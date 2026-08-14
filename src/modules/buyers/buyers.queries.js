/**
 * SQL for buyer (dealer/customer) profiles.
 *
 * A buyer is global — the same dealer can buy from every firm the owner runs —
 * but their khata balance is not: `customer_ledgers` is keyed on (firm, buyer).
 * So every listing here LEFT JOINs the ledger with an explicit firm predicate,
 * and a buyer who has never bought from the active firm reads as balance 0
 * rather than disappearing.
 */

const BUYER_COLUMNS = `
  b.id, u.name, u.phone, u.email,
  b.buyer_type AS buyerType, b.contact_person AS contactPerson,
  b.area, b.address, b.credit_limit AS creditLimit, b.is_active AS isActive,
  b.created_at AS createdAt,
  COALESCE(cl.current_udhaar_balance, 0) AS balance,
  cl.id AS ledgerId, cl.last_updated AS lastUpdated`;

async function listBuyers(db, firmId, { search, buyerType, withLedgerOnly = false, includeInactive = false } = {}) {
  const where = [];
  const params = [firmId];

  if (!includeInactive) where.push('b.is_active = 1');
  if (buyerType) {
    where.push('b.buyer_type = ?');
    params.push(buyerType);
  }
  if (search) {
    where.push('(u.name LIKE ? OR u.phone LIKE ? OR b.contact_person LIKE ? OR b.area LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (withLedgerOnly) where.push('cl.id IS NOT NULL');

  const [rows] = await db.query(
    `SELECT ${BUYER_COLUMNS}
     FROM buyers b
     JOIN users u ON u.id = b.user_id
     LEFT JOIN customer_ledgers cl ON cl.buyer_id = b.id AND cl.firm_id = ?
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY COALESCE(cl.current_udhaar_balance, 0) DESC, u.name ASC`,
    params
  );
  return rows;
}

async function findBuyerById(db, firmId, id) {
  const [rows] = await db.query(
    `SELECT ${BUYER_COLUMNS}
     FROM buyers b
     JOIN users u ON u.id = b.user_id
     LEFT JOIN customer_ledgers cl ON cl.buyer_id = b.id AND cl.firm_id = ?
     WHERE b.id = ?
     LIMIT 1`,
    [firmId, id]
  );
  return rows[0] || null;
}

/**
 * A buyer's khata entries at ONE firm, oldest first so the running balance
 * reads down the page the way a paper khata does.
 */
async function findBuyerTransactions(db, firmId, buyerId, { limit = 200 } = {}) {
  const [rows] = await db.query(
    `SELECT lt.id, lt.transaction_type AS transactionType, lt.amount,
            lt.running_balance AS runningBalance, lt.description,
            lt.created_at AS createdAt,
            lt.order_id AS orderId, o.bill_number AS billNumber
     FROM ledger_transactions lt
     JOIN customer_ledgers cl ON cl.id = lt.ledger_id
     LEFT JOIN orders o ON o.id = lt.order_id
     WHERE cl.firm_id = ? AND cl.buyer_id = ?
     ORDER BY lt.created_at ASC, lt.id ASC
     LIMIT ?`,
    [firmId, buyerId, Number(limit)]
  );
  return rows;
}

/** Bills this buyer has taken from the active firm. */
async function findBuyerOrders(db, firmId, buyerId, { limit = 50 } = {}) {
  const [rows] = await db.query(
    `SELECT o.id, o.bill_number AS billNumber, o.bill_date AS billDate, o.channel,
            o.item_count AS itemCount, o.net_amount AS netAmount,
            o.payment_status AS paymentStatus, o.order_status AS orderStatus
     FROM orders o
     WHERE o.firm_id = ? AND o.buyer_id = ?
     ORDER BY o.bill_date DESC, o.id DESC
     LIMIT ?`,
    [firmId, buyerId, Number(limit)]
  );
  return rows;
}

async function findUserByPhone(db, phone) {
  const [rows] = await db.query('SELECT id, name FROM users WHERE phone = ? LIMIT 1', [phone]);
  return rows[0] || null;
}

async function findRoleByName(db, name) {
  const [rows] = await db.query('SELECT id FROM roles WHERE name = ? LIMIT 1', [name]);
  return rows[0] || null;
}

async function insertUser(conn, { roleId, name, phone, email, passwordHash, status }) {
  const [result] = await conn.query(
    `INSERT INTO users (role_id, name, phone, email, password_hash, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [roleId, name, phone, email, passwordHash, status]
  );
  return result.insertId;
}

async function insertBuyer(conn, buyer) {
  const [result] = await conn.query(
    `INSERT INTO buyers (user_id, buyer_type, contact_person, area, address, credit_limit, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [buyer.userId, buyer.buyerType, buyer.contactPerson, buyer.area, buyer.address, buyer.creditLimit]
  );
  return result.insertId;
}

/**
 * Opens the khata for this (firm, buyer) pair. Called at buyer creation so a
 * dealer shows up on the Khata screen immediately, at a zero balance, instead
 * of only appearing once their first credit bill is raised.
 */
async function ensureLedger(conn, firmId, buyerId, creditLimit) {
  await conn.query(
    `INSERT INTO customer_ledgers (firm_id, buyer_id, current_udhaar_balance, credit_limit)
     VALUES (?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE credit_limit = VALUES(credit_limit)`,
    [firmId, buyerId, creditLimit]
  );
}

async function updateBuyer(db, id, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  await db.query(
    `UPDATE buyers SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
    [...columns.map((c) => fields[c]), id]
  );
}

async function updateBuyerUser(db, buyerId, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  await db.query(
    `UPDATE users u JOIN buyers b ON b.user_id = u.id
     SET ${columns.map((c) => `u.\`${c}\` = ?`).join(', ')}
     WHERE b.id = ?`,
    [...columns.map((c) => fields[c]), buyerId]
  );
}

/** Keeps the khata's credit limit in step with the buyer's, per firm. */
async function syncLedgerCreditLimit(db, firmId, buyerId, creditLimit) {
  await db.query(
    `UPDATE customer_ledgers SET credit_limit = ? WHERE firm_id = ? AND buyer_id = ?`,
    [creditLimit, firmId, buyerId]
  );
}

module.exports = {
  listBuyers,
  findBuyerById,
  findBuyerTransactions,
  findBuyerOrders,
  findUserByPhone,
  findRoleByName,
  insertUser,
  insertBuyer,
  ensureLedger,
  updateBuyer,
  updateBuyerUser,
  syncLedgerCreditLimit,
};
