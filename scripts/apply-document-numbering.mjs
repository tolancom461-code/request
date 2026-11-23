import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { connectionUrl, snapshot, saveBackup, hash, sanitizedFailure } from "./database-snapshot.mjs";

const migration = "20261123160000_central_document_numbering";
const proof = JSON.parse(readFileSync("evidence/document-numbering-verification.json", "utf8"));
if (!proof.passed || proof.migration !== migration || proof.migrationSha256 !== hash(readFileSync(`prisma/migrations/${migration}/migration.sql`))) throw new Error("Passing isolated tests of this migration are required.");
const url = new URL(connectionUrl());
url.searchParams.set("connect_timeout", "20");
const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
try {
  const applied = await client.$queryRawUnsafe("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name");
  if (applied.some(row => row.migration_name === migration)) throw new Error("The numbering migration is already applied; maintenance was not repeated.");
  const expectedHistory = ["20260824090000_canonical_phase2a_tidb_baseline", "20260824170000_add_server_sessions_fallback", "20260929174500_optional_email_username_login", "20261123090000_item_setup_supplier", "20261123110000_unify_item_supplier"];
  if (JSON.stringify(applied.map(row => row.migration_name)) !== JSON.stringify(expectedHistory)) throw new Error("Unexpected migration history; no changes applied.");
  const captured = await snapshot(client);
  const backup = saveBackup(captured);
  const oldRequests = captured.tables.find(table => table.tableName === "requests").rows;
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"], { windowsHide: true, encoding: "utf8", env: { ...process.env, DATABASE_URL: url.toString(), APP_DATABASE_URL: url.toString() } });
  if (result.status !== 0) throw new Error(`Migration failed: ${result.stderr}\n${result.stdout}`);
  const after = await client.requestRecord.findMany({ select: { id: true, requestNumber: true } });
  if (oldRequests.some(before => !after.some(current => current.id === before.id && current.requestNumber === before.request_number))) throw new Error("An existing document reference changed unexpectedly.");
  const report = { applied: true, migration, migrationSha256: proof.migrationSha256, backupDirectory: backup.directory, existingReferencesRetained: oldRequests.length, sequenceRows: await client.documentNumberSequence.count(), completedAt: new Date().toISOString() };
  writeFileSync("evidence/document-numbering-applied.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify(sanitizedFailure(error)));
  process.exitCode = 1;
} finally { await client.$disconnect(); }
