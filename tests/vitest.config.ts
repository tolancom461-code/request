import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

function loadDotEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export default defineConfig(() => {
  loadDotEnvFile(path.resolve(process.cwd(), ".env"));
  const databaseTests = process.env.RUN_DATABASE_TESTS === "1";
  if (databaseTests) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !/^\/REQUEST_verify_[a-f0-9]{8}$/.test(new URL(url).pathname)) {
      throw new Error(
        "Database tests require an isolated REQUEST_verify_* database supplied through TEST_DATABASE_URL."
      );
    }
    for (const key of [
      "DATABASE_URL",
      "APP_DATABASE_URL",
      "TARGET_TIDB_DATABASE_URL",
      "FRESH_TIDB_DATABASE_URL",
    ])
      process.env[key] = url;
    delete process.env.REDIS_URL;
  }

  return {
    test: {
      include: ["tests/**/*.test.ts"],
      exclude: databaseTests
        ? []
        : [
            "tests/**/*.integration.test.ts",
            "tests/database-integrity.test.ts",
            "tests/*tidb-connection.test.ts",
          ],
      testTimeout: 60_000,
      hookTimeout: 60_000,
      sequence: { concurrent: false },
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
      fileParallelism: false,
      maxWorkers: 1,
      minWorkers: 1,
    },
  };
});
