import { Inject, Injectable, OnModuleDestroy, UnauthorizedException } from "@nestjs/common";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Redis } from "ioredis";
import type { FastifyReply, FastifyRequest } from "fastify";
import { loadConfig } from "./config.js";
import { PrismaService } from "./prisma.service.js";

export type SessionRecord = {
  id: string;
  userId: string;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
};

export type SessionStoreKind = "redis" | "tidb";

export function allowedCsrfOrigins(config: Pick<ReturnType<typeof loadConfig>, "NODE_ENV" | "PUBLIC_APP_ORIGIN">) {
  return config.NODE_ENV === "production"
    ? new Set([config.PUBLIC_APP_ORIGIN])
    : new Set([config.PUBLIC_APP_ORIGIN, "http://localhost:3000", "http://localhost:5173"]);
}

const sessionKey = (id: string) => `restaurant:session:${id}`;

@Injectable()
export class SessionService implements OnModuleDestroy {
  readonly redis?: Redis;
  private readonly config = loadConfig();
  readonly storeKind: SessionStoreKind;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.storeKind = this.config.REDIS_URL ? "redis" : "tidb";
    if (this.config.REDIS_URL) this.redis = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  }

  private sessionCookieName() {
    if (this.config.NODE_ENV === "production" || !this.config.SESSION_COOKIE_NAME.startsWith("__Host-")) return this.config.SESSION_COOKIE_NAME;
    return this.config.SESSION_COOKIE_NAME.slice("__Host-".length);
  }

  private expiry(createdAt: number, now: number) {
    return Math.min(now + this.config.SESSION_IDLE_MINUTES * 60_000, createdAt + this.config.SESSION_ABSOLUTE_HOURS * 3600_000);
  }

  async connect() {
    if (this.redis?.status === "wait") await this.redis.connect();
  }

  async health() {
    if (this.redis) {
      await this.connect();
      await this.redis.ping();
      return "redis" as const;
    }
    await this.prisma.$queryRaw`SELECT 1`;
    return "tidb" as const;
  }

  async onModuleDestroy() {
    if (this.redis && this.redis.status !== "end") await this.redis.quit();
  }

  async create(userId: string): Promise<SessionRecord> {
    const now = Date.now();
    const session: SessionRecord = {
      id: randomUUID(),
      userId,
      csrfToken: randomUUID(),
      createdAt: now,
      lastSeenAt: now,
    };
    if (this.redis) {
      await this.connect();
      await this.redis.set(sessionKey(session.id), JSON.stringify(session), "EX", Math.ceil((this.expiry(now, now) - now) / 1000));
    } else {
      const expiresAt = new Date(this.expiry(now, now));
      await this.prisma.serverSession.create({ data: { id: session.id, userId, csrfToken: session.csrfToken, createdAt: new Date(now), lastSeenAt: new Date(now), expiresAt } });
    }
    return session;
  }

  async get(id?: string): Promise<SessionRecord | null> {
    if (!id) return null;
    if (this.redis) {
      await this.connect();
      const raw = await this.redis.get(sessionKey(id));
      if (!raw) return null;
      const session = JSON.parse(raw) as SessionRecord;
      const now = Date.now();
      const absoluteExpiry = session.createdAt + this.config.SESSION_ABSOLUTE_HOURS * 3600_000;
      if (now >= absoluteExpiry || now >= session.lastSeenAt + this.config.SESSION_IDLE_MINUTES * 60_000) {
        await this.destroy(id);
        return null;
      }
      session.lastSeenAt = now;
      await this.redis.set(sessionKey(id), JSON.stringify(session), "EX", Math.ceil((this.expiry(session.createdAt, now) - now) / 1000));
      return session;
    }
    const stored = await this.prisma.serverSession.findUnique({ where: { id } });
    if (!stored) return null;
    const now = Date.now();
    const absoluteExpiry = stored.createdAt.getTime() + this.config.SESSION_ABSOLUTE_HOURS * 3600_000;
    if (now >= absoluteExpiry || now >= stored.expiresAt.getTime() || now >= stored.lastSeenAt.getTime() + this.config.SESSION_IDLE_MINUTES * 60_000) {
      await this.prisma.serverSession.delete({ where: { id } }).catch(() => undefined);
      return null;
    }
    await this.prisma.serverSession.update({ where: { id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(this.expiry(stored.createdAt.getTime(), now)) } });
    return { id: stored.id, userId: stored.userId, csrfToken: stored.csrfToken, createdAt: stored.createdAt.getTime(), lastSeenAt: now };
  }

  async destroy(id?: string) {
    if (!id) return;
    if (this.redis) {
      await this.connect();
      await this.redis.del(sessionKey(id));
    } else {
      await this.prisma.serverSession.delete({ where: { id } }).catch(() => undefined);
    }
  }

  async destroyUserSessions(userId: string) {
    if (!this.redis) {
      await this.prisma.serverSession.deleteMany({ where: { userId } });
      return;
    }
    await this.connect();
    const stream = this.redis.scanStream({ match: "restaurant:session:*" });
    const deletions: string[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", async (keys: string[]) => {
        for (const key of keys) {
          const raw = await this.redis!.get(key);
          if (raw && (JSON.parse(raw) as SessionRecord).userId === userId) deletions.push(key);
        }
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    if (deletions.length) await this.redis.del(...deletions);
  }

  setCookie(reply: FastifyReply, session: SessionRecord) {
    const production = this.config.NODE_ENV === "production";
    const now = Date.now();
    reply.setCookie(this.sessionCookieName(), session.id, {
      httpOnly: true,
      secure: production,
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(0, Math.ceil((this.expiry(session.createdAt, now) - now) / 1000)),
    });
  }

  clearCookie(reply: FastifyReply) {
    reply.clearCookie(this.sessionCookieName(), { path: "/", httpOnly: true, secure: this.config.NODE_ENV === "production", sameSite: "lax" });
  }

  requestSessionId(request: FastifyRequest): string | undefined {
    return request.cookies[this.sessionCookieName()];
  }

  assertCsrf(session: SessionRecord, token: string | undefined, origin: string | undefined) {
    if (!token || !origin) throw new UnauthorizedException("CSRF validation failed.");
    const expected = Buffer.from(session.csrfToken);
    const actual = Buffer.from(token);
    const allowedOrigins = allowedCsrfOrigins(this.config);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || !allowedOrigins.has(origin)) {
      throw new UnauthorizedException("CSRF validation failed.");
    }
  }
}
