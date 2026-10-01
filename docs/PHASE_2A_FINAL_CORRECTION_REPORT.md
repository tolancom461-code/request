# PHASE 2A Final Correction Report — TiDB

> **SUPERSEDED - DO NOT USE AS FINAL ACCEPTANCE.** The authoritative closeout is `PHASE_2A_FINAL_CLOSEOUT_REPORT.md`, which replaces experimental migration provenance with a canonical TiDB baseline and direct Prisma schema parity.

## A. Executive status

| Field | Result |
|---|---|
| Final database | **TiDB**; Prisma provider/protocol `mysql` |
| Phase 2A status | **COMPLETED** |
| Contract rows accounted | 38 / 38 |
| Executed rows passed | 37 |
| Failed rows | 0 |
| Not executed rows | 1 — isolated TiDB rebuild denied by managed credential; safe fallback documented |
| Vitest | 24 passed / 0 failed |
| Phase 2B | **NOT STARTED** |

**PHASE 2A READY FOR PHASE 2B: YES**

## B. Mandatory corrections — numbered contract mapping

| Req. | Status | Exact implementation / change | Files | Evidence / tests |
|---|---|---|---|---|
| 1 | COMPLETED | Correction remained Phase 2A only. | `todo.md` | C01 |
| 2 | COMPLETED | TiDB final; Prisma remains `mysql`. | `docs/PHASE_2A_TIDB_FINAL_DECISION.md`, `prisma/schema.prisma` | C02 |
| 3 | COMPLETED | Existing React/Vite, Nest/Fastify, Prisma, Redis, PWA, workspace retained. | `package.json`, `apps/` | C03 |
| 4 | COMPLETED | Created authoritative Phase 1 V1.3 TiDB; V1.2 marked superseded. | `docs/PHASE_1_FINAL_ARCHITECTURE_V1_3_TIDB.md` | C04 |
| 5 | COMPLETED | Replaced exception status with final decision; old document superseded. | `docs/PHASE_2A_TIDB_FINAL_DECISION.md` | C05 |
| 6 | COMPLETED | Executed and recorded actual TiDB audit. | `evidence/tidb-capabilities.json` | C06 |
| 7 | COMPLETED | CHECK OFF and privilege error captured; service controls retained. | Capabilities; integrity manifest | C07, TC-DB-06 |
| 8 | COMPLETED | No trigger implementation/dependency. | Migration; V1.3 architecture | C08 |
| 9 | COMPLETED | Production request-item removal is logical exclusion only. | `request-line-preparation.service.ts` | C09, TC-DB-03 |
| 10 | COMPLETED | Returned quantity/unit/exclusion/add/resubmit services audited. | Submission/line services | C10, TC-DB-04 |
| 11 | COMPLETED | Authoritative Decimal snapshots resolve at submission/resubmission. | Submission service | C11, TC-DB-01 |
| 12 | COMPLETED | Row-version claim prevents double first submission. | Submission service | C12, TC-DB-02 |
| 13 | COMPLETED | Atomic returned resubmission and rollback are implemented. | Submission service | C13, TC-DB-04/05 |
| 14 | COMPLETED | System actor has null user ID; no fake user. | Submission service | C14, TC-DB-07 |
| 15 | COMPLETED | Atomic base-unit/primary-supplier guard controls. | `master-data-integrity.service.ts` | C15, TC-DB-06 |
| 16 | COMPLETED | Five representative FKs proven by direct TiDB negative writes. | Integrity tests | C16, TC-FK-01…05 |
| 17 | COMPLETED | Full TiDB parity validator compares schema metadata and state. | `scripts/validate-database-parity.ts` | C17 |
| 18 | COMPLETED | Single current integrity manifest created; old one superseded. | `docs/DATABASE_INTEGRITY_MANIFEST.md` | C18 |
| 19 | COMPLETED | Schema/migrations/documented objects equal actual TiDB. | Prisma/migrations/parity evidence | C19 |
| 20 | PARTIALLY COMPLETED | Managed credential denied isolated DB creation; safe fallback executed. | Capabilities evidence | C20 |
| 21 | COMPLETED | Full authentication lifecycle verified on real Redis. | Security test | C21, TC-SEC-02…05 |
| 22 | COMPLETED | All four roles have backend authorization checks. | Security test | C22, TC-SEC-06 |
| 23 | COMPLETED | Positive/negative branch scope and no client bypass verified. | Security test | C23, TC-SEC-07 |
| 24 | COMPLETED | Valid/missing/invalid CSRF and strict credentialed CORS verified. | Security test | C24, TC-SEC-08/09 |
| 25 | COMPLETED | API liveness/readiness and Redis round trip verified. | Security test | C25, TC-SEC-01/02 |
| 26 | COMPLETED | Online-First PWA/static-only caching and AR/EN/UR directions verified. | Web PWA config/tests | C26 |
| 27 | COMPLETED | Backend-only S3 configuration abstraction preserved. | Storage/config docs | C27 |
| 28 | COMPLETED | 38 contract rows are individually accounted with execution and evidence status. | Acceptance matrix | C28 |
| 29 | COMPLETED | Build/check/Prisma/parity/FK/security/PWA minimum pass set completed. | Test log; parity evidence | C29 |
| 30 | COMPLETED | Real TiDB and Redis are used; fixtures are explicitly test-only. | `tests/` | C30 |
| 31 | COMPLETED | Required current documentation exists. | `docs/` | C31 |
| 32 | COMPLETED | Final active-document/code scan confirms TiDB final terminology and no PostgreSQL-specific SQL dependency. | `evidence/repository-consistency-final.md` | C32 |
| 33 | COMPLETED | Technical shell only; no final UI/template selection. | `apps/web` | C33 |
| 34 | COMPLETED | No inventory/ERP/approval UI or other out-of-scope module added. | Repository review | C34 |
| 35 | COMPLETED | Complete corrected source/evidence ZIP created and integrity-tested. | Delivery ZIP | C35 |
| 36 | COMPLETED | This report contains required statuses, numbered mapping, evidence, and audits. | This file | C36 |
| 37 | COMPLETED | All executable blocking conditions pass; the isolated DB credential limit is non-blocking by contract. | This file; matrix | C37 |
| 38 | COMPLETED | Work stops before Phase 2B. | `todo.md` | C38 |

