# Database Integrity Manifest — Canonical TiDB Baseline

## A. Rules represented directly by `prisma/schema.prisma`

The current migration chain represents Prisma model/table mappings, field/column mappings, scalar types and precision, nullability, defaults, primary keys, foreign keys with delete/update actions, unique constraints, and non-unique relation indexes. `item_units.active_base_item_id` is a nullable Prisma field with a unique constraint. An item's supplier is selected through `items.default_supplier_id`; `branch_items` assigns the same item to one or more restaurants. The November 2026 migrations retire `branch_item_suppliers` and its request-line relation while retaining the historical migrations unchanged.

| Rule | Canonical representation | Proof |
|---|---|---|
| Foreign-key graph | Prisma relations and canonical migration FKs | Direct diff `EMPTY`; TC-FK-01…05 |
| Item/unit uniqueness | `@@unique([itemId, unitId])` | Direct diff `EMPTY`; TC-DB-06 |
| Active base unit | Nullable unique `activeBaseItemId` | Direct diff `EMPTY`; TC-DB-06 |
| Item supplier | Nullable `defaultSupplierId` foreign key to `suppliers`; one supplier per item | Supplier integration and database-integrity tests |
| Restaurant items | Unique `(branchId, itemId)` relationship | Shared-item and stale-selection integration tests |

## B. TiDB-specific or application-enforced rules

TiDB CHECK enforcement is disabled in the managed cluster; **CHECK not database-enforced** is the active policy. Positive conversion factors, base-unit validity, active item/supplier validation, actor validity, logical request-line removal, snapshot timing, and first-submit/resubmit transaction rules are enforced by tested NestJS services. Submitted request lines retain their supplier and unit snapshots when master data changes. No trigger is required or used. Migration history is managed through Prisma commands, including `migrate resolve` for the inspected, partially applied supplier-column migration.

## C. Intentional compatibility difference

Disabled TiDB CHECK enforcement is the sole accepted compatibility limitation. It is documented as application-enforced and does not mask a table, column, type, nullability, default, mapping, foreign-key, or index difference. Canonical migration-derived parity and direct Prisma schema-to-TiDB parity both pass.
