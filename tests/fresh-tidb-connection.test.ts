import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { secureMysqlUrl } from "../apps/api/src/config";

describe("fresh TiDB closeout target", () => {
  it("accepts the protected FRESH_TIDB_DATABASE_URL through a read-only connectivity probe", async () => {
    const rawUrl = process.env.FRESH_TIDB_DATABASE_URL ?? process.env.TARGET_TIDB_DATABASE_URL ?? process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
    expect(rawUrl, "A TiDB DATABASE_URL must be configured").toBeTruthy();

    const prisma = new PrismaClient({
      datasources: { db: { url: secureMysqlUrl(rawUrl!) } },
    });

    try {
      const result = await prisma.$queryRawUnsafe<Array<{ one: number }>>("SELECT 1 AS one");
      expect(Number(result[0]?.one)).toBe(1);
      const tables = await prisma.$queryRawUnsafe<Array<Record<string, string>>>("SHOW TABLES");
      const tableNames = tables.map((row) => Object.values(row)[0]).filter((name): name is string => typeof name === "string");
      const applicationTables = tableNames.filter((name) => name !== "schema_unused_indexes");
      if (process.env.FRESH_TIDB_EXPECT_EMPTY === "1") {
        expect(applicationTables, "The supplied TiDB target must contain no application tables before fresh migration").toEqual([]);
      } else {
        expect(applicationTables, "The migrated clean target must expose Prisma migration history").toContain("_prisma_migrations");
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);
});
