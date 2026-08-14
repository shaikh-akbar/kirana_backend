const { pool, withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const { generateOrderNumber } = require('../../utils/generateCode');
const { reserveBillNumber, findSellerIdForFirm } = require('../firms/firms.queries');
const { buildOrderLines } = require('./orders.lines');
const queries = require('./orders.queries');

/**
 * POS billing: fast checkout for walk-in / retail customers of ONE firm.
 * - Rates come from the line's `unitPrice` when the counter types one, else
 *   from today's daily_price_logs.retail_price.
 * - Reserves the firm's next sequential bill number (the number printed on the
 *   paper bill).
 * - Deducts that firm's inventory batches FEFO and logs a stock_movement per
 *   batch touched, each traceable back to the order.
 * - Records the payment immediately (retail sales are paid at the counter).
 */
async function createRetailOrder({
  firmId,
  buyerId = null,
  customerName,
  customerPhone = null,
  billDate = null,
  sellerId,
  items,
  discountAmount = 0,
  taxAmount = 0,
  payment,
  notes = null,
}) {
  if (!firmId) {
    throw ApiError.badRequest('firmId is required');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('At least one order item is required');
  }
  if (!payment || !payment.mode || payment.amount == null) {
    throw ApiError.badRequest('payment.mode and payment.amount are required for a retail sale');
  }

  return withTransaction(async (conn) => {
    const { lines, grossAmount, itemCount, totalQuantity, totalWeightKg } = await buildOrderLines(
      conn,
      items,
      async (c, productId) => {
        const dailyPrice = await queries.getLatestDailyPrice(c, productId);
        return dailyPrice.retail_price;
      }
    );

    // The firm owns the seller relationship; the body may override it, but a
    // POS screen has no reason to know a seller id.
    const resolvedSellerId = sellerId || (await findSellerIdForFirm(conn, firmId));

    const netAmount = Number((grossAmount + Number(taxAmount) - Number(discountAmount)).toFixed(2));
    const paidAmount = Number(payment.amount);
    const paymentStatus = paidAmount >= netAmount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';

    // Locks the firm row and advances its counter; rolls back with the order so
    // a failed checkout never burns a bill number.
    const { billNumber, billSequence } = await reserveBillNumber(conn, firmId);

    const orderId = await queries.insertOrder(conn, {
      firmId,
      orderNumber: generateOrderNumber('RETAIL'),
      billNumber,
      billSequence,
      billDate,
      channel: 'RETAIL',
      buyerId,
      // A walk-in sale has no buyer row but the bill still prints a payee.
      customerName: customerName || 'CASH',
      customerPhone,
      sellerId: resolvedSellerId,
      grossAmount,
      taxAmount,
      discountAmount,
      netAmount,
      itemCount,
      totalQuantity,
      totalWeightKg,
      paymentStatus,
      orderStatus: 'COMPLETED',
      notes,
    });

    // Deduction happens after the insert so every stock_movement carries the
    // order id it was caused by — without it the audit trail is untraceable.
    for (const line of lines) {
      await queries.deductInventoryFEFO(
        conn,
        firmId,
        line.productId,
        line.quantityBaseUnits,
        'RETAIL_SALE',
        'ORDER',
        orderId
      );
    }

    for (const line of lines) {
      await queries.insertOrderItem(conn, { orderId, ...line });
    }

    if (paidAmount > 0) {
      await queries.insertPaymentTransaction(conn, {
        orderId,
        ledgerId: null,
        paymentMode: payment.mode,
        amount: paidAmount,
        referenceNumber: payment.referenceNumber,
      });
    }

    return {
      orderId,
      billNumber,
      channel: 'RETAIL',
      grossAmount,
      taxAmount,
      discountAmount,
      netAmount,
      itemCount,
      totalQuantity,
      totalWeightKg,
      paidAmount,
      paymentStatus,
      items: lines,
    };
  });
}

/** Printable bill payload — firm header, totals, frozen lines, payments. */
async function getInvoice(firmId, orderId) {
  return queries.getInvoice(pool, firmId, orderId);
}

/** Bill register for the firm, filterable by channel and bill-date range. */
async function listOrders(firmId, filters) {
  return queries.listOrders(pool, firmId, filters);
}

module.exports = { createRetailOrder, getInvoice, listOrders };
