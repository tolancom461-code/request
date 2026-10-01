import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { secureMysqlUrl } from "../apps/api/src/config.js";

type ActualColumn = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: "YES" | "NO";
  COLUMN_DEFAULT: string | null;
  EXTRA: string;
  GENERATION_EXPRESSION: string | null;
  CHARACTER_SET_NAME: string | null;
  COLLATION_NAME: string | null;
};
type ActualIndex = { TABLE_NAME: string; INDEX_NAME: string; NON_UNIQUE: number; SEQ_IN_INDEX: number; COLUMN_NAME: string | null; INDEX_TYPE: string };
type ActualForeignKey = { CONSTRAINT_NAME: string; TABLE_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string; UPDATE_RULE: string; DELETE_RULE: string };
type ActualCheck = { CONSTRAINT_NAME: string; CHECK_CLAUSE: string | null };
type MigrationHistory = { migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null };

type ColumnDefinition = { type: string; nullable: boolean; defaultValue: string | null; autoIncrement: boolean; generatedExpression: string | null };
type IndexDefinition = { table: string; name: string; unique: boolean; columns: string[]; indexType: string };
type ForeignKeyDefinition = { table: string; name: string; column: string; referencedTable: string; referencedColumn: string; deleteRule: string; updateRule: string };
type TableDefinition = { columns: Map<string, ColumnDefinition>; primaryKey: string[] };

const root = process.cwd();
const migrationsPath = join(root, "prisma", "migrations");
const manifestPath = join(root, "docs", "DATABASE_INTEGRITY_MANIFEST.md");
const targetName = process.env.PARITY_TARGET ?? "CURRENT TIDB";
const databaseUrl = process.env.DATABASE_URL ? secureMysqlUrl(process.env.DATABASE_URL) : "";
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const platformTables = new Set(["_prisma_migrations"]);

