const { ApiError } = require('../../utils/ApiError');

/**
 * SQL for inbound stock: purchase orders, their lines, and the batches they
 * create. Everything here is firm-scoped — a purchase books stock into one
 * firm's godown and one firm's payables, even though the supplier and the
 * product catalog behind it are shared.
 */

async function listPurchaseOrders(db, firmId, { supplierId, paymentStatus, fromDate, toDate, limit = 50, offset = 0 } = {}) {
  const where = ['po.firm_id = ?'];
  const params = [firmId];

  if (supplierId) {
    where.push('po.supplier_id = ?');
    params.push(supplierId);
  }
  if (paymentStatus) {
    where.push('po.payment_status = ?');
    params.push(paymentStatus);
  }
  if (fromDate) {
    where.push('po.purchase_date >= ?');
    params.push(fromDate);
  }
  if (toDate) {
    where.push('po.purchase_date <= ?');
    params.push(toDate);
  }

  const [rows] = await db.query(
    `SELECT po.id, po.invoice_number AS invoiceNumber, po.purchase_date AS purchaseDate,
            po.supplier_id AS supplierId, s.vendor_name AS supplierName,
            po.total_amount AS totalAmount, po.paid_amount AS paidAmount,
            po.payment_status AS paymentStatus, po.created_at AS createdAt,
            COUNT(poi.id) AS lineCount,
            COALESCE(SUM(poi.quantity), 0) AS totalQty
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
     WHERE ${where.join(' AND ')}
     GROUP BY po.id, po.invoice_number, po.purchase_date, po.supplier_id, s.vendor_name,
              po.total_amount, po.paid_amount, po.payment_status, po.created_at
     ORDER BY po.purchase_date DESC, po.id DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM purchase_orders po WHERE ${where.join(' AND ')}`,
    params
  );

  return { rows, total };
}

/** The lines of many purchase orders in one round-trip, for the list screen. */
async function findItemsForPurchaseOrders(db, purchaseOrderIds) {
  if (purchaseOrderIds.length === 0) return [];
  const [rows] = await db.query(
    `SELECT poi.purchase_order_id AS purchaseOrderId, poi.id, poi.product_id AS productId,
            p.name AS productName, bu.unit_name AS unit,
            poi.quantity, poi.unit_cost_price AS unitCostPrice, poi.total_price AS totalPrice,
            poi.batch_id AS batchId, ib.batch_number AS batchNumber, ib.expiry_date AS expiryDate
     FROM purchase_order_items poi
     JOIN products p ON p.id = poi.product_id
     LEFT JOIN product_units bu ON bu.product_id = p.id AND bu.is_base_unit = 1
     LEFT JOIN inventory_batches ib ON ib.id = poi.batch_id
     WHERE poi.purchase_order_id IN (?)
     ORDER BY poi.id ASC`,
    [purchaseOrderIds]
  );
  return rows;
}

async function findPurchaseOrderById(db, firmId, id) {
  const [rows] = await db.query(
    `SELECT po.id, po.invoice_number AS invoiceNumber, po.purchase_date AS purchaseDate,
            po.supplier_id AS supplierId, s.vendor_name AS supplierName,
            s.phone AS supplierPhone, s.gstin AS supplierGstin,
            po.total_amount AS totalAmount, po.paid_amount AS paidAmount,
            po.payment_status AS paymentStatus, po.created_at AS createdAt
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = ? AND po.firm_id = ?
     LIMIT 1`,
    [id, firmId]
  );
  return rows[0] || null;
}

/**
 * Locks the product row while a purchase is posted and returns what the line
 * needs: the base unit every batch quantity is expressed in, plus the optional
 * unit the buyer keyed the line in.
 */
async function getProductForPurchase(conn, productId, unitId) {
  const [products] = await conn.query(
    `SELECT id, name FROM products WHERE id = ? AND is_active = 1 LIMIT 1`,
    [productId]
  );
  if (!products[0]) {
    throw ApiError.badRequest(`Product ${productId} does not exist or is inactive`);
  }

  const [baseUnits] = await conn.query(
    `SELECT id, unit_name, conversion_factor FROM product_units
     WHERE product_id = ? AND is_base_unit = 1 LIMIT 1`,
    [productId]
  );

  let unit = null;
  if (unitId) {
    const [units] = await conn.query(
      `SELECT id, unit_name, conversion_factor FROM product_units
       WHERE id = ? AND product_id = ? LIMIT 1`,
      [unitId, productId]
    );
    if (!units[0]) {
      throw ApiError.badRequest(`Unit ${unitId} is not configured for product ${productId}`);
    }
    unit = units[0];
  }

  return { product: products[0], baseUnit: baseUnits[0] || null, unit };
}

async function insertPurchaseOrder(conn, po) {
  const [result] = await conn.query(
    `INSERT INTO purchase_orders
       (firm_id, supplier_id, total_amount, paid_amount, payment_status, invoice_number, purchase_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [po.firmId, po.supplierId, po.totalAmount, po.paidAmount, po.paymentStatus, po.invoiceNumber, po.purchaseDate]
  );
  return result.insertId;
}

async function insertBatch(conn, batch) {
  const [result] = await conn.query(
    `INSERT INTO inventory_batches
       (firm_id, product_id, supplier_id, batch_number, mfg_date, expiry_date,
        cost_price, quantity_available, storage_location)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      batch.firmId,
      batch.productId,
      batch.supplierId,
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

async function insertPurchaseOrderItem(conn, item) {
  await conn.query(
    `INSERT INTO purchase_order_items
       (purchase_order_id, product_id, batch_id, quantity, unit_cost_price, total_price)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [item.purchaseOrderId, item.productId, item.batchId, item.quantity, item.unitCostPrice, item.totalPrice]
  );
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

/**
 * Moves the supplier's payable by the unpaid part of this bill. Written as a
 * relative UPDATE, not a read-modify-write, so two purchases posted at once
 * cannot lose one another's increment.
 */
async function addSupplierBalance(conn, supplierId, amount) {
  if (!amount) return;
  await conn.query(
    `UPDATE suppliers SET current_balance = current_balance + ? WHERE id = ?`,
    [amount, supplierId]
  );
}

async function findSupplierForUpdate(conn, supplierId) {
  const [rows] = await conn.query(
    `SELECT id, vendor_name, current_balance FROM suppliers WHERE id = ? FOR UPDATE`,
    [supplierId]
  );
  return rows[0] || null;
}

module.exports = {
  listPurchaseOrders,
  findItemsForPurchaseOrders,
  findPurchaseOrderById,
  getProductForPurchase,
  insertPurchaseOrder,
  insertBatch,
  insertPurchaseOrderItem,
  insertStockMovement,
  addSupplierBalance,
  findSupplierForUpdate,
};
