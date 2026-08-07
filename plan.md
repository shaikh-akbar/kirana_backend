# Roadmap

## Phase 0 — Foundation (done)

- [x] `schema.sql`: full InnoDB/utf8mb4 schema — roles/users/buyers/sellers/firms, product
      catalog + unit conversion + wholesale tiers + daily pricing, suppliers + batch inventory +
      stock movements + purchase orders, orders + Khata ledger + payments + credit reminders.
- [x] Express app skeleton: config/middleware/utils, JWT auth + RBAC, centralized error handling.
- [x] Auth module: register / login / me.
- [x] Retail order flow (POS checkout, FEFO stock deduction, immediate payment).
- [x] Wholesale order flow (tiered pricing, FEFO stock deduction, Khata credit booking with
      credit-limit enforcement).
- [x] Khata ledger read + repayment recording.
- [x] Daily price bulk update.
- [x] Low-stock report.

## Phase 1 — Catalog & purchasing CRUD

Nothing currently creates a `product`, `category`, `product_units` row, or a `purchase_order` —
today's endpoints assume that data already exists. Needed before the order endpoints are usable
end-to-end:

- [ ] Categories: CRUD + tree listing (`parent_id`).
- [ ] Products: CRUD, including nested `product_units` (define base unit + conversion factors)
      and `wholesale_pricing_tiers` management.
- [ ] Suppliers: CRUD.
- [ ] Purchase orders: create PO + PO items → generates `inventory_batches` rows and a
      `PURCHASE` `stock_movements` entry (mirrors the transactional pattern already used in
      `orders`).
- [ ] Buyers/sellers/firms: onboarding endpoints (create buyer profile + ledger on signup for
      wholesale buyers).

## Phase 2 — Order visibility & corrections

- [ ] `GET /api/orders/:id` and `GET /api/orders` (filter by channel/buyer/date range) — needed
      for invoices, receipts, and the Khata order-linkage the schema already supports.
- [ ] Order cancellation/return flow: reverse `stock_movements` (RETURN), reverse the Khata debit
      if it was a credit sale, update `order_status`.
- [ ] `LOOSE_CONVERSION` stock movement endpoint (e.g. break a 50kg bag into loose kg stock) —
      the enum value exists in `stock_movements` but nothing writes it yet.

## Phase 3 — Khata automation

- [ ] `credit_reminders` scheduler: a cron/worker that finds ledgers past a due threshold, writes
      a `PENDING` reminder row, and dispatches it (SMS/WhatsApp) — the table exists, the
      dispatcher doesn't.
- [ ] Ledger statement export (PDF/print) per buyer for a date range.

## Phase 4 — Reporting & dashboards

- [ ] Daily sales summary (retail vs wholesale split, payment mode breakdown).
- [ ] Supplier ledger / purchase payment tracking (mirrors Khata but for `suppliers.current_balance`).
- [ ] Expiry report (batches nearing `expiry_date`) — complements low-stock.
- [ ] GST/HSN-wise sales report using `products.hsn_code` + `firms.gstin`.

## Phase 5 — Hardening

- [ ] Automated tests (unit for services, integration for the transactional order flows —
      these are the highest-risk code paths: stock deduction + pricing + ledger all commit
      together).
- [ ] Rate limiting on `/api/auth/login`.
- [ ] Structured logging (replace `console.error` in the error middleware).
- [ ] DB migrations tool (the project currently has one static `schema.sql`; once there's
      production data, switch to versioned migrations for any further schema change).

## Phase 6 — Frontend

- [ ] Admin/back-office SPA (React or Next.js) consuming this API: POS screen, wholesale order
      screen, Khata ledger view per buyer, daily price entry grid, low-stock dashboard.
- [ ] Role-aware UI matching the ADMIN / SALES_REP / CASHIER permissions already enforced
      server-side.
