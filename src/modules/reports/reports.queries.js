/**
 * Aggregate reads behind the Dashboard and Reports screens.
 *
 * Every query is firm-scoped and reads `orders.bill_date`, not `created_at`:
 * a bill keyed in tonight for yesterday's counter sales belongs in yesterday's
 * day-book, which is the number the shopkeeper reconciles cash against.
 * Cancelled orders are excluded everywhere — the bill number survives for the
 * printed series, but the money never existed.
 */

const LIVE_ORDER = "o.order_status <> 'CANCELLED'";

/** Sales for one day, split by channel. */
async function findSalesForDate(db, firmId, date) {
  const [rows] = await db.query(
    `SELECT o.channel,
            COUNT(*) AS billCount,
            COALESCE(SUM(o.net_amount), 0) AS amount
     FROM orders o
     WHERE o.firm_id = ? AND DATE(o.bill_date) = ? AND ${LIVE_ORDER}
     GROUP BY o.channel`,
    [firmId, date]
  );
  return rows;
}

/**
 * Day-by-day sales for a trailing window. Days with no sale are absent by
 * definition (there is no row to group), so the caller pads the series — a
 * gap in the x-axis would misread as "no data" rather than "no sales".
 */
async function findSalesTrend(db, firmId, days) {
  const [rows] = await db.query(
    `SELECT DATE(o.bill_date) AS billDay, o.channel,
            COALESCE(SUM(o.net_amount), 0) AS amount
     FROM orders o
     WHERE o.firm_id = ?
       AND o.bill_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND ${LIVE_ORDER}
     GROUP BY DATE(o.bill_date), o.channel
     ORDER BY billDay ASC`,
    [firmId, Number(days) - 1]
  );
  return rows;
}

/** Total outstanding khata across this firm's dealers. */
async function findKhataSummary(db, firmId) {
  const [rows] = await db.query(
    `SELECT COALESCE(SUM(cl.current_udhaar_balance), 0) AS outstanding,
            COUNT(*) AS accountCount,
            SUM(CASE WHEN cl.credit_limit > 0
                      AND cl.current_udhaar_balance > cl.credit_limit THEN 1 ELSE 0 END) AS overLimitCount
     FROM customer_ledgers cl
     WHERE cl.firm_id = ?`,
    [firmId]
  );
  return rows[0];
}

/**
 * Products at or under their reorder mark at this firm. Mirrors the low-stock
 * report's own predicate, including the LEFT JOIN placement that keeps
 * never-stocked products in the count.
 */
async function findLowStockCount(db, firmId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS lowStockCount FROM (
       SELECT p.id
       FROM products p
       LEFT JOIN inventory_batches ib ON ib.product_id = p.id AND ib.firm_id = ?
       WHERE p.is_active = 1
       GROUP BY p.id, p.min_stock_alert
       HAVING COALESCE(SUM(ib.quantity_available), 0) <= p.min_stock_alert
     ) low`,
    [firmId]
  );
  return Number(rows[0].lowStockCount);
}

/** Best sellers by revenue over a trailing window. */
async function findTopProducts(db, firmId, { days = 30, limit = 5 } = {}) {
  const [rows] = await db.query(
    `SELECT oi.product_id AS productId,
            MAX(oi.description) AS productName,
            SUM(oi.quantity) AS quantity,
            SUM(oi.weight_kg) AS weightKg,
            SUM(oi.total_price) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.firm_id = ?
       AND o.bill_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND ${LIVE_ORDER}
     GROUP BY oi.product_id
     ORDER BY revenue DESC
     LIMIT ?`,
    [firmId, Number(days), Number(limit)]
  );
  return rows;
}

/**
 * The activity feed's three sources. They are read separately and merged in
 * the service rather than UNIONed: the columns have nothing in common, and a
 * UNION would force every source into one shape and lose the fields each entry
 * needs to render its own sentence.
 */
async function findRecentOrders(db, firmId, limit) {
  const [rows] = await db.query(
    `SELECT o.id, o.bill_number AS billNumber, o.channel, o.customer_name AS customerName,
            o.net_amount AS netAmount, o.payment_status AS paymentStatus,
            o.created_at AS at
     FROM orders o
     WHERE o.firm_id = ? AND ${LIVE_ORDER}
     ORDER BY o.created_at DESC
     LIMIT ?`,
    [firmId, Number(limit)]
  );
  return rows;
}

async function findRecentPayments(db, firmId, limit) {
  const [rows] = await db.query(
    `SELECT pt.id, pt.amount, pt.payment_mode AS paymentMode,
            pt.transaction_date AS at,
            u.name AS buyerName
     FROM payment_transactions pt
     JOIN customer_ledgers cl ON cl.id = pt.ledger_id
     JOIN buyers b ON b.id = cl.buyer_id
     JOIN users u ON u.id = b.user_id
     WHERE cl.firm_id = ?
     ORDER BY pt.transaction_date DESC, pt.id DESC
     LIMIT ?`,
    [firmId, Number(limit)]
  );
  return rows;
}

async function findRecentPurchases(db, firmId, limit) {
  const [rows] = await db.query(
    `SELECT po.id, po.invoice_number AS invoiceNumber, po.total_amount AS totalAmount,
            po.created_at AS at, s.vendor_name AS supplierName
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.firm_id = ?
     ORDER BY po.created_at DESC
     LIMIT ?`,
    [firmId, Number(limit)]
  );
  return rows;
}

/** Payment-mode split for a date range, for the Reports screen. */
async function findPaymentModeSplit(db, firmId, fromDate, toDate) {
  const [rows] = await db.query(
    `SELECT pt.payment_mode AS paymentMode, COALESCE(SUM(pt.amount), 0) AS amount, COUNT(*) AS count
     FROM payment_transactions pt
     JOIN orders o ON o.id = pt.order_id
     WHERE o.firm_id = ? AND DATE(pt.transaction_date) BETWEEN ? AND ?
     GROUP BY pt.payment_mode
     ORDER BY amount DESC`,
    [firmId, fromDate, toDate]
  );
  return rows;
}

/** Headline totals for an arbitrary date range. */
async function findRangeSummary(db, firmId, fromDate, toDate) {
  const [rows] = await db.query(
    `SELECT o.channel,
            COUNT(*) AS billCount,
            COALESCE(SUM(o.net_amount), 0) AS amount,
            COALESCE(SUM(o.discount_amount), 0) AS discount,
            COALESCE(SUM(o.total_quantity), 0) AS quantity
     FROM orders o
     WHERE o.firm_id = ? AND DATE(o.bill_date) BETWEEN ? AND ? AND ${LIVE_ORDER}
     GROUP BY o.channel`,
    [firmId, fromDate, toDate]
  );
  return rows;
}

module.exports = {
  findSalesForDate,
  findSalesTrend,
  findKhataSummary,
  findLowStockCount,
  findTopProducts,
  findRecentOrders,
  findRecentPayments,
  findRecentPurchases,
  findPaymentModeSplit,
  findRangeSummary,
};
