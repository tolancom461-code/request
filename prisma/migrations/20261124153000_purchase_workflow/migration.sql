-- CreateTable
CREATE TABLE `item_suppliers` (
    `item_id` CHAR(36) NOT NULL,
    `supplier_id` CHAR(36) NOT NULL,

    INDEX `item_suppliers_supplier_id_idx`(`supplier_id`),
    PRIMARY KEY (`item_id`, `supplier_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_plans` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('draft', 'issued') NOT NULL DEFAULT 'draft',
    `basis` ENUM('last', 'average') NOT NULL,
    `created_by_user_id` CHAR(36) NOT NULL,
    `issued_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `issued_at` DATETIME(3) NULL,

    UNIQUE INDEX `purchase_plans_request_id_key`(`request_id`),
    INDEX `purchase_plans_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `purchase_plans_issued_by_user_id_idx`(`issued_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_allocations` (
    `id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `request_item_id` CHAR(36) NOT NULL,
    `supplier_id` CHAR(36) NOT NULL,
    `quantity` DECIMAL(18, 6) NOT NULL,
    `estimated_unit_cost` DECIMAL(38, 6) NULL,
    `sheet_id` CHAR(36) NULL,

    INDEX `purchase_allocations_request_item_id_idx`(`request_item_id`),
    INDEX `purchase_allocations_supplier_id_idx`(`supplier_id`),
    INDEX `purchase_allocations_sheet_id_idx`(`sheet_id`),
    UNIQUE INDEX `purchase_allocations_plan_id_request_item_id_supplier_id_key`(`plan_id`, `request_item_id`, `supplier_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_sheets` (
    `id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `supplier_id` CHAR(36) NOT NULL,
    `number` VARCHAR(80) NOT NULL,
    `supplier_code` VARCHAR(80) NOT NULL,
    `supplier_name` VARCHAR(200) NOT NULL,
    `issued_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_sheets_number_key`(`number`),
    INDEX `purchase_sheets_supplier_id_idx`(`supplier_id`),
    UNIQUE INDEX `purchase_sheets_plan_id_supplier_id_key`(`plan_id`, `supplier_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_receipts` (
    `id` CHAR(36) NOT NULL,
    `operation_id` CHAR(36) NOT NULL,
    `allocation_id` CHAR(36) NOT NULL,
    `item_id` CHAR(36) NOT NULL,
    `supplier_id` CHAR(36) NOT NULL,
    `quantity` DECIMAL(18, 6) NOT NULL,
    `base_quantity` DECIMAL(36, 12) NOT NULL,
    `unit_cost` DECIMAL(18, 6) NOT NULL,
    `net_amount` DECIMAL(36, 12) NOT NULL,
    `purchased_on` DATE NOT NULL,
    `invoice_reference` VARCHAR(200) NULL,
    `recorded_by_user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `purchase_receipts_operation_id_key`(`operation_id`),
    INDEX `purchase_receipts_item_id_supplier_id_purchased_on_created_a_idx`(`item_id`, `supplier_id`, `purchased_on`, `created_at`),
    INDEX `purchase_receipts_allocation_id_idx`(`allocation_id`),
    INDEX `purchase_receipts_supplier_id_idx`(`supplier_id`),
    INDEX `purchase_receipts_recorded_by_user_id_idx`(`recorded_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `item_suppliers` ADD CONSTRAINT `item_suppliers_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_suppliers` ADD CONSTRAINT `item_suppliers_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_plans` ADD CONSTRAINT `purchase_plans_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_plans` ADD CONSTRAINT `purchase_plans_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_plans` ADD CONSTRAINT `purchase_plans_issued_by_user_id_fkey` FOREIGN KEY (`issued_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_allocations` ADD CONSTRAINT `purchase_allocations_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `purchase_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_allocations` ADD CONSTRAINT `purchase_allocations_request_item_id_fkey` FOREIGN KEY (`request_item_id`) REFERENCES `request_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_allocations` ADD CONSTRAINT `purchase_allocations_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_allocations` ADD CONSTRAINT `purchase_allocations_sheet_id_fkey` FOREIGN KEY (`sheet_id`) REFERENCES `purchase_sheets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_sheets` ADD CONSTRAINT `purchase_sheets_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `purchase_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_sheets` ADD CONSTRAINT `purchase_sheets_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipts` ADD CONSTRAINT `purchase_receipts_allocation_id_fkey` FOREIGN KEY (`allocation_id`) REFERENCES `purchase_allocations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipts` ADD CONSTRAINT `purchase_receipts_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipts` ADD CONSTRAINT `purchase_receipts_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipts` ADD CONSTRAINT `purchase_receipts_recorded_by_user_id_fkey` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the current default as the first supplier link for every configured item.
INSERT INTO `item_suppliers` (`item_id`, `supplier_id`)
SELECT `id`, `default_supplier_id`
FROM `items`
WHERE `default_supplier_id` IS NOT NULL
ON DUPLICATE KEY UPDATE `supplier_id` = VALUES(`supplier_id`);

-- Seed permissions and grant them to existing built-in administrators and warehouse managers.
INSERT INTO `permissions` (`id`, `code`, `name`)
VALUES
    (UUID(), 'purchase.prepare', 'Prepare purchase plans'),
    (UUID(), 'purchase.issue', 'Issue supplier purchase sheets'),
    (UUID(), 'purchase.record', 'Record actual supplier purchases')
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT role_row.`id`, permission_row.`id`
FROM `roles` AS role_row
CROSS JOIN `permissions` AS permission_row
WHERE role_row.`code` IN ('system_admin', 'warehouse_manager')
  AND permission_row.`code` IN ('purchase.prepare', 'purchase.issue', 'purchase.record')
ON DUPLICATE KEY UPDATE `permission_id` = VALUES(`permission_id`);
