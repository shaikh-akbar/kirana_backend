-- =====================================================================
-- Kirana Store CRM & ERP Platform - Database Schema
-- Engine: InnoDB | Charset: utf8mb4 | Collation: utf8mb4_unicode_ci
-- Supports Wholesale + Retail sales channels, unit conversion, batch/
-- expiry inventory, Khata (credit ledger) and daily commodity pricing.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `kirana_erp`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `kirana_erp`;

-- =====================================================================
-- 1. CORE SYSTEM TABLES
-- =====================================================================

-- ---------------------------------------------------------------------
-- roles: system roles used for RBAC (Admin, Sales Rep, Cashier, ...)
-- ---------------------------------------------------------------------
CREATE TABLE `roles` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(50)  NOT NULL,
  `permissions` JSON         NULL,
  `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- users: every login-capable person (staff, buyers, sellers reference back to this)
-- ---------------------------------------------------------------------
CREATE TABLE `users` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id`       INT UNSIGNED NOT NULL,
  `name`          VARCHAR(100)    NOT NULL,
  `phone`         VARCHAR(15)     NOT NULL,
  `email`         VARCHAR(150)    NULL,
  `password_hash` VARCHAR(255)    NOT NULL,
  `status`        ENUM('ACTIVE','INACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_phone` (`phone`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role_id` (`role_id`),
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- buyers: customer-side profile (retail walk-in or wholesale dealer)
-- ---------------------------------------------------------------------
CREATE TABLE `buyers` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      BIGINT UNSIGNED NOT NULL,
  `buyer_type`   ENUM('WHOLESALE','RETAIL') NOT NULL DEFAULT 'RETAIL',
  `credit_limit` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_buyers_user_id` (`user_id`),
  KEY `idx_buyers_buyer_type` (`buyer_type`),
  CONSTRAINT `fk_buyers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- sellers: staff / owner acting as the selling party on an order
-- ---------------------------------------------------------------------
CREATE TABLE `sellers` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `business_name` VARCHAR(150) NOT NULL,
  `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sellers_user_id` (`user_id`),
  CONSTRAINT `fk_sellers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- firms: GST-registered business entities under a seller (multi-firm support)
-- ---------------------------------------------------------------------
CREATE TABLE `firms` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `seller_id`  BIGINT UNSIGNED NOT NULL,
  `firm_name`  VARCHAR(150) NOT NULL,
  `gstin`      VARCHAR(15)  NULL,
  `address`    TEXT         NULL,
  `phone`      VARCHAR(15)  NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_firms_seller_id` (`seller_id`),
  UNIQUE KEY `uq_firms_gstin` (`gstin`),
  CONSTRAINT `fk_firms_seller` FOREIGN KEY (`seller_id`) REFERENCES `sellers` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- categories: self-referencing product categories/sub-categories
-- ---------------------------------------------------------------------
CREATE TABLE `categories` (
  `id`        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`      VARCHAR(100) NOT NULL,
  `parent_id` INT UNSIGNED NULL,
  `slug`      VARCHAR(120) NOT NULL,
  `status`    ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_slug` (`slug`),
  KEY `idx_categories_parent_id` (`parent_id`),
  CONSTRAINT `fk_categories_parent` FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 2. PRODUCT, PRICING & UNIT CONVERSION
-- =====================================================================

-- ---------------------------------------------------------------------
-- products: master catalog shared by both retail and wholesale channels
-- ---------------------------------------------------------------------
CREATE TABLE `products` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id`     INT UNSIGNED NULL,
  `name`            VARCHAR(150) NOT NULL,
  `sku`             VARCHAR(50)  NOT NULL,
  `barcode`         VARCHAR(50)  NULL,
  `description`     TEXT         NULL,
  `hsn_code`        VARCHAR(20)  NULL,
  `min_stock_alert` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `is_active`       TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_sku` (`sku`),
  UNIQUE KEY `uq_products_barcode` (`barcode`),
  KEY `idx_products_category_id` (`category_id`),
  KEY `idx_products_name` (`name`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- product_units: unit-of-measure conversion table (loose <-> packed)
-- conversion_factor is always expressed relative to the product's base unit
-- e.g. base unit = GRAM (factor 1), KG -> 1000, QUINTAL -> 100000, BAG -> 50000
-- ---------------------------------------------------------------------
CREATE TABLE `product_units` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`         BIGINT UNSIGNED NOT NULL,
  `unit_name`           ENUM('KG','GRAM','BAG','QUINTAL','BOX','PACKET') NOT NULL,
  `conversion_factor`  DECIMAL(12,4) NOT NULL DEFAULT 1.0000,
  `is_base_unit`       TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_units_product_unit` (`product_id`, `unit_name`),
  CONSTRAINT `fk_product_units_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- wholesale_pricing_tiers: quantity-slab pricing for bulk/wholesale orders
-- ---------------------------------------------------------------------
CREATE TABLE `wholesale_pricing_tiers` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`          BIGINT UNSIGNED NOT NULL,
  `min_quantity`        DECIMAL(10,2) NOT NULL,
  `max_quantity`        DECIMAL(10,2) NULL,
  `tier_price_per_unit` DECIMAL(10,2) NOT NULL,
  `created_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wpt_product_range` (`product_id`, `min_quantity`, `max_quantity`),
  CONSTRAINT `fk_wpt_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- daily_price_logs: day-wise commodity market rate snapshot (mandi rates)
-- ---------------------------------------------------------------------
CREATE TABLE `daily_price_logs` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`       BIGINT UNSIGNED NOT NULL,
  `wholesale_price`  DECIMAL(10,2) NOT NULL,
  `retail_price`     DECIMAL(10,2) NOT NULL,
  `effective_date`   DATE NOT NULL,
  `updated_by`       BIGINT UNSIGNED NULL,
  `created_at`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dpl_product_date` (`product_id`, `effective_date`),
  KEY `idx_dpl_effective_date` (`effective_date`),
  CONSTRAINT `fk_dpl_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_dpl_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 3. INVENTORY, SUPPLIERS & PURCHASING
-- =====================================================================

-- ---------------------------------------------------------------------
-- suppliers: vendors who supply stock (separate from customer-facing buyers)
-- ---------------------------------------------------------------------
CREATE TABLE `suppliers` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vendor_name`     VARCHAR(150) NOT NULL,
  `phone`           VARCHAR(15)  NULL,
  `gstin`           VARCHAR(15)  NULL,
  `address`         TEXT         NULL,
  `current_balance` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_suppliers_vendor_name` (`vendor_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- inventory_batches: batch/lot-wise stock with expiry tracking (FEFO support)
-- ---------------------------------------------------------------------
CREATE TABLE `inventory_batches` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`          BIGINT UNSIGNED NOT NULL,
  `supplier_id`         BIGINT UNSIGNED NULL,
  `batch_number`        VARCHAR(50) NOT NULL,
  `mfg_date`            DATE NULL,
  `expiry_date`         DATE NULL,
  `cost_price`          DECIMAL(10,2) NOT NULL,
  `quantity_available`  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `created_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ib_product_expiry` (`product_id`, `expiry_date`),
  KEY `idx_ib_supplier_id` (`supplier_id`),
  CONSTRAINT `fk_ib_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_ib_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- purchase_orders: inbound stock purchases from suppliers
-- ---------------------------------------------------------------------
CREATE TABLE `purchase_orders` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `supplier_id`     BIGINT UNSIGNED NOT NULL,
  `total_amount`    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `paid_amount`     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `payment_status`  ENUM('PAID','PENDING','PARTIAL') NOT NULL DEFAULT 'PENDING',
  `invoice_number`  VARCHAR(50) NOT NULL,
  `purchase_date`   DATE NOT NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_po_invoice_number` (`invoice_number`),
  KEY `idx_po_supplier_id` (`supplier_id`),
  KEY `idx_po_purchase_date` (`purchase_date`),
  CONSTRAINT `fk_po_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- purchase_order_items: line items of a purchase order, tied to the batch created
-- ---------------------------------------------------------------------
CREATE TABLE `purchase_order_items` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_order_id`  BIGINT UNSIGNED NOT NULL,
  `product_id`         BIGINT UNSIGNED NOT NULL,
  `batch_id`           BIGINT UNSIGNED NULL,
  `quantity`           DECIMAL(10,2) NOT NULL,
  `unit_cost_price`    DECIMAL(10,2) NOT NULL,
  `total_price`        DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_poi_purchase_order_id` (`purchase_order_id`),
  KEY `idx_poi_product_id` (`product_id`),
  KEY `idx_poi_batch_id` (`batch_id`),
  CONSTRAINT `fk_poi_purchase_order` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_poi_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_poi_batch` FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- stock_movements: append-only audit trail of every stock change (in/out)
-- reference_type + reference_id point polymorphically at the source
-- document (orders, purchase_orders, manual adjustments) - no FK since
-- the source table varies by movement_type.
-- ---------------------------------------------------------------------
CREATE TABLE `stock_movements` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`      BIGINT UNSIGNED NOT NULL,
  `batch_id`        BIGINT UNSIGNED NULL,
  `movement_type`   ENUM('PURCHASE','RETAIL_SALE','WHOLESALE_SALE','DAMAGE','LOOSE_CONVERSION','RETURN','ADJUSTMENT') NOT NULL,
  `quantity`        DECIMAL(10,2) NOT NULL COMMENT 'positive = stock in, negative = stock out',
  `reference_type`  VARCHAR(30) NULL COMMENT 'ORDER | PURCHASE_ORDER | MANUAL',
  `reference_id`    BIGINT UNSIGNED NULL COMMENT 'id in the table named by reference_type',
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sm_product_created` (`product_id`, `created_at`),
  KEY `idx_sm_batch_id` (`batch_id`),
  KEY `idx_sm_reference` (`reference_type`, `reference_id`),
  CONSTRAINT `fk_sm_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_sm_batch` FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 4. ORDERS & KHATA (LEDGER) SYSTEM
-- =====================================================================

-- ---------------------------------------------------------------------
-- orders: header for both RETAIL (POS) and WHOLESALE (bulk/credit) sales
-- ---------------------------------------------------------------------
CREATE TABLE `orders` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_number`     VARCHAR(30) NOT NULL,
  `channel`          ENUM('WHOLESALE','RETAIL') NOT NULL,
  `buyer_id`         BIGINT UNSIGNED NULL,
  `seller_id`        BIGINT UNSIGNED NULL,
  `gross_amount`     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `tax_amount`       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `discount_amount`  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `net_amount`       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `payment_status`   ENUM('PAID','UNPAID','PARTIAL') NOT NULL DEFAULT 'UNPAID',
  `order_status`     ENUM('PENDING','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `created_at`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_order_number` (`order_number`),
  KEY `idx_orders_buyer_created` (`buyer_id`, `created_at`),
  KEY `idx_orders_seller_id` (`seller_id`),
  KEY `idx_orders_channel_status` (`channel`, `order_status`),
  CONSTRAINT `fk_orders_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `buyers` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `fk_orders_seller` FOREIGN KEY (`seller_id`) REFERENCES `sellers` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- order_items: line items, unit-aware (each line records the unit sold in)
-- ---------------------------------------------------------------------
CREATE TABLE `order_items` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`     BIGINT UNSIGNED NOT NULL,
  `product_id`   BIGINT UNSIGNED NOT NULL,
  `unit_id`      BIGINT UNSIGNED NOT NULL,
  `quantity`     DECIMAL(10,2) NOT NULL,
  `unit_price`   DECIMAL(10,2) NOT NULL,
  `total_price`  DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_oi_order_id` (`order_id`),
  KEY `idx_oi_product_id` (`product_id`),
  KEY `idx_oi_unit_id` (`unit_id`),
  CONSTRAINT `fk_oi_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_oi_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_oi_unit` FOREIGN KEY (`unit_id`) REFERENCES `product_units` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- customer_ledgers: one Khata account per buyer, holds the running balance
-- ---------------------------------------------------------------------
CREATE TABLE `customer_ledgers` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `buyer_id`                 BIGINT UNSIGNED NOT NULL,
  `current_udhaar_balance`   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `credit_limit`             DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `last_updated`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cl_buyer_id` (`buyer_id`),
  CONSTRAINT `fk_cl_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `buyers` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ledger_transactions: append-only Khata entries (DEBIT = credit sale,
-- CREDIT = repayment); running_balance is a point-in-time snapshot
-- ---------------------------------------------------------------------
CREATE TABLE `ledger_transactions` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ledger_id`          BIGINT UNSIGNED NOT NULL,
  `order_id`           BIGINT UNSIGNED NULL,
  `transaction_type`   ENUM('DEBIT','CREDIT') NOT NULL,
  `amount`             DECIMAL(10,2) NOT NULL,
  `running_balance`    DECIMAL(10,2) NOT NULL,
  `description`        VARCHAR(255) NULL,
  `created_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lt_ledger_created` (`ledger_id`, `created_at`),
  KEY `idx_lt_order_id` (`order_id`),
  CONSTRAINT `fk_lt_ledger` FOREIGN KEY (`ledger_id`) REFERENCES `customer_ledgers` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_lt_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- payment_transactions: actual money movements (POS payment or Khata repayment)
-- ---------------------------------------------------------------------
CREATE TABLE `payment_transactions` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`           BIGINT UNSIGNED NULL,
  `ledger_id`          BIGINT UNSIGNED NULL,
  `payment_mode`       ENUM('CASH','UPI','CARD','NET_BANKING','CHEQUE') NOT NULL,
  `amount`             DECIMAL(10,2) NOT NULL,
  `reference_number`   VARCHAR(100) NULL,
  `transaction_date`   DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pt_order_id` (`order_id`),
  KEY `idx_pt_ledger_id` (`ledger_id`),
  KEY `idx_pt_transaction_date` (`transaction_date`),
  CONSTRAINT `fk_pt_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `fk_pt_ledger` FOREIGN KEY (`ledger_id`) REFERENCES `customer_ledgers` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- credit_reminders: scheduled Khata due reminders (SMS/WhatsApp queue)
-- ---------------------------------------------------------------------
CREATE TABLE `credit_reminders` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `buyer_id`       BIGINT UNSIGNED NOT NULL,
  `ledger_id`      BIGINT UNSIGNED NOT NULL,
  `reminder_date`  DATE NOT NULL,
  `status`         ENUM('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  `message_body`   TEXT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cr_buyer_id` (`buyer_id`),
  KEY `idx_cr_ledger_status` (`ledger_id`, `status`),
  KEY `idx_cr_reminder_date` (`reminder_date`),
  CONSTRAINT `fk_cr_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `buyers` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_cr_ledger` FOREIGN KEY (`ledger_id`) REFERENCES `customer_ledgers` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- SEED DATA: baseline roles required for auth/RBAC to function
-- =====================================================================
INSERT INTO `roles` (`name`, `permissions`) VALUES
  ('ADMIN',     JSON_ARRAY('*')),
  ('SALES_REP', JSON_ARRAY('orders:create', 'orders:read', 'khata:read', 'khata:create', 'inventory:read')),
  ('CASHIER',   JSON_ARRAY('orders:create:retail', 'orders:read', 'khata:payment:create', 'inventory:read'))
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
