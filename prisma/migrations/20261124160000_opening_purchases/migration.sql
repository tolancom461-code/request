-- CreateTable
CREATE TABLE `opening_purchases` (
    `id` CHAR(36) NOT NULL,
    `operation_id` CHAR(36) NOT NULL,
    `item_id` CHAR(36) NOT NULL,
    `supplier_id` CHAR(36) NOT NULL,
    `item_unit_id` CHAR(36) NOT NULL,
    `supplier_code` VARCHAR(80) NOT NULL,
    `supplier_name` VARCHAR(200) NOT NULL,
    `unit_code` VARCHAR(40) NOT NULL,
    `quantity` DECIMAL(18, 6) NOT NULL,
    `base_quantity` DECIMAL(36, 12) NOT NULL,
    `unit_cost` DECIMAL(18, 6) NOT NULL,
    `net_amount` DECIMAL(36, 12) NOT NULL,
    `purchased_on` DATE NOT NULL,
    `invoice_reference` VARCHAR(200) NULL,
    `recorded_by_user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `opening_purchases_operation_id_key`(`operation_id`),
    INDEX `opening_purchases_item_id_supplier_id_purchased_on_created_a_idx`(`item_id`, `supplier_id`, `purchased_on`, `created_at`),
    INDEX `opening_purchases_supplier_id_idx`(`supplier_id`),
    INDEX `opening_purchases_item_unit_id_idx`(`item_unit_id`),
    INDEX `opening_purchases_recorded_by_user_id_idx`(`recorded_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `opening_purchases` ADD CONSTRAINT `opening_purchases_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opening_purchases` ADD CONSTRAINT `opening_purchases_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opening_purchases` ADD CONSTRAINT `opening_purchases_item_unit_id_fkey` FOREIGN KEY (`item_unit_id`) REFERENCES `item_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opening_purchases` ADD CONSTRAINT `opening_purchases_recorded_by_user_id_fkey` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

