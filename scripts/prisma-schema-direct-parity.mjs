import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rawUrl = process.env.PARITY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!rawUrl) throw new Error("PARITY_DATABASE_URL or DATABASE_URL is required for direct Prisma schema parity.");

const databaseUrl = new URL(rawUrl);
databaseUrl.searchParams.delete("ssl");
databaseUrl.searchParams.set("sslaccept", "strict");

const evidencePath = resolve(root, "evidence", "prisma_schema_direct_parity.json");
mkdirSync(dirname(evidencePath), { recursive: true });

let stdout = "";
let stderr = "";
let exitCode = 0;
try {
  stdout = execFileSync(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "diff",
      "--from-schema-datamodel",
      "prisma/schema.prisma",
      "--to-url",
      databaseUrl.toString(),
      "--script",
      "--exit-code",
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  exitCode = typeof error.status === "number" ? error.status : 1;
  stdout = error.stdout?.toString() ?? "";
  stderr = error.stderr?.toString() ?? "";
}

const actionableSql = stdout
  .split("\n")
  .filter((line) => !line.trim().startsWith("--") && line.trim().length > 0)
  .join("\n")
  .trim();
const parityPass = exitCode === 0 && actionableSql.length === 0;
const result = {
  target: process.env.PARITY_TARGET ?? "UNSPECIFIED",
  command: "prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url [REDACTED] --script --exit-code",
  prismaSchemaToTidbStructuralDiff: parityPass ? "EMPTY" : "NON_EMPTY_OR_ERROR",
  exitCode,
  actionableSql,
  stderr: stderr.trim(),
  pass: parityPass,
};

writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`PRISMA_SCHEMA_TO_TIDB_STRUCTURAL_DIFF = ${result.prismaSchemaToTidbStructuralDiff}`);
if (!parityPass) process.exit(exitCode || 1);
