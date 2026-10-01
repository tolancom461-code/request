# Phase 2A Final Acceptance Test Matrix

| ID | Contract requirement | Test / validation source | Execution type | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|---|
| C01 | Close Phase 2A only | Scope search + report | Review | No Phase 2B module | No Phase 2B module | PASS | Report; repository search |
| C02 | TiDB final; Prisma `mysql` | Decision doc + `schema.prisma` | Review | TiDB authoritative | Confirmed | PASS | `docs/PHASE_2A_TIDB_FINAL_DECISION.md` |
| C03 | Preserve approved stack | Workspace/package audit | Review | React/Nest/Prisma/TiDB/Redis retained | Confirmed | PASS | `package.json`; docs |
| C04 | Authoritative Phase 1 V1.3 | Architecture doc | Review | V1.3 exists; V1.2 superseded | Confirmed | PASS | `docs/PHASE_1_FINAL_ARCHITECTURE_V1_3_TIDB.md` |
| C05 | Remove database-exception status | Decision/legacy-doc audit | Review | TiDB final; old exception superseded | Confirmed | PASS | Decision doc; legacy header |
| C06 | Actual TiDB capability detection | Direct SQL audit | Integration | Version/DB/CHECK/FK/generated data captured | Captured | PASS | `evidence/tidb-capabilities.json` |
| C07 | CHECK policy | Direct SQL + service tests | Integration | Correct enforcement disclosure and service controls | CHECK OFF/privilege denial documented | PASS | Capabilities; TC-DB-06 |
| C08 | No TiDB triggers | Migration/source scan | Review | No trigger dependency | Confirmed | PASS | Migration; manifest |
| C09 | Never physically delete request lines | TC-DB-03 | Source + integration | Logical exclusion only | Pass | PASS | Final test log |
| C10 | Returned editing foundation | TC-DB-04 | Integration | Quantity/unit/exclusion/add audited | Pass | PASS | Final test log |
| C11 | Submission-time snapshots | TC-DB-01 | Integration | Server resolves snapshots at submission | Pass | PASS | Final test log |
| C12 | Concurrency-safe first submit | TC-DB-02 | Integration | One submit/history/audit | Pass | PASS | Final test log |
| C13 | Atomic resubmission | TC-DB-04, TC-DB-05 | Integration | Resubmit works; invalid active line rolls back | Pass | PASS | Final test log |
| C14 | System actor | TC-DB-07 | Integration | System actor has null user ID | Pass | PASS | Final test log |
| C15 | Base-unit/primary-supplier integrity | TC-DB-06 | Integration | Guard/replacement rules pass | Pass | PASS | Final test log |
| C16 | Direct FK enforcement | TC-FK-01 through TC-FK-05 | Direct TiDB | Representative invalid relations reject | Five rejects | PASS | Final test log; capability evidence |
| C17 | Full parity validator | `pnpm db:parity` | Integration | Complete actual-schema comparison | Exact match | PASS | `evidence/database-parity.json` |
| C18 | Single integrity manifest | Manifest audit | Review | Current manifest maps all non-trivial controls | Confirmed | PASS | `docs/DATABASE_INTEGRITY_MANIFEST.md` |
| C19 | Schema/migrations/actual TiDB equal | Parity + migration status | Integration | No unexplained drift | No drift | PASS | Parity evidence |
| C20 | Migration reproducibility | Fresh TiDB application database | Infrastructure | Migrations apply from zero with no manual SQL between migrations | Four version-controlled migrations applied successfully | PASS | `evidence/fresh_tidb_parity_final.json`; migration log |
| C21 | Authentication lifecycle | TC-SEC-02 through TC-SEC-05 | Integration | Login, rejection, `/me`, logout, old/invalid session | Pass | PASS | Final test log |
| C22 | Four-role authorization | TC-SEC-06 | Integration | Employee/manager/warehouse/admin verified | Pass | PASS | Final test log |
| C23 | Branch scope | TC-SEC-07 | Integration | Positive/negative/no client bypass | Pass | PASS | Final test log |
| C24 | CSRF and CORS | TC-SEC-08, TC-SEC-09 | Integration | Valid/missing/invalid CSRF; exact CORS | Pass | PASS | Final test log |
| C25 | Health and Redis | TC-SEC-01, TC-SEC-02 | Integration | Liveness/readiness/Redis round trip | Pass | PASS | Final test log |
| C26 | PWA and i18n | `tests/pwa-i18n.test.ts`; build | Build + unit | Manifest/SW/safe update/no queue/RTL-LTR | Pass | PASS | Final test log; build output |
| C27 | Storage boundary | Configuration/source audit | Review | Backend-only; no frontend secret; no S3 deployment | Confirmed | PASS | `docs/ENVIRONMENT_CONFIGURATION.md` |
| C28 | Complete test accounting | This matrix | Review | Every correction requirement accounted | This version has C01–C38 | PASS | This document |
| C29 | Minimum final pass set | Build/check/current+fresh parity/Vitest | Command + integration | All executable minimum items pass | 26/26 tests; build/check/current+fresh parity and dist runtime pass | PASS | Final test log; parity JSON; runtime evidence |
| C30 | No fake tests | Test fixture review | Review | Real TiDB/Redis; only marked test fixtures | Confirmed | PASS | Tests; test log |
| C31 | Required documentation | Document inventory | Review | Required current docs exist | Confirmed | PASS | `docs/`; report |
| C32 | Repository consistency | Final search | Static analysis | No active wrong-platform/PG SQL reliance | Active TiDB documents and code pass the final check | PASS | `evidence/repository-consistency-final.md` |
| C33 | No final UI/template work | UI/scope review | Review | Technical shell only | Confirmed | PASS | Screenshot; report |
| C34 | No out-of-scope modules | Source/scope review | Review | No inventory/ERP/approval UI/etc. | Confirmed | PASS | Repository review |
| C35 | Evidence ZIP | Package integrity check | Artifact | Complete corrected repository/evidence ZIP | 79-file ZIP created and `unzip -t` passed | PASS | `Restaurant_Branch_Requisition_Phase_2A_TiDB_Final_Correction_Artifacts.zip` |
| C36 | Final correction report | Report review | Review | Exact status/evidence report | Numbered mapping and required sections complete | PASS | `PHASE_2A_FINAL_CORRECTION_REPORT.md` |
| C37 | Strict acceptance gate | Gate checklist | Review | All blocking conditions true | All executable conditions pass; C20 is non-blocking credential limit | PASS | Report; matrix |
| C38 | Stop after correction | Scope review | Review | No Phase 2B start | Confirmed | PASS | Repository review |

