# Phase 1 Final Architecture V1.3 — TiDB

## Authoritative status

This document is the **authoritative architecture** for all phases following Phase 2A. The final database platform is **TiDB** and the Prisma provider/protocol is **`mysql`**. PostgreSQL is not an active target, fallback, or unresolved decision.

## Runtime architecture

The platform is an npm-workspaces monorepo containing a React/Vite/TypeScript Online-First PWA, a NestJS/Fastify/TypeScript API under `/api/v1`, Prisma, TiDB, and Redis-backed server-side sessions. Browser code communicates with the API only; database, Redis, session, and storage credentials remain server-side. The PWA caches static application assets only. It never queues or replays business mutations offline.

## TiDB integrity model

TiDB foreign keys are represented in Prisma and committed migrations, and representative invalid writes are tested directly. The development cluster reports TiDB `8.0.11-TiDB-v8.5.3-serverless`; its `tidb_enable_check_constraint` setting is `OFF`, and the managed credential is not permitted to change it. Intended CHECK definitions remain versioned and documented, while executable service validation, transaction guards, unique guard keys, and direct FK enforcement provide the active integrity controls.

The architecture does **not** depend on database triggers. The runtime never physically deletes `request_items`; all removals use `lineStatus = excluded` with removal actor, time, and reason. This applies to draft and submitted requests alike.

| Rule | TiDB-safe enforcement |
|---|---|
| One active base unit per item | Nullable guard key plus unique index, maintained by `MasterDataIntegrityService` transactionally. |
| One active primary supplier per branch item | Nullable guard key plus unique index, maintained by `MasterDataIntegrityService` transactionally. |
| Positive factor and base-unit factor of one | `RequestLinePreparationService` and `MasterDataIntegrityService` validation; intended CHECK definitions remain versioned. |
| Historical request data | Logical exclusion, audit rows, status history, and submission/resubmission transactions. |
| Concurrent first submission | `rowVersion` claim in a TiDB transaction, one status history and audit result. |

## Historical request rules

Authoritative supplier, unit, conversion-factor, and base-quantity snapshots are resolved only when a request moves from `draft` or `returned` to `pending_approval`. The server revalidates branch item, item unit, and active primary supplier, computes base quantity using Decimal arithmetic, and never trusts client snapshot values. Returned-request edits create audit before/after evidence; resubmission retains the original `submittedAt`, refreshes active-line snapshots, and rolls back as a unit if an active line is invalid.

The actor model has two valid forms: `actorType = user` requires a real `actorUserId`; `actorType = system` requires `actorUserId = NULL`. No fabricated system user is permitted.

## Security and authorization

Authentication uses Argon2id verification, server-side Redis sessions, HttpOnly cookies, CSRF validation for state-changing requests, origin-specific credentialed CORS, rate limiting, secure headers, RBAC, and server-side branch-scope authorization. Approved roles remain System Admin, Branch Employee, Restaurant/Branch Manager, and Warehouse Manager.

## Parity and operations

The required project rule is: **Prisma schema + committed migrations + documented TiDB integrity objects = actual TiDB**. `scripts/validate-database-parity.ts` compares tables, columns, type metadata, nullability, keys, foreign keys, indexes, generated objects, CHECK visibility, and Prisma migration state. Allowed TiDB limitations are reported separately from unexplained drift.

## Supersession

`/home/ubuntu/restaurant_phase1_final_lock/PHASE_1_FINAL_ARCHITECTURE_V1_2.md` is **SUPERSEDED BY PHASE_1_FINAL_ARCHITECTURE_V1_3_TIDB.md**. Its historical record is retained.
