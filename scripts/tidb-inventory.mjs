import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const connectionName = process.argv[2];
const url = connectionName === "source" ? process.env.DATABASE_URL : process.env.TARGET_TIDB_DATABASE_URL;

if (!url || !["source", "target"].includes(connectionName)) {
  throw new Error("Run as: node scripts/tidb-inventory.mjs <source|target>");
}

const secureUrl = url.includes("sslaccept=") ? url : `${url}${url.includes("?") ? "&" : "?"}sslaccept=strict`;
const prisma = new PrismaClient({ datasources: { db: { url: secureUrl } } });
const quoted = (identifier) => `\`${identifier.replaceAll("`", "``")}\``;

try {
  const databases = await prisma.$queryRawUnsafe("SELECT DATABASE() AS databaseName");
  const databaseName = databases[0]?.databaseName;
  const tables = await prisma.$queryRawUnsafe(
    "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const inventory = [];
  for (const { tableName } of tables) {
    const countRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS rowCount FROM ${quoted(tableName)}`);
    const definitionRows = await prisma.$queryRawUnsafe(`SHOW CREATE TABLE ${quoted(tableName)}`);
    const definition = Object.values(definitionRows[0] ?? {}).find((value) => typeof value === "string" && value.includes("CREATE TABLE")) ?? "";
    inventory.push({ tableName, rowCount: String(countRows[0]?.rowCount ?? 0), ddlSha256: createHash("sha256").update(definition).digest("hex") });
  }
  console.log(JSON.stringify({ event: "tidb_read_only_inventory", connectionName, databaseName, tableCount: inventory.length, tables: inventory }));
} finally {
  await prisma.$disconnect();
}
