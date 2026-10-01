import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { secureMysqlUrl } from "../apps/api/src/config.js";
import { PrismaService } from "../apps/api/src/prisma.service.js";
import { SessionService } from "../apps/api/src/session.service.js";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const suffix = randomUUID().slice(0, 8);
const email = `session-fallback-${suffix}@example.test`;
let userId = "";
let sessions: SessionService;

beforeAll(async () => {
  await prisma.$connect();
  const user = await prisma.user.create({ data: { username: `session-fallback-${suffix}`, email, status: "active", updatedAt: new Date() } });
  userId = user.id;
  sessions = new SessionService(prisma as unknown as PrismaService);
});

afterAll(async () => {
  await sessions?.destroyUserSessions(userId).catch(() => undefined);
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("TiDB session fallback", () => {
  it("persists, reads, invalidates, and reports a TiDB-backed server session without REDIS_URL", async () => {
    expect(await sessions.health()).toBe("tidb");
    const created = await sessions.create(userId);
    expect((await sessions.get(created.id))?.userId).toBe(userId);
    await sessions.destroyUserSessions(userId);
    expect(await sessions.get(created.id)).toBeNull();
  });
});
