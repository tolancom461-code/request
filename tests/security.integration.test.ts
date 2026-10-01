import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication } from "../apps/api/src/main.js";
import { secureMysqlUrl } from "../apps/api/src/config.js";
import { SessionService } from "../apps/api/src/session.service.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const prisma = new PrismaClient({ datasources: { db: { url: secureMysqlUrl(process.env.DATABASE_URL ?? "") } } });
const password = "phase2a-password";
let app: NestFastifyApplication;
let branchA = "";
let branchB = "";
let suffix = "";
const createdEmails: string[] = [];
type Login = { cookie: string; csrfToken: string; rawCookie: string };

const cookieId = (cookie: string) => cookie.split("=")[1];

async function connectTiDbWithRetry(attempts = 4) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await prisma.$connect();
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Can't reach database server") || attempt === attempts) throw error;
      await prisma.$disconnect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

async function createUser(roleCode: string, branchIds: string[], status: "active" | "inactive" = "active") {
  const token = randomUUID().slice(0, 8);
  const email = `security-${roleCode}-${suffix}-${token}@example.test`;
  createdEmails.push(email);
  const user = await prisma.user.create({ data: { username: `security-${token}`, email, passwordHash: await argon2.hash(password), status, updatedAt: new Date() } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  for (const branchId of branchIds) await prisma.userBranchScope.create({ data: { userId: user.id, branchId } });
  return { user, email, username: user.username };
}

async function login(username: string, passwordValue = password): Promise<Login> {
  const response = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ username, password: passwordValue });
  expect(response.status).toBe(201);
  const rawCookie = response.headers["set-cookie"]?.[0] as string;
    expect(rawCookie).toContain("session=");
  return { rawCookie, cookie: rawCookie.split(";")[0], csrfToken: response.body.csrfToken };
}

beforeAll(async () => {
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  await connectTiDbWithRetry();
  suffix = randomUUID().slice(0, 8);
  const now = new Date();
  const first = await prisma.branch.create({ data: { code: `SEC-A-${suffix}`, nameAr: "فرع أمان أ", nameEn: "Security Branch A", updatedAt: now } });
  const second = await prisma.branch.create({ data: { code: `SEC-B-${suffix}`, nameAr: "فرع أمان ب", nameEn: "Security Branch B", updatedAt: now } });
  branchA = first.id;
  branchB = second.id;
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  for (const email of createdEmails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) continue;
    await prisma.userBranchScope.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await app?.close();
  await prisma.$disconnect();
});

