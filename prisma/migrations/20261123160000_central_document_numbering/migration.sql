CREATE TABLE `document_number_sequences` (
    `prefix` VARCHAR(16) NOT NULL,
    `year` INTEGER NOT NULL,
    `last_value` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`prefix`, `year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Continue any existing numbers already in the new format; historical references stay intact.
INSERT INTO `document_number_sequences` (`prefix`, `year`, `last_value`, `updated_at`)
SELECT 'Req', CAST(SUBSTRING(`request_number`, 5, 4) AS UNSIGNED),
       MAX(CAST(SUBSTRING(`request_number`, 10) AS UNSIGNED)), CURRENT_TIMESTAMP(3)
FROM `requests`
WHERE `request_number` REGEXP '^[Rr][Ee][Qq]-[0-9]{4}-[0-9]{4,}$'
GROUP BY CAST(SUBSTRING(`request_number`, 5, 4) AS UNSIGNED)
ON DUPLICATE KEY UPDATE `last_value` = GREATEST(`last_value`, VALUES(`last_value`));