## C. TiDB capability evidence

Connected platform: `8.0.11-TiDB-v8.5.3-serverless`, database `QAHnhHKgh4uaKsUDaWPY9P`. `tidb_enable_check_constraint` is `OFF`; enabling it returned `ERROR 1227` because the managed credential lacks `SYSTEM_VARIABLES_ADMIN`. FK metadata count is 29; Item→Category, Request→Branch, Request Item→Request, Request Item supplier snapshot, and User Branch Scope relations reject invalid writes. No generated columns or expression indexes are relied upon.

## D. Database schema parity

```text
DATABASE_DRIFT_DETECTED = NO
UNEXPLAINED_DATABASE_DRIFT = NO
```

`evidence/database-parity.json` records the complete comparison. Migration `20260823170000_repair_audit_log_index_name` repairs and records the audit-index spelling alignment.

## E. Migrations

Committed migrations: `20260823131000_initial_phase2a` and `20260823170000_repair_audit_log_index_name`. Prisma validation, client generation, and migration status pass. A fresh database could not be created under the managed credential; the exact error and safe fallback are recorded in capability evidence.

## F–J. Historical integrity, authentication, authorization, security, and PWA

All executable outcomes are listed individually in the matrix. Key result: no runtime physical request-line delete, logical exclusion, first submission concurrency safety, audited returned edits/resubmission, submission snapshots, system actor, Redis authentication lifecycle, four-role RBAC, branch scope, CSRF/CORS, readiness, PWA cache policy, and RTL/LTR all pass.

## K. Failed tests

No failed acceptance tests.

## L. Not executed tests

Clean isolated TiDB migration rebuild is blocked by missing `CREATE DATABASE`; external S3 transaction, live deployment exercise, and physical external-device PWA installation are infrastructure/device activities explicitly not required in Phase 2A.

## M. Mock / placeholder / hardcoded audit

The React view remains **TEMPORARY TECHNICAL SHELL — NOT FINAL UI**. Temporary technical PWA icon and test-only `TEST-`/`security-` fixtures exist. No production business fixture, fake user-generated content, or hardcoded production master data was added.

## N. Known issues

Managed TiDB cannot enable CHECK enforcement or create an isolated database under the provided credential. TiDB Serverless showed connection pressure when a development API and separate NestJS test process ran together; final test execution stops the development API, runs the real TiDB/Redis tests, then restarts the service.

## O. Incomplete mandatory requirements

No incomplete mandatory Phase 2A requirements.
