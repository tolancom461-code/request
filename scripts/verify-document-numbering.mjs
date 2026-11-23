import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { connectionUrl, quote, hash, sanitizedFailure } from "./database-snapshot.mjs";

const migration = "20261123160000_central_document_numbering";
const name = `REQUEST_verify_${randomBytes(4).toString("hex")}`;
const target = new URL(connectionUrl(name));
target.searchParams.set("connection_limit", "5");
target.searchParams.set("connect_timeout", "20");
target.searchParams.set("pool_timeout", "30");
const sourceUrl = new URL(connectionUrl());
sourceUrl.searchParams.set("connect_timeout", "20");
const source = new PrismaClient({ datasources: { db: { url: sourceUrl.toString() } } });
const env = {
  ...process.env, DATABASE_URL: target.toString(), APP_DATABASE_URL: target.toString(),
  TEST_DATABASE_URL: target.toString(), RUN_DATABASE_TESTS: "1", NODE_ENV: "test",
  SESSION_SECRET: randomBytes(32).toString("hex"), PUBLIC_APP_ORIGIN: "http://localhost:5173",
};
delete env.REDIS_URL;
const log = createWriteStream("evidence/document-numbering-integration.log");
async function run(args) {
  const child = spawn(process.execPath, args, { env, windowsHide: true });
  child.stdout.on("data", value => log.write(value));
  child.stderr.on("data", value => log.write(value));
  const code = await new Promise((done, fail) => { child.on("exit", done); child.on("error", fail); });
  if (code !== 0) throw new Error(`Isolated verification failed at ${args[0]}; see the local numbering log.`);
}
let created = false;
let report = { passed: false, databaseName: name, migration, migrationSha256: hash(readFileSync(`prisma/migrations/${migration}/migration.sql`)) };
try {
  if (!/^REQUEST_verify_[a-f0-9]{8}$/.test(name)) throw new Error("Invalid verification database.");
  await source.$executeRawUnsafe(`CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"]);
  await run(["--import", "tsx", "scripts/seed-system.ts"]);
  console.log(JSON.stringify({ event: "numbering_test_database_ready", databaseName: name }));
  const results = [];
  // Separate processes fully release native connection pools between integration suites.
  for (const [file, stage] of [["tests/document-numbering.integration.test.ts", "core"], ["tests/phase5-requisition.integration.test.ts", "requests"], ["tests/target-tidb-connection.test.ts", "inventory"]]) {
    const output = `evidence/document-numbering-${stage}.json`;
    await run(["node_modules/vitest/vitest.mjs", "run", file, "--config", "tests/vitest.config.ts", "--testTimeout", "180000", "--hookTimeout", "180000", "--reporter=default", "--reporter=json", `--outputFile=${output}`]);
    results.push(JSON.parse(readFileSync(output, "utf8")));
    console.log(JSON.stringify({ event: "numbering_stage_passed", stage }));
  }
  const result = { success: results.every(row => row.success && row.numPendingTests === 0), numTotalTests: results.reduce((n, row) => n + row.numTotalTests, 0), numPassedTests: results.reduce((n, row) => n + row.numPassedTests, 0), numFailedTests: results.reduce((n, row) => n + row.numFailedTests, 0), testResults: results.flatMap(row => row.testResults) };
  writeFileSync("evidence/document-numbering-tests.json", JSON.stringify(result, null, 2));
  report = { ...report, passed: result.success, totalTests: result.numTotalTests, passedTests: result.numPassedTests, failedTests: result.numFailedTests };
  if (!report.passed) throw new Error("Not all numbering integration cases passed.");
} catch (error) {
  console.error(JSON.stringify(sanitizedFailure(error)));
  process.exitCode = 1;
} finally {
  if (created) {
    await source.$executeRawUnsafe(`DROP DATABASE ${quote(name)}`);
    report.temporaryDatabaseRemoved = true;
  }
  await source.$disconnect();
  log.end();
  report.completedAt = new Date().toISOString();
  writeFileSync("evidence/document-numbering-verification.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
