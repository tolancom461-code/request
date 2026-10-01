# Phase 2A Test Results — Canonical TiDB Final Closeout

| Verification | Result | Evidence |
|---|---|---|
| Canonical empty target precondition | PASS | `tests/fresh-tidb-connection.test.ts` with `FRESH_TIDB_EXPECT_EMPTY=1` |
| Canonical fresh replay/status | PASS | `evidence/canonical_tidb_baseline_replay.log` |
| Prisma validate/generate | PASS | `evidence/canonical_tidb_baseline_replay.log` |
| Canonical migration-derived parity | PASS | `evidence/canonical_migration_to_tidb_parity.json` |
| Direct Prisma schema parity | PASS; `EMPTY` | `evidence/prisma_schema_to_tidb_direct_parity.json` |
| Direct parity negative control | PASS; expected non-zero drift detection | `evidence/prisma_schema_direct_parity_negative_control.json` |
| Final restored parity | PASS | `evidence/final_restored_migration_parity.json` |
| Phase 2A regression | PASS; 5 files, 26 tests | `evidence/canonical_closeout_regression_build.log` |
| TypeScript and production build | PASS | `evidence/canonical_closeout_regression_build.log` |

No fixture was retained on the isolated canonical target. The direct negative-control marker was removed before final parity.
