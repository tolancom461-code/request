import { spawn } from "node:child_process";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { connectionUrl, hash } from "./database-snapshot.mjs";

const state = JSON.parse(readFileSync("evidence/reset-verification-target.json", "utf8"));
const plan = JSON.parse(readFileSync("evidence/reset-schema-plan.json", "utf8"));
const prior = JSON.parse(readFileSync("evidence/reset-workflow-verification.json", "utf8"));
const original = JSON.parse(readFileSync("evidence/reset-isolated-tests.json", "utf8"));
if (!state.restorationVerified || !/^REQUEST_verify_[a-f0-9]{8}$/.test(state.name) ||
    prior.databaseName !== state.name || prior.migrationSha256 !== plan.sha256 ||
    hash(readFileSync(`prisma/migrations/${plan.migration}/migration.sql`)) !== plan.sha256)
  throw new Error("The isolated verification target or tested migration changed.");
const failed = original.testResults.filter(suite => suite.status !== "passed");
if (!failed.length) throw new Error("The full run has no failed suites to recheck.");
const paths = failed.map(suite => {
  const file = relative(process.cwd(), resolve(suite.name)).replaceAll("\\", "/");
  if (!/^tests\/[\w./-]+\.test\.ts$/.test(file)) throw new Error("Unexpected failed test path.");
  return file;
});
const testUrl = new URL(connectionUrl(state.name));
testUrl.searchParams.set("connection_limit", "5");
const env = {
  ...process.env,
  RUN_DATABASE_TESTS: "1",
  TEST_DATABASE_URL: testUrl.toString(),
  NODE_ENV: "test",
  SESSION_SECRET: randomBytes(32).toString("base64"),
  PUBLIC_APP_ORIGIN: "http://localhost:5173",
};
delete env.REDIS_URL;
const log = createWriteStream("evidence/reset-isolated-recheck.log");
const child = spawn(process.execPath, [
  "node_modules/vitest/vitest.mjs", "run", ...paths,
  "--config", "tests/vitest.config.ts", "--testTimeout", "180000",
  "--hookTimeout", "180000", "--reporter=default", "--reporter=json",
  "--outputFile=evidence/reset-isolated-recheck.json",
], { env, windowsHide: true });
child.stdout.on("data", data => log.write(data));
child.stderr.on("data", data => log.write(data));
const code = await new Promise((done, reject) => {
  child.on("exit", done);
  child.on("error", reject);
});
log.end();
const recheck = JSON.parse(readFileSync("evidence/reset-isolated-recheck.json", "utf8"));
const key = suite => resolve(suite.name).toLowerCase();
const rerunByName = new Map(recheck.testResults.map(suite => [key(suite), suite]));
for (const suite of failed) {
  const retry = rerunByName.get(key(suite));
  if (!retry || retry.assertionResults.length !== suite.assertionResults.length)
    throw new Error("The recheck does not cover every case in a failed suite.");
}
const merged = original.testResults.map(suite => rerunByName.get(key(suite)) ?? suite);
const assertions = merged.flatMap(suite => suite.assertionResults);
const result = {
  passed: code === 0 && recheck.success && merged.every(suite => suite.status === "passed") &&
    assertions.length === original.numTotalTests && assertions.every(test => test.status === "passed"),
  databaseName: state.name,
  migrationSha256: plan.sha256,
  totalTests: assertions.length,
  passedTests: assertions.filter(test => test.status === "passed").length,
  failedTests: assertions.filter(test => test.status === "failed").length,
  recheckedSuites: paths,
  originalReport: "evidence/reset-isolated-tests.json",
  recheckReport: "evidence/reset-isolated-recheck.json",
  completedAt: new Date().toISOString(),
};
writeFileSync("evidence/reset-workflow-verification.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
