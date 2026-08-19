const { ApiError } = require('../../utils/ApiError');

/**
 * SQL for the firms module. Functions that participate in a larger write take
 * a transactional `conn`; read-only helpers accept the pool.
 */

/**
 * A firm hangs off a `sellers` row, but a freshly-registered user has none.
 * Rather than force a separate "become a seller" call, the seller profile is
 * created lazily the first time that user creates a firm.
 */
async function getOrCreateSellerForUser(conn, userId, businessName) {
  const [rows] = await conn.query('SELECT id FROM sellers WHERE user_id = ? LIMIT 1', [userId]);
  if (rows[0]) return rows[0].id;

  const [result] = await conn.query(
    'INSERT INTO sellers (user_id, business_name) VALUES (?, ?)',
    [userId, businessName]
  );
  return result.insertId;
}

async function insertFirm(conn, sellerId, firm) {
  const [result] = await conn.query(
    `INSERT INTO firms
       (seller_id, firm_name, firm_type, legal_name, gstin, pan, vat_tin, fssai_number,
        address, city, state, state_code, pincode, phone, alt_phone,
        invoice_prefix, invoice_padding, next_bill_number,
        invoice_footer_text, invoice_thanks_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sellerId,
      firm.firmName,
      firm.firmType,
      firm.legalName,
      firm.gstin,
      firm.pan,
      firm.vatTin,
      firm.fssaiNumber,
      firm.address,
      firm.city,
      firm.state,
      firm.stateCode,
      firm.pincode,
      firm.phone,
      firm.altPhone,
      firm.invoicePrefix,
      firm.invoicePadding,
      firm.nextBillNumber,
      firm.invoiceFooterText,
      firm.invoiceThanksText,
    ]
  );
  return result.insertId;
}

/**
 * Grants a user access to a firm. `is_default` marks the firm the frontend
 * pre-selects on login; only one per user, so any previous default is cleared.
 */
async function insertFirmUser(conn, { firmId, userId, roleId, isDefault = false }) {
  if (isDefault) {
    await conn.query('UPDATE firm_users SET is_default = 0 WHERE user_id = ?', [userId]);
  }
  await conn.query(
    `INSERT INTO firm_users (firm_id, user_id, role_id, is_default)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), is_default = VALUES(is_default)`,
    [firmId, userId, roleId, isDefault ? 1 : 0]
  );
}

/** Every firm the user may operate — this is what the firm-switcher renders. */
async function listFirmsForUser(db, userId) {
  const [rows] = await db.query(
    `SELECT f.id, f.firm_name AS firmName, f.firm_type AS firmType, f.gstin,
            f.city, f.state, f.phone, f.is_active AS isActive,
            fu.is_default AS isDefault, r.name AS firmRole
     FROM firm_users fu
     JOIN firms f ON f.id = fu.firm_id
     JOIN roles r ON r.id = fu.role_id
     WHERE fu.user_id = ?
     ORDER BY fu.is_default DESC, f.firm_name ASC`,
    [userId]
  );
  return rows;
}

/** Full firm record including invoice settings — used by Settings and the bill header. */
async function findFirmById(db, firmId) {
  const [rows] = await db.query(
    `SELECT id, seller_id AS sellerId, firm_name AS firmName, firm_type AS firmType,
            legal_name AS legalName, gstin, pan, vat_tin AS vatTin, fssai_number AS fssaiNumber,
            address, city, state, state_code AS stateCode, pincode, phone, alt_phone AS altPhone,
            invoice_prefix AS invoicePrefix, invoice_padding AS invoicePadding,
            next_bill_number AS nextBillNumber, invoice_footer_text AS invoiceFooterText,
            invoice_thanks_text AS invoiceThanksText, is_active AS isActive,
            created_at AS createdAt, updated_at AS updatedAt
     FROM firms
     WHERE id = ?
     LIMIT 1`,
    [firmId]
  );
  return rows[0] || null;
}

/**
 * Reserves the next bill number for a firm and advances the counter.
 *
 * MUST be called inside the same transaction as the order INSERT: the firm row
 * is locked FOR UPDATE so two concurrent counters cannot hand out the same
 * bill number, and the increment rolls back with the order if checkout fails
 * (a rolled-back sale must not burn a bill number and leave a gap in the
 * printed series, which an auditor would question).
 *
 * Returns e.g. { billNumber: 'A026490', billSequence: 26490 } for a firm with
 * invoice_prefix='A', invoice_padding=6, next_bill_number=26490.
 */
async function reserveBillNumber(conn, firmId) {
  const [rows] = await conn.query(
    `SELECT invoice_prefix, invoice_padding, next_bill_number
     FROM firms
     WHERE id = ?
     FOR UPDATE`,
    [firmId]
  );
  if (!rows[0]) {
    throw ApiError.notFound(`Firm ${firmId} not found`);
  }

  const { invoice_prefix: prefix, invoice_padding: padding, next_bill_number: sequence } = rows[0];

  await conn.query('UPDATE firms SET next_bill_number = next_bill_number + 1 WHERE id = ?', [firmId]);

  return {
    billNumber: `${prefix}${String(sequence).padStart(Number(padding), '0')}`,
    billSequence: Number(sequence),
  };
}

/**
 * Partial update. `fields` is a pre-validated map of column -> value built by
 * the service, so the column names never come straight from the request body.
 */
async function updateFirm(db, firmId, fields) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;

  const assignments = entries.map(([column]) => `\`${column}\` = ?`).join(', ');
  const values = entries.map(([, value]) => value);

  await db.query(`UPDATE firms SET ${assignments} WHERE id = ?`, [...values, firmId]);
}

/**
 * The seller a firm's bills are raised by. Checkout defaults to this rather
 * than trusting a `sellerId` from the request body.
 */
async function findSellerIdForFirm(db, firmId) {
  const [rows] = await db.query('SELECT seller_id FROM firms WHERE id = ? LIMIT 1', [firmId]);
  return rows[0] ? rows[0].seller_id : null;
}

async function findRoleByName(db, roleName) {
  const [rows] = await db.query('SELECT id FROM roles WHERE name = ? LIMIT 1', [roleName]);
  return rows[0] || null;
}

/** Looks up an existing user to grant firm access to — they must already have an account. */
async function findUserByPhone(db, phone) {
  const [rows] = await db.query('SELECT id, name, phone, status FROM users WHERE phone = ? LIMIT 1', [phone]);
  return rows[0] || null;
}

/** Everyone with access to a firm, for the admin's staff-management screen. */
async function listStaffForFirm(db, firmId) {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.phone, u.status, r.name AS roleName, fu.is_default AS isDefault
     FROM firm_users fu
     JOIN users u ON u.id = fu.user_id
     JOIN roles r ON r.id = fu.role_id
     WHERE fu.firm_id = ?
     ORDER BY r.name ASC, u.name ASC`,
    [firmId]
  );
  return rows;
}

module.exports = {
  getOrCreateSellerForUser,
  insertFirm,
  insertFirmUser,
  listFirmsForUser,
  findFirmById,
  reserveBillNumber,
  updateFirm,
  findSellerIdForFirm,
  findRoleByName,
  findUserByPhone,
  listStaffForFirm,
};
