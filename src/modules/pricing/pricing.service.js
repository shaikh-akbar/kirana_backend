const { pool, withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const queries = require('./pricing.queries');

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The editable rate sheet for a date. Rows with no rate for that date are
 * pre-filled from the last published rate, so the shopkeeper adjusts yesterday's
 * numbers instead of retyping the whole sheet each morning — but they are
 * flagged `published: false` so the screen can show which rates are still
 * carried over rather than confirmed for today.
 */
async function getRateSheet(effectiveDate) {
  const date = effectiveDate || today();
  const rows = await queries.findRateSheet(pool, date);

  return {
    effectiveDate: date,
    rows: rows.map((row) => ({
      ...row,
      published: Boolean(row.published),
      wholesalePrice: row.wholesalePrice != null ? Number(row.wholesalePrice) : row.previousWholesale != null ? Number(row.previousWholesale) : null,
      retailPrice: row.retailPrice != null ? Number(row.retailPrice) : row.previousRetail != null ? Number(row.previousRetail) : null,
      previousWholesale: row.previousWholesale != null ? Number(row.previousWholesale) : null,
      previousRetail: row.previousRetail != null ? Number(row.previousRetail) : null,
    })),
  };
}

/**
 * Bulk-upserts today's (or a given date's) mandi rates for many products
 * at once - one row per product per day, so re-running the same date
 * just overwrites that day's rate instead of duplicating it.
 */
async function bulkUpdateDailyPrices({ effectiveDate, updates, updatedBy }) {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw ApiError.badRequest('updates must be a non-empty array');
  }

  const date = effectiveDate || today();

  return withTransaction(async (conn) => {
    for (const update of updates) {
      await queries.upsertDailyPrice(conn, {
        productId: update.productId,
        wholesalePrice: update.wholesalePrice,
        retailPrice: update.retailPrice,
        effectiveDate: date,
        updatedBy,
      });
    }
    return { effectiveDate: date, updatedCount: updates.length };
  });
}

module.exports = { getRateSheet, bulkUpdateDailyPrices };
