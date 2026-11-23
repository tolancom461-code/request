# Central document numbering

Document references use `Prefix-Year-Sequence`, starting with `Req-2026-0001` for requisitions. Each prefix/year has a separate persistent counter. The year is calculated in `Asia/Riyadh`, so 2027 begins at 21:00 UTC on 31 December 2026. Four digits are the minimum width: after `9999` comes `10000`.

`DocumentNumberingService` is the single allocator. The registry in that service maps document types to unique prefixes. New document types must use that service inside the same transaction that saves the document. Master-data codes, barcodes and SKUs remain manually assigned.

The atomic TiDB upsert locks the prefix/year counter until commit. The existing unique constraint on `requests.request_number` remains the final uniqueness guard. Failed document transactions roll back the tentative number; rejected and completed requests keep their committed numbers. Draft creation locks the user and rechecks the existing draft, so concurrent requests to resume the same cart do not issue multiple numbers. Transient transaction conflicts are retried with a bounded delay.

Historical references retain their original values. The migration initializes counters from any references already using the new format, taking their maximum sequence. It never updates a saved request number. The admin-only **Numbering center** shows the current year's prefix and last issued number. Reading or refreshing it does not consume a number; there is no manual reset operation.

## Validation and migration

`scripts/verify-document-numbering.mjs` creates an isolated `REQUEST_verify_*` database, applies the migration chain, seeds system roles, runs TiDB integration tests, and removes that temporary database. Cases cover concurrency across service instances, rollback, Riyadh's year boundary, values after 9999, migration initialization, draft reuse and access control. Local format tests and DOM tests cover year calculation and the read-only center.

The migration is `prisma/migrations/20261123160000_central_document_numbering/migration.sql`. The one-time `scripts/apply-document-numbering.mjs` requires a passing isolated test result with the same migration checksum, checks the expected migration history, takes an encrypted backup, applies the migration, and verifies existing references are unchanged. Local results and backup locations are recorded under the ignored `evidence` directory.

## Applied on 23 November 2026

The migration is applied to `REQUEST`. An encrypted backup was taken before application, and the existing request reference was verified unchanged. Migration-derived parity reports no drift. The implementation passed 66 local cases, 15 DOM cases, and 15 TiDB integration cases. Both production builds passed. The temporary test databases were removed.

The running application must be updated to this code to use the new allocator and show the admin center. Applying the database migration alone does not change numbering in an older running application. No saved request was renumbered, and verification did not allocate a number on `REQUEST`.
