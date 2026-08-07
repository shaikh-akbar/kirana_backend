/**
 * Sums batch-level quantity_available per product and compares it to the
 * product's min_stock_alert threshold. Products with zero batches still
 * show up (COALESCE to 0) so a newly listed, never-stocked item is
 * flagged too.
 */
async function findLowStockProducts(conn) {
  const [rows] = await conn.query(
    `SELECT
       p.id AS product_id,
       p.name,
       p.sku,
       p.min_stock_alert,
       COALESCE(SUM(ib.quantity_available), 0) AS total_available
     FROM products p
     LEFT JOIN inventory_batches ib ON ib.product_id = p.id
     WHERE p.is_active = 1
     GROUP BY p.id, p.name, p.sku, p.min_stock_alert
     HAVING total_available <= p.min_stock_alert
     ORDER BY total_available ASC`
  );
  return rows;
}

module.exports = { findLowStockProducts };
