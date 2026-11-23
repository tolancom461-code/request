import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

// Read metadata and aggregate counts only. This script never runs DDL or DML.
const envEntry = readFileSync(".env", "utf8")
  .split(/\r?\n/)
  .find(line => line.trim().startsWith("DATABASE_URL="));
if (!envEntry)
  throw new Error("DATABASE_URL is missing from the local environment file.");
const databaseUrl = new URL(
  envEntry
    .slice(envEntry.indexOf("=") + 1)
    .trim()
    .replace(/^["']|["']$/g, "")
);
databaseUrl.searchParams.set("sslaccept", "strict");
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl.toString() } },
});
const query = async sql => {
  if (!/^\s*(SELECT|SHOW)\b/i.test(sql))
    throw new Error("Only read-only inspection queries are allowed.");
  return prisma.$queryRawUnsafe(sql);
};
const serialize = value =>
  JSON.stringify(
    value,
    (_, entry) => (typeof entry === "bigint" ? Number(entry) : entry),
    2
  );
try {
  const database = await query("SELECT DATABASE() AS databaseName");
  const tables = await query(
    "SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME"
  );
  const columns = await query(
    "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION"
  );
  const indexes = await query(
    "SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequenceNumber, COLUMN_NAME AS columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX"
  );
  const foreignKeys = await query(
    "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, CONSTRAINT_NAME AS constraintName, REFERENCED_TABLE_NAME AS referencedTable, REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME"
  );
  const counts = [];
  for (const table of tables.filter(
    entry => entry.tableType === "BASE TABLE"
  )) {
    const quoted = "`" + table.tableName.replaceAll("`", "``") + "`";
    const rows = await query(`SELECT COUNT(*) AS rowCount FROM ${quoted}`);
    counts.push({ tableName: table.tableName, rowCount: rows[0].rowCount });
  }
  const models = Prisma.dmmf.datamodel.models;
  const expected = new Map(
    models.map(model => [
      model.dbName ?? model.name,
      model.fields
        .filter(field => field.kind !== "object")
        .map(field => field.dbName ?? field.name),
    ])
  );
  const unmappedTables = tables.filter(
    table =>
      !expected.has(table.tableName) && table.tableName !== "_prisma_migrations"
  );
  const unmappedColumns = columns.filter(
    column =>
      expected.has(column.tableName) &&
      !expected.get(column.tableName).includes(column.columnName)
  );
  const missingColumns = [];
  for (const [tableName, fields] of expected)
    for (const columnName of fields)
      if (
        !columns.some(
          column =>
            column.tableName === tableName && column.columnName === columnName
        )
      )
        missingColumns.push({ tableName, columnName });
  const migrations = tables.some(
    table => table.tableName === "_prisma_migrations"
  )
    ? await query(
        "SELECT migration_name AS migrationName, finished_at AS finishedAt, rolled_back_at AS rolledBackAt, applied_steps_count AS appliedSteps FROM _prisma_migrations ORDER BY started_at"
      )
    : [];
  const profiles = {};
  profiles.items = await query(
    "SELECT COUNT(*) AS totalItems, SUM(status = 'active') AS activeItems, SUM(name_en IS NULL OR name_en = '') AS missingEnglishName, SUM(name_ur IS NULL OR name_ur = '') AS missingUrduName, SUM(image_object_key IS NOT NULL AND image_object_key <> '') AS itemsWithImage, SUM(default_supplier_id IS NOT NULL) AS itemsWithDefaultSupplier FROM items"
  );
  profiles.branchItems = await query(
    "SELECT status, COUNT(*) AS linkCount, COUNT(DISTINCT item_id) AS distinctItems, COUNT(DISTINCT branch_id) AS distinctRestaurants FROM branch_items GROUP BY status"
  );
  profiles.itemsSharedByRestaurants = await query(
    "SELECT COUNT(*) AS sharedItemCount FROM (SELECT item_id FROM branch_items WHERE status = 'active' GROUP BY item_id HAVING COUNT(DISTINCT branch_id) > 1) shared_items"
  );
  profiles.baseUnits = await query(
    "SELECT is_base_unit AS isBaseUnit, status, COUNT(*) AS unitCount, SUM(active_base_item_id IS NOT NULL) AS populatedBaseGuards FROM item_units GROUP BY is_base_unit, status"
  );
  const report = {
    inspectedAt: new Date().toISOString(),
    database: database[0].databaseName,
    tables,
    counts,
    columns,
    indexes,
    foreignKeys,
    unmappedTables,
    unmappedColumns,
    missingColumns,
    migrations,
    profiles,
  };
  if (process.argv.includes("--verify-setup-reuse")) {
    const { ItemSetupService } = await import(
      "../apps/api/dist/item-setup.service.js"
    );
    const readOnly = prisma.$extends({
      query: {
        $allModels: {
          $allOperations({ operation, args, query }) {
            if (
              ![
                "findMany",
                "findFirst",
                "findUnique",
                "findUniqueOrThrow",
                "count",
                "aggregate",
                "groupBy",
              ].includes(operation)
            )
              throw new Error(
                "A write was blocked during the read-only code check."
              );
            return query(args);
          },
        },
      },
    });
    const setup = new ItemSetupService(readOnly, {});
    const items = await setup.items();
    report.codeProjection = {
      totalItems: items.length,
      configuredItemSuppliers: items.filter(item => item.defaultSupplierId)
        .length,
      needsSupplierSelection: items.filter(item => !item.defaultSupplierId)
        .length,
    };
  }
  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/setup-schema-inspection.json", serialize(report));
  console.log(
    serialize({
      database: report.database,
      tableCount: tables.length,
      counts,
      unmappedTables,
      unmappedColumns,
      missingColumns,
      migrations,
      profiles,
      codeProjection: report.codeProjection,
      newSupplierColumnIndexes: indexes.filter(
        index =>
          index.tableName === "items" &&
          index.columnName === "default_supplier_id"
      ),
      newSupplierColumnReferences: foreignKeys.filter(
        key =>
          key.tableName === "items" && key.columnName === "default_supplier_id"
      ),
    })
  );
} catch (error) {
  // Avoid printing connection strings or database error payloads containing credentials.
  let message = String(error?.message ?? "").replaceAll(
    databaseUrl.toString(),
    "[REDACTED_URL]"
  );
  for (const secret of [
    databaseUrl.username,
    databaseUrl.password,
    decodeURIComponent(databaseUrl.username),
    decodeURIComponent(databaseUrl.password),
  ].filter(Boolean))
    message = message.replaceAll(secret, "[REDACTED]");
  console.error(
    serialize({
      inspectionFailed: true,
      errorType: error?.name ?? "Error",
      code: error?.code ?? error?.errorCode ?? null,
      message,
    })
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
