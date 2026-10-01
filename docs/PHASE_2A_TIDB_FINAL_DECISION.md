# Phase 2A Final Database Decision

> **Approved final database platform: TiDB.**

TiDB is the final approved project database. Prisma continues to use `provider = "mysql"` because TiDB exposes the MySQL-compatible protocol. TiDB is not a temporary exception and Phase 2A does not require a PostgreSQL fallback.

The current cluster capability evidence is retained in [`evidence/tidb-capabilities.json`](../evidence/tidb-capabilities.json). The chosen architecture uses committed migrations, Prisma, service validation, unique guard keys, direct foreign-key verification, audited request transitions, and parity validation. It does not use triggers. Because the current managed credential cannot enable TiDB CHECK enforcement, intended checks are documented and versioned while application-path controls are tested.

`docs/PHASE_2A_MYSQL_EXCEPTION.md` is superseded and retained only as historical context.
