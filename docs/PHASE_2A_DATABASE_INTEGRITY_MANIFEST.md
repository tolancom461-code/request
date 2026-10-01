# Phase 2A — Database Integrity Manifest

> **SUPERSEDED BY [`DATABASE_INTEGRITY_MANIFEST.md`](./DATABASE_INTEGRITY_MANIFEST.md).** This prior document is retained as historical Phase 2A evidence only.

## Purpose

This manifest separates controls verified in the MySQL-compatible TiDB database from controls enforced only by the NestJS transactional service layer. It is intentionally conservative: a control is not described as database-enforced unless its behavior is available in the target environment.

| Integrity rule | Primary implementation | Verification status | Limitation |
|---|---|---|---|
| Core entities and relations | Prisma schema and applied SQL migration | 20 expected tables found | None observed |
| Foreign-key lineage | MySQL/TiDB foreign keys | Applied in migration | Not independently mutation-tested in this phase |
| One branch-item mapping | Unique index | Present | None observed |
| One active base unit key | Nullable unique guard key maintained by `MasterDataIntegrityService` | Duplicate base unit rejected by integration test | Cannot be derived by a database-generated column in target TiDB |
| One active primary supplier key | Nullable unique guard key maintained by `MasterDataIntegrityService` | Duplicate primary supplier rejected by integration test | Cannot be derived by a database-generated column in target TiDB |
| Supplier snapshots | `RequestLinePreparationService` transaction | Snapshot code/name verified by integration test | Requires service-layer write path |
| Base quantity snapshot | `RequestLinePreparationService` transaction | Conversion calculation verified by integration test | Requires service-layer write path |
| First submission | `RequestSubmissionService` transaction, status history, audit log | State/history/audit verified by integration test | No database trigger for immutability |
| Submitted-line physical deletion | Service rejects deletion after first submission | Verified by integration test | Direct SQL write is outside application authorization boundary |
| Actor consistency and submitted-at check DDL | Migration CHECK clauses | DDL applied | Current TiDB environment neither exposes nor enforces these checks; documented platform limitation |

> **Critical limitation:** direct database access can bypass service-enforced historical controls. Production access must be restricted to the application credential and approved maintenance procedures until a database engine with trigger/check enforcement is selected.

## Parity procedure

Run `pnpm run db:parity`. The validator verifies the 20 expected tables and 10 critical unique indexes. It reports TiDB CHECK/trigger restrictions as known platform limitations rather than unexplained drift.
