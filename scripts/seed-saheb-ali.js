/**
 * Seeds one real firm end-to-end so the app can be demoed against actual data
 * instead of the frontend's mock arrays.
 *
 *   node scripts/seed-saheb-ali.js
 *
 * The firm, its address/phone and its bill series are taken from the client's
 * own printed bill (SAHEB ALI WHOLESALE KIRANA, Bill No. A026490, 01/08/2026).
 * `next_bill_number` is set to 26490 so the first bill this system prints
 * continues their existing paper series rather than restarting at 1 — the same
 * migration any shop moving off a manual bill book needs.
 *
 * Idempotent: re-running finds the existing user/firm/products by their natural
 * keys and leaves the bill counter alone.
 */
require('dotenv').config({ quiet: true });

const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');
const firmsService = require('../src/modules/firms/firms.service');

const OWNER = {
  name: 'Saheb Ali',
  phone: '7666915178',
  email: null,
  password: 'kirana@123',
};

const FIRM = {
  firmName: 'SAHEB ALI WHOLESALE KIRANA',
  firmType: 'WHOLESALE',
  address: 'Old Agra Road, Sona Compound, Opp Taj Garden Hotel',
  city: 'Malegaon',
  state: 'Maharashtra',
  stateCode: '27',
  phone: '7666915178',
  // Their paper bills read "A026490": prefix 'A' + the counter padded to 6.
  invoicePrefix: 'A',
  invoicePadding: 6,
  nextBillNumber: 26490,
  invoiceThanksText: 'Thanks for Shoping Visit Again',
};

const CATEGORY = { name: 'Pulses & Dals', slug: 'pulses-dals' };
const SALT_CATEGORY = { name: 'Sugar & Salt', slug: 'sugar-salt' };

/**
 * The three lines from the client's bill, at the rates printed on it.
 *
 * Base unit is PACKET, not KG, on purpose: the bill's footer reads
 * "Total Wtt.: 0.000Kg" because their counter bills packed goods by the piece
 * and never weighs them. Modelling these as PACKET reproduces that 0.000
 * faithfully; a KG base unit would print 9.000Kg and not match the paper.
 */
// mfgDate/expiryDate are null for rock salt, which does not expire — the schema
// allows it and FEFO deliberately consumes never-expiring batches last.
const PRODUCTS = [
  {
    sku: 'KN-13',
    name: 'KHADA NAMAK 13',
    category: SALT_CATEGORY,
    rate: 12.0,
    costPrice: 9.5,
    openingStock: 500,
    minStockAlert: 50,
    mfgDate: null,
    expiryDate: null,
  },
  {
    sku: 'TD-13',
    name: 'TUWAR DAAL 13',
    category: CATEGORY,
    rate: 114.0,
    costPrice: 98.0,
    openingStock: 300,
    minStockAlert: 40,
    mfgDate: '2026-05-10',
    expiryDate: '2027-05-10',
  },
  {
    sku: 'CD-01',
    name: 'CHANA DAAL',
    category: CATEGORY,
    rate: 82.0,
    costPrice: 70.0,
    openingStock: 400,
    minStockAlert: 40,
    mfgDate: '2026-03-01',
    // Inside the 30-day window, so this batch exercises the expiring-soon flag.
    expiryDate: '2026-09-01',
  },
];

// Matches the bill date, and is in the past so `effective_date <= CURDATE()`
// picks it up as the rate currently in force.
const PRICE_EFFECTIVE_DATE = '2026-08-01';

