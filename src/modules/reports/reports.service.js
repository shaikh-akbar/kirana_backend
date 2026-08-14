const { pool } = require('../../config/db');
const queries = require('./reports.queries');

const TREND_DAYS = 14;

/* ------------------------------------------------------------------ *
 * Date helpers — all arithmetic in UTC
 * ------------------------------------------------------------------ */

/**
 * `dateStrings: true` on the pool means MySQL DATEs arrive as 'YYYY-MM-DD'
 * already, so the series is built and keyed as plain strings. Doing the day
 * arithmetic in UTC keeps a date from sliding a day when the server sits east
 * of Greenwich — IST is +5:30, and local-time arithmetic there is exactly the
 * case that produces an off-by-one day-book.
 */
function toDayString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dayString, delta) {
  const [year, month, day] = dayString.split('-').map(Number);
  return toDayString(new Date(Date.UTC(year, month - 1, day + delta)));
}

function todayString() {
  const now = new Date();
  return toDayString(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/* ------------------------------------------------------------------ *
 * Shaping
 * ------------------------------------------------------------------ */

function splitByChannel(rows) {
  const retail = rows.find((r) => r.channel === 'RETAIL');
  const wholesale = rows.find((r) => r.channel === 'WHOLESALE');
  return {
    retail: Number(retail?.amount || 0),
    wholesale: Number(wholesale?.amount || 0),
    billCount: Number(retail?.billCount || 0) + Number(wholesale?.billCount || 0),
  };
}

/**
 * Turns the sparse per-day rows into a dense 14-point series. A day the shop
 * made no sale has no row at all, and leaving the gap out would draw a chart
 * that skips from Friday to Sunday as if Saturday never happened.
 */
function buildTrend(rows, days, endDay) {
  const byDay = new Map();
  for (const row of rows) {
    const key = String(row.billDay).slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, { retail: 0, wholesale: 0 });
    const entry = byDay.get(key);
    if (row.channel === 'RETAIL') entry.retail = Number(row.amount);
    else entry.wholesale = Number(row.amount);
  }

  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addDays(endDay, -offset);
    const entry = byDay.get(day) || { retail: 0, wholesale: 0 };
    series.push({
      day,
      // 'MM-DD' is what the chart's x-axis prints; the full date rides along
      // for tooltips.
      date: day.slice(5),
      retail: entry.retail,
      wholesale: entry.wholesale,
    });
  }
  return series;
}

function percentChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

/** One sentence per feed entry, written where the data is, not in the UI. */
function buildActivity({ orders, payments, purchases }) {
  const entries = [];

  for (const order of orders) {
    const isRetail = order.channel === 'RETAIL';
    entries.push({
      id: `order-${order.id}`,
      type: isRetail ? 'sale' : 'order',
      text: isRetail
        ? `POS sale ${order.billNumber} — ₹${Number(order.netAmount).toLocaleString('en-IN')}`
        : `Wholesale bill ${order.billNumber} for ${order.customerName} — ₹${Number(order.netAmount).toLocaleString('en-IN')}`,
      at: order.at,
    });
  }

  for (const payment of payments) {
    entries.push({
      id: `payment-${payment.id}`,
      type: 'payment',
      text: `Khata repayment of ₹${Number(payment.amount).toLocaleString('en-IN')} from ${payment.buyerName} — ${payment.paymentMode}`,
      at: payment.at,
    });
  }

  for (const purchase of purchases) {
    entries.push({
      id: `purchase-${purchase.id}`,
      type: 'stock',
      text: `Stock received from ${purchase.supplierName} — invoice ${purchase.invoiceNumber}`,
      at: purchase.at,
    });
  }

  return entries
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

async function getDashboard(firmId) {
  const today = todayString();
  const yesterday = addDays(today, -1);

  const [todayRows, yesterdayRows, trendRows, khata, lowStockCount, topProducts, orders, payments, purchases] =
    await Promise.all([
      queries.findSalesForDate(pool, firmId, today),
      queries.findSalesForDate(pool, firmId, yesterday),
      queries.findSalesTrend(pool, firmId, TREND_DAYS),
      queries.findKhataSummary(pool, firmId),
      queries.findLowStockCount(pool, firmId),
      queries.findTopProducts(pool, firmId, { days: 30, limit: 5 }),
      queries.findRecentOrders(pool, firmId, 8),
      queries.findRecentPayments(pool, firmId, 5),
      queries.findRecentPurchases(pool, firmId, 5),
    ]);

  const todaySales = splitByChannel(todayRows);
  const yesterdaySales = splitByChannel(yesterdayRows);
  const todaysTotal = todaySales.retail + todaySales.wholesale;

  return {
    stats: {
      todaysSales: todaysTotal,
      retailShare: todaySales.retail,
      wholesaleShare: todaySales.wholesale,
      billCount: todaySales.billCount,
      salesDeltaPct: percentChange(todaysTotal, yesterdaySales.retail + yesterdaySales.wholesale),
      pendingKhata: Number(khata.outstanding),
      khataAccounts: Number(khata.accountCount),
      overLimitCount: Number(khata.overLimitCount || 0),
      lowStockCount,
    },
    trend: buildTrend(trendRows, TREND_DAYS, today),
    activity: buildActivity({ orders, payments, purchases }),
    topProducts: topProducts.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      quantity: Number(row.quantity),
      weightKg: Number(row.weightKg),
      revenue: Number(row.revenue),
    })),
  };
}

/** Reports screen: the same shape over an arbitrary range. */
async function getSalesReport(firmId, { fromDate, toDate } = {}) {
  const to = toDate || todayString();
  const from = fromDate || addDays(to, -(TREND_DAYS - 1));

  const [summaryRows, trendRows, paymentModes, topProducts] = await Promise.all([
    queries.findRangeSummary(pool, firmId, from, to),
    queries.findSalesTrend(pool, firmId, TREND_DAYS),
    queries.findPaymentModeSplit(pool, firmId, from, to),
    queries.findTopProducts(pool, firmId, { days: TREND_DAYS, limit: 8 }),
  ]);

  const summary = splitByChannel(summaryRows);

  return {
    fromDate: from,
    toDate: to,
    summary: {
      retail: summary.retail,
      wholesale: summary.wholesale,
      total: summary.retail + summary.wholesale,
      billCount: summary.billCount,
    },
    trend: buildTrend(trendRows, TREND_DAYS, todayString()),
    paymentModes: paymentModes.map((row) => ({
      paymentMode: row.paymentMode,
      amount: Number(row.amount),
      count: Number(row.count),
    })),
    topProducts: topProducts.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      quantity: Number(row.quantity),
      weightKg: Number(row.weightKg),
      revenue: Number(row.revenue),
    })),
  };
}

module.exports = { getDashboard, getSalesReport };
