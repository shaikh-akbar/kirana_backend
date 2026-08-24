const { pool, withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const { ROLES } = require('../../constants/roles');
const queries = require('./firms.queries');

/**
 * Default statutory declaration printed at the foot of a bill. Taken from the
 * declaration Maharashtra dealers already print (and which appears on the
 * client's existing bills), so a newly-created firm produces a compliant
 * print-out without the owner having to type it in. Editable per firm.
 */
const DEFAULT_INVOICE_FOOTER =
  'I/We hereby certify that my/our registration certificate under the Maharashtra Value Added ' +
  'Tax Act, 2002 is in force on the date on which the sale of the goods specified in this tax ' +
  'invoice is made by me/us and that the transaction of sale covered by this tax invoice has ' +
  'been effected by me/us and it shall be accounted for in the turnover of sales while filing ' +
  'of return and the due tax, if any, payable on the sale has been paid or shall be paid.';

/**
 * Request-field -> DB-column whitelist for updates. Anything not listed here is
 * silently ignored, so a caller cannot reach `seller_id`, `next_bill_number`
 * (only the checkout path may move the counter) or `id`.
 */
const UPDATABLE_FIELDS = {
  firmName: 'firm_name',
  firmType: 'firm_type',
  legalName: 'legal_name',
  gstin: 'gstin',
  pan: 'pan',
  vatTin: 'vat_tin',
  fssaiNumber: 'fssai_number',
  address: 'address',
  city: 'city',
  state: 'state',
  stateCode: 'state_code',
  pincode: 'pincode',
  phone: 'phone',
  altPhone: 'alt_phone',
  invoicePrefix: 'invoice_prefix',
  invoicePadding: 'invoice_padding',
  invoiceFooterText: 'invoice_footer_text',
  invoiceThanksText: 'invoice_thanks_text',
  isActive: 'is_active',
};

/**
 * Creates a firm and makes the calling user its ADMIN in one transaction.
 *
 * All three writes must land together: a firm with no `firm_users` row would be
 * invisible to its own creator (firmScope reads that table), and a seller row
 * with no firm is dead weight.
 *
 * `nextBillNumber` is settable at creation on purpose — a shop migrating from a
 * manual or legacy bill book continues its existing series (e.g. start at
 * 26491 so the next printed bill is A026491) instead of restarting at 1 and
 * producing duplicate bill numbers for the financial year.
 */
async function createFirm(userId, input) {
  return withTransaction(async (conn) => {
    const adminRole = await queries.findRoleByName(conn, ROLES.ADMIN);
    if (!adminRole) {
      throw ApiError.badRequest('ADMIN role is missing — seed roles before creating a firm');
    }

    const sellerId = await queries.getOrCreateSellerForUser(conn, userId, input.firmName);

    let firmId;
    try {
      firmId = await queries.insertFirm(conn, sellerId, {
        firmName: input.firmName,
        firmType: input.firmType || 'BOTH',
        legalName: input.legalName || null,
        gstin: input.gstin || null,
        pan: input.pan || null,
        vatTin: input.vatTin || null,
        fssaiNumber: input.fssaiNumber || null,
        address: input.address || null,
        city: input.city || null,
        state: input.state || null,
        stateCode: input.stateCode || null,
        pincode: input.pincode || null,
        phone: input.phone || null,
        altPhone: input.altPhone || null,
        invoicePrefix: input.invoicePrefix || 'INV',
        invoicePadding: input.invoicePadding != null ? input.invoicePadding : 6,
        nextBillNumber: input.nextBillNumber != null ? input.nextBillNumber : 1,
        invoiceFooterText: input.invoiceFooterText || DEFAULT_INVOICE_FOOTER,
        invoiceThanksText: input.invoiceThanksText || 'Thanks for Shoping Visit Again',
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // Two distinct unique keys can trip here; tell the owner which one.
        const onGstin = String(err.sqlMessage || '').includes('uq_firms_gstin');
        throw ApiError.conflict(
          onGstin
            ? `A firm with GSTIN ${input.gstin} already exists`
            : `You already have a firm named '${input.firmName}'`
        );
      }
      throw err;
    }

    // First firm a user creates becomes their default selection on login.
    const existing = await queries.listFirmsForUser(conn, userId);
    const isFirstFirm = existing.length === 0;

    await queries.insertFirmUser(conn, {
      firmId,
      userId,
      roleId: adminRole.id,
      isDefault: isFirstFirm,
    });

    return queries.findFirmById(conn, firmId);
  });
}

async function listMyFirms(userId) {
  return queries.listFirmsForUser(pool, userId);
}

/**
 * Grants an existing user access to a firm as staff. This is the only way a
 * RETAILER/WHOLESALER account ends up with a `firm_users` row — self-service
 * signup only creates the user, not a firm membership, so without this call
 * they would have no firm and the frontend would have nowhere to send them
 * but the "create a firm" onboarding screen meant for a new owner.
 *
 * Re-running this for a user who is already a member updates their role
 * instead of failing — `insertFirmUser`'s upsert makes "add" and "change this
 * person's role" the same call.
 */
async function addStaff(firmId, input) {
  return withTransaction(async (conn) => {
    const role = await queries.findRoleByName(conn, input.roleName);
    if (!role) {
      throw ApiError.badRequest(`Unknown role '${input.roleName}'`);
    }

    const user = await queries.findUserByPhone(conn, input.phone);
    if (!user) {
      throw ApiError.notFound(`No user registered with phone ${input.phone} — they must register first`);
    }
    if (user.status !== 'ACTIVE') {
      throw ApiError.badRequest(`${user.name}'s account is not active`);
    }

    const existingFirms = await queries.listFirmsForUser(conn, user.id);

    await queries.insertFirmUser(conn, {
      firmId,
      userId: user.id,
      roleId: role.id,
      // First firm this user has ever been added to becomes their default,
      // same rule createFirm uses for a brand-new owner.
      isDefault: existingFirms.length === 0,
    });

    return { id: user.id, name: user.name, phone: user.phone, roleName: role.name };
  });
}

async function listStaff(firmId) {
  return queries.listStaffForFirm(pool, firmId);
}

/** Read a single firm. firmScope has already proven the caller's access. */
async function getFirm(firmId) {
  const firm = await queries.findFirmById(pool, firmId);
  if (!firm) {
    throw ApiError.notFound(`Firm ${firmId} not found`);
  }
  return firm;
}

async function updateFirmDetails(firmId, input) {
  const fields = {};
  for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (input[key] !== undefined) {
      fields[column] = key === 'isActive' ? (input[key] ? 1 : 0) : input[key];
    }
  }

  if (Object.keys(fields).length === 0) {
    throw ApiError.badRequest('No updatable fields supplied');
  }

  try {
    await queries.updateFirm(pool, firmId, fields);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw ApiError.conflict('Another firm already uses that name or GSTIN');
    }
    throw err;
  }

  return getFirm(firmId);
}

module.exports = {
  createFirm,
  listMyFirms,
  getFirm,
  updateFirmDetails,
  addStaff,
  listStaff,
  DEFAULT_INVOICE_FOOTER,
};
