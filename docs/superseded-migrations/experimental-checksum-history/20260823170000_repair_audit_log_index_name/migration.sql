-- Repair the misspelled index introduced by the initial TiDB migration.
-- The indexed columns remain unchanged; this aligns physical TiDB metadata with Prisma.
DROP INDEX `audit_logs_entity_type_entity_id_ocred_idx` ON `audit_logs`;
CREATE INDEX `audit_logs_entity_type_entity_id_occurred_at_idx`
  ON `audit_logs`(`entity_type`, `entity_id`, `occurred_at`);
