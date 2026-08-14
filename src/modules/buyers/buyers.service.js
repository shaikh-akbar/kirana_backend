const crypto = require('crypto');
const { pool, withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const queries = require('./buyers.queries');

/**
 * Buyers are customers, not staff, so their `users` row exists only to hold a
 * name and phone: it is created INACTIVE with an unusable password, which
 * `auth.service.login` rejects outright. Migration 002 adds the BUYER role for
 * the same reason — `users.role_id` is NOT NULL and every seeded role was a
 * staff role, so a dealer would otherwise have had to be filed as a cashier.
 */
const BUYER_ROLE = 'BUYER';

/**
 * Not a hash of anything — bcrypt.compare can never match it, so the account
 * cannot be logged into even if someone flips its status to ACTIVE. A real
 * password has to be set deliberately.
 */
function unusablePasswordHash() {
  return `!nologin:${crypto.randomBytes(24).toString('hex')}`;
}

/** Credit headroom, as the Khata screen colours it. */
function creditStatus(balance, creditLimit) {
  const limit = Number(creditLimit);
  if (!limit) return Number(balance) > 0 ? 'OVER_LIMIT' : 'CLEAR';
  const ratio = Number(balance) / limit;
  if (ratio > 1) return 'OVER_LIMIT';
  if (ratio >= 0.7) return 'NEAR_LIMIT';
  return 'CLEAR';
}

function decorate(buyer) {
  return {
    ...buyer,
    balance: Number(buyer.balance),
    creditLimit: Number(buyer.creditLimit),
    status: creditStatus(buyer.balance, buyer.creditLimit),
    creditAvailable: Math.max(Number(buyer.creditLimit) - Number(buyer.balance), 0),
  };
}

async function listBuyers(firmId, filters) {
  const rows = await queries.listBuyers(pool, firmId, filters);
  return rows.map(decorate);
}

/** Profile + khata history + bill history, which is the whole buyer timeline. */
async function getBuyer(firmId, id) {
  const buyer = await queries.findBuyerById(pool, firmId, id);
  if (!buyer) throw ApiError.notFound(`Buyer ${id} not found`);

  const [transactions, orders] = await Promise.all([
    queries.findBuyerTransactions(pool, firmId, id),
    queries.findBuyerOrders(pool, firmId, id),
  ]);

  return { ...decorate(buyer), transactions, orders };
}

/**
 * Creates the user, the buyer profile and the khata for the active firm in one
 * transaction. Half of that is worse than none: a buyer with no ledger is
 * invisible on the Khata screen, and a user row with no buyer profile cannot be
 * billed to.
 */
async function createBuyer(firmId, input) {
  const existingUser = await queries.findUserByPhone(pool, input.phone);
  if (existingUser) {
    throw ApiError.conflict(`Phone ${input.phone} is already registered to ${existingUser.name}`);
  }

  const role = await queries.findRoleByName(pool, BUYER_ROLE);
  if (!role) {
    throw ApiError.badRequest('BUYER role is missing — run the 002 migration before adding buyers');
  }

  const buyerId = await withTransaction(async (conn) => {
    const userId = await queries.insertUser(conn, {
      roleId: role.id,
      name: input.name,
      phone: input.phone,
      email: input.email || null,
      passwordHash: unusablePasswordHash(),
      status: 'INACTIVE',
    });

    const creditLimit = input.creditLimit != null ? input.creditLimit : 0;
    const id = await queries.insertBuyer(conn, {
      userId,
      buyerType: input.buyerType || 'WHOLESALE',
      contactPerson: input.contactPerson || null,
      area: input.area || null,
      address: input.address || null,
      creditLimit,
    });

    await queries.ensureLedger(conn, firmId, id, creditLimit);
    return id;
  });

  return getBuyer(firmId, buyerId);
}

const BUYER_FIELDS = {
  buyerType: 'buyer_type',
  contactPerson: 'contact_person',
  area: 'area',
  address: 'address',
  creditLimit: 'credit_limit',
};

const USER_FIELDS = { name: 'name', phone: 'phone', email: 'email' };

async function updateBuyer(firmId, id, input) {
  const existing = await queries.findBuyerById(pool, firmId, id);
  if (!existing) throw ApiError.notFound(`Buyer ${id} not found`);

  const buyerFields = {};
  for (const [key, column] of Object.entries(BUYER_FIELDS)) {
    if (input[key] !== undefined) buyerFields[column] = input[key] === '' ? null : input[key];
  }
  if (input.isActive !== undefined) buyerFields.is_active = input.isActive ? 1 : 0;

  const userFields = {};
  for (const [key, column] of Object.entries(USER_FIELDS)) {
    if (input[key] !== undefined) userFields[column] = input[key] === '' ? null : input[key];
  }

  if (Object.keys(buyerFields).length === 0 && Object.keys(userFields).length === 0) {
    throw ApiError.badRequest('No updatable fields supplied');
  }

  await withTransaction(async (conn) => {
    try {
      await queries.updateBuyer(conn, id, buyerFields);
      await queries.updateBuyerUser(conn, id, userFields);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw ApiError.conflict('That phone number or email already belongs to another account');
      }
      throw err;
    }

    // The ledger carries its own copy of the limit (it is what the credit check
    // reads at checkout), so raising the buyer's limit has to reach it — but
    // only at the firm the caller is acting for; other firms set their own.
    if (input.creditLimit !== undefined) {
      await queries.syncLedgerCreditLimit(conn, firmId, id, input.creditLimit);
    }
  });

  return getBuyer(firmId, id);
}

module.exports = { listBuyers, getBuyer, createBuyer, updateBuyer, creditStatus };