async function findOrCreateOwner() {
  const [existing] = await pool.query(
    'SELECT id, name FROM users WHERE phone = ? LIMIT 1',
    [OWNER.phone]
  );
  if (existing[0]) {
    console.log(`  owner reused #${existing[0].id} (${existing[0].name})`);
    return existing[0].id;
  }

  const [[adminRole]] = await pool.query("SELECT id FROM roles WHERE name = 'ADMIN' LIMIT 1");
  const passwordHash = await bcrypt.hash(OWNER.password, 10);
  const [result] = await pool.query(
    `INSERT INTO users (role_id, name, phone, email, password_hash, status)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
    [adminRole.id, OWNER.name, OWNER.phone, OWNER.email, passwordHash]
  );
  console.log(`  owner            created #${result.insertId} (${OWNER.name} / ${OWNER.phone})`);
  return result.insertId;
}

async function findOrCreateFirm(userId) {
  const [existing] = await pool.query(
    'SELECT id, firm_name, next_bill_number FROM firms WHERE firm_name = ? LIMIT 1',
    [FIRM.firmName]
  );
  if (existing[0]) {
    console.log(
      `  firm             reused #${existing[0].id} (next bill A${String(existing[0].next_bill_number).padStart(6, '0')})`
    );
    return existing[0].id;
  }

  const firm = await firmsService.createFirm(userId, FIRM);
  console.log(
    `  firm             created #${firm.id} (${firm.firmName}, next bill ${firm.invoicePrefix}${String(firm.nextBillNumber).padStart(firm.invoicePadding, '0')})`
  );
  return firm.id;
}

async function findOrCreateCategory(category) {
  const [existing] = await pool.query('SELECT id FROM categories WHERE slug = ? LIMIT 1', [category.slug]);
  if (existing[0]) return existing[0].id;

  const [result] = await pool.query(
    "INSERT INTO categories (name, slug, status) VALUES (?, ?, 'ACTIVE')",
    [category.name, category.slug]
  );
  return result.insertId;
}

async function findOrCreateProduct(product, categoryId) {
  const [existing] = await pool.query('SELECT id FROM products WHERE sku = ? LIMIT 1', [product.sku]);
  if (existing[0]) return existing[0].id;

  const [result] = await pool.query(
    `INSERT INTO products (category_id, name, sku, min_stock_alert, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [categoryId, product.name, product.sku, product.minStockAlert]
  );
  return result.insertId;
}

async function ensureBaseUnit(productId) {
  const [existing] = await pool.query(
    'SELECT id FROM product_units WHERE product_id = ? AND is_base_unit = 1 LIMIT 1',
    [productId]
  );
  if (existing[0]) return existing[0].id;

  const [result] = await pool.query(
    `INSERT INTO product_units (product_id, unit_name, conversion_factor, is_base_unit)
     VALUES (?, 'PACKET', 1.0000, 1)`,
    [productId]
  );
  return result.insertId;
}

async function upsertDailyPrice(productId, rate, updatedBy) {
  // Wholesale rate sits a little under the counter rate; both are seeded so POS
  // and wholesale billing each have a rate to fall back on.
  await pool.query(
    `INSERT INTO daily_price_logs (product_id, wholesale_price, retail_price, effective_date, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       wholesale_price = VALUES(wholesale_price),
       retail_price = VALUES(retail_price),
       updated_by = VALUES(updated_by)`,
    [productId, Number((rate * 0.96).toFixed(2)), rate, PRICE_EFFECTIVE_DATE, updatedBy]
  );
}

async function ensureOpeningStock(firmId, productId, product) {
  const [existing] = await pool.query(
    'SELECT id FROM inventory_batches WHERE firm_id = ? AND product_id = ? LIMIT 1',
    [firmId, productId]
  );
  if (existing[0]) return existing[0].id;

  const [result] = await pool.query(
    `INSERT INTO inventory_batches
       (firm_id, product_id, supplier_id, batch_number, mfg_date, expiry_date,
        cost_price, quantity_available, storage_location)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'Godown')`,
    [
      firmId,
      productId,
      `OPEN-${product.sku}`,
      product.mfgDate,
      product.expiryDate,
      product.costPrice,
      product.openingStock,
    ]
  );

  // Opening stock is a real stock event, so it gets an ADJUSTMENT movement
  // rather than appearing out of nowhere in the audit trail.
  await pool.query(
    `INSERT INTO stock_movements
       (firm_id, product_id, batch_id, movement_type, quantity, reference_type, reference_id)
     VALUES (?, ?, ?, 'ADJUSTMENT', ?, 'MANUAL', NULL)`,
    [firmId, productId, result.insertId, product.openingStock]
  );

  return result.insertId;
}

async function getSellerId(userId) {
  const [rows] = await pool.query('SELECT id FROM sellers WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] ? rows[0].id : null;
}

async function main() {
  console.log('Seeding SAHEB ALI WHOLESALE KIRANA\n');

  const userId = await findOrCreateOwner();
  const firmId = await findOrCreateFirm(userId);
  const sellerId = await getSellerId(userId);

  const seeded = [];
  for (const product of PRODUCTS) {
    const categoryId = await findOrCreateCategory(product.category);
    const productId = await findOrCreateProduct(product, categoryId);
    const unitId = await ensureBaseUnit(productId);
    await upsertDailyPrice(productId, product.rate, userId);
    await ensureOpeningStock(firmId, productId, product);
    seeded.push({ ...product, productId, unitId });
    console.log(
      `  product          #${productId} ${product.name.padEnd(16)} unit #${unitId}  rate ${product.rate.toFixed(2)}  stock ${product.openingStock}`
    );
  }

  console.log('\nReady. Use these for the POS/bill call:');
  console.log(`  firmId   : ${firmId}   (send as X-Firm-Id)`);
  console.log(`  sellerId : ${sellerId}`);
  console.log(`  login    : phone ${OWNER.phone} / password ${OWNER.password}`);
  console.log('  items    :');
  for (const s of seeded) {
    console.log(`             { "productId": ${s.productId}, "unitId": ${s.unitId}, "quantity": ?, "unitPrice": ${s.rate} }  // ${s.name}`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('\nSeed failed:', err.message);
  await pool.end();
  process.exit(1);
});
