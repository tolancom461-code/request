import { spawn } from "node:child_process";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { connectionUrl, sanitizedFailure } from "./database-snapshot.mjs";

const state = JSON.parse(
  readFileSync("evidence/reset-verification-target.json", "utf8")
);
const migration = JSON.parse(
  readFileSync("evidence/reset-schema-plan.json", "utf8")
);
if (
  !state.restorationVerified ||
  !/^REQUEST_verify_[a-f0-9]{8}$/.test(state.name)
)
  throw new Error("An isolated, restore-verified test database is required.");
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
const log = createWriteStream("evidence/reset-isolated-tests.log");
const child = spawn(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "tests/vitest.config.ts",
    "--testTimeout",
    "180000",
    "--hookTimeout",
    "180000",
    "--reporter=default",
    "--reporter=json",
    "--outputFile=evidence/reset-isolated-tests.json",
  ],
  { env, windowsHide: true }
);
child.stdout.on("data", data => log.write(data));
child.stderr.on("data", data => log.write(data));
const code = await new Promise((resolve, reject) => {
  child.on("exit", resolve);
  child.on("error", reject);
});
log.end();
let report;
try {
  report = JSON.parse(
    readFileSync("evidence/reset-isolated-tests.json", "utf8")
  );
} catch {
  throw new Error(
    "The isolated test runner did not produce a result; see the local test log."
  );
}
const result = {
  passed: code === 0 && report.success,
  databaseName: state.name,
  migrationSha256: migration.sha256,
  totalTests: report.numTotalTests,
  passedTests: report.numPassedTests,
  failedTests: report.numFailedTests,
  completedAt: new Date().toISOString(),
};
writeFileSync(
  "evidence/reset-workflow-verification.json",
  JSON.stringify(result, null, 2)
);
console.log(JSON.stringify(result));
if (!result.passed) {
  for (const suite of report.testResults ?? []) {
    for (const test of suite.assertionResults ?? [])
      if (test.status === "failed")
        console.error(
          JSON.stringify({
            test: test.fullName,
            ...sanitizedFailure(
              new Error((test.failureMessages ?? []).join("\n").slice(0, 2200))
            ),
          })
        );
    if (suite.message && !(suite.assertionResults ?? []).length)
      console.error(
        JSON.stringify({
          suite: suite.name,
          ...sanitizedFailure(new Error(suite.message.slice(0, 2200))),
        })
      );
  }
  process.exitCode = 1;
}