describe("Phase 2A authentication, authorization, and platform security", () => {
  it("TC-SEC-01 passes API liveness and readiness with TiDB and the configured session store", async () => {
    const live = await request(app.getHttpServer()).get("/api/v1/health/live");
    const ready = await request(app.getHttpServer()).get("/api/v1/health/ready");
    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ status: "ready", database: "ok" });
    expect(["redis", "tidb"]).toContain(ready.body.sessionStore);
  });

  it("TC-SEC-02 accepts valid login, creates an HttpOnly cookie and persists the configured server-side session", async () => {
    const employee = await createUser("branch_employee", [branchA]);
    const session = await login(employee.username);
    expect(session.rawCookie).toContain("HttpOnly");
    const redisSession = await app.get(SessionService).get(cookieId(session.cookie));
    expect(redisSession?.userId).toBe(employee.user.id);
  });

  it("TC-SEC-03 rejects invalid password, unknown user, and inactive user", async () => {
    const active = await createUser("branch_employee", [branchA]);
    const inactive = await createUser("branch_employee", [branchA], "inactive");
    expect((await request(app.getHttpServer()).post("/api/v1/auth/login").send({ username: active.username, password: "wrong-password" })).status).toBe(401);
    expect((await request(app.getHttpServer()).post("/api/v1/auth/login").send({ username: `unknown-${suffix}`, password })).status).toBe(401);
    expect((await request(app.getHttpServer()).post("/api/v1/auth/login").send({ username: inactive.username, password })).status).toBe(401);
  });

  it("TC-SEC-04 returns current user for a valid session and rejects unauthenticated or invalid sessions", async () => {
    const employee = await createUser("branch_employee", [branchA]);
    const session = await login(employee.username);
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", session.cookie)).body.user.email).toBe(employee.email);
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me")).status).toBe(401);
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", "__Host-session=not-a-real-session")).status).toBe(401);
  });

  it("TC-SEC-05 invalidates the server-side session on logout and rejects the old cookie", async () => {
    const employee = await createUser("branch_employee", [branchA]);
    const session = await login(employee.username);
    const loggedOut = await request(app.getHttpServer()).post("/api/v1/auth/logout").set("Cookie", session.cookie).set("Origin", "http://localhost:5173").set("X-CSRF-Token", session.csrfToken);
    expect(loggedOut.status).toBe(201);
    expect(await app.get(SessionService).get(cookieId(session.cookie))).toBeNull();
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", session.cookie)).status).toBe(401);
  });

  it("TC-SEC-06 enforces all four role permissions independently", async () => {
    const employee = await createUser("branch_employee", [branchA]);
    const manager = await createUser("branch_manager", [branchA, branchB]);
    const warehouse = await createUser("warehouse_manager", [branchA]);
    const admin = await createUser("system_admin", [branchA]);
    const employeeSession = await login(employee.username);
    const managerSession = await login(manager.username);
    const warehouseSession = await login(warehouse.username);
    const adminSession = await login(admin.username);
    const mutate = (path: string, session: Login) => request(app.getHttpServer()).post(path).set("Cookie", session.cookie).set("Origin", "http://localhost:5173").set("X-CSRF-Token", session.csrfToken);
    expect((await mutate("/api/v1/foundation/manager-action", employeeSession)).status).toBe(403);
    expect((await mutate("/api/v1/foundation/warehouse-action", employeeSession)).status).toBe(403);
    expect((await mutate("/api/v1/foundation/admin-action", employeeSession)).status).toBe(403);
    expect((await mutate("/api/v1/foundation/manager-action", managerSession)).status).toBe(201);
    expect((await mutate("/api/v1/foundation/admin-action", managerSession)).status).toBe(403);
    expect((await mutate("/api/v1/foundation/warehouse-action", warehouseSession)).status).toBe(201);
    expect((await mutate("/api/v1/foundation/admin-action", warehouseSession)).status).toBe(403);
    expect((await mutate("/api/v1/foundation/admin-action", adminSession)).status).toBe(201);
    expect((await request(app.getHttpServer()).post("/api/v1/foundation/admin-action")).status).toBe(401);
  });

  it("TC-SEC-07 enforces positive and negative branch scope without client-id bypass", async () => {
    const employee = await createUser("branch_employee", [branchA]);
    const manager = await createUser("branch_manager", [branchA, branchB]);
    const employeeSession = await login(employee.username);
    const managerSession = await login(manager.username);
    expect((await request(app.getHttpServer()).get(`/api/v1/foundation/branch/${branchA}`).set("Cookie", employeeSession.cookie)).status).toBe(200);
    expect((await request(app.getHttpServer()).get(`/api/v1/foundation/branch/${branchB}`).set("Cookie", employeeSession.cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`/api/v1/foundation/branch/${branchA}`).set("Cookie", managerSession.cookie)).status).toBe(200);
    expect((await request(app.getHttpServer()).get(`/api/v1/foundation/branch/${branchB}`).set("Cookie", managerSession.cookie)).status).toBe(200);
  });

  it("TC-SEC-08 separates valid, missing and invalid CSRF outcomes", async () => {
    const employee = await createUser("branch_employee", [branchA]);
    const session = await login(employee.username);
    const valid = await request(app.getHttpServer()).post("/api/v1/foundation/manager-action").set("Cookie", session.cookie).set("Origin", "http://localhost:5173").set("X-CSRF-Token", session.csrfToken);
    const missing = await request(app.getHttpServer()).post("/api/v1/foundation/manager-action").set("Cookie", session.cookie).set("Origin", "http://localhost:5173");
    const invalid = await request(app.getHttpServer()).post("/api/v1/foundation/manager-action").set("Cookie", session.cookie).set("Origin", "http://localhost:5173").set("X-CSRF-Token", "invalid-token");
    expect(valid.status).toBe(403);
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
  });

  it("TC-SEC-09 keeps credentialed CORS origin-specific and does not grant an unapproved origin", async () => {
    const allowed = await request(app.getHttpServer()).options("/api/v1/foundation/manager-action").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "POST");
    const rejected = await request(app.getHttpServer()).options("/api/v1/foundation/manager-action").set("Origin", "https://unapproved.example").set("Access-Control-Request-Method", "POST");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(allowed.headers["access-control-allow-origin"]).not.toBe("*");
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
