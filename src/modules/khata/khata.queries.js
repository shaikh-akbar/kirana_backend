/**
 * Khata (credit ledger) SQL. Every ledger lookup is keyed on (firm_id, buyer_id):
 * a dealer who buys from two firms under the same owner owes each of them
 * separately, and the two balances must never be merged.
 */

async function getLedgerByBuyerId(conn, firmId, buyerId) {
  const [rows] = await conn.query(
    `SELECT cl.id, cl.firm_id, cl.buyer_id, cl.current_udhaar_balance, cl.credit_limit, cl.last_updated,
            u.name AS buyer_name, u.phone AS buyer_phone, b.buyer_type
     FROM customer_ledgers cl
     JOIN buyers b ON b.id = cl.buyer_id
     JOIN users u ON u.id = b.user_id
     WHERE cl.firm_id = ? AND cl.buyer_id = ?
     LIMIT 1`,
    [firmId, buyerId]
  );
  return rows[0] || null;
}

async function getLedgerByBuyerIdForUpdate(conn, firmId, buyerId) {
  const [rows] = await conn.query(
    `SELECT id, firm_id, buyer_id, current_udhaar_balance, credit_limit
     FROM customer_ledgers
     WHERE firm_id = ? AND buyer_id = ?
     FOR UPDATE`,
    [firmId, buyerId]
  );
  return rows[0] || null;
}

/** All khata accounts at this firm, biggest outstanding first. */
async function listLedgers(conn, firmId) {
  const [rows] = await conn.query(
    `SELECT cl.id AS ledgerId, cl.buyer_id AS buyerId, u.name AS buyerName, u.phone AS buyerPhone,
            b.buyer_type AS buyerType,
            cl.current_udhaar_balance AS balance, cl.credit_limit AS creditLimit,
            cl.last_updated AS lastUpdated
     FROM customer_ledgers cl
     JOIN buyers b ON b.id = cl.buyer_id
     JOIN users u ON u.id = b.user_id
     WHERE cl.firm_id = ?
     ORDER BY cl.current_udhaar_balance DESC, u.name ASC`,
    [firmId]
  );
  return rows;
}

async function getLedgerTransactions(conn, ledgerId, { limit = 50, offset = 0 } = {}) {
  const [rows] = await conn.query(
    `SELECT lt.id, lt.order_id AS orderId, o.bill_number AS billNumber,
            lt.transaction_type AS transactionType, lt.amount,
            lt.running_balance AS runningBalance, lt.description, lt.created_at AS createdAt
     FROM ledger_transactions lt
     LEFT JOIN orders o ON o.id = lt.order_id
     WHERE lt.ledger_id = ?
     ORDER BY lt.created_at DESC, lt.id DESC
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
  listLedgers,
  getLedgerTransactions,
  insertLedgerTransaction,
  updateLedgerBalance,
  insertPaymentTransaction,
};
