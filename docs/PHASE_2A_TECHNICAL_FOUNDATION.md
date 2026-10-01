# Phase 2A Technical Foundation

The Phase 2A foundation consists of React/Vite/TypeScript, NestJS/Fastify/TypeScript, Prisma, **TiDB**, Redis server-side sessions, and an S3-compatible backend-only storage abstraction. The API exposes health, readiness, authentication, protected authorization checks, and foundation request transitions under `/api/v1`.

The web application is explicitly a **TEMPORARY TECHNICAL SHELL — NOT FINAL UI**. It validates API connectivity, PWA registration and safe updates, localization direction, and the Online-First policy. It does not implement final business screens, template selection, branding, inventory, purchasing, accounting, or Phase 2B work.

| Layer | Implemented foundation |
|---|---|
| Data | Prisma schema, canonical TiDB migration baseline, independent migration-derived and direct Prisma parity gates, RBAC seed only. |
| Authentication | Argon2id password verification, Redis session creation/revocation, Secure HttpOnly cookie handling. |
| Authorization | Four-role RBAC, server-side branch scopes, protected routes. |
| Security | CSRF, origin-specific CORS, rate limiting, secure headers, safe error handling. |
| Historical integrity | Logical request-line exclusion, audited returned edits, submission snapshots, row-version concurrency claim. |
| Web platform | PWA manifest/service worker, static-only precache, Arabic/English/Urdu direction support. |

## Canonical TiDB migration policy

The authoritative database remains TiDB through Prisma provider `mysql`. Future environments apply only `prisma/migrations/20260824090000_canonical_phase2a_tidb_baseline/` together with `prisma/migrations/migration_lock.toml`.

> **Migration immutability rule.** Accepted canonical migrations must not be edited. Future schema changes require new migrations; do not directly edit `_prisma_migrations`, reconcile checksums in that table, or reset production databases to repair migration history.

The experimental checksum-reconciliation files live only under `docs/superseded-migrations/experimental-checksum-history/` and are marked `SUPERSEDED - DO NOT APPLY`. Release evidence requires both `pnpm run db:parity` and `pnpm run db:parity:direct` to pass.
