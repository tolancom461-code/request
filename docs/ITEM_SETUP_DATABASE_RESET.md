# Unified item setup and database reset

The supported setup order is: restaurants/suppliers/categories/units, item details and base unit in one save, item supplier, then a restaurant's selected items in one save. An item may be assigned to several restaurants. Its supplier is stored on `items.default_supplier_id` and applies across those restaurants.

`branch_item_suppliers` and `request_items.branch_item_supplier_id_snapshot` are retired by `20261123110000_unify_item_supplier`. The API no longer exposes branch-specific supplier configuration or supplier effective-date scheduling. Request lines retain supplier ID/code/name, selected unit ID, conversion factor and base quantity snapshots. Submitted requests keep their supplier data when the item's supplier changes; submission and returned resubmission resolve the current supplier.

The reset clears trial master data, requests, notifications, audit activity, sessions, scopes and non-administrator users. Active System Admin identities, password hashes, system roles, permissions and migration history are retained. Clearing sessions requires signing in again.

## Backup and recovery

Backups are stored under the Git-ignored `.backups` directory. `database.aesgcm` contains authenticated AES-256-GCM encrypted schema and data. `key.dpapi` protects the encryption key for the same Windows user account. Keep both files and `manifest.json` together. These backups require that Windows account to decrypt; they are not portable plaintext SQL dumps.

Each backup is decrypted and checked before cleanup. Before the authorized reset, a backup was also restored into an isolated `REQUEST_verify_*` database and its per-table data hashes were compared. Restoration into a new isolated database can be repeated with:

```powershell
node scripts/prepare-database-reset.mjs verification-clone "ABSOLUTE_BACKUP_DIRECTORY"
```

The command creates a new verification database and does not restore over `REQUEST`. Local evidence files identify the backup directories, restored target, tested migration checksum and final cleanup counts. They contain no connection password.

## Validation

Regular `pnpm test` runs local unit, HTTP and source-contract tests. Database integration tests require `RUN_DATABASE_TESTS=1` and a `TEST_DATABASE_URL` whose database name matches `REQUEST_verify_*`. The isolated runner configures this automatically:

```powershell
node scripts/run-isolated-tests.mjs
node node_modules/vitest/vitest.mjs run --config tests/vitest.dom.config.ts
```

If an isolated suite fails because of an interrupted database connection, `node scripts/recheck-isolated-failures.mjs` reruns every case in the failed suites. It retains the original and recheck reports separately and derives the final verification from all suites; it does not replace a failed result with an unchecked success flag.

Database tests exercise the real TiDB schema, authentication, permissions, branch scope, CSRF, item setup, requisition submission/return, approval, warehouse processing, notifications and reports. Object-storage operations in image tests use an isolated adapter; these tests do not establish a live S3 round trip.

`scripts/reset-restaurant-database.mjs` binds the authorized maintenance job to `REQUEST` on the inspected server, requires a verified isolated test result and unchanged migration checksum before its explicit reset mode, takes a fresh encrypted backup and refuses to repeat a completed reset. It preserves the existing administrator credentials. Do not use it as a routine data-cleaning command.

## Completed maintenance: 23 November 2026

The authorized reset removed 468 trial records from `REQUEST`. One active System Admin, four roles, twelve permissions, their system assignments and all migration history remain. Both new migrations are applied; Prisma's direct diff and migration-derived parity report no drift. The final application check returned HTTP 200 for readiness, the preserved admin session, setup options, setup items and the dashboard. The verification session was removed, and all business tables remain empty.

The isolated suite covers 125 passing cases, including a successful repeat of the four requisition cases after one case encountered a TiDB connection interruption. The separate DOM suite passed nine cases. Type checks and production builds passed. The temporary verification database was removed after verification. The fresh pre-reset backup is identified in the local `evidence/reset-applied.json`; backup files remain under `.backups`.

The local environment currently has no object-storage configuration. Configure `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` before uploading real item images; the database reset does not configure that external service.
