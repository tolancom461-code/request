import { PrismaClient } from "@prisma/client";

const sourceUrl = process.env.TARGET_TIDB_DATABASE_URL;
const databaseName = "restaurant_branch_requisition";

if (!sourceUrl) {
  throw new Error("TARGET_TIDB_DATABASE_URL is required.");
}

const secureUrl = sourceUrl.includes("sslaccept=")
  ? sourceUrl
  : `${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}sslaccept=strict`;
const prisma = new PrismaClient({ datasources: { db: { url: secureUrl } } });

try {
  await prisma.$executeRawUnsafe(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const rows = await prisma.$queryRawUnsafe(
    "SELECT schema_name AS databaseName FROM information_schema.schemata WHERE schema_name = ?",
    databaseName,
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("Target database was not confirmed after creation.");
  }
  console.log(JSON.stringify({ event: "target_database_created_or_confirmed", databaseName }));
} finally {
  await prisma.$disconnect();
}
