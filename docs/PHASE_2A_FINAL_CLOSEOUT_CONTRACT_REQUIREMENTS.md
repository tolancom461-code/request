# Phase 2A Final Closeout Contract — Extracted Requirements

**Source:** `/home/ubuntu/upload/document(37).pdf`.

## Scope

The file is a final, narrowly scoped **Phase 2A** contract. It explicitly prohibits starting Phase 2B, changing the approved TiDB/Prisma MySQL-provider stack, redesigning features, or modifying accepted Phase 2A application behavior except where direct migration/parity work requires it.

## Mandatory deliverables

| Area | Required outcome |
|---|---|
| Canonical baseline | `prisma/migrations/` contains only a deterministic, clean TiDB canonical migration chain suitable for future empty environments. Experimental reconciliation migrations must be archived outside this executable path and marked `SUPERSEDED - DO NOT APPLY`. |
| Migration safety | No executable migration or script may directly update, insert, delete, or otherwise manipulate `_prisma_migrations`. No manual SQL is allowed between canonical migrations. |
| Lock file | `prisma/migrations/migration_lock.toml` exists and declares `provider = "mysql"`. |
| Clean replay | A separate clean TiDB application target is shown to have no project application tables before replay; canonical migrations replay from zero successfully. |
| Prisma checks | `prisma validate`, `prisma generate`, and migration status pass against final source and clean TiDB target. |
| Gate A | Canonical migration end-state compared with actual TiDB passes. |
| Gate B | A direct, Prisma-supported `prisma/schema.prisma` to actual TiDB structural comparison proves an empty/no-op difference. Migration SQL parsing alone is insufficient. |
| Direct negative control | A temporary unexpected structural object on the clean target makes Gate B fail, then is removed and Gate B passes again. |
| Integrity manifest | The manifest distinguishes Prisma-represented objects, TiDB/application-enforced rules, and intentional compatibility differences; it must not mask real schema mismatch. |
| Reporting | Update the specified Phase 2A documents; create `docs/PHASE_2A_CANONICAL_TIDB_BASELINE_EVIDENCE.md`, `docs/DATABASE_SCHEMA_PARITY_REPORT.md`, and exactly `PHASE_2A_FINAL_CLOSEOUT_REPORT.md`. |

## Mandatory final assertions

The report must state actual values for canonical replay, direct Prisma schema-to-TiDB parity, migration-to-TiDB parity, direct negative control, restored parity, lock file, direct Prisma migration-table manipulation, unexplained drift, regression tests, and binary final acceptance. `PHASE 2A READY FOR PHASE 2B: YES` is permitted only if every contractual gate passes; otherwise it must be `NO`.
