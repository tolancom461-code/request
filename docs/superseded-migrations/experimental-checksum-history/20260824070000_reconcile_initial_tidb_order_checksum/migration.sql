-- Reconcile the checksum after splitting TiDB guard-column creation from the
-- dependent unique-index creation in the initial migration. The split is
-- required for a fresh TiDB deployment and does not change final schema.
UPDATE `_prisma_migrations`
SET `checksum` = '2d94c49cea86cff8fec8fb6a2d3e2de7b1f1981ab91d65ebe6770a62dc093869'
WHERE `migration_name` = '20260823131000_initial_phase2a';
