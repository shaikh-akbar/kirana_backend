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

## Phase 0.5 — Multi-firm scoping & real invoicing (done)

`schema.sql` shipped a `firms` table that nothing referenced, so all books were global. Fixed in
`migrations/001_multi_firm_and_invoicing.sql` plus a `scripts/migrate.js` runner.

- [x] Scoping split: catalog stays shared (categories, products, product_units,
      wholesale_pricing_tiers, daily_price_logs, suppliers); transactional data is per firm
      (orders, purchase_orders, inventory_batches, stock_movements, customer_ledgers).
- [x] `firm_users` access table — staff who are not sellers can be granted a firm + role.
- [x] `firmScope` middleware: resolves `X-Firm-Id` → `req.firmId`, proving membership. Applied to
      every orders/inventory/khata route. firmId is never read from the request body.
- [x] Firms module: `POST /api/firms` (onboarding — creates the seller profile lazily, the firm,
      and the owner's ADMIN membership in one transaction), `GET /api/firms` (firm-switcher feed),
      `GET|PATCH /api/firms/active`. Update goes through a column whitelist, so `next_bill_number`
      and `seller_id` are unreachable from the API.
- [x] Per-firm sequential bill numbers (`reserveBillNumber`): firm row locked `FOR UPDATE` inside
      the checkout transaction, so a rolled-back sale never burns a number and leaves a gap in the
      printed series. `nextBillNumber` is settable at firm creation so a shop continues its
      existing paper bill book (e.g. resume at A026490).
- [x] Invoice parity with the client's printed bill: firm header block, `bill_number`/`bill_date`
      distinct from `created_at` (bills can be back-dated), `customer_name` defaulting to CASH for
      walk-ins, `item_count`/`total_quantity`/`total_weight_kg` footers, statutory footer text.
- [x] Counter-typed rates: `items[].unitPrice` overrides the stored daily/tier rate — a kirana sets
      the day's rate at the counter, and billing was previously impossible without a pre-seeded
      `daily_price_logs` row.
- [x] `order_items` freezes `description`/`unit_label` at bill time so a reprint matches the paper
      even after a product is renamed; `quantity` widened to DECIMAL(12,3) to print "3.000".
- [x] `GET /api/orders` (bill register, filterable by channel + bill-date range) and
      `GET /api/orders/:id/invoice` (printable payload) — closes the Phase 2 invoice gap.
- [x] Bugs fixed while scoping: FEFO deduction and the low-stock report ignored firm entirely;
      `stock_movements.reference_id` was always NULL so movements could not be traced to their
      order; `getLatestDailyPrice` could pick a future-dated rate.
- [x] `scripts/seed-saheb-ali.js` — seeds the client's real firm, the three products from their
      bill, opening stock and rates.

## Phase 1 — Catalog & purchasing CRUD (done, except staff invites)

`migrations/002_catalog_crud_support.sql` adds what this phase needed from the schema: a `BUYER`
role (a dealer's `users` row must reference *some* role, and every seeded role was a staff role),
`buyers.contact_person` / `area` / `address` (the khata screens identify a dealer by person and
market lane), and two access-path indexes for the new reports.

- [x] Categories: CRUD + tree listing (`parent_id`) — `modules/catalog`.
- [x] Products: CRUD, including nested `product_units` (base unit + conversion factors) and
      `wholesale_pricing_tiers`. Listing joins per-firm stock on hand and the rate in force today.
      Deletion is a retirement (`is_active = 0`) — `order_items` FKs to products and an old bill
      must stay reprintable.
- [x] Suppliers: CRUD. `current_balance` is deliberately not writable: it moves only by posting
      purchases and payments, or the supplier ledger stops reconciling.
- [x] Purchase orders: `POST /api/purchases` creates the PO + items + firm-scoped
      `inventory_batches` + a `PURCHASE` `stock_movements` row, and adds the unpaid balance to the
      supplier — one transaction, because a partial commit leaves the godown and the books
      disagreeing.
- [x] Buyers: `modules/buyers` — creates the user, buyer profile and the firm's khata together.
      Buyer users are created INACTIVE with an unusable password hash: they are customers, not
      logins.
- [x] Opening-stock / stock-adjustment endpoint (`POST /api/inventory/adjust`). A positive
      quantity opens a batch; a negative one deducts FEFO via the order module's own routine, so a
      write-off consumes batches in exactly the order a sale does.
- [ ] Staff management: invite a user to a firm (`firm_users` row) — the table and middleware
      support it, no endpoint writes it yet.

## Phase 2 — Order visibility & corrections

- [x] `GET /api/orders/:id/invoice` and `GET /api/orders` (filter by channel + bill-date range) —
      done in Phase 0.5. Still missing: a `buyerId` filter on the register.
- [ ] Order cancellation/return flow: reverse `stock_movements` (RETURN), reverse the Khata debit
      if it was a credit sale, update `order_status`. Note: cancelling must NOT reuse the bill
      number — the printed series has to stay gap-free and immutable.
- [ ] `LOOSE_CONVERSION` stock movement endpoint (e.g. break a 50kg bag into loose kg stock) —
      the enum value exists in `stock_movements` but nothing writes it yet.

## Phase 3 — Khata automation

- [ ] `credit_reminders` scheduler: a cron/worker that finds ledgers past a due threshold, writes
      a `PENDING` reminder row, and dispatches it (SMS/WhatsApp) — the table exists, the
      dispatcher doesn't.
- [ ] Ledger statement export (PDF/print) per buyer for a date range.

## Phase 4 — Reporting & dashboards

- [x] `GET /api/reports/dashboard` — today's sales split by channel with a real change against
      yesterday, outstanding khata, low-stock count, a dense 14-day trend (days with no sale are
      padded, or the chart would skip them) and an activity feed merged from orders, khata
      repayments and stock receipts.
- [x] `GET /api/reports/sales` — the same over an arbitrary range, plus a payment-mode split.
      Both read `bill_date`, not `created_at`, and exclude cancelled orders.
- [ ] Daily sales summary refinements (per-seller split; cash-drawer reconciliation).
- [ ] Supplier ledger / purchase payment tracking (mirrors Khata but for `suppliers.current_balance`).
- [ ] Expiry report (batches nearing `expiry_date`) — complements low-stock.
- [ ] GST/HSN-wise sales report using `products.hsn_code` + `firms.gstin`.

## Phase 5 — Hardening

- [ ] Automated tests (unit for services, integration for the transactional order flows —
      these are the highest-risk code paths: stock deduction + pricing + ledger all commit
      together).
- [ ] Rate limiting on `/api/auth/login`.
- [ ] Structured logging (replace `console.error` in the error middleware).
- [x] DB migrations tool — `scripts/migrate.js` (forward-only, tracked in `schema_migrations`).
      `schema.sql` remains the baseline for a fresh database; every further change goes in a
      numbered file under `migrations/`.
- [ ] Per-financial-year bill series reset (Indian FY runs Apr–Mar; most shops restart numbering).
      `firms.next_bill_number` is a single counter today, so this needs a series table before the
      next 1 April.

## Phase 6 — Frontend (running on live data)

The SPA at `../Frontend/frontend` (React 19 + Vite + MUI) no longer ships any mock data:
`src/data/` is deleted and `src/api/endpoints.js` is the single data-access layer.

- [x] Auth: login screen + token storage + route guards.
- [x] `FirmContext` + axios interceptor sending `Authorization` and `X-Firm-Id` on every request;
      Topbar firm-switcher reads `GET /api/firms` and offers "+ Add new firm".
- [x] Every screen is live: Dashboard and Reports on `/reports/*`, POS on `/products` +
      `/orders/retail`, Wholesale on `/buyers` + `/orders/wholesale`, Khata on `/buyers/:id` +
      `/khata/payment`, Pricing on `/prices/daily`, Purchases on `/purchases` (with a working
      entry dialog — the button used to fake a toast), Inventory on `/inventory/batches`.
- [x] Bill print view driven by `GET /api/orders/:id/invoice`.
- [x] Empty states throughout, since a newly created firm legitimately has no catalog or stock.
- [x] Shared `useResource(key, loader)` hook (`src/api/useResource.js`): results are tagged with
      the firm they were fetched for and everything is derived from that tag, so switching firms
      never shows the previous firm's numbers — without the synchronous effect-setState the lint
      config rejects.
- [ ] CSV/Excel product import — shopkeepers already keep their item list in Excel.
- [ ] Catalog admin screens: products/categories/suppliers/buyers now have full CRUD endpoints,
      but the UI can only read them. Creating a product or supplier still needs an API client.
- [ ] Role-aware UI matching the ADMIN / SALES_REP / CASHIER permissions already enforced
      server-side.

### Two behaviour fixes made while wiring this up

- `sellerId` was a required field on both checkout endpoints, but the client has no way to know a
  seller id and could have named someone else's — attributing a bill to the wrong seller. It is now
  optional and defaults from the firm being billed for.
- The POS cart added a 5% GST line of its own that the server never charged, so the on-screen
  receipt and the printed bill disagreed. The invented tax row is gone; the counter total is the
  sum of the lines.
