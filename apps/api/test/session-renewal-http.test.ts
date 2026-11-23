import "reflect-metadata";
import { Controller, Get, Inject, Module, Post, Req, Res } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../src/prisma.service.js";
import { SessionService } from "../src/session.service.js";
import { AccessGuard, AccessService, Permissions } from "../src/security.js";

type Stored = { id: string; userId: string; csrfToken: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date };
const rows = new Map<string, Stored>();
const prisma = {
  $queryRaw: async (_query: TemplateStringsArray, userId: string) => [{
    id: userId, username: userId, email: null, roleCode: null, permissionCode: null, branchId: null,
  }],
  serverSession: {
    create: async ({ data }: { data: Stored }) => { rows.set(data.id, data); return data; },
    findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    updateMany: async ({ where, data }: { where: { id: string }; data: Partial<Stored> }) => {
      const row = { ...rows.get(where.id)!, ...data };
      rows.set(where.id, row);
      return { count: 1 };
    },
    delete: async ({ where }: { where: { id: string } }) => rows.delete(where.id),
  },
};
@Controller("session-probe")
@Permissions()
class ProbeController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}
  @Get() get() { return { authenticated: true }; }
  @Post("logout") async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.destroy(this.sessions.requestSessionId(request));
    this.sessions.clearCookie(reply);
    return { success: true };
  }
}
@Module({
  controllers: [ProbeController],
  providers: [
    SessionService,
    AccessService,
    { provide: PrismaService, useValue: prisma },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
class ProbeModule {}

const start = Date.parse("2026-11-23T12:00:00Z");
const minute = 60_000;
let app: NestFastifyApplication;
let sessions: SessionService;
let clock: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  rows.clear();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SESSION_SECRET", "session-renewal-isolated-test-secret");
  vi.stubEnv("SESSION_COOKIE_NAME", "__Host-session");
  vi.stubEnv("SESSION_IDLE_MINUTES", "30");
  vi.stubEnv("SESSION_ABSOLUTE_HOURS", "1");
  vi.stubEnv("PUBLIC_APP_ORIGIN", "http://localhost:5173");
  vi.stubEnv("REDIS_URL", undefined);
  clock = vi.spyOn(Date, "now").mockReturnValue(start);
  app = await NestFactory.create<NestFastifyApplication>(ProbeModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  sessions = app.get(SessionService);
});
afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Session renewal through protected HTTP requests", () => {
  it("sets the initial server expiry to the configured idle timeout", async () => {
    const session = await sessions.create("admin");
    expect(rows.get(session.id)?.expiresAt.getTime()).toBe(start + 30 * minute);
  });

  it("renews the browser cookie while active, so it remains usable after the original expiry", async () => {
    const session = await sessions.create("admin");
    clock.mockReturnValue(start + 20 * minute);
    const first = await app.inject({ url: "/session-probe", headers: { cookie: `session=${session.id}` } });
    expect(first.statusCode).toBe(200);
    const renewed = first.cookies.find(value => value.name === "session");
    expect(renewed).toMatchObject({ value: session.id, maxAge: 1800, httpOnly: true, sameSite: "Lax", path: "/" });
    expect(rows.get(session.id)?.expiresAt.getTime()).toBe(start + 50 * minute);
    clock.mockReturnValue(start + 35 * minute);
    const next = await app.inject({ url: "/session-probe", headers: { cookie: `session=${renewed!.value}` } });
    expect(next.statusCode).toBe(200);
  });

  it("does not renew an expired or missing session", async () => {
    const session = await sessions.create("admin");
    clock.mockReturnValue(start + 31 * minute);
    const expired = await app.inject({ url: "/session-probe", headers: { cookie: `session=${session.id}` } });
    expect(expired.statusCode).toBe(401);
    expect(expired.headers["set-cookie"]).toBeUndefined();
    expect((await app.inject({ url: "/session-probe" })).statusCode).toBe(401);
  });

  it("caps renewed browser and server expiry at the absolute session limit", async () => {
    const session = await sessions.create("admin");
    for (const elapsed of [20, 40, 55]) {
      clock.mockReturnValue(start + elapsed * minute);
      const response = await app.inject({ url: "/session-probe", headers: { cookie: `session=${session.id}` } });
      expect(response.statusCode).toBe(200);
      if (elapsed === 55) {
        expect(response.cookies.find(value => value.name === "session")?.maxAge).toBe(300);
        expect(rows.get(session.id)?.expiresAt.getTime()).toBe(start + 60 * minute);
      }
    }
    clock.mockReturnValue(start + 60 * minute);
    expect((await app.inject({ url: "/session-probe", headers: { cookie: `session=${session.id}` } })).statusCode).toBe(401);
  });

  it("renews Redis TTL with the same idle and absolute limits", async () => {
    const values = new Map<string, string>();
    const redis = {
      status: "ready",
      get: async (key: string) => values.get(key) ?? null,
      set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number) => { values.set(key, value); }),
      del: async (key: string) => values.delete(key),
      quit: async () => undefined,
    };
    Object.defineProperty(sessions, "redis", { value: redis });
    const session = await sessions.create("admin");
    expect(redis.set.mock.calls.at(-1)?.[3]).toBe(1800);
    for (const [elapsed, ttl] of [[20, 1800], [40, 1200], [55, 300]]) {
      clock.mockReturnValue(start + elapsed * minute);
      expect((await sessions.get(session.id))?.id).toBe(session.id);
      expect(redis.set.mock.calls.at(-1)?.[3]).toBe(ttl);
    }
    clock.mockReturnValue(start + 60 * minute);
    expect(await sessions.get(session.id)).toBeNull();
    expect(values.size).toBe(0);
    const idle = await sessions.create("admin");
    clock.mockReturnValue(start + 91 * minute);
    expect(await sessions.get(idle.id)).toBeNull();
  });

  it("clears the cookie on logout after the guard has renewed it", async () => {
    const session = await sessions.create("admin");
    const response = await app.inject({ method: "POST", url: "/session-probe/logout", headers: { cookie: `session=${session.id}`, origin: "http://localhost:5173", "x-csrf-token": session.csrfToken } });
    expect(response.statusCode).toBe(201);
    expect(response.cookies.filter(value => value.name === "session").at(-1)?.value).toBe("");
    expect(await sessions.get(session.id)).toBeNull();
  });
});
