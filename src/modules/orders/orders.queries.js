const { ApiError } = require('../../utils/ApiError');

/**
 * All raw SQL for the orders module lives here so retail/wholesale
 * services stay focused on business logic, not query strings.
 * Every function takes an active transactional connection (`conn`).
 *
 * Firm scoping: stock and orders belong to one firm, so every query that
 * touches inventory_batches / stock_movements / orders / customer_ledgers takes
 * a `firmId`. The catalog (products, product_units, wholesale_pricing_tiers,
 * daily_price_logs) is shared across a seller's firms and is not scoped.
 */

/**
 * How many kilograms one unit of each weight-based unit represents. Units that
 * are counts rather than weights (BOX, PACKET) deliberately have no entry:
 * they contribute 0 to the bill's "Total Wtt." line, which is why a bill of
 * packet goods correctly prints 0.000Kg.
 */
const UNIT_NAME_TO_KG = Object.freeze({
  GRAM: 0.001,
  KG: 1,
  QUINTAL: 100,
});

async function getProductForBilling(conn, productId) {
  const [rows] = await conn.query(
    `SELECT id, name, sku, hsn_code
     FROM products
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [productId]
  );
  if (!rows[0]) {
    throw ApiError.badRequest(`Product ${productId} does not exist or is inactive`);
  }
  return rows[0];
}

async function getUnitConversion(conn, productId, unitId) {
  const [rows] = await conn.query(
    `SELECT id, unit_name, conversion_factor, is_base_unit
     FROM product_units
     WHERE id = ? AND product_id = ?
     LIMIT 1`,
    [unitId, productId]
  );
  if (!rows[0]) {
    throw ApiError.badRequest(`Unit ${unitId} is not configured for product ${productId}`);
  }
  return rows[0];
}

/**
 * The unit every `conversion_factor` on this product is expressed against.
 * Needed to turn a quantity in base units into kilograms for the bill's
 * weight total — a BAG's factor says how many base units it holds, not how
 * many kilograms it weighs.
 */
async function getBaseUnit(conn, productId) {
  const [rows] = await conn.query(
    `SELECT id, unit_name, conversion_factor
     FROM product_units
     WHERE product_id = ? AND is_base_unit = 1
     LIMIT 1`,
    [productId]
  );
  return rows[0] || null;
}

/** Kilograms represented by `quantityBaseUnits` of a product, 0 if not weight-based. */
function baseUnitsToKg(baseUnitName, quantityBaseUnits) {
  const kgPerBaseUnit = UNIT_NAME_TO_KG[baseUnitName];
  if (!kgPerBaseUnit) return 0;
  return Number((Number(quantityBaseUnits) * kgPerBaseUnit).toFixed(3));
}

async function getLatestDailyPrice(conn, productId) {
  const [rows] = await conn.query(
    `SELECT wholesale_price, retail_price, effective_date
     FROM daily_price_logs
     WHERE product_id = ? AND effective_date <= CURDATE()
     ORDER BY effective_date DESC
     LIMIT 1`,
    [productId]
  );
  if (!rows[0]) {
    throw ApiError.badRequest(
      `No daily price is in effect for product ${productId} — set today's rate or send an explicit unitPrice on the line`
    );
  }
  return rows[0];
}

async function getWholesaleTierPrice(conn, productId, quantityBaseUnits) {
  const [rows] = await conn.query(
    `SELECT tier_price_per_unit
     FROM wholesale_pricing_tiers
     WHERE product_id = ?
       AND min_quantity <= ?
       AND (max_quantity IS NULL OR max_quantity >= ?)
     ORDER BY min_quantity DESC
     LIMIT 1`,
    [productId, quantityBaseUnits, quantityBaseUnits]
  );
  return rows[0] ? rows[0].tier_price_per_unit : null;
}

/**
 * Deducts `quantityBaseUnits` of a product from ONE FIRM's batches using FEFO
 * (first-expiry-first-out; batches with no expiry are consumed last).
 * Locks candidate rows with FOR UPDATE to prevent overselling under
 * concurrent checkouts. Throws if that firm's available stock is insufficient.
 */
