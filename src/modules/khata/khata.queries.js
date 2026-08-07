async function getLedgerByBuyerId(conn, buyerId) {
  const [rows] = await conn.query(
    `SELECT cl.id, cl.buyer_id, cl.current_udhaar_balance, cl.credit_limit, cl.last_updated
     FROM customer_ledgers cl
     WHERE cl.buyer_id = ?
     LIMIT 1`,
    [buyerId]
  );
  return rows[0] || null;
}

async function getLedgerByBuyerIdForUpdate(conn, buyerId) {
  const [rows] = await conn.query(
    `SELECT id, buyer_id, current_udhaar_balance, credit_limit
     FROM customer_ledgers
     WHERE buyer_id = ?
     FOR UPDATE`,
    [buyerId]
  );
  return rows[0] || null;
}

async function getLedgerTransactions(conn, ledgerId, { limit = 50, offset = 0 } = {}) {
  const [rows] = await conn.query(
    `SELECT id, order_id, transaction_type, amount, running_balance, description, created_at
     FROM ledger_transactions
     WHERE ledger_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [ledgerId, Number(limit), Number(offset)]
  );
  return rows;
}

async function insertLedgerTransaction(conn, entry) {
  await conn.query(
    `INSERT INTO ledger_transactions (ledger_id, order_id, transaction_type, amount, running_balance, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entry.ledgerId, entry.orderId || null, entry.transactionType, entry.amount, entry.runningBalance, entry.description || null]
  );
}

async function updateLedgerBalance(conn, ledgerId, newBalance) {
  await conn.query(`UPDATE customer_ledgers SET current_udhaar_balance = ? WHERE id = ?`, [newBalance, ledgerId]);
}

async function insertPaymentTransaction(conn, payment) {
  await conn.query(
    `INSERT INTO payment_transactions (order_id, ledger_id, payment_mode, amount, reference_number, transaction_date)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [payment.orderId || null, payment.ledgerId, payment.paymentMode, payment.amount, payment.referenceNumber || null]
  );
}

module.exports = {
  getLedgerByBuyerId,
  getLedgerByBuyerIdForUpdate,
  getLedgerTransactions,
  insertLedgerTransaction,
  updateLedgerBalance,
  insertPaymentTransaction,
};
