# SUPERSEDED — Phase 2A TiDB Final Decision

> This historical document is superseded by [`PHASE_2A_TIDB_FINAL_DECISION.md`](./PHASE_2A_TIDB_FINAL_DECISION.md). TiDB is now the final approved database platform, not an unresolved exception.

# Phase 2A — User-Approved MySQL Exception (Historical)

## Decision

The authoritative Phase 1 locked architecture selected PostgreSQL. During Phase 2A, the user explicitly approved using the managed **MySQL-compatible TiDB** database available in the project environment instead. This document records that exception rather than silently changing the approved architecture.

| Topic | Locked Phase 1 decision | Phase 2A implemented decision | Status |
|---|---|---|---|
| Database platform | PostgreSQL | MySQL-compatible TiDB | User-approved exception |
| ORM | Prisma-compatible design | Prisma 6 with MySQL provider | Implemented |
| Referential integrity | Foreign keys and database constraints | Foreign keys and unique indexes applied | Verified |
| Cross-row historical protection | PostgreSQL triggers | Transaction-only service enforcement | Partial; platform limitation |
| Check constraints | PostgreSQL enforced checks | DDL present, not enforced/introspectable by this TiDB environment | Known limitation |

## Consequences

The data model, relations, snapshot fields, actor model, and request-state vocabulary remain aligned to the Phase 1 design. The exception changes only database-platform capabilities. Because this TiDB Serverless environment does not support the trigger implementation required for the original platform, the following controls are implemented in application transactions and are **not** database-trigger enforced: first-submission timestamp immutability, post-submission line lineage marking, and blocking physical deletion of a previously submitted line.

The final Phase 2A report must continue to disclose this exception until an approved migration back to PostgreSQL or an equivalent database-enforced control is completed.