async function deductInventoryFEFO(
  conn,
  firmId,
  productId,
  quantityBaseUnits,
  movementType,
  referenceType,
  referenceId
) {
  const [batches] = await conn.query(
    `SELECT id, quantity_available
     FROM inventory_batches
     WHERE firm_id = ? AND product_id = ? AND quantity_available > 0
     ORDER BY (expiry_date IS NULL), expiry_date ASC, id ASC
     FOR UPDATE`,
    [firmId, productId]
  );

  let remaining = Number(quantityBaseUnits);
  const deductions = [];

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(Number(batch.quantity_available), remaining);
    if (take <= 0) continue;

    await conn.query(
      `UPDATE inventory_batches SET quantity_available = quantity_available - ? WHERE id = ?`,
      [take, batch.id]
    );
    await conn.query(
      `INSERT INTO stock_movements
         (firm_id, product_id, batch_id, movement_type, quantity, reference_type, reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [firmId, productId, batch.id, movementType, -take, referenceType, referenceId]
    );

    deductions.push({ batchId: batch.id, quantity: take });
    remaining -= take;
  }

  if (remaining > 0) {
    throw ApiError.conflict(`Insufficient stock for product ${productId}: short by ${remaining}`);
  }

  return deductions;
}

/**
 * `bill_date` falls back to MySQL's NOW() rather than a JS timestamp so an
 * omitted bill date is stamped in the database server's local timezone. A
 * JS `new Date().toISOString()` would write UTC and print an IST bill a few
 * hours behind — visible on the bill and wrong in the day-book.
 */
async function insertOrder(conn, order) {
  const [result] = await conn.query(
    `INSERT INTO orders
       (firm_id, order_number, bill_number, bill_sequence, bill_date, channel,
        buyer_id, customer_name, customer_phone, seller_id,
        gross_amount, tax_amount, discount_amount, net_amount,
        item_count, total_quantity, total_weight_kg,
        payment_status, order_status, notes)
     VALUES (?, ?, ?, ?, COALESCE(?, NOW()), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.firmId,
      order.orderNumber,
      order.billNumber,
      order.billSequence,
      order.billDate,
      order.channel,
      order.buyerId,
      order.customerName,
      order.customerPhone,
      order.sellerId,
      order.grossAmount,
      order.taxAmount,
      order.discountAmount,
      order.netAmount,
      order.itemCount,
      order.totalQuantity,
      order.totalWeightKg,
      order.paymentStatus,
      order.orderStatus,
      order.notes,
    ]
  );
  return result.insertId;
}

async function insertOrderItem(conn, item) {
  await conn.query(
    `INSERT INTO order_items
       (order_id, line_no, product_id, description, unit_id, unit_label, quantity, weight_kg, unit_price, total_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.orderId,
      item.lineNo,
      item.productId,
      item.description,
      item.unitId,
      item.unitLabel,
      item.quantity,
      item.weightKg,
      item.unitPrice,
      item.totalPrice,
    ]
  );
}

async function insertPaymentTransaction(conn, payment) {
  await conn.query(
    `INSERT INTO payment_transactions (order_id, ledger_id, payment_mode, amount, reference_number, transaction_date)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [payment.orderId, payment.ledgerId, payment.paymentMode, payment.amount, payment.referenceNumber || null]
  );
}

/**
 * The khata account for a (firm, buyer) pair. A dealer who buys from both of an
 * owner's firms keeps a separate balance at each, so the ledger is looked up on
 * the pair rather than on the buyer alone.
 */
async function getOrCreateLedger(conn, firmId, buyerId) {
  const [rows] = await conn.query(
    `SELECT id, current_udhaar_balance, credit_limit
     FROM customer_ledgers
     WHERE firm_id = ? AND buyer_id = ?
     FOR UPDATE`,
    [firmId, buyerId]
  );
  if (rows[0]) return rows[0];

  const [buyerRows] = await conn.query(`SELECT credit_limit FROM buyers WHERE id = ?`, [buyerId]);
  if (!buyerRows[0]) {
    throw ApiError.notFound(`Buyer ${buyerId} not found`);
  }

  const [result] = await conn.query(
    `INSERT INTO customer_ledgers (firm_id, buyer_id, current_udhaar_balance, credit_limit)
     VALUES (?, ?, 0, ?)`,
    [firmId, buyerId, buyerRows[0].credit_limit]
  );
  return { id: result.insertId, current_udhaar_balance: 0, credit_limit: buyerRows[0].credit_limit };
}

