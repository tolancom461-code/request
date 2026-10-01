-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` VARCHAR(500) NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(120) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` VARCHAR(500) NULL,

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `user_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,

    INDEX `user_roles_role_id_idx`(`role_id`),
    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` CHAR(36) NOT NULL,
    `permission_id` CHAR(36) NOT NULL,

    INDEX `role_permissions_permission_id_idx`(`permission_id`),
    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branches` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `name_ar` VARCHAR(200) NOT NULL,
    `name_en` VARCHAR(200) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `branches_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_branch_scopes` (
    `user_id` CHAR(36) NOT NULL,
    `branch_id` CHAR(36) NOT NULL,

    INDEX `user_branch_scopes_branch_id_idx`(`branch_id`),
    PRIMARY KEY (`user_id`, `branch_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` CHAR(36) NOT NULL,
    `supplier_code` VARCHAR(80) NOT NULL,
    `supplier_name` VARCHAR(200) NOT NULL,
    `tax_number` VARCHAR(100) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `suppliers_supplier_code_key`(`supplier_code`),
    UNIQUE INDEX `suppliers_tax_number_key`(`tax_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `units` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name_ar` VARCHAR(100) NOT NULL,
    `name_en` VARCHAR(100) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

    UNIQUE INDEX `units_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `name_ar` VARCHAR(200) NOT NULL,
    `name_en` VARCHAR(200) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `categories_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `items` (
    `id` CHAR(36) NOT NULL,
    `sku` VARCHAR(80) NOT NULL,
    `barcode` VARCHAR(120) NULL,
    `category_id` CHAR(36) NOT NULL,
    `name_ar` VARCHAR(250) NOT NULL,
    `name_en` VARCHAR(250) NULL,
    `name_ur` VARCHAR(250) NULL,
    `image_object_key` VARCHAR(500) NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `items_sku_key`(`sku`),
    UNIQUE INDEX `items_barcode_key`(`barcode`),
    INDEX `items_category_id_idx`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `item_units` (
    `id` CHAR(36) NOT NULL,
    `item_id` CHAR(36) NOT NULL,
    `unit_id` CHAR(36) NOT NULL,
    `conversion_factor_to_base` DECIMAL(18, 6) NOT NULL,
    `is_base_unit` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `active_base_item_id` CHAR(36) NULL,

    UNIQUE INDEX `item_units_active_base_item_id_key`(`active_base_item_id`),
    INDEX `item_units_item_id_status_idx`(`item_id`, `status`),
    INDEX `item_units_unit_id_idx`(`unit_id`),
    UNIQUE INDEX `item_units_item_id_unit_id_key`(`item_id`, `unit_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branch_items` (
    `id` CHAR(36) NOT NULL,
    `branch_id` CHAR(36) NOT NULL,
    `item_id` CHAR(36) NOT NULL,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `deleted_at` DATETIME(3) NULL,

    INDEX `branch_items_item_id_idx`(`item_id`),
    UNIQUE INDEX `branch_items_branch_id_item_id_key`(`branch_id`, `item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branch_item_suppliers` (
    `id` CHAR(36) NOT NULL,
    `branch_item_id` CHAR(36) NOT NULL,
    `supplier_id` CHAR(36) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    `active_primary_branch_item_id` CHAR(36) NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,

    UNIQUE INDEX `branch_item_suppliers_active_primary_branch_item_id_key`(`active_primary_branch_item_id`),
    INDEX `branch_item_suppliers_branch_item_id_status_is_primary_idx`(`branch_item_id`, `status`, `is_primary`),
    INDEX `branch_item_suppliers_supplier_id_idx`(`supplier_id`),
    UNIQUE INDEX `branch_item_suppliers_branch_item_id_supplier_id_key`(`branch_item_id`, `supplier_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requests` (
    `id` CHAR(36) NOT NULL,
    `request_number` VARCHAR(80) NOT NULL,
    `branch_id` CHAR(36) NOT NULL,
    `created_by_user_id` CHAR(36) NOT NULL,
    `status` ENUM('draft', 'pending_approval', 'returned', 'rejected', 'approved', 'sent_to_warehouse', 'preparing', 'ready', 'dispatched', 'completed') NOT NULL DEFAULT 'draft',
    `row_version` INTEGER NOT NULL DEFAULT 1,
    `submitted_at` DATETIME(3) NULL,
    `approved_at` DATETIME(3) NULL,
    `warehouse_available_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `requests_request_number_key`(`request_number`),
    INDEX `requests_branch_id_status_idx`(`branch_id`, `status`),
    INDEX `requests_created_by_user_id_status_idx`(`created_by_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `request_items` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `branch_item_id_snapshot` CHAR(36) NOT NULL,
    `item_id_snapshot` CHAR(36) NOT NULL,
    `item_unit_id_snapshot` CHAR(36) NOT NULL,
    `branch_item_supplier_id_snapshot` CHAR(36) NOT NULL,
    `supplier_id_snapshot` CHAR(36) NOT NULL,
    `supplier_code_snapshot` VARCHAR(80) NOT NULL,
    `supplier_name_snapshot` VARCHAR(200) NOT NULL,
    `requested_quantity` DECIMAL(18, 6) NOT NULL,
    `conversion_factor_snapshot` DECIMAL(18, 6) NOT NULL,
    `base_quantity_snapshot` DECIMAL(18, 6) NOT NULL,
    `line_status` ENUM('active', 'excluded') NOT NULL DEFAULT 'active',
    `added_after_first_submission` BOOLEAN NOT NULL DEFAULT false,
    `added_by_user_id` CHAR(36) NULL,
    `added_at` DATETIME(3) NULL,
    `removed_by_user_id` CHAR(36) NULL,
    `removed_at` DATETIME(3) NULL,
    `removal_reason` VARCHAR(500) NULL,

    INDEX `request_items_request_id_line_status_idx`(`request_id`, `line_status`),
    INDEX `request_items_branch_item_id_snapshot_idx`(`branch_item_id_snapshot`),
    INDEX `request_items_item_id_snapshot_idx`(`item_id_snapshot`),
    INDEX `request_items_item_unit_id_snapshot_idx`(`item_unit_id_snapshot`),
    INDEX `request_items_branch_item_supplier_id_snapshot_idx`(`branch_item_supplier_id_snapshot`),
    INDEX `request_items_supplier_id_snapshot_idx`(`supplier_id_snapshot`),
    INDEX `request_items_added_by_user_id_idx`(`added_by_user_id`),
    INDEX `request_items_removed_by_user_id_idx`(`removed_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `request_approvals` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `decision` ENUM('approved', 'returned', 'rejected') NOT NULL,
    `comment` VARCHAR(1000) NULL,
    `decided_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `request_approvals_request_id_decided_at_idx`(`request_id`, `decided_at`),
    INDEX `request_approvals_actor_user_id_idx`(`actor_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `request_status_history` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `actor_type` ENUM('user', 'system') NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `from_status` ENUM('draft', 'pending_approval', 'returned', 'rejected', 'approved', 'sent_to_warehouse', 'preparing', 'ready', 'dispatched', 'completed') NULL,
    `to_status` ENUM('draft', 'pending_approval', 'returned', 'rejected', 'approved', 'sent_to_warehouse', 'preparing', 'ready', 'dispatched', 'completed') NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `request_status_history_request_id_occurred_at_idx`(`request_id`, `occurred_at`),
    INDEX `request_status_history_actor_user_id_idx`(`actor_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actor_type` ENUM('user', 'system') NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `entity_type` VARCHAR(100) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `action` VARCHAR(120) NOT NULL,
    `before_data` JSON NULL,
    `after_data` JSON NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_type_entity_id_occurred_at_idx`(`entity_type`, `entity_id`, `occurred_at`),
    INDEX `audit_logs_actor_user_id_idx`(`actor_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `recipient_user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(120) NOT NULL,
    `payload` JSON NOT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_recipient_user_id_read_at_idx`(`recipient_user_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_branch_scopes` ADD CONSTRAINT `user_branch_scopes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_branch_scopes` ADD CONSTRAINT `user_branch_scopes_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_units` ADD CONSTRAINT `item_units_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_units` ADD CONSTRAINT `item_units_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branch_items` ADD CONSTRAINT `branch_items_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branch_items` ADD CONSTRAINT `branch_items_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branch_item_suppliers` ADD CONSTRAINT `branch_item_suppliers_branch_item_id_fkey` FOREIGN KEY (`branch_item_id`) REFERENCES `branch_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branch_item_suppliers` ADD CONSTRAINT `branch_item_suppliers_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requests` ADD CONSTRAINT `requests_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requests` ADD CONSTRAINT `requests_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_items` ADD CONSTRAINT `request_items_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_items` ADD CONSTRAINT `request_items_branch_item_id_snapshot_fkey` FOREIGN KEY (`branch_item_id_snapshot`) REFERENCES `branch_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_items` ADD CONSTRAINT `request_items_item_id_snapshot_fkey` FOREIGN KEY (`item_id_snapshot`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_items` ADD CONSTRAINT `request_items_item_unit_id_snapshot_fkey` FOREIGN KEY (`item_unit_id_snapshot`) REFERENCES `item_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_items` ADD CONSTRAINT `request_items_branch_item_supplier_id_snapshot_fkey` FOREIGN KEY (`branch_item_supplier_id_snapshot`) REFERENCES `branch_item_suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_items` ADD CONSTRAINT `request_items_supplier_id_snapshot_fkey` FOREIGN KEY (`supplier_id_snapshot`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_items` ADD CONSTRAINT `request_items_added_by_user_id_fkey` FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_items` ADD CONSTRAINT `request_items_removed_by_user_id_fkey` FOREIGN KEY (`removed_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_approvals` ADD CONSTRAINT `request_approvals_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_approvals` ADD CONSTRAINT `request_approvals_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_status_history` ADD CONSTRAINT `request_status_history_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_status_history` ADD CONSTRAINT `request_status_history_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipient_user_id_fkey` FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

