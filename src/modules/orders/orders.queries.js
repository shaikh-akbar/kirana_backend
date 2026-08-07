const { ApiError } = require('../../utils/ApiError');

/**
 * All raw SQL for the orders module lives here so retail/wholesale
 * services stay focused on business logic, not query strings.
 * Every function takes an active transactional connection (`conn`).
 */

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

async function getLatestDailyPrice(conn, productId) {
  const [rows] = await conn.query(
    `SELECT wholesale_price, retail_price, effective_date
     FROM daily_price_logs
     WHERE product_id = ?
     ORDER BY effective_date DESC
     LIMIT 1`,
    [productId]
  );
  if (!rows[0]) {
    throw ApiError.badRequest(`No daily price has been set for product ${productId}`);
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
 * Deducts `quantityBaseUnits` of a product from its batches using FEFO
 * (first-expiry-first-out; batches with no expiry are consumed last).
 * Locks candidate rows with FOR UPDATE to prevent overselling under
 * concurrent checkouts. Throws if available stock is insufficient.
 */
async function deductInventoryFEFO(conn, productId, quantityBaseUnits, movementType, referenceType, referenceId) {
  const [batches] = await conn.query(
    `SELECT id, quantity_available
     FROM inventory_batches
     WHERE product_id = ? AND quantity_available > 0
     ORDER BY (expiry_date IS NULL), expiry_date ASC, id ASC
     FOR UPDATE`,
    [productId]
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
      `INSERT INTO stock_movements (product_id, batch_id, movement_type, quantity, reference_type, reference_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [productId, batch.id, movementType, -take, referenceType, referenceId]
    );

    deductions.push({ batchId: batch.id, quantity: take });
    remaining -= take;
  }

  if (remaining > 0) {
    throw ApiError.conflict(`Insufficient stock for product ${productId}: short by ${remaining}`);
  }

  return deductions;
}

async function insertOrder(conn, order) {
  const [result] = await conn.query(
    `INSERT INTO orders
       (order_number, channel, buyer_id, seller_id, gross_amount, tax_amount, discount_amount, net_amount, payment_status, order_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.orderNumber,
      order.channel,
      order.buyerId,
      order.sellerId,
      order.grossAmount,
      order.taxAmount,
      order.discountAmount,
      order.netAmount,
      order.paymentStatus,
      order.orderStatus,
    ]
  );
  return result.insertId;
}

async function insertOrderItem(conn, item) {
  await conn.query(
    `INSERT INTO order_items (order_id, product_id, unit_id, quantity, unit_price, total_price)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [item.orderId, item.productId, item.unitId, item.quantity, item.unitPrice, item.totalPrice]
  );
}

async function insertPaymentTransaction(conn, payment) {
  await conn.query(
    `INSERT INTO payment_transactions (order_id, ledger_id, payment_mode, amount, reference_number, transaction_date)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [payment.orderId, payment.ledgerId, payment.paymentMode, payment.amount, payment.referenceNumber || null]
  );
}

async function getOrCreateLedger(conn, buyerId) {
  const [rows] = await conn.query(
    `SELECT id, current_udhaar_balance, credit_limit FROM customer_ledgers WHERE buyer_id = ? FOR UPDATE`,
    [buyerId]
  );
  if (rows[0]) return rows[0];

  const [buyerRows] = await conn.query(`SELECT credit_limit FROM buyers WHERE id = ?`, [buyerId]);
  if (!buyerRows[0]) {
    throw ApiError.notFound(`Buyer ${buyerId} not found`);
  }

  const [result] = await conn.query(
    `INSERT INTO customer_ledgers (buyer_id, current_udhaar_balance, credit_limit) VALUES (?, 0, ?)`,
    [buyerId, buyerRows[0].credit_limit]
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

module.exports = {
  getUnitConversion,
  getLatestDailyPrice,
  getWholesaleTierPrice,
  deductInventoryFEFO,
  insertOrder,
  insertOrderItem,
  insertPaymentTransaction,
  getOrCreateLedger,
  insertLedgerTransaction,
  updateLedgerBalance,
};
