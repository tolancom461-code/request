-- DropForeignKey
ALTER TABLE `branch_item_suppliers` DROP FOREIGN KEY `branch_item_suppliers_branch_item_id_fkey`;

-- DropForeignKey
ALTER TABLE `branch_item_suppliers` DROP FOREIGN KEY `branch_item_suppliers_supplier_id_fkey`;

-- DropForeignKey
ALTER TABLE `request_items` DROP FOREIGN KEY `request_items_branch_item_supplier_id_snapshot_fkey`;

-- DropIndex
DROP INDEX `request_items_branch_item_supplier_id_snapshot_idx` ON `request_items`;

-- AlterTable
ALTER TABLE `request_items` DROP COLUMN `branch_item_supplier_id_snapshot`;

-- DropTable
DROP TABLE `branch_item_suppliers`;

