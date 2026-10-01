-- The initial migration now intentionally creates the historical `ocred` index,
-- so the following committed repair migration can drop it and create the final
-- Prisma index name during a fresh deploy. Existing TiDB already has the final
-- physical index because that repair migration was recorded previously.
--
-- This version-controlled reconciliation updates only Prisma's migration
-- checksum for the already-applied initial source. A fresh target receives the
-- same checksum from Prisma automatically, so no manual SQL is needed there.
UPDATE `_prisma_migrations`
SET `checksum` = '9056f3481fac60e3a275a2e86c2365d7dd8a6962983e94236e94d53af40fe148'
WHERE `migration_name` = '20260823131000_initial_phase2a';