function normalized(value: string | null | undefined) {
  const result = (value ?? "").toLowerCase().replace(/`/g, "").replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").replace(/unsigned/g, "").trim();
  if (result === "boolean") return "tinyint(1)";
  if (result === "integer") return "int";
  return result;
}

function normalDefault(value: string | null | undefined) {
  const result = normalized(value).replace(/^\((.*)\)$/, "$1").replace(/^current_timestamp$/, "current_timestamp()").replace(/^'(.*)'$/, "$1");
  if (result === "false") return "0";
  if (result === "true") return "1";
  return result;
}

function parseColumns(fragment: string) {
  return [...fragment.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function parseColumnDefinition(definition: string): ColumnDefinition {
  const raw = definition.replace(/,\s*$/, "").trim();
  const type = raw.match(/^([a-z]+(?:\([^)]*\))?(?:\s+unsigned)?)/i)?.[1] ?? "";
  const defaultMatch = raw.match(/\bDEFAULT\s+(.+?)(?=\s+(?:ON UPDATE|CHARACTER SET|COLLATE|COMMENT|GENERATED)\b|$)/i);
  const generatedMatch = raw.match(/GENERATED\s+ALWAYS\s+AS\s*\((.+)\)/i);
  return {
    type: normalized(type),
    nullable: !/\bNOT NULL\b/i.test(raw),
    defaultValue: defaultMatch ? normalDefault(defaultMatch[1]) : null,
    autoIncrement: /AUTO_INCREMENT/i.test(raw),
    generatedExpression: generatedMatch ? normalized(generatedMatch[1]) : null,
  };
}

function blankExpected() {
  return { tables: new Map<string, TableDefinition>(), indexes: new Map<string, IndexDefinition>(), foreignKeys: new Map<string, ForeignKeyDefinition>(), checks: new Map<string, string>(), migrationChainErrors: [] as string[] };
}

function indexKey(table: string, name: string) {
  return `${table}.${name}`;
}

function applyMigration(source: string, file: string, expected: ReturnType<typeof blankExpected>) {
  for (const match of source.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) DEFAULT CHARACTER SET/gi)) {
    const [, tableName, body] = match;
    const table: TableDefinition = { columns: new Map(), primaryKey: [] };
    for (const line of body.split("\n")) {
      const column = line.match(/^\s*`([^`]+)`\s+(.+?)(?:,\s*)?$/);
      if (column && !/^(UNIQUE |INDEX |PRIMARY KEY)/i.test(column[2].trim())) table.columns.set(column[1], parseColumnDefinition(column[2]));
      const index = line.match(/^\s*(UNIQUE )?INDEX `([^`]+)`\(([^)]+)\)/i);
      if (index) expected.indexes.set(indexKey(tableName, index[2]), { table: tableName, name: index[2], unique: Boolean(index[1]), columns: parseColumns(index[3]), indexType: "BTREE" });
      const primary = line.match(/^\s*PRIMARY KEY \(([^)]+)\)/i);
      if (primary) table.primaryKey = parseColumns(primary[1]);
    }
    expected.tables.set(tableName, table);
  }
  for (const match of source.matchAll(/ALTER TABLE `([^`]+)`\s+ADD COLUMN `([^`]+)`\s+([^,;]+)(?:,|;)/gi)) {
    expected.tables.get(match[1])?.columns.set(match[2], parseColumnDefinition(match[3]));
  }
  for (const match of source.matchAll(/ALTER TABLE `([^`]+)`\s+ADD (UNIQUE )?INDEX `([^`]+)`\s*\(([^)]+)\)/gi)) {
    expected.indexes.set(indexKey(match[1], match[3]), { table: match[1], name: match[3], unique: Boolean(match[2]), columns: parseColumns(match[4]), indexType: "BTREE" });
  }
  for (const match of source.matchAll(/ALTER TABLE `([^`]+)`\s+ADD CONSTRAINT `([^`]+)` FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)`\(`([^`]+)`\) ON DELETE ([A-Z ]+) ON UPDATE ([A-Z ]+);/gi)) {
    const definition: ForeignKeyDefinition = { table: match[1], name: match[2], column: match[3], referencedTable: match[4], referencedColumn: match[5], deleteRule: match[6].trim(), updateRule: match[7].trim() };
    expected.foreignKeys.set(definition.name, definition);
  }
  for (const match of source.matchAll(/ALTER TABLE `([^`]+)`\s+ADD CONSTRAINT `(ck_[^`]+)` CHECK\s*\(([^;]+)\);/gi)) expected.checks.set(match[2], normalized(match[3]));
  for (const match of source.matchAll(/CREATE (UNIQUE )?INDEX `([^`]+)`\s+ON `([^`]+)`\s*\(([^)]+)\)/gi)) {
    expected.indexes.set(indexKey(match[3], match[2]), { table: match[3], name: match[2], unique: Boolean(match[1]), columns: parseColumns(match[4]), indexType: "BTREE" });
  }
  for (const match of source.matchAll(/DROP INDEX `([^`]+)` ON `([^`]+)`/gi)) {
    const key = indexKey(match[2], match[1]);
    if (!expected.indexes.delete(key)) expected.migrationChainErrors.push(`${file}: DROP INDEX references no prior version-controlled index ${key}`);
  }
}

async function migrationSources() {
  const directories = (await readdir(migrationsPath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const migrations: Array<{ name: string; source: string; checksum: string }> = [];
  for (const name of directories) {
    const source = await readFile(join(migrationsPath, name, "migration.sql"), "utf8");
    migrations.push({ name, source, checksum: createHash("sha256").update(source).digest("hex") });
  }
  return migrations;
}

function prismaCommand(args: string[]) {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/run-prisma-with-tls.mjs", ...args], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" });
  return { command: `pnpm exec tsx scripts/run-prisma-with-tls.mjs ${args.join(" ")}`, exitCode: result.status ?? 1, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function retry<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  let error: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); } catch (caught) {
      error = caught;
      await prisma.$disconnect().catch(() => undefined);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw error;
}

async function main() {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const expected = blankExpected();
  const migrations = await migrationSources();
  for (const migration of migrations) applyMigration(migration.source, migration.name, expected);
  const [tables, columns, indexes, foreignKeys, checks, checkVariable, history, manifest] = await Promise.all([
    retry(() => prisma.$queryRaw<Array<{ TABLE_NAME: string }>>`SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE()`),
    retry(() => prisma.$queryRaw<ActualColumn[]>`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, GENERATION_EXPRESSION, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.columns WHERE table_schema = DATABASE()`),
    retry(() => prisma.$queryRaw<ActualIndex[]>`SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`),
    retry(() => prisma.$queryRaw<ActualForeignKey[]>`SELECT k.CONSTRAINT_NAME, k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name WHERE k.constraint_schema = DATABASE() AND k.referenced_table_name IS NOT NULL`),
    retry(() => prisma.$queryRaw<ActualCheck[]>`SELECT tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE FROM information_schema.table_constraints tc LEFT JOIN information_schema.check_constraints cc ON tc.constraint_schema = cc.constraint_schema AND tc.constraint_name = cc.constraint_name WHERE tc.constraint_schema = DATABASE() AND tc.constraint_type = 'CHECK'`),
    retry(() => prisma.$queryRaw<Array<{ Value: string }>>`SHOW VARIABLES LIKE 'tidb_enable_check_constraint'`),
    retry(() => prisma.$queryRaw<MigrationHistory[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`),
    readFile(manifestPath, "utf8"),
  ]);

  const actualTables = new Set(tables.map((row) => row.TABLE_NAME));
  const expectedTableNames = new Set(expected.tables.keys());
  const missingTables = [...expectedTableNames].filter((table) => !actualTables.has(table));
  const unexpectedTables = [...actualTables].filter((table) => !expectedTableNames.has(table) && !platformTables.has(table));
  const missingColumns: string[] = [], unexpectedColumns: string[] = [], columnMismatches: string[] = [];
  for (const [tableName, definition] of expected.tables) {
    const actual = columns.filter((column) => column.TABLE_NAME === tableName);
    const actualByName = new Map(actual.map((column) => [column.COLUMN_NAME, column]));
    for (const [columnName, expectedColumn] of definition.columns) {
      const found = actualByName.get(columnName);
      if (!found) { missingColumns.push(`${tableName}.${columnName}`); continue; }
      const typeMatches = normalized(found.COLUMN_TYPE) === expectedColumn.type;
      const nullableMatches = (found.IS_NULLABLE === "YES") === expectedColumn.nullable;
      const defaultMatches = normalDefault(found.COLUMN_DEFAULT) === (expectedColumn.defaultValue ?? "");
      const autoMatches = /auto_increment/i.test(found.EXTRA) === expectedColumn.autoIncrement;
      const generatedMatches = normalized(found.GENERATION_EXPRESSION) === (expectedColumn.generatedExpression ?? "");
      if (!typeMatches || !nullableMatches || !defaultMatches || !autoMatches || !generatedMatches) columnMismatches.push(`${tableName}.${columnName}`);
    }
    for (const found of actual) if (!definition.columns.has(found.COLUMN_NAME)) unexpectedColumns.push(`${tableName}.${found.COLUMN_NAME}`);
  }
  const actualIndexes = new Map<string, IndexDefinition>();
  for (const row of indexes) {
    if (!expected.tables.has(row.TABLE_NAME)) continue;
    const key = indexKey(row.TABLE_NAME, row.INDEX_NAME);
    const present = actualIndexes.get(key) ?? { table: row.TABLE_NAME, name: row.INDEX_NAME, unique: Number(row.NON_UNIQUE) === 0, columns: [], indexType: row.INDEX_TYPE };
    if (row.COLUMN_NAME) present.columns.push(row.COLUMN_NAME);
    actualIndexes.set(key, present);
  }
  const expectedIndexes = new Map(expected.indexes);
  for (const [tableName, table] of expected.tables) if (table.primaryKey.length) expectedIndexes.set(indexKey(tableName, "PRIMARY"), { table: tableName, name: "PRIMARY", unique: true, columns: table.primaryKey, indexType: "BTREE" });
  const missingIndexes: string[] = [], unexpectedIndexes: string[] = [], indexMismatches: string[] = [];
  for (const [key, definition] of expectedIndexes) {
    const found = actualIndexes.get(key);
    if (!found) missingIndexes.push(key);
    else if (found.unique !== definition.unique || found.columns.join(",") !== definition.columns.join(",") || normalized(found.indexType) !== normalized(definition.indexType)) indexMismatches.push(key);
  }
  for (const [key, index] of actualIndexes) {
    const backingForeignKey = [...expected.foreignKeys.values()].some((foreignKey) => foreignKey.table === index.table && foreignKey.name === index.name && index.columns.join(",") === foreignKey.column);
    if (!expectedIndexes.has(key) && !backingForeignKey) unexpectedIndexes.push(key);
  }
  const actualForeignKeys = new Map(foreignKeys.map((key) => [key.CONSTRAINT_NAME, key]));
  const missingForeignKeys: string[] = [], unexpectedForeignKeys: string[] = [], foreignKeyMismatches: string[] = [];
  for (const [name, definition] of expected.foreignKeys) {
    const found = actualForeignKeys.get(name);
    if (!found) missingForeignKeys.push(name);
    else if (found.TABLE_NAME !== definition.table || found.COLUMN_NAME !== definition.column || found.REFERENCED_TABLE_NAME !== definition.referencedTable || found.REFERENCED_COLUMN_NAME !== definition.referencedColumn || normalized(found.DELETE_RULE) !== normalized(definition.deleteRule) || normalized(found.UPDATE_RULE) !== normalized(definition.updateRule)) foreignKeyMismatches.push(name);
  }
  for (const name of actualForeignKeys.keys()) if (!expected.foreignKeys.has(name)) unexpectedForeignKeys.push(name);
  const checksEnabled = normalized(checkVariable[0]?.Value) === "on";
  const actualChecks = new Map(checks.map((check) => [check.CONSTRAINT_NAME, normalized(check.CHECK_CLAUSE)]));
  const missingChecks = checksEnabled ? [...expected.checks.keys()].filter((name) => !actualChecks.has(name)) : [];
  const unexpectedChecks = checksEnabled ? [...actualChecks.keys()].filter((name) => !expected.checks.has(name)) : [];
  const checkDefinitionMismatches = checksEnabled ? [...expected.checks.entries()].filter(([name, clause]) => actualChecks.get(name) !== clause).map(([name]) => name) : [];
  const manifestCheckPolicyPresent = /CHECK.*not database-enforced|CHECK feature is OFF/i.test(manifest);
  const historyByName = new Map(history.map((entry) => [entry.migration_name, entry]));
  const missingAppliedMigrations = migrations.filter((migration) => !historyByName.get(migration.name)?.finished_at || historyByName.get(migration.name)?.rolled_back_at).map((migration) => migration.name);
  const checksumMismatches = migrations.filter((migration) => historyByName.get(migration.name)?.checksum !== migration.checksum).map((migration) => migration.name);
  const unexpectedAppliedMigrations = history.filter((entry) => !migrations.some((migration) => migration.name === entry.migration_name)).map((entry) => entry.migration_name);
  const prismaCommands = {
    validate: prismaCommand(["validate", "--schema", "prisma/schema.prisma"]),
    generate: prismaCommand(["generate", "--schema", "prisma/schema.prisma"]),
    migrationStatus: prismaCommand(["migrate", "status", "--schema", "prisma/schema.prisma"]),
  };
  const drift = [expected.migrationChainErrors, missingAppliedMigrations, checksumMismatches, unexpectedAppliedMigrations, missingTables, unexpectedTables, missingColumns, unexpectedColumns, columnMismatches, missingIndexes, unexpectedIndexes, indexMismatches, missingForeignKeys, unexpectedForeignKeys, foreignKeyMismatches, missingChecks, unexpectedChecks, checkDefinitionMismatches, !checksEnabled && !manifestCheckPolicyPresent ? ["manifest CHECK policy missing"] : []].flat();
  const report = { target: targetName, checksEnabled, migrationChainErrors: expected.migrationChainErrors, migrationHistory: { missingAppliedMigrations, checksumMismatches, unexpectedAppliedMigrations }, tables: { missingTables, unexpectedTables }, columns: { missingColumns, unexpectedColumns, columnMismatches }, indexes: { missingIndexes, unexpectedIndexes, indexMismatches }, foreignKeys: { missingForeignKeys, unexpectedForeignKeys, foreignKeyMismatches }, checks: { expected: [...expected.checks.keys()], actual: [...actualChecks.keys()], missingChecks, unexpectedChecks, checkDefinitionMismatches, manifestCheckPolicyPresent }, prisma: prismaCommands, "DATABASE DRIFT DETECTED": drift.length ? "YES" : "NO", "UNEXPLAINED DATABASE DRIFT": drift.length ? "YES" : "NO" };
  await writeFile(join(root, "evidence", "database-parity.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PARITY TARGET: ${targetName}`);
  console.log(`DATABASE DRIFT DETECTED: ${report["DATABASE DRIFT DETECTED"]}`);
  console.log(`UNEXPLAINED DATABASE DRIFT: ${report["UNEXPLAINED DATABASE DRIFT"]}`);
  if (drift.length) { console.log(JSON.stringify(report, null, 2)); process.exitCode = 1; }
  if (prismaCommands.validate.exitCode || prismaCommands.generate.exitCode || prismaCommands.migrationStatus.exitCode) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
