# Environment Configuration

| Variable / service | Boundary | Validation |
|---|---|---|
| `DATABASE_URL` | Server only | TiDB MySQL-compatible URL normalized for strict TLS by backend configuration. |
| `SESSION_SECRET` | Server only | Required high-entropy secret; not exposed to client. |
| Redis | Server only | Readiness check and Redis session round-trip test. |
| S3-compatible storage configuration | Server only | Configuration abstraction and input validation; no Phase 2A object transaction required. |
| `PUBLIC_APP_ORIGIN` | API configuration | Exact credentialed CORS origin; unapproved origins are denied. |

No database, Redis, S3, or session secret is bundled into the Vite client. The TiDB database is the approved production target. The temporary local Redis service is used for development acceptance tests; external S3 transaction testing is outside Phase 2A.
