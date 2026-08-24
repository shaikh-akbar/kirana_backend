const { ApiError } = require('../../utils/ApiError');

/**
 * SQL for the shared catalog: categories, products (+ their unit conversions and
 * wholesale slabs) and suppliers.
 *
 * Scoping note: none of these tables carry a `firm_id` — migration 001 keeps the
 * catalog global on purpose, so two firms under one owner share one "Tuwar Daal"
 * item instead of maintaining duplicate item lists. The only firm-scoped numbers
 * that appear here are the *derived* ones (stock on hand), which are joined in
 * from `inventory_batches` with an explicit firm predicate.
 */

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

async function listCategories(db, { includeInactive = false } = {}) {
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.parent_id AS parentId, c.slug, c.status,
            parent.name AS parentName,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS productCount
     FROM categories c
     LEFT JOIN categories parent ON parent.id = c.parent_id
     ${includeInactive ? '' : "WHERE c.status = 'ACTIVE'"}
     ORDER BY COALESCE(parent.name, c.name), (c.parent_id IS NOT NULL), c.name`
  );
  return rows;
}

async function findCategoryById(db, id) {
  const [rows] = await db.query(
    `SELECT id, name, parent_id AS parentId, slug, status FROM categories WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function insertCategory(db, { name, parentId, slug, status }) {
  const [result] = await db.query(
    `INSERT INTO categories (name, parent_id, slug, status) VALUES (?, ?, ?, ?)`,
    [name, parentId, slug, status]
  );
  return result.insertId;
}

async function updateCategory(db, id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  await db.query(
    `UPDATE categories SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
    [...columns.map((c) => fields[c]), id]
  );
}

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

/**
 * The rate in force for each product today. `daily_price_logs` holds one row per
 * product per day, so "current" means the newest row not dated in the future —
 * a rate keyed in ahead of time must not leak into today's bills.
 */
const CURRENT_PRICE_JOIN = `
  LEFT JOIN daily_price_logs dp ON dp.id = (
    SELECT d.id FROM daily_price_logs d
    WHERE d.product_id = p.id AND d.effective_date <= CURDATE()
    ORDER BY d.effective_date DESC, d.id DESC
    LIMIT 1
  )`;

/**
 * Stock on hand at ONE firm. Aggregated in a derived table rather than with a
 * plain JOIN + GROUP BY so the product row survives when the firm holds no
 * batch of it — a never-stocked item must still be listable and sellable.
 */
const FIRM_STOCK_JOIN = `
  LEFT JOIN (
    SELECT ib.product_id, SUM(ib.quantity_available) AS qty
    FROM inventory_batches ib
    WHERE ib.firm_id = ?
    GROUP BY ib.product_id
  ) st ON st.product_id = p.id`;

const PRODUCT_COLUMNS = `
  p.id, p.name, p.sku, p.barcode, p.description, p.hsn_code AS hsnCode,
  p.category_id AS categoryId, c.name AS category,
  p.min_stock_alert AS threshold, p.is_active AS isActive,
  bu.id AS baseUnitId, bu.unit_name AS unit,
  COALESCE(st.qty, 0) AS stock,
  dp.wholesale_price AS wholesalePrice, dp.retail_price AS retailPrice,
  dp.effective_date AS priceDate`;

async function listProducts(db, firmId, { search, categoryId, includeInactive = false, lowStockOnly = false } = {}) {
  const where = [];
  // firmId is consumed by FIRM_STOCK_JOIN, which appears before the WHERE
  // clause — so its placeholder must be bound first.
  const params = [firmId];

  if (!includeInactive) where.push('p.is_active = 1');
  if (categoryId) {
    where.push('p.category_id = ?');
    params.push(categoryId);
  }
  if (search) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (lowStockOnly) where.push('COALESCE(st.qty, 0) <= p.min_stock_alert');

  const [rows] = await db.query(
    `SELECT ${PRODUCT_COLUMNS}
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_units bu ON bu.product_id = p.id AND bu.is_base_unit = 1
     ${FIRM_STOCK_JOIN}
     ${CURRENT_PRICE_JOIN}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.name ASC`,
    params
  );
  return rows;
}

async function findProductById(db, firmId, id) {
  const [rows] = await db.query(
    `SELECT ${PRODUCT_COLUMNS}
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_units bu ON bu.product_id = p.id AND bu.is_base_unit = 1
     ${FIRM_STOCK_JOIN}
     ${CURRENT_PRICE_JOIN}
     WHERE p.id = ?
     LIMIT 1`,
    [firmId, id]
  );
  return rows[0] || null;
}

async function findProductUnits(db, productId) {
  const [rows] = await db.query(
    `SELECT id, unit_name AS unitName, conversion_factor AS conversionFactor,
            is_base_unit AS isBaseUnit
     FROM product_units
     WHERE product_id = ?
     ORDER BY is_base_unit DESC, conversion_factor ASC`,
    [productId]
  );
  return rows;
}

async function findPricingTiers(db, productId) {
  const [rows] = await db.query(
    `SELECT id, min_quantity AS minQuantity, max_quantity AS maxQuantity,
            tier_price_per_unit AS tierPrice
     FROM wholesale_pricing_tiers
     WHERE product_id = ?
     ORDER BY min_quantity ASC`,
    [productId]
  );
  return rows;
}

/** Units for many products at once — one round-trip instead of N. */
async function findUnitsForProducts(db, productIds) {
  if (productIds.length === 0) return [];
  const [rows] = await db.query(
    `SELECT product_id AS productId, id, unit_name AS unitName,
            conversion_factor AS conversionFactor, is_base_unit AS isBaseUnit
     FROM product_units
     WHERE product_id IN (?)
     ORDER BY is_base_unit DESC, conversion_factor ASC`,
    [productIds]
  );
  return rows;
}

async function insertProduct(db, product) {
  const [result] = await db.query(
    `INSERT INTO products (category_id, name, sku, barcode, description, hsn_code, min_stock_alert, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      product.categoryId,
      product.name,
      product.sku,
      product.barcode,
      product.description,
      product.hsnCode,
      product.minStockAlert,
      product.isActive,
    ]
  );
  return result.insertId;
}

async function updateProduct(db, id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  await db.query(
    `UPDATE products SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
    [...columns.map((c) => fields[c]), id]
  );
}

/**
 * Replaces a product's unit table wholesale. Deleting first would orphan
 * `order_items.unit_id`, but that FK is ON DELETE SET NULL and the line already
 * froze its own `unit_label` at bill time, so a reprint is unaffected.
 */
async function replaceProductUnits(conn, productId, units) {
  await conn.query('DELETE FROM product_units WHERE product_id = ?', [productId]);
  for (const unit of units) {
    await conn.query(
      `INSERT INTO product_units (product_id, unit_name, conversion_factor, is_base_unit)
       VALUES (?, ?, ?, ?)`,
      [productId, unit.unitName, unit.conversionFactor, unit.isBaseUnit ? 1 : 0]
    );
  }
}

async function replacePricingTiers(conn, productId, tiers) {
  await conn.query('DELETE FROM wholesale_pricing_tiers WHERE product_id = ?', [productId]);
  for (const tier of tiers) {
    await conn.query(
      `INSERT INTO wholesale_pricing_tiers (product_id, min_quantity, max_quantity, tier_price_per_unit)
       VALUES (?, ?, ?, ?)`,
      [productId, tier.minQuantity, tier.maxQuantity ?? null, tier.tierPrice]
    );
  }
}

/**
 * Products are retired, never deleted: `order_items` keeps a real FK to them and
 * an old bill must stay reprintable.
 */
async function deactivateProduct(db, id) {
  const [result] = await db.query('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
  if (result.affectedRows === 0) {
    throw ApiError.notFound(`Product ${id} not found`);
  }
}

/* ------------------------------------------------------------------ *
 * Suppliers
 * ------------------------------------------------------------------ */

async function listSuppliers(
  db,
  firmId,
  { search, fromDate, toDate, limit = 50, offset = 0 } = {}
) {
  const joinParams = [firmId];
  const searchParams = [];
  const where = [];

  if (fromDate) {
    joinParams.push(fromDate);
  }
  if (toDate) {
    joinParams.push(toDate);
  }

  if (search) {
    const like = `%${search}%`;
    where.push('(s.vendor_name LIKE ? OR s.phone LIKE ? OR s.gstin LIKE ?)');
    searchParams.push(like, like, like);
  }

  const purchaseDateFilter = [
    'po.supplier_id = s.id',
    'po.firm_id = ?',
    fromDate ? 'po.purchase_date >= ?' : null,
    toDate ? 'po.purchase_date <= ?' : null,
  ]
    .filter(Boolean)
    .join(' AND ');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await db.query(
    `SELECT s.id, s.vendor_name AS vendorName, s.phone, s.gstin, s.address,
            s.current_balance AS currentBalance, s.created_at AS createdAt,
            COUNT(DISTINCT po.id) AS purchaseCount,
            COALESCE(SUM(poi.quantity), 0) AS totalQty,
            COALESCE(SUM(poi.total_price), 0) AS totalAmount,
            MAX(po.purchase_date) AS lastPurchaseDate
     FROM suppliers s
     LEFT JOIN purchase_orders po ON ${purchaseDateFilter}
     LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
     ${whereSql}
     GROUP BY s.id, s.vendor_name, s.phone, s.gstin, s.address, s.current_balance, s.created_at
     ORDER BY s.vendor_name ASC
     LIMIT ? OFFSET ?`,
    [...joinParams, ...searchParams, Number(limit), Number(offset)]
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM suppliers s
     ${whereSql}`,
    searchParams
  );

  return { rows, total };
}

async function findSupplierById(db, id) {
  const [rows] = await db.query(
    `SELECT id, vendor_name AS vendorName, phone, gstin, address,
            current_balance AS currentBalance, created_at AS createdAt
     FROM suppliers WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function insertSupplier(db, supplier) {
  const [result] = await db.query(
    `INSERT INTO suppliers (vendor_name, phone, gstin, address, current_balance)
     VALUES (?, ?, ?, ?, ?)`,
    [supplier.vendorName, supplier.phone, supplier.gstin, supplier.address, supplier.openingBalance]
  );
  return result.insertId;
}

async function updateSupplier(db, id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  await db.query(
    `UPDATE suppliers SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
    [...columns.map((c) => fields[c]), id]
  );
}

module.exports = {
  listCategories,
  findCategoryById,
  insertCategory,
  updateCategory,
  listProducts,
  findProductById,
  findProductUnits,
  findPricingTiers,
  findUnitsForProducts,
  insertProduct,
  updateProduct,
  replaceProductUnits,
  replacePricingTiers,
  deactivateProduct,
  listSuppliers,
  findSupplierById,
  insertSupplier,
  updateSupplier,
};
