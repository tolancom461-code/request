import { Prisma, PrismaClient } from "@prisma/client";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const quote = value => "`" + value.replaceAll("`", "``") + "`";
export const hash = value => createHash("sha256").update(value).digest("hex");
export function connectionUrl(databaseName) {
  const entry = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find(line => line.startsWith("DATABASE_URL="));
  if (!entry) throw new Error("Local database configuration is missing.");
  const url = new URL(
    entry
      .slice(entry.indexOf("=") + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
  );
  if (
    url.hostname !== "gateway01.ap-southeast-1.prod.aws.tidbcloud.com" ||
    url.pathname !== "/REQUEST"
  )
    throw new Error(
      "Unexpected source database; maintenance is limited to the authorized REQUEST database."
    );
  if (databaseName) {
    if (
      databaseName !== "REQUEST" &&
      !/^REQUEST_verify_[a-f0-9]{8}$/.test(databaseName)
    )
      throw new Error("Unexpected verification database name.");
    url.pathname = `/${databaseName}`;
  }
  url.searchParams.set("sslaccept", "strict");
  url.searchParams.set("connection_limit", "1");
  return url.toString();
}
export const clientFor = name =>
  new PrismaClient({ datasources: { db: { url: connectionUrl(name) } } });
const encode = value => {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (Prisma.Decimal.isDecimal(value)) return { $decimal: value.toString() };
  if (value instanceof Uint8Array)
    return { $bytes: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object")
    return { $json: JSON.stringify(value) };
  return value;
};
const decode = value =>
  value && typeof value === "object"
    ? "$date" in value
      ? new Date(value.$date)
      : "$bigint" in value
        ? BigInt(value.$bigint)
        : "$decimal" in value
          ? value.$decimal
          : "$bytes" in value
            ? Buffer.from(value.$bytes, "base64")
            : "$json" in value
              ? value.$json
              : value
    : value;
export function dataDigest(rows, columns) {
  return hash(
    rows
      .map(row => JSON.stringify(columns.map(column => row[column])))
      .sort()
      .join("\n")
  );
}
export async function snapshot(client) {
  return client.$transaction(
    async tx => {
      const [{ databaseName }] = await tx.$queryRawUnsafe(
        "SELECT DATABASE() AS databaseName"
      );
      const tables = await tx.$queryRawUnsafe(
        "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
      );
      const relations = await tx.$queryRawUnsafe(
        "SELECT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL"
      );
      const captured = [];
      for (const { tableName } of tables) {
        const metadata = await tx.$queryRawUnsafe(
          "SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
          tableName
        );
        const columns = metadata.map(column => column.columnName);
        const definitions = await tx.$queryRawUnsafe(
          `SHOW CREATE TABLE ${quote(tableName)}`
        );
        const ddl = Object.values(definitions[0]).find(
          value => typeof value === "string" && value.includes("CREATE TABLE")
        );
        if (!ddl) throw new Error(`Missing table definition: ${tableName}`);
        const rawRows = await tx.$queryRawUnsafe(
          `SELECT * FROM ${quote(tableName)}`
        );
        const rows = rawRows.map(row =>
          Object.fromEntries(
            columns.map(column => [column, encode(row[column])])
          )
        );
        captured.push({
          tableName,
          columns,
          ddl,
          rows,
          rowCount: rows.length,
          dataSha256: dataDigest(rows, columns),
        });
      }
      return {
        databaseName,
        capturedAt: new Date().toISOString(),
        tables: captured,
        relations,
      };
    },
    { maxWait: 60_000, timeout: 600_000 }
  );
}
function protectKey(value, unprotect = false) {
  const operation = unprotect ? "Unprotect" : "Protect";
  const script = `Add-Type -AssemblyName System.Security; $value = [Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($value, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { input: value.toString("base64"), encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0)
    throw new Error("Windows backup-key protection failed.");
  return Buffer.from(result.stdout.trim(), "base64");
}
export function saveBackup(data) {
  const directory = resolve(
    ".backups",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`
  );
  mkdirSync(directory, { recursive: true });
  const plaintext = Buffer.from(JSON.stringify(data));
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  writeFileSync(
    resolve(directory, "database.aesgcm"),
    Buffer.concat([iv, cipher.getAuthTag(), encrypted])
  );
  writeFileSync(resolve(directory, "key.dpapi"), protectKey(key));
  const manifest = {
    database: data.databaseName,
    capturedAt: data.capturedAt,
    sha256: hash(plaintext),
    tables: data.tables.map(({ tableName, rowCount, dataSha256 }) => ({
      tableName,
      rowCount,
      dataSha256,
    })),
  };
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  const verified = loadBackup(directory);
  if (JSON.stringify(verified) !== JSON.stringify(data))
    throw new Error("Backup verification failed.");
  return { directory, manifest };
}
export function loadBackup(directory) {
  const bytes = readFileSync(resolve(directory, "database.aesgcm"));
  const key = protectKey(readFileSync(resolve(directory, "key.dpapi")), true);
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const plaintext = Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]);
  const manifest = JSON.parse(
    readFileSync(resolve(directory, "manifest.json"), "utf8")
  );
  if (hash(plaintext) !== manifest.sha256)
    throw new Error("Backup checksum does not match.");
  return JSON.parse(plaintext.toString("utf8"));
}
export function tableOrder(data) {
  const pending = new Map(
    data.tables.map(table => [table.tableName, new Set()])
  );
  for (const { child, parent } of data.relations)
    if (child !== parent && pending.has(child) && pending.has(parent))
      pending.get(child).add(parent);
  const result = [];
  while (pending.size) {
    const ready = [...pending]
      .filter(([, dependencies]) => !dependencies.size)
      .map(([name]) => name)
      .sort();
    if (!ready.length)
      throw new Error("A dependency cycle prevents safe restoration.");
    for (const name of ready) {
      result.push(name);
      pending.delete(name);
      for (const dependencies of pending.values()) dependencies.delete(name);
    }
  }
  return result;
}
export async function restoreEmpty(client, data) {
  const tables = await client.$queryRawUnsafe(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
  );
  if (tables.length)
    throw new Error("Restoration requires an empty verification database.");
  const byName = new Map(data.tables.map(table => [table.tableName, table]));
  for (const name of tableOrder(data))
    await client.$executeRawUnsafe(byName.get(name).ddl);
  await client.$transaction(
    async tx => {
      for (const name of tableOrder(data)) {
        const table = byName.get(name);
        for (let offset = 0; offset < table.rows.length; offset += 50) {
          const rows = table.rows.slice(offset, offset + 50);
          const tuple = `(${table.columns.map(() => "?").join(",")})`;
          await tx.$executeRawUnsafe(
            `INSERT INTO ${quote(name)} (${table.columns.map(quote).join(",")}) VALUES ${rows.map(() => tuple).join(",")}`,
            ...rows.flatMap(row =>
              table.columns.map(column => decode(row[column]))
            )
          );
        }
      }
    },
    { maxWait: 60_000, timeout: 600_000 }
  );
  const restored = await snapshot(client);
  for (const table of data.tables) {
    const actual = restored.tables.find(
      entry => entry.tableName === table.tableName
    );
    if (
      !actual ||
      actual.rowCount !== table.rowCount ||
      actual.dataSha256 !== table.dataSha256
    )
      throw new Error(`Restored content differs: ${table.tableName}`);
  }
  return restored;
}
export function sanitizedFailure(error) {
  let message = String(error?.message ?? error);
  const url = new URL(connectionUrl());
  for (const secret of [
    url.toString(),
    url.username,
    url.password,
    decodeURIComponent(url.username),
    decodeURIComponent(url.password),
  ].filter(Boolean))
    message = message.replaceAll(secret, "[REDACTED]");
  return {
    errorType: error?.name,
    code: error?.code ?? error?.errorCode ?? null,
    message,
  };
}
