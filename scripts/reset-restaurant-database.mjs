import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  clientFor,
  connectionUrl,
  snapshot,
  saveBackup,
  loadBackup,
  quote,
  hash,
  sanitizedFailure,
} from "./database-snapshot.mjs";

const firstMigration = "20261123090000_item_setup_supplier";
const unifiedMigration = "20261123110000_unify_item_supplier";
const cloneState = () =>
  JSON.parse(readFileSync("evidence/reset-verification-target.json", "utf8"));
const cloneName = () => cloneState().name;
const mode = process.argv[2];
const databaseName =
  mode === "apply-authorized-reset" ? "REQUEST" : cloneName();
if (
  mode === "apply-authorized-reset" &&
  process.argv[3] !== "--reset-trial-data"
)
  throw new Error("Explicit trial-data reset mode is required.");
if (
  mode === "apply-authorized-reset" &&
  existsSync("evidence/reset-applied.json")
)
  throw new Error(
    "The authorized reset has already completed; it cannot be rerun accidentally."
  );
const client = clientFor(databaseName);

function prisma(args) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: connectionUrl(databaseName),
        APP_DATABASE_URL: connectionUrl(databaseName),
      },
      windowsHide: true,
    }
  );
  if (result.status !== 0)
    throw new Error(
      `Prisma command failed: ${result.stderr}\n${result.stdout}`
    );
  return result.stdout;
}
async function completeItemSupplier() {
  const columns = await client.$queryRawUnsafe(
    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'default_supplier_id'"
  );
  if (!columns.length)
    await client.$executeRawUnsafe(
      "ALTER TABLE items ADD COLUMN default_supplier_id CHAR(36) NULL"
    );
  const indexes = await client.$queryRawUnsafe(
    "SELECT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'default_supplier_id'"
  );
  if (!indexes.length)
    await client.$executeRawUnsafe(
      "CREATE INDEX items_default_supplier_id_idx ON items (default_supplier_id)"
    );
  const foreignKeys = await client.$queryRawUnsafe(
    "SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'default_supplier_id' AND REFERENCED_TABLE_NAME = 'suppliers'"
  );
  if (!foreignKeys.length)
    await client.$executeRawUnsafe(
      "ALTER TABLE items ADD CONSTRAINT items_default_supplier_id_fkey FOREIGN KEY (default_supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT ON UPDATE CASCADE"
    );
  const applied = await client.$queryRawUnsafe(
    "SELECT id FROM _prisma_migrations WHERE migration_name = ? AND finished_at IS NOT NULL AND rolled_back_at IS NULL",
    firstMigration
  );
  if (!applied.length)
    prisma([
      "migrate",
      "resolve",
      "--applied",
      firstMigration,
      "--schema",
      "prisma/schema.prisma",
    ]);
}
async function resetTrialData() {
  const before = await snapshot(client);
  const required = [
    "roles",
    "permissions",
    "role_permissions",
    "users",
    "user_roles",
    "_prisma_migrations",
  ];
  if (
    !required.every(name =>
      before.tables.some(table => table.tableName === name)
    )
  )
    throw new Error("Required system tables are missing.");
  const allowed = new Set([
    "_prisma_migrations",
    "users",
    "roles",
    "permissions",
    "role_permissions",
    "user_roles",
    "branches",
    "user_branch_scopes",
    "categories",
    "units",
    "items",
    "item_units",
    "suppliers",
    "branch_items",
    "branch_item_suppliers",
    "requests",
    "request_items",
    "request_approvals",
    "request_status_history",
    "notifications",
    "audit_logs",
    "server_sessions",
  ]);
  if (before.tables.some(table => !allowed.has(table.tableName)))
    throw new Error("Unexpected tables prevent automatic trial-data cleanup.");
  let admins = await client.$queryRawUnsafe(
    "SELECT DISTINCT u.id, u.username, u.password_hash, u.status FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'system_admin' AND u.status = 'active'"
  );
  if (databaseName !== "REQUEST") {
    const original = loadBackup(cloneState().backup);
    const roleIds = new Set(
      original.tables
        .find(table => table.tableName === "roles")
        .rows.filter(row => row.code === "system_admin")
        .map(row => row.id)
    );
    const originalAdminIds = new Set(
      original.tables
        .find(table => table.tableName === "user_roles")
        .rows.filter(row => roleIds.has(row.role_id))
        .map(row => row.user_id)
    );
    admins = admins.filter(admin => originalAdminIds.has(admin.id));
  }
  if (!admins.length || admins.some(admin => !admin.password_hash))
    throw new Error("No usable System Admin exists; reset was not started.");
  const ids = admins.map(admin => admin.id);
  const encryptedBackup =
    databaseName === "REQUEST" ? saveBackup(before) : null;
  const deleted = {};
  // Children first. System definitions, migration history, and administrator identities are retained.
  const order = [
    "notifications",
    "request_approvals",
    "request_status_history",
    "request_items",
    "requests",
    "audit_logs",
    "server_sessions",
    "user_branch_scopes",
    "user_roles",
    "users",
    "branch_item_suppliers",
    "branch_items",
    "item_units",
    "items",
    "suppliers",
    "categories",
    "units",
    "branches",
  ];
  await client.$transaction(
    async tx => {
      for (const name of order) {
        if (!before.tables.some(table => table.tableName === name)) continue;
        const idColumn =
          name === "users" ? "id" : name === "user_roles" ? "user_id" : null;
        deleted[name] = idColumn
          ? await tx.$executeRawUnsafe(
              `DELETE FROM ${quote(name)} WHERE ${quote(idColumn)} NOT IN (${ids.map(() => "?").join(",")})`,
              ...ids
            )
          : await tx.$executeRawUnsafe(`DELETE FROM ${quote(name)}`);
      }
      const kept = await tx.$queryRawUnsafe(
        `SELECT id, username, password_hash, status FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
        ...ids
      );
      if (
        kept.length !== admins.length ||
        kept.some(
          row =>
            !admins.some(
              admin =>
                admin.id === row.id &&
                admin.username === row.username &&
                admin.password_hash === row.password_hash &&
                row.status === admin.status
            )
        )
      )
        throw new Error(
          "Administrator preservation check failed; cleanup was rolled back."
        );
    },
    { maxWait: 60_000, timeout: 600_000 }
  );
  return {
    deleted,
    preservedAdminCount: admins.length,
    backupDirectory: encryptedBackup?.directory ?? null,
    beforeRowCount: before.tables.reduce(
      (sum, table) => sum + table.rowCount,
      0
    ),
  };
}
async function assertFinalSchema() {
  const diff = prisma([
    "migrate",
    "diff",
    "--from-url",
    connectionUrl(databaseName),
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
  ]);
  if (
    diff
      .split(/\r?\n/)
      .some(line => line.trim() && !line.trim().startsWith("--"))
  )
    throw new Error("The final database schema differs from Prisma.");
  const tables = await client.$queryRawUnsafe(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
  );
  const counts = [];
  for (const { name } of tables) {
    const [row] = await client.$queryRawUnsafe(
      `SELECT COUNT(*) AS total FROM ${quote(name)}`
    );
    counts.push({ table: name, rows: Number(row.total) });
  }
  return { schemaParity: true, counts };
}
try {
  if (mode === "prepare-clone") {
    await completeItemSupplier();
    const sql = prisma([
      "migrate",
      "diff",
      "--from-url",
      connectionUrl(databaseName),
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ]);
    if (!sql.includes("DROP TABLE `branch_item_suppliers`"))
      throw new Error(
        "The proposed migration does not remove the retired relation."
      );
    mkdirSync(resolve("prisma/migrations", unifiedMigration), {
      recursive: true,
    });
    writeFileSync(
      resolve("prisma/migrations", unifiedMigration, "migration.sql"),
      sql
    );
    writeFileSync(
      "evidence/reset-schema-plan.json",
      JSON.stringify(
        { databaseName, migration: unifiedMigration, sha256: hash(sql) },
        null,
        2
      )
    );
    console.log(
      JSON.stringify({
        event: "verification_migration_prepared",
        databaseName,
        migration: unifiedMigration,
        sql,
      })
    );
  } else if (mode === "reset-clone" || mode === "apply-authorized-reset") {
    const plan = JSON.parse(
      readFileSync("evidence/reset-schema-plan.json", "utf8")
    );
    if (
      hash(
        readFileSync(
          resolve("prisma/migrations", unifiedMigration, "migration.sql")
        )
      ) !== plan.sha256
    )
      throw new Error("The migration changed after it was prepared.");
    if (databaseName === "REQUEST") {
      const verified = JSON.parse(
        readFileSync("evidence/reset-workflow-verification.json", "utf8")
      );
      if (
        !verified.passed ||
        verified.databaseName !== cloneName() ||
        verified.migrationSha256 !== plan.sha256
      )
        throw new Error(
          "A passing isolated workflow verification is required before resetting REQUEST."
        );
    }
    const cleanup = await resetTrialData();
    await completeItemSupplier();
    prisma(["migrate", "deploy", "--schema", "prisma/schema.prisma"]);
    const result = {
      databaseName,
      ...cleanup,
      ...(await assertFinalSchema()),
      appliedAt: new Date().toISOString(),
      migrationSha256: plan.sha256,
    };
    writeFileSync(
      `evidence/reset-${databaseName === "REQUEST" ? "applied" : "clone"}.json`,
      JSON.stringify(result, null, 2)
    );
    console.log(
      JSON.stringify({ event: "database_reset_completed", ...result })
    );
  } else if (mode === "verify")
    console.log(JSON.stringify(await assertFinalSchema()));
  else
    throw new Error(
      "Choose prepare-clone, reset-clone, apply-authorized-reset, or verify."
    );
} catch (error) {
  console.error(JSON.stringify(sanitizedFailure(error)));
  process.exitCode = 1;
} finally {
  await client.$disconnect();
}