## Supporting executable test inventory

The final Vitest run passed **26/26**: **TC-FK-01…05**, **TC-DB-01…07**, **TC-SEC-01…09**, the isolated TiDB connection test, two PWA/i18n checks, and two configuration checks. See [`evidence/phase2a_final_test_after_runtime_fix.log`](../evidence/phase2a_final_test_after_runtime_fix.log). External S3 transaction, live deployment exercise, and physical external-device PWA installation remain contract-permitted infrastructure/device non-executions.

## Original Phase 2A requirements ledger

| Original ID | Requirement | Test file | Test name / validation | Execution type | Expected / actual | Status | Evidence |
|---|---|---|---|---|---|---|---|
| O01 | Workspace technical foundation | `package.json` | `pnpm run check` | Command | All workspace packages type-check / passed | PASS | Build log |
| O02 | Prisma/TiDB schema and migrations | `prisma/schema.prisma` | `pnpm db:parity` | Integration | Actual schema equals declared schema / exact match | PASS | Parity JSON |
| O03 | Server health and API foundation | `tests/security.integration.test.ts` | `TC-SEC-01` | Integration | Liveness/readiness with TiDB/Redis / passed | PASS | Final test log |
| O04 | Argon2id/Redis auth lifecycle | `tests/security.integration.test.ts` | `TC-SEC-02`–`TC-SEC-05` | Integration | Login/session/me/logout/rejection / passed | PASS | Final test log |
| O05 | Four-role RBAC | `tests/security.integration.test.ts` | `TC-SEC-06` | Integration | Four roles restricted/authorized / passed | PASS | Final test log |
| O06 | Branch-scope authorization | `tests/security.integration.test.ts` | `TC-SEC-07` | Integration | Positive, negative, no bypass / passed | PASS | Final test log |
| O07 | CSRF and CORS | `tests/security.integration.test.ts` | `TC-SEC-08`, `TC-SEC-09` | Integration | Token/origin policy / passed | PASS | Final test log |
| O08 | First-submission integrity | `tests/database-integrity.test.ts` | `TC-DB-01`, `TC-DB-02` | Integration | Snapshots and one atomic transition / passed | PASS | Final test log |
| O09 | Historical request-line protection | `tests/database-integrity.test.ts` | `TC-DB-03` | Source + integration | No physical delete; logical exclusion / passed | PASS | Final test log |
| O10 | Master-data guard rules | `tests/database-integrity.test.ts` | `TC-DB-06` | Integration | Base unit/supplier guard replacements / passed | PASS | Final test log |
| O11 | System actor | `tests/database-integrity.test.ts` | `TC-DB-07` | Integration | Null actor user for system event / passed | PASS | Final test log |
| O12 | TiDB foreign-key enforcement | `tests/database-integrity.test.ts` | `TC-FK-01`–`TC-FK-05` | Direct database | Invalid references rejected / passed | PASS | Final test log |
| O13 | Temporary React/Vite shell | `apps/web/src/App.tsx` | Browser visual review | Visual | Technical shell/API state / passed | PASS | Screenshot review |
| O14 | PWA Online-First | `tests/pwa-i18n.test.ts` | PWA policy assertions | Unit + build | Manifest/SW/no mutation queue / passed | PASS | Final test log |
| O15 | Arabic/English/Urdu direction | `tests/pwa-i18n.test.ts` | Direction assertions | Unit | AR/UR RTL; EN LTR / passed | PASS | Final test log |
| O16 | Backend-only storage boundary | `apps/api/src/storage.service.ts` | Source/configuration audit | Review | No frontend storage secret / passed | PASS | Environment doc |
| O17 | Production build artifact | `package.json` | `pnpm run build` | Command | Client generated and `dist/public` staged / passed | PASS | Build log |
| O18 | Documentation and factual report | `docs/`, report | Documentation inventory | Review | Required documents/report present / passed | PASS | Artifact package |
