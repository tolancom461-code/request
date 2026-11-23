-- A supplier can now be chosen before an item is assigned to restaurants.
-- Existing branch-specific supplier links and request snapshots remain intact.
ALTER TABLE `items` ADD COLUMN `default_supplier_id` CHAR(36) NULL;
CREATE INDEX `items_default_supplier_id_idx` ON `items` (`default_supplier_id`);
ALTER TABLE `items` ADD CONSTRAINT `items_default_supplier_id_fkey`
  FOREIGN KEY (`default_supplier_id`) REFERENCES `suppliers` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