async function insertLedgerTransaction(conn, entry) {
  await conn.query(
    `INSERT INTO ledger_transactions (ledger_id, order_id, transaction_type, amount, running_balance, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entry.ledgerId, entry.orderId, entry.transactionType, entry.amount, entry.runningBalance, entry.description || null]
  );
}

async function updateLedgerBalance(conn, ledgerId, newBalance) {
  await conn.query(
    `UPDATE customer_ledgers SET current_udhaar_balance = ? WHERE id = ?`,
    [newBalance, ledgerId]
  );
}

/**
 * Everything the printed bill needs, in one round-trip per part: the firm block
 * that heads the bill, the order totals, and the frozen line snapshots.
 * Scoped by firm so one firm can never fetch another's invoice.
 */
async function getInvoice(db, firmId, orderId) {
  const [orderRows] = await db.query(
    `SELECT o.id, o.bill_number AS billNumber, o.bill_sequence AS billSequence,
            o.bill_date AS billDate, o.order_number AS orderNumber, o.channel,
            o.buyer_id AS buyerId, o.customer_name AS customerName,
            o.customer_phone AS customerPhone,
            o.gross_amount AS grossAmount, o.tax_amount AS taxAmount,
            o.discount_amount AS discountAmount, o.net_amount AS netAmount,
            o.item_count AS itemCount, o.total_quantity AS totalQuantity,
            o.total_weight_kg AS totalWeightKg,
            o.payment_status AS paymentStatus, o.order_status AS orderStatus,
            o.notes, o.created_at AS createdAt
     FROM orders o
     WHERE o.id = ? AND o.firm_id = ?
     LIMIT 1`,
    [orderId, firmId]
  );
  if (!orderRows[0]) {
    throw ApiError.notFound(`Order ${orderId} not found for this firm`);
  }

  const [firmRows] = await db.query(
    `SELECT id, firm_name AS firmName, legal_name AS legalName, gstin, pan,
            vat_tin AS vatTin, fssai_number AS fssaiNumber,
            address, city, state, state_code AS stateCode, pincode,
            phone, alt_phone AS altPhone,
            invoice_footer_text AS footerText, invoice_thanks_text AS thanksText
     FROM firms WHERE id = ? LIMIT 1`,
    [firmId]
  );

  const [items] = await db.query(
    `SELECT line_no AS lineNo, product_id AS productId, description,
            unit_label AS unitLabel, quantity, weight_kg AS weightKg,
            unit_price AS unitPrice, total_price AS totalPrice
     FROM order_items
     WHERE order_id = ?
     ORDER BY line_no ASC, id ASC`,
    [orderId]
  );

  const [payments] = await db.query(
    `SELECT payment_mode AS mode, amount, reference_number AS referenceNumber,
            transaction_date AS transactionDate
     FROM payment_transactions
     WHERE order_id = ?
     ORDER BY id ASC`,
    [orderId]
  );

  return { firm: firmRows[0], order: orderRows[0], items, payments };
}

/** Paginated bill register for a firm, newest bill first. */
async function listOrders(
  db,
  firmId,
  { channel, search, paymentStatus, orderStatus, fromDate, toDate, limit = 50, offset = 0 } = {}
) {
  const where = ['o.firm_id = ?'];
  const params = [firmId];

  if (channel) {
    where.push('o.channel = ?');
    params.push(channel);
  }
  if (search) {
    const like = `%${search}%`;
    where.push('(o.bill_number LIKE ? OR o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)');
    params.push(like, like, like, like);
  }
  if (paymentStatus) {
    where.push('o.payment_status = ?');
    params.push(paymentStatus);
  }
  if (orderStatus) {
    where.push('o.order_status = ?');
    params.push(orderStatus);
  }
  if (fromDate) {
    where.push('o.bill_date >= ?');
    params.push(`${fromDate} 00:00:00`);
  }
  if (toDate) {
    where.push('o.bill_date <= ?');
    params.push(`${toDate} 23:59:59`);
  }

  const [rows] = await db.query(
    `SELECT o.id, o.order_number AS orderNumber, o.bill_number AS billNumber,
            o.bill_date AS billDate, o.channel,
            o.buyer_id AS buyerId, o.customer_name AS customerName,
            o.customer_phone AS customerPhone, o.item_count AS itemCount,
            o.total_quantity AS totalQuantity, o.net_amount AS netAmount,
            o.payment_status AS paymentStatus, o.order_status AS orderStatus
     FROM orders o
     WHERE ${where.join(' AND ')}
     ORDER BY o.bill_date DESC, o.id DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM orders o WHERE ${where.join(' AND ')}`,
    params
  );

  return { rows, total };
}

module.exports = {
  UNIT_NAME_TO_KG,
  getProductForBilling,
  getUnitConversion,
  getBaseUnit,
  baseUnitsToKg,
  getLatestDailyPrice,
  getWholesaleTierPrice,
  deductInventoryFEFO,
  insertOrder,
  insertOrderItem,
  insertPaymentTransaction,
  getOrCreateLedger,
  insertLedgerTransaction,
  updateLedgerBalance,
  getInvoice,
  listOrders,
};
