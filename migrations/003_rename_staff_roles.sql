-- =====================================================================
-- Migration 003 — Rename staff roles to match the retailer/wholesaler model
-- =====================================================================
-- WHY:
--   The app's role model moved from generic staff titles (SALES_REP, CASHIER)
--   to the business-facing roles the product now uses: ADMIN stays the same,
--   SALES_REP -> WHOLESALER, CASHIER -> RETAILER. BUYER (added in migration
--   002) is untouched. Renaming in place (not inserting new rows) preserves
--   existing users.role_id foreign keys.
--
-- Re-runnable: each UPDATE only matches rows still on the old name, so running
-- this twice is a no-op the second time.
-- =====================================================================

USE `kirana_erp`;

UPDATE `roles` SET `name` = 'WHOLESALER' WHERE `name` = 'SALES_REP';
UPDATE `roles` SET `name` = 'RETAILER' WHERE `name` = 'CASHIER';
