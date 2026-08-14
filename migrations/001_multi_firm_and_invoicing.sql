-- =====================================================================
-- Migration 001 — Multi-firm scoping + real invoice support
-- =====================================================================
-- WHY:
--   schema.sql shipped a `firms` table but no business table referenced it,
--   so every product/order/batch/ledger row was global. Two firms under one
--   owner (e.g. "Shree Krishna Kirana Store" + "Shree Krishna Wholesale
--   Depot") would have shared one set of books — legally wrong, since each
--   firm files its own return under its own GSTIN/TIN.
--
-- SCOPING MODEL (deliberate split):
--   SHARED (global)     : categories, products, product_units,
--                         wholesale_pricing_tiers, daily_price_logs, suppliers
--                         -> the same "Tuwar Daal" item and the same mandi rate
--                            are used by both firms; avoids duplicate catalogs.
--   FIRM-SCOPED (per firm): orders, purchase_orders, inventory_batches,
--                         stock_movements, customer_ledgers
--                         -> stock, invoices, purchases and khata balances are
--                            each firm's own books.
--
-- INVOICE SUPPORT is modelled on the client's existing printed bill
-- (SAHEB ALI WHOLESALE KIRANA, Bill No. A026490): a per-firm sequential
-- bill number with an alpha prefix, a bill date/time distinct from the row's
-- created_at, a "TO: CASH" walk-in customer name, item-count/total-qty/
-- total-weight footers, and the Maharashtra VAT declaration block.
--
-- Safe to run on the current DB: every business table is empty (only `roles`
-- is seeded), so NOT NULL columns can be added without backfill.
-- =====================================================================

USE `kirana_erp`;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. firms: identity, statutory ids and invoice numbering settings
-- ---------------------------------------------------------------------
ALTER TABLE `firms`
  ADD COLUMN `firm_type`      ENUM('RETAIL','WHOLESALE','BOTH') NOT NULL DEFAULT 'BOTH' AFTER `firm_name`,
  ADD COLUMN `legal_name`     VARCHAR(150) NULL AFTER `firm_type`,
  ADD COLUMN `pan`            VARCHAR(10)  NULL AFTER `gstin`,
  ADD COLUMN `vat_tin`        VARCHAR(20)  NULL COMMENT 'legacy MVAT TIN still printed on bills' AFTER `pan`,
  ADD COLUMN `fssai_number`   VARCHAR(20)  NULL AFTER `vat_tin`,
  ADD COLUMN `city`           VARCHAR(80)  NULL AFTER `address`,
  ADD COLUMN `state`          VARCHAR(80)  NULL AFTER `city`,
  ADD COLUMN `state_code`     VARCHAR(2)   NULL COMMENT 'GST state code, e.g. 27 = Maharashtra' AFTER `state`,
  ADD COLUMN `pincode`        VARCHAR(10)  NULL AFTER `state_code`,
  ADD COLUMN `alt_phone`      VARCHAR(15)  NULL AFTER `phone`,
  -- invoice numbering: bill_number = invoice_prefix + zero-padded counter
  -- e.g. prefix 'A', padding 6, counter 26490 -> 'A026490'
  ADD COLUMN `invoice_prefix`      VARCHAR(10) NOT NULL DEFAULT 'INV' AFTER `pincode`,
  ADD COLUMN `invoice_padding`     TINYINT UNSIGNED NOT NULL DEFAULT 6 AFTER `invoice_prefix`,
  ADD COLUMN `next_bill_number`    INT UNSIGNED NOT NULL DEFAULT 1 AFTER `invoice_padding`,
  ADD COLUMN `invoice_footer_text` TEXT NULL COMMENT 'statutory declaration printed at the bill foot' AFTER `next_bill_number`,
  ADD COLUMN `invoice_thanks_text` VARCHAR(120) NULL DEFAULT 'Thanks for Shoping Visit Again' AFTER `invoice_footer_text`,
  ADD COLUMN `is_active`      TINYINT(1) NOT NULL DEFAULT 1 AFTER `invoice_thanks_text`,
  ADD COLUMN `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;

-- A seller cannot register the same firm name twice; GSTIN stays globally
-- unique (already enforced) but is nullable for unregistered firms.
ALTER TABLE `firms`
  ADD UNIQUE KEY `uq_firms_seller_name` (`seller_id`, `firm_name`);

-- ---------------------------------------------------------------------
-- 2. firm_users: which users may operate which firm, and in what role
-- ---------------------------------------------------------------------
-- The owner reaches a firm through sellers.user_id, but staff (CASHIER,
-- SALES_REP) are not sellers and would otherwise have no path to a firm.
-- This table is the authoritative access list used by the firmScope
-- middleware, and is what the frontend's firm-switcher dropdown reads.
CREATE TABLE IF NOT EXISTS `firm_users` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `firm_id`    BIGINT UNSIGNED NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `role_id`    INT UNSIGNED NOT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'firm pre-selected on login',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_firm_users_firm_user` (`firm_id`, `user_id`),
  KEY `idx_firm_users_user_id` (`user_id`),
  KEY `idx_firm_users_role_id` (`role_id`),
  CONSTRAINT `fk_firm_users_firm` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_firm_users_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_firm_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. inventory_batches: stock belongs to one firm's godown
-- ---------------------------------------------------------------------
ALTER TABLE `inventory_batches`
  ADD COLUMN `firm_id` BIGINT UNSIGNED NOT NULL AFTER `id`,
  ADD COLUMN `storage_location` VARCHAR(50) NULL COMMENT 'rack/godown label, e.g. Rack A1' AFTER `quantity_available`,
  ADD KEY `idx_ib_firm_product_expiry` (`firm_id`, `product_id`, `expiry_date`),
  ADD CONSTRAINT `fk_ib_firm` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- 4. stock_movements: per-firm audit trail
-- ---------------------------------------------------------------------
-- firm_id is stored rather than derived from batch_id because ADJUSTMENT and
-- LOOSE_CONVERSION movements may carry a NULL batch_id.
ALTER TABLE `stock_movements`
  ADD COLUMN `firm_id` BIGINT UNSIGNED NOT NULL AFTER `id`,
  ADD KEY `idx_sm_firm_created` (`firm_id`, `created_at`),
  ADD CONSTRAINT `fk_sm_firm` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- 5. orders: firm ownership + printable invoice fields
-- ---------------------------------------------------------------------
ALTER TABLE `orders`
  ADD COLUMN `firm_id` BIGINT UNSIGNED NOT NULL AFTER `id`,
  -- Human-facing bill number shown on the print-out (e.g. 'A026490').
  -- order_number stays as the internal, globally-unique document id.
  ADD COLUMN `bill_number` VARCHAR(20) NOT NULL AFTER `order_number`,
  -- The counter value behind bill_number, kept for gap detection and for
  -- "reprint bill 26490" lookups without string parsing.
  ADD COLUMN `bill_sequence` INT UNSIGNED NOT NULL AFTER `bill_number`,
  -- Bill date/time as printed. Distinct from created_at so a bill can be
  -- back-dated (offline day-book entry) without faking the audit timestamp.
  ADD COLUMN `bill_date` DATETIME NOT NULL AFTER `bill_sequence`,
  -- Walk-in cash sales have no buyer row; the bill still prints "TO: CASH".
  ADD COLUMN `customer_name` VARCHAR(150) NOT NULL DEFAULT 'CASH' AFTER `buyer_id`,
  ADD COLUMN `customer_phone` VARCHAR(15) NULL AFTER `customer_name`,
  -- Printed footers: "Items 3 / Total Qty 9 / Total Wtt.: 0.000Kg"
  ADD COLUMN `item_count`      SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER `net_amount`,
  ADD COLUMN `total_quantity`  DECIMAL(12,3) NOT NULL DEFAULT 0.000 AFTER `item_count`,
  ADD COLUMN `total_weight_kg` DECIMAL(12,3) NOT NULL DEFAULT 0.000 AFTER `total_quantity`,
  ADD COLUMN `notes` VARCHAR(255) NULL AFTER `order_status`,
  ADD UNIQUE KEY `uq_orders_firm_bill` (`firm_id`, `bill_number`),
  ADD KEY `idx_orders_firm_bill_date` (`firm_id`, `bill_date`),
  ADD CONSTRAINT `fk_orders_firm` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- ---------------------------------------------------------------------
-- 6. order_items: immutable line snapshot + 3-decimal quantities
-- ---------------------------------------------------------------------
-- A reprinted bill must match the original paper, so the description and
-- unit label are frozen onto the line instead of being re-joined from
-- `products` (which may be renamed later).
-- quantity widens to DECIMAL(12,3): the client's bill prints "3.000".
ALTER TABLE `order_items`
  MODIFY COLUMN `quantity` DECIMAL(12,3) NOT NULL,
  ADD COLUMN `description` VARCHAR(150) NOT NULL COMMENT 'product name frozen at bill time' AFTER `product_id`,
  ADD COLUMN `unit_label`  VARCHAR(20)  NULL COMMENT 'unit name frozen at bill time' AFTER `unit_id`,
  ADD COLUMN `weight_kg`   DECIMAL(12,3) NOT NULL DEFAULT 0.000 COMMENT 'line weight, feeds Total Wtt.' AFTER `quantity`,
  ADD COLUMN `line_no`     SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'print order on the bill' AFTER `order_id`;

-- order_items.unit_id must tolerate ad-hoc lines (a rate typed for an item
-- with no configured unit row), so it becomes nullable.
--
-- These are three separate ALTERs on purpose: MySQL validates an
-- ADD CONSTRAINT ... ON DELETE SET NULL against the column definition as it
-- was at the start of the statement, so combining MODIFY ... NULL with the
-- ADD CONSTRAINT in one ALTER fails with ER_FK_INCORRECT_OPTION.
ALTER TABLE `order_items`
  DROP FOREIGN KEY `fk_oi_unit`;
ALTER TABLE `order_items`
  MODIFY COLUMN `unit_id` BIGINT UNSIGNED NULL;
ALTER TABLE `order_items`
  ADD CONSTRAINT `fk_oi_unit` FOREIGN KEY (`unit_id`) REFERENCES `product_units` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 7. purchase_orders: inbound stock is booked to one firm
-- ---------------------------------------------------------------------
-- invoice_number was globally unique, which would reject two firms that
-- happen to receive supplier bills with the same number. Scope it per firm.
ALTER TABLE `purchase_orders`
  ADD COLUMN `firm_id` BIGINT UNSIGNED NOT NULL AFTER `id`,
  DROP INDEX `uq_po_invoice_number`,
  ADD UNIQUE KEY `uq_po_firm_invoice` (`firm_id`, `invoice_number`),
  ADD KEY `idx_po_firm_date` (`firm_id`, `purchase_date`),
  ADD CONSTRAINT `fk_po_firm` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- ---------------------------------------------------------------------
-- 8. customer_ledgers: one khata per (buyer, firm)
-- ---------------------------------------------------------------------
-- The same dealer can owe money to both firms independently, so the khata
-- balance is keyed on the pair, not on buyer alone.
ALTER TABLE `customer_ledgers`
  ADD COLUMN `firm_id` BIGINT UNSIGNED NOT NULL AFTER `id`,
  DROP INDEX `uq_cl_buyer_id`,
  ADD UNIQUE KEY `uq_cl_firm_buyer` (`firm_id`, `buyer_id`),
  ADD CONSTRAINT `fk_cl_firm` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- 9. daily_price_logs: rate is per firm-type, not per firm
-- ---------------------------------------------------------------------
-- Left global on purpose (both firms buy at the same mandi rate), but the
-- bill must be able to override it: shopkeepers type the day's rate at the
-- counter. `orders`/`order_items` already store the applied unit_price, so
-- no schema change is needed here — recorded for future readers.

SET FOREIGN_KEY_CHECKS = 1;
