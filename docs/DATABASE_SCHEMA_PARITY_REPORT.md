# Database Schema Parity Report — Canonical TiDB Final Closeout

| Required gate | Method | Result | Evidence |
|---|---|---|---|
| `CANONICAL_MIGRATIONS_TO_TIDB` | Canonical migration/metadata validator against isolated TiDB | PASS | `evidence/canonical_migration_to_tidb_parity.json` |
| `PRISMA_SCHEMA_TO_TIDB` | Prisma-supported `migrate diff` from schema datamodel to TiDB URL | PASS; structural diff `EMPTY` | `evidence/prisma_schema_to_tidb_direct_parity.json` |
| `TIDB_INTEGRITY_MANIFEST_VALIDATION` | Manifest review plus migration-derived parity policy check | PASS | `docs/DATABASE_INTEGRITY_MANIFEST.md`; parity JSON |
| `NEGATIVE_CONTROL_DIRECT_SCHEMA_DIFF` | Disposable unexpected table on isolated TiDB | DETECTED_DRIFT_AS_EXPECTED | `evidence/prisma_schema_direct_parity_negative_control.json` |
| `FINAL_RESTORED_PARITY` | Remove marker, rerun both independent gates | PASS | `evidence/prisma_schema_direct_parity_restored.json`; `evidence/final_restored_migration_parity.json` |

`UNEXPLAINED_DATABASE_DRIFT = NO`.

The migration-derived gate validates canonical source/history/checksum, metadata, tables, columns, indexes, foreign keys, and TiDB policy. The direct gate independently compares `prisma/schema.prisma` with TiDB; it is not derived from parsing migration SQL.
