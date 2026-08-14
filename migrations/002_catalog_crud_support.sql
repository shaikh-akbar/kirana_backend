-- =====================================================================
-- Migration 002 — Support for catalog/buyer/purchase CRUD (Phase 1)
-- =====================================================================
-- WHY:
--   Phase 1 opens the tables that only `scripts/seed-saheb-ali.js` could write
--   before (products, buyers, purchase orders) to the API. Two gaps in the
--   baseline schema block that, and one report is unservable without an index.
--
--   1. A `buyers` row hangs off a `users` row, and `users.role_id` is NOT NULL
--      pointing at a role table seeded only with staff roles (ADMIN,
--      SALES_REP, CASHIER). Registering a dealer would therefore have had to
--      label them a cashier. A BUYER role with no permissions fixes that
--      without widening anyone's access: buyer users are created INACTIVE and
--      cannot log in at all today.
--
--   2. The khata screens identify a dealer by their contact person and market
--      area ("Anil Deshmukh, APMC Yard Sector 4") — a shopkeeper recognises
--      the person and the lane, not the registered firm name. `buyers` had
--      nowhere to keep either.
--
-- Re-runnable: every statement is guarded (IF NOT EXISTS / ON DUPLICATE KEY),
-- so a half-applied file can be retried.
-- =====================================================================

USE `kirana_erp`;

-- ---------------------------------------------------------------------
-- 1. BUYER role — a customer identity, not a login
-- ---------------------------------------------------------------------
-- Empty permission array on purpose: nothing in the API authorises on it. It
-- exists so a dealer's `users` row can satisfy the NOT NULL FK without being
-- mistaken for staff by `authorize()`.
INSERT INTO `roles` (`name`, `permissions`) VALUES
  ('BUYER', JSON_ARRAY())
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- ---------------------------------------------------------------------
-- 2. buyers: the identifying details a khata screen shows
-- ---------------------------------------------------------------------
ALTER TABLE `buyers`
  ADD COLUMN IF NOT EXISTS `contact_person` VARCHAR(100) NULL
    COMMENT 'person the shopkeeper actually deals with' AFTER `buyer_type`,
  ADD COLUMN IF NOT EXISTS `area` VARCHAR(120) NULL
    COMMENT 'market/locality, e.g. APMC Yard Sector 4' AFTER `contact_person`,
  ADD COLUMN IF NOT EXISTS `address` TEXT NULL AFTER `area`,
  ADD COLUMN IF NOT EXISTS `is_active` TINYINT(1) NOT NULL DEFAULT 1 AFTER `credit_limit`;

-- ---------------------------------------------------------------------
-- 3. Reporting indexes
-- ---------------------------------------------------------------------
-- The dashboard's 14-day trend and top-products panels both scan
-- orders by (firm, bill_date) and then join order_items by order — the first
-- is already covered by idx_orders_firm_bill_date from migration 001, the
-- second needs order_items reachable by order_id alone.
ALTER TABLE `order_items`
  ADD INDEX IF NOT EXISTS `idx_oi_order_id` (`order_id`);

-- Supplier-side purchase listing filters on (firm, purchase_date), covered by
-- idx_po_firm_date. Line items need the same order-by-parent access path.
ALTER TABLE `purchase_order_items`
  ADD INDEX IF NOT EXISTS `idx_poi_po_product` (`purchase_order_id`, `product_id`);
