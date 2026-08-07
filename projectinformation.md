# Kirana Store CRM & ERP Platform — Project Information

## 1. What this is

A backend platform for a Kirana (neighborhood grocery/general store) that runs **both** sales
channels off one shared product & stock base, the same way desktop ERP tools like Marg do:

- **Retail**: fast POS-style billing for walk-in customers, paid on the spot.
- **Wholesale**: bulk/dealer billing with quantity-slab pricing and a Khata (credit ledger),
  for buyers who take goods now and pay later.

Both channels sell from the **same `products` table and the same physical stock** — a 50kg bag
of rice sold loose by the kg at retail and sold by the bag/quintal at wholesale are the same
inventory, tracked in one base unit and converted per sale via `product_units`.

## 2. Core domain concepts

| Concept | Table(s) | Why it exists |
|---|---|---|
| Unit conversion | `product_units` | A product has one base unit (e.g. GRAM) and any number of sellable units (KG, BAG, QUINTAL, BOX, PACKET) with a `conversion_factor` back to the base unit. Every stock deduction and price calculation normalizes through this. |
| Batch/expiry inventory | `inventory_batches` | Stock is tracked per purchase batch (batch number, mfg/expiry date, cost price), not as one flat counter. Sales deduct **FEFO** (first-expiry-first-out). |
| Stock audit trail | `stock_movements` | Append-only ledger of every stock change (purchase, retail sale, wholesale sale, damage, loose conversion, return, adjustment), each tied to the batch it touched. |
| Tiered wholesale pricing | `wholesale_pricing_tiers` | Bulk buyers get a better per-unit rate as order quantity crosses slabs (e.g. 0–49kg, 50–99kg, 100kg+). |
| Daily commodity pricing | `daily_price_logs` | Mandi/market rates change day to day; one row per product per day holds both the wholesale and retail rate for that date. Orders always price off the latest row. |
| Khata (credit ledger) | `customer_ledgers`, `ledger_transactions` | Wholesale buyers can take stock on credit up to a `credit_limit`. Every credit sale is a DEBIT, every repayment is a CREDIT, and `running_balance` snapshots the balance after each entry so history never needs to be recomputed. |
| Payments | `payment_transactions` | The actual money movement (cash/UPI/card/etc.), separate from the ledger entry, because a sale can be partially paid + partially on credit in the same transaction. |
| Purchasing | `suppliers`, `purchase_orders`, `purchase_order_items` | Inbound stock from vendors, which is what creates new `inventory_batches` rows. |

## 3. Tech stack

- **Runtime**: Node.js + Express 5
- **Database**: MySQL 8 (InnoDB, utf8mb4), accessed via `mysql2/promise` connection pool
  (no ORM — raw SQL kept in a dedicated `*.queries.js` file per module)
- **Auth**: JWT (`jsonwebtoken`) + bcrypt password hashing (`bcryptjs`)
- **Validation**: `express-validator`
- **Security/logging**: `helmet`, `cors`, `morgan`

## 4. Folder structure

```
backend/
├── schema.sql                     # full MySQL migration (run once against a fresh DB)
├── projectinformation.md          # this file
├── plan.md                        # phased roadmap
├── .env.example                   # copy to .env and fill in
├── index.js                       # process entrypoint (loads dotenv, starts server)
├── package.json
└── src/
    ├── app.js                     # Express app: middleware stack + route mounting
    ├── config/
    │   └── db.js                  # mysql2 pool + withTransaction() helper
    ├── constants/
    │   └── roles.js                # ROLES enum (ADMIN, SALES_REP, CASHIER)
    ├── middlewares/
    │   ├── auth.middleware.js      # authenticate() JWT check, authorize(...roles) RBAC
    │   ├── error.middleware.js     # centralized error + 404 handler
    │   └── validate.middleware.js  # express-validator result -> ApiError bridge
    ├── utils/
    │   ├── ApiError.js
    │   ├── ApiResponse.js
    │   ├── asyncHandler.js
    │   └── generateCode.js        # order number generator
    ├── modules/
    │   ├── auth/                  # register, login, /me
    │   ├── orders/                # retail + wholesale checkout
    │   │   └── orders.queries.js  # shared SQL: unit conversion, FEFO deduction, tiers
    │   ├── khata/                 # ledger history + repayments
    │   ├── pricing/                # daily price bulk upsert
    │   └── inventory/              # low-stock report
    └── routes/
        └── index.js                # mounts every module under /api/*
```

Each module follows the same three-layer split:

- **`*.routes.js`** — URL + middleware wiring only (auth, RBAC, validation chain).
- **`*.controller.js`** — thin HTTP adapter: pulls `req.body/params/query`, calls the service,
  wraps the result in `ApiResponse`. No business logic.
- **`*.service.js`** — business logic, wrapped in `withTransaction()` for anything that writes
  to more than one table.
- **`*.queries.js`** — every raw SQL statement the module needs, one function per query, always
  taking a `conn` (pool or active transaction connection) as the first argument.

## 5. API surface (implemented)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | public | Create a staff user under a role |
| POST | `/api/auth/login` | public | Returns a JWT |
| GET | `/api/auth/me` | any authenticated | Echo current session |
| POST | `/api/orders/retail` | ADMIN, CASHIER, SALES_REP | POS checkout: prices off `daily_price_logs.retail_price`, deducts batches FEFO, logs payment |
| POST | `/api/orders/wholesale` | ADMIN, SALES_REP | Bulk checkout: prices off `wholesale_pricing_tiers` (falls back to `daily_price_logs.wholesale_price`), deducts batches FEFO, books any unpaid balance to the buyer's Khata |
| GET | `/api/khata/:buyerId` | ADMIN, SALES_REP, CASHIER | Ledger balance + transaction history |
| POST | `/api/khata/payment` | ADMIN, CASHIER | Records a full/partial credit repayment |
| PUT | `/api/prices/daily-update` | ADMIN, SALES_REP | Bulk upsert today's (or a given date's) wholesale + retail rates |
| GET | `/api/inventory/low-stock` | ADMIN, SALES_REP, CASHIER | Products whose total batch stock has fallen to/below `min_stock_alert` |

All authenticated routes expect `Authorization: Bearer <token>`.

## 6. Running it locally

```bash
cp .env.example .env        # fill in DB credentials + JWT_SECRET
mysql -u root -p < schema.sql
npm install
npm run dev                 # nodemon, http://localhost:5000/api/health
```

## 7. Design decisions worth knowing

- **Money**: every monetary column is `DECIMAL(10,2)` — never floats — and JS-side math rounds
  with `.toFixed(2)` before persisting to avoid floating-point drift across multi-line orders.
- **Order numbers**: generated app-side (`RET-`/`WHS-` + timestamp + random suffix) before the
  INSERT, so no dependency on the auto-increment id or a second UPDATE round-trip.
- **FEFO stock deduction**: batches are locked with `FOR UPDATE` inside the order transaction so
  two concurrent checkouts can't oversell the same batch.
- **Credit limit enforcement**: a wholesale order that would push `current_udhaar_balance` above
  `credit_limit` is rejected with a 400 before anything commits (the whole order is one
  transaction, so a rejected credit check rolls back the inventory deduction too).
- **`stock_movements.reference_id`/`reference_type`** is intentionally not a foreign key — it
  points at either an `orders` row or a `purchase_orders` row depending on `movement_type`, so a
  single FK can't model it.
