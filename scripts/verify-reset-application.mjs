import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  clientFor,
  connectionUrl,
  loadBackup,
  sanitizedFailure,
} from "./database-snapshot.mjs";

const reset = JSON.parse(readFileSync("evidence/reset-applied.json", "utf8"));
if (!reset.schemaParity || reset.databaseName !== "REQUEST")
  throw new Error(
    "The authorized reset must finish before application verification."
  );
const backup = loadBackup(reset.backupDirectory);
const originalUsers = backup.tables.find(
  table => table.tableName === "users"
).rows;
const url = connectionUrl();
process.env.DATABASE_URL = url;
process.env.APP_DATABASE_URL = url;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
delete process.env.REDIS_URL;
const db = clientFor();
let app, sessions, session;
try {
  const admins = await db.user.findMany({
    where: {
      status: "active",
      roles: { some: { role: { code: "system_admin" } } },
    },
  });
  if (
    admins.length !== reset.preservedAdminCount ||
    admins.some(
      admin =>
        !originalUsers.some(
          before =>
            before.id === admin.id &&
            before.password_hash === admin.passwordHash &&
            before.username === admin.username
        )
    )
  )
    throw new Error("Administrator credentials changed unexpectedly.");
  const { createApplication } = await import("../apps/api/dist/main.js");
  const { SessionService } = await import(
    "../apps/api/dist/session.service.js"
  );
  app = await createApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  sessions = app.get(SessionService);
  session = await sessions.create(admins[0].id);
  const cookieName = (
    process.env.SESSION_COOKIE_NAME ?? "__Host-session"
  ).replace(/^__Host-/, "");
  const headers = { cookie: `${cookieName}=${session.id}` };
  const checks = {};
  for (const path of [
    "health/ready",
    "auth/me",
    "admin/item-setup/options",
    "admin/item-setup/items",
    "reports/dashboard",
  ]) {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/${path}`,
      headers,
    });
    checks[path] = response.statusCode;
    if (response.statusCode !== 200)
      throw new Error(`Application check failed: ${path}`);
    const body = response.json();
    if (path === "admin/item-setup/items" && body.length)
      throw new Error("Trial items remain after reset.");
    if (
      path === "admin/item-setup/options" &&
      Object.values(body).some(rows => rows.length)
    )
      throw new Error("Trial master data remains after reset.");
    if (path === "reports/dashboard" && body.kpis.submittedRequests !== 0)
      throw new Error("Trial requests remain after reset.");
  }
  await sessions.destroy(session.id);
  session = null;
  if ((await db.serverSession.count()) !== 0)
    throw new Error("The verification session was not removed.");
  const report = {
    passed: true,
    administratorCredentialsUnchanged: true,
    adminCount: admins.length,
    checks,
    verificationSessionsRemaining: 0,
    verifiedAt: new Date().toISOString(),
  };
  writeFileSync(
    "evidence/reset-application-verification.json",
    JSON.stringify(report, null, 2)
  );
  console.log(
    JSON.stringify({ event: "reset_application_verified", ...report })
  );
} catch (error) {
  console.error(JSON.stringify(sanitizedFailure(error)));
  process.exitCode = 1;
} finally {
  if (session) await sessions?.destroy(session.id);
  await app?.close();
  await db.$disconnect();
}
