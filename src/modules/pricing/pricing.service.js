const { withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const queries = require('./pricing.queries');

/**
 * Bulk-upserts today's (or a given date's) mandi rates for many products
 * at once - one row per product per day, so re-running the same date
 * just overwrites that day's rate instead of duplicating it.
 */
async function bulkUpdateDailyPrices({ effectiveDate, updates, updatedBy }) {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw ApiError.badRequest('updates must be a non-empty array');
  }

  const date = effectiveDate || new Date().toISOString().slice(0, 10);

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

module.exports = { bulkUpdateDailyPrices };
