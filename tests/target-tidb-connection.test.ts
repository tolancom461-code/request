import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { secureMysqlUrl } from "../apps/api/src/config.js";

const targetUrl = process.env.TARGET_TIDB_DATABASE_URL ?? process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
const prisma = targetUrl ? new PrismaClient({ datasources: { db: { url: secureMysqlUrl(targetUrl) } } }) : null;
const appUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
const appPrisma = appUrl ? new PrismaClient({ datasources: { db: { url: secureMysqlUrl(appUrl) } } }) : null;
const applicationTables = new Set(["users", "roles", "permissions", "role_permissions", "user_roles", "branches", "user_branch_scopes", "categories", "items", "units", "item_units", "branch_items", "suppliers", "branch_item_suppliers", "requests", "request_items", "request_approvals", "request_status_history", "audit_logs", "notifications", "server_sessions", "_prisma_migrations"]);

afterAll(async () => {
  await prisma?.$disconnect();
  await appPrisma?.$disconnect();
});

describe("TiDB target migration connection", () => {
  it("accepts the protected target connection through a TLS read-only probe", async () => {
    expect(targetUrl).toBeTruthy();
    const rows = await prisma!.$queryRaw<Array<{ databaseName: string | null }>>`SELECT DATABASE() AS databaseName`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.databaseName).toBe(new URL(targetUrl!).pathname.replace(/^\//, ""));
  }, 60_000);

  it("accepts the managed application database secret through a TLS read-only probe", async () => {
    expect(appUrl).toBeTruthy();
    const rows = await appPrisma!.$queryRaw<Array<{ databaseName: string | null }>>`SELECT DATABASE() AS databaseName`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.databaseName).toBe(new URL(appUrl!).pathname.replace(/^\//, ""));
  }, 60_000);

  it("reads the target table inventory without writing data", async () => {
    const tables = await prisma!.$queryRaw<Array<{ tableName: string }>>`SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`;
    const existingApplicationTables = tables.map((table) => table.tableName).filter((table) => applicationTables.has(table));
    console.log(JSON.stringify({ event: "target_tidb_read_only_inventory", databaseTableCount: tables.length, applicationTableCount: existingApplicationTables.length, applicationTables: existingApplicationTables }));
    expect(existingApplicationTables).toEqual([...applicationTables].sort());
  }, 60_000);
});
