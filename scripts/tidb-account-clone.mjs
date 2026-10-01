import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const mode = process.argv[2];
const sourceUrl = process.env.DATABASE_URL;
const targetUrl = process.env.TARGET_TIDB_DATABASE_URL;

if (!sourceUrl || !["snapshot", "apply", "compare"].includes(mode)) {
  throw new Error("Run as: node scripts/tidb-account-clone.mjs <snapshot|compare|apply>");
}
if (["apply", "compare"].includes(mode) && !targetUrl) {
  throw new Error("TARGET_TIDB_DATABASE_URL is required for compare or apply mode.");
}

const withTls = (url) => url.includes("sslaccept=") ? url : `${url}${url.includes("?") ? "&" : "?"}sslaccept=strict`;
const quoted = (identifier) => `\`${identifier.replaceAll("`", "``")}\``;
const source = new PrismaClient({ datasources: { db: { url: withTls(sourceUrl) } } });
const target = targetUrl ? new PrismaClient({ datasources: { db: { url: withTls(targetUrl) } } }) : null;

function stableValue(value) {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return { bigint: value.toString() };
  if (value instanceof Date) return { date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { buffer: value.toString("base64") };
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digestRows(rows, columns) {
  const normalized = rows.map((row) => JSON.stringify(Object.fromEntries(columns.map((column) => [column, stableValue(row[column])])))).sort();
  return createHash("sha256").update(normalized.join("\n")).digest("hex");
}

function findCreateStatement(row) {
  return Object.values(row ?? {}).find((value) => typeof value === "string" && value.includes("CREATE TABLE"));
}

async function readSnapshot(client) {
  return client.$transaction(async (tx) => {
    const databaseRows = await tx.$queryRawUnsafe("SELECT DATABASE() AS databaseName");
    const databaseName = databaseRows[0]?.databaseName;
    const tableRows = await tx.$queryRawUnsafe("SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name");
    const relationRows = await tx.$queryRawUnsafe("SELECT table_name AS tableName, referenced_table_name AS referencedTableName FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL ORDER BY table_name, referenced_table_name");
    const tables = [];
    for (const { tableName } of tableRows) {
      const columnRows = await tx.$queryRawUnsafe("SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position", tableName);
      const columns = columnRows.map(({ columnName }) => columnName);
      const definitionRows = await tx.$queryRawUnsafe(`SHOW CREATE TABLE ${quoted(tableName)}`);
      const ddl = findCreateStatement(definitionRows[0]);
      if (!ddl) throw new Error(`No CREATE TABLE definition was returned for ${tableName}.`);
      const rows = await tx.$queryRawUnsafe(`SELECT * FROM ${quoted(tableName)}`);
      tables.push({ tableName, columns, ddl, rows, rowCount: rows.length, ddlSha256: createHash("sha256").update(ddl).digest("hex"), dataSha256: digestRows(rows, columns) });
    }
    return { databaseName, tables, relations: relationRows };
  }, { maxWait: 60_000, timeout: 600_000 });
}

function publicManifest(snapshot) {
  return {
    tableCount: snapshot.tables.length,
    totalRows: snapshot.tables.reduce((sum, table) => sum + table.rowCount, 0),
    tables: snapshot.tables.map(({ tableName, rowCount, ddlSha256, dataSha256 }) => ({ tableName, rowCount, ddlSha256, dataSha256 })),
  };
}

function topologicalTables(snapshot) {
  const tableNames = new Set(snapshot.tables.map((table) => table.tableName));
  const pending = new Map(snapshot.tables.map((table) => [table.tableName, new Set()]));
  for (const { tableName, referencedTableName } of snapshot.relations) {
    if (tableNames.has(tableName) && tableNames.has(referencedTableName) && tableName !== referencedTableName) pending.get(tableName).add(referencedTableName);
  }
  const ordered = [];
  while (pending.size) {
    const ready = [...pending.entries()].filter(([, dependencies]) => dependencies.size === 0).map(([name]) => name).sort();
    if (!ready.length) throw new Error("Foreign-key dependency cycle detected; target was left unchanged.");
    for (const tableName of ready) {
      ordered.push(tableName);
      pending.delete(tableName);
      for (const dependencies of pending.values()) dependencies.delete(tableName);
    }
  }
  return ordered;
}

async function assertEmptyTarget(client) {
  const rows = await client.$queryRawUnsafe("SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'");
  if (Number(rows[0]?.tableCount ?? 0) !== 0) throw new Error("Target database is not empty; copy was not started.");
}

async function insertTableRows(client, table) {
  const chunkSize = 100;
  for (let offset = 0; offset < table.rows.length; offset += chunkSize) {
    const rows = table.rows.slice(offset, offset + chunkSize);
    const tuple = `(${table.columns.map(() => "?").join(", ")})`;
    const sql = `INSERT INTO ${quoted(table.tableName)} (${table.columns.map(quoted).join(", ")}) VALUES ${rows.map(() => tuple).join(", ")}`;
    const values = rows.flatMap((row) => table.columns.map((column) => row[column]));
    await client.$executeRawUnsafe(sql, ...values);
  }
}

function assertEquivalent(sourceSnapshot, targetSnapshot) {
  const sourceManifest = publicManifest(sourceSnapshot);
  const targetManifest = publicManifest(targetSnapshot);
  if (JSON.stringify(sourceManifest) !== JSON.stringify(targetManifest)) {
    throw new Error("Post-copy table count, row count, DDL hash, or data hash differs; source remains unchanged.");
  }
}

try {
  const sourceSnapshot = await readSnapshot(source);
  if (mode === "snapshot") {
    console.log(JSON.stringify({ event: "source_snapshot_complete", source: publicManifest(sourceSnapshot) }));
  } else if (mode === "compare") {
    const targetSnapshot = await readSnapshot(target);
    assertEquivalent(sourceSnapshot, targetSnapshot);
    console.log(JSON.stringify({ event: "live_source_target_comparison_verified", source: publicManifest(sourceSnapshot), target: publicManifest(targetSnapshot) }));
  } else {
    await assertEmptyTarget(target);
    const byName = new Map(sourceSnapshot.tables.map((table) => [table.tableName, table]));
    const order = topologicalTables(sourceSnapshot);
    for (const tableName of order) await target.$executeRawUnsafe(byName.get(tableName).ddl);
    await target.$transaction(async (tx) => {
      for (const tableName of order) await insertTableRows(tx, byName.get(tableName));
    }, { maxWait: 60_000, timeout: 600_000 });
    const targetSnapshot = await readSnapshot(target);
    assertEquivalent(sourceSnapshot, targetSnapshot);
    console.log(JSON.stringify({ event: "database_copy_verified", source: publicManifest(sourceSnapshot), target: publicManifest(targetSnapshot) }));
  }
} finally {
  await source.$disconnect();
  await target?.$disconnect();
}
