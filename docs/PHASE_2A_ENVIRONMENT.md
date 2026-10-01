# Phase 2A — Environment and Configuration

| Variable | Purpose | Exposure rule | Phase 2A status |
|---|---|---|---|
| `DATABASE_URL` | Managed MySQL-compatible TiDB connection | Backend only; TLS normalized by Prisma wrapper | Available from project environment |
| `SESSION_SECRET` | Server-side Redis session security secret | Backend only; never committed or returned | Generated and configured during Phase 2A |
| `REDIS_URL` | Redis session store endpoint | Backend only | Defaults to local Redis for development; production endpoint is not configured in this phase |
| `PUBLIC_APP_ORIGIN` | Same-origin CSRF and CORS allowlist | Backend only | Defaults to local technical-shell origin for development |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3-compatible object storage abstraction | Backend only | Configuration validation implemented; no image-management module built |

The backend fails startup if the effective session secret is shorter than 24 characters. Database URLs are normalized to add `sslaccept=strict` when that option is absent. The frontend has no database, session, Redis, storage, or other server secret embedded in its source.
