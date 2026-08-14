/**
 * The rate sheet for one date: every sellable product, the rate keyed in for
 * that date if any, and the rate that was in force before it.
 *
 * Both halves matter to the screen. The `forDate` join is LEFT so a product
 * with no rate yet still appears as an empty row to type into — the sheet is
 * the entry form, not a report of what was already entered. The `previous`
 * join is what the up/down delta arrows compare against; it is the newest row
 * strictly *before* the date, not "yesterday", because a shop that skips
 * Sunday must still see Saturday's rate rather than a blank.
 */
async function findRateSheet(db, effectiveDate) {
  const [rows] = await db.query(
    `SELECT p.id AS productId, p.name AS productName, p.sku,
            c.name AS category, bu.unit_name AS unit,
            forDate.wholesale_price AS wholesalePrice,
            forDate.retail_price AS retailPrice,
            forDate.created_at AS lastUpdated,
            prev.wholesale_price AS previousWholesale,
            prev.retail_price AS previousRetail,
            prev.effective_date AS previousDate,
            (forDate.id IS NOT NULL) AS published
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_units bu ON bu.product_id = p.id AND bu.is_base_unit = 1
     LEFT JOIN daily_price_logs forDate
       ON forDate.product_id = p.id AND forDate.effective_date = ?
     LEFT JOIN daily_price_logs prev ON prev.id = (
       SELECT d.id FROM daily_price_logs d
       WHERE d.product_id = p.id AND d.effective_date < ?
       ORDER BY d.effective_date DESC, d.id DESC
       LIMIT 1
     )
     WHERE p.is_active = 1
     ORDER BY COALESCE(c.name, ''), p.name ASC`,
    [effectiveDate, effectiveDate]
  );
  return rows;
}

async function upsertDailyPrice(conn, { productId, wholesalePrice, retailPrice, effectiveDate, updatedBy }) {
  await conn.query(
    `INSERT INTO daily_price_logs (product_id, wholesale_price, retail_price, effective_date, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       wholesale_price = VALUES(wholesale_price),
       retail_price = VALUES(retail_price),
       updated_by = VALUES(updated_by)`,
    [productId, wholesalePrice, retailPrice, effectiveDate, updatedBy]
  );
}

module.exports = { findRateSheet, upsertDailyPrice };
