# Phase 2A Canonical TiDB Baseline Evidence

## Clean-target precondition

The isolated TiDB target identity was recorded only as database name `restaurant_phase2a_canonical_baseline_20260824` on the approved TiDB gateway; no credentials, tokens, or connection URLs are stored in this evidence. Before replay, `FRESH_TIDB_EXPECT_EMPTY=1` executed `tests/fresh-tidb-connection.test.ts` and confirmed that no project application tables existed.

## Canonical migration history

| Order | File | Result |
|---|---|---|
| 1 | `prisma/migrations/20260824090000_canonical_phase2a_tidb_baseline/migration.sql` | Applied by Prisma from an empty target: PASS |
| Lock | `prisma/migrations/migration_lock.toml` | `provider = "mysql"`: PASS |

The command `DATABASE_URL=[REDACTED] node scripts/run-prisma-with-tls.mjs migrate deploy --schema prisma/schema.prisma` exited with status `0`. It was the sole schema-creation command after the target was confirmed empty; no database schema object was manually pre-created and no manual SQL ran between migrations.

## Prisma and parity results

| Check | Result | Evidence |
|---|---|---|
| `prisma validate` | PASS | `evidence/canonical_tidb_baseline_replay.log` |
| `prisma generate` | PASS | `evidence/canonical_tidb_baseline_replay.log` |
| `prisma migrate status` | PASS; schema up to date | `evidence/canonical_tidb_baseline_replay.log` |
| Canonical migrations → TiDB | PASS | `evidence/canonical_migration_to_tidb_parity.json` |
| Prisma schema → TiDB direct diff | PASS; `EMPTY` | `evidence/prisma_schema_to_tidb_direct_parity.json` |
| Direct-diff negative control | PASS; drift detected with exit code `2` | `evidence/prisma_schema_direct_parity_negative_control.json` |
| Direct-diff restored target | PASS; `EMPTY` | `evidence/prisma_schema_direct_parity_restored.json` |
| Migration-derived restored target | PASS | `evidence/final_restored_migration_parity.json` |

The direct parity command is `prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url [REDACTED] --script --exit-code`, executed through `scripts/prisma-schema-direct-parity.mjs`. A no-op result is recorded as `PRISMA_SCHEMA_TO_TIDB_STRUCTURAL_DIFF = EMPTY`.
