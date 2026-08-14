/**
 * Sums batch-level quantity_available per product FOR ONE FIRM and compares it
 * to the product's min_stock_alert threshold. Products with zero batches at
 * this firm still show up (COALESCE to 0) so a newly listed, never-stocked item
 * is flagged too.
 *
 * The firm_id predicate sits in the LEFT JOIN's ON clause, not in WHERE: moving
 * it to WHERE would discard products that have no batch at this firm (their
 * joined columns are NULL), hiding exactly the out-of-stock items the report
 * exists to surface.
 */
async function findLowStockProducts(conn, firmId) {
  const [rows] = await conn.query(
    `SELECT
       p.id AS product_id,
       p.name,
       p.sku,
       p.min_stock_alert,
       COALESCE(SUM(ib.quantity_available), 0) AS total_available
     FROM products p
     LEFT JOIN inventory_batches ib
       ON ib.product_id = p.id AND ib.firm_id = ?
     WHERE p.is_active = 1
     GROUP BY p.id, p.name, p.sku, p.min_stock_alert
     HAVING total_available <= p.min_stock_alert
     ORDER BY total_available ASC`,
    [firmId]
  );
  return rows;
}

/**
 * Batch-level stock for one firm, newest-expiring first, with a derived flag
 * the Inventory screen colours rows by.
 */
async function findBatches(conn, firmId, { productId = null, expiringWithinDays = null } = {}) {
  const where = ['ib.firm_id = ?'];
  const params = [firmId];

  if (productId) {
    where.push('ib.product_id = ?');
    params.push(productId);
  }
  if (expiringWithinDays != null) {
    where.push('ib.expiry_date IS NOT NULL AND ib.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)');
    params.push(Number(expiringWithinDays));
  }

  const [rows] = await conn.query(
    `SELECT ib.id, ib.product_id AS productId, p.name AS productName, p.sku,
            c.name AS category,
            p.min_stock_alert AS minStockAlert,
            bu.unit_name AS unit,
            ib.batch_number AS batchNumber, ib.mfg_date AS mfgDate, ib.expiry_date AS expiryDate,
            ib.cost_price AS costPrice, ib.quantity_available AS quantityAvailable,
            ib.storage_location AS storageLocation,
            s.vendor_name AS supplierName,
            -- NULL expiry means "does not expire", so it must never be treated
            -- as overdue; DATEDIFF is only meaningful when a date exists.
            CASE WHEN ib.expiry_date IS NULL THEN NULL
                 ELSE DATEDIFF(ib.expiry_date, CURDATE()) END AS daysToExpiry,
            CASE
              WHEN ib.expiry_date IS NOT NULL AND ib.expiry_date < CURDATE() THEN 'EXPIRED'
              WHEN ib.expiry_date IS NOT NULL AND ib.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'EXPIRING_SOON'
              WHEN ib.quantity_available <= p.min_stock_alert THEN 'LOW_STOCK'
              ELSE 'OK'
            END AS flag
     FROM inventory_batches ib
     JOIN products p ON p.id = ib.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_units bu ON bu.product_id = p.id AND bu.is_base_unit = 1
     LEFT JOIN suppliers s ON s.id = ib.supplier_id
     WHERE ${where.join(' AND ')}
     ORDER BY (ib.expiry_date IS NULL), ib.expiry_date ASC, ib.id ASC`,
    params
  );
  return rows;
}

/**
 * Opening stock and stock-in corrections: a firm that has just been created has
 * no supplier bill to key in, but its godown is not empty. This writes the
 * batch the FEFO deduction will later consume.
 */
async function insertAdjustmentBatch(conn, batch) {
  const [result] = await conn.query(
    `INSERT INTO inventory_batches
       (firm_id, product_id, supplier_id, batch_number, mfg_date, expiry_date,
        cost_price, quantity_available, storage_location)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    [
      batch.firmId,
      batch.productId,
      batch.batchNumber,
      batch.mfgDate,
      batch.expiryDate,
      batch.costPrice,
      batch.quantity,
      batch.storageLocation,
    ]
  );
  return result.insertId;
}

async function insertStockMovement(conn, movement) {
  await conn.query(
    `INSERT INTO stock_movements
       (firm_id, product_id, batch_id, movement_type, quantity, reference_type, reference_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      movement.firmId,
      movement.productId,
      movement.batchId,
      movement.movementType,
      movement.quantity,
      movement.referenceType,
      movement.referenceId,
    ]
  );
}

async function findProductForAdjustment(conn, productId) {
  const [rows] = await conn.query(
    `SELECT p.id, p.name, bu.unit_name AS baseUnit
     FROM products p
     LEFT JOIN product_units bu ON bu.product_id = p.id AND bu.is_base_unit = 1
     WHERE p.id = ? AND p.is_active = 1
     LIMIT 1`,
    [productId]
  );
  return rows[0] || null;
}

/** Append-only movement history for one firm, newest first. */
async function findStockMovements(db, firmId, { productId, limit = 100, offset = 0 } = {}) {
  const where = ['sm.firm_id = ?'];
  const params = [firmId];

  if (productId) {
    where.push('sm.product_id = ?');
    params.push(productId);
  }

  const [rows] = await db.query(
    `SELECT sm.id, sm.product_id AS productId, p.name AS productName,
            sm.batch_id AS batchId, ib.batch_number AS batchNumber,
            sm.movement_type AS movementType, sm.quantity,
            sm.reference_type AS referenceType, sm.reference_id AS referenceId,
            sm.created_at AS createdAt
     FROM stock_movements sm
     JOIN products p ON p.id = sm.product_id
     LEFT JOIN inventory_batches ib ON ib.id = sm.batch_id
     WHERE ${where.join(' AND ')}
     ORDER BY sm.created_at DESC, sm.id DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );
  return rows;
}

module.exports = {
  findLowStockProducts,
  findBatches,
  insertAdjustmentBatch,
  insertStockMovement,
  findProductForAdjustment,
  findStockMovements,
};
