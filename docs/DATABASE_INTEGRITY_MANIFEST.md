# Database Integrity Manifest — Canonical TiDB Baseline

## A. Rules represented directly by `prisma/schema.prisma`

The canonical baseline represents Prisma model/table mappings, field/column mappings, scalar types and precision, nullability, defaults, primary keys, foreign keys with delete/update actions, unique constraints, and non-unique relation indexes. The two active-guard fields, `item_units.active_base_item_id` and `branch_item_suppliers.active_primary_branch_item_id`, are nullable Prisma fields with unique constraints and canonical Prisma-generated indexes.

| Rule | Canonical representation | Proof |
|---|---|---|
| Foreign-key graph | Prisma relations and canonical migration FKs | Direct diff `EMPTY`; TC-FK-01…05 |
| Item/unit uniqueness | `@@unique([itemId, unitId])` | Direct diff `EMPTY`; TC-DB-06 |
| Active base unit | Nullable unique `activeBaseItemId` | Direct diff `EMPTY`; TC-DB-06 |
| Active primary supplier | Nullable unique `activePrimaryBranchItemId` | Direct diff `EMPTY`; TC-DB-06 |

## B. TiDB-specific or application-enforced rules

TiDB CHECK enforcement is disabled in the managed cluster; **CHECK not database-enforced** is the active policy. Positive conversion factors, base-unit and primary-supplier truth conditions, actor validity, logical request-line removal, snapshot timing, and first-submit/resubmit transaction rules are enforced by tested NestJS services. No trigger is required or used. No authoritative migration or maintenance script directly modifies `_prisma_migrations`.

## C. Intentional compatibility difference

Disabled TiDB CHECK enforcement is the sole accepted compatibility limitation. It is documented as application-enforced and does not mask a table, column, type, nullability, default, mapping, foreign-key, or index difference. Canonical migration-derived parity and direct Prisma schema-to-TiDB parity both pass.
