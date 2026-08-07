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

module.exports = { upsertDailyPrice };
