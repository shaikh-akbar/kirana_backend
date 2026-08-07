const { withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const { generateOrderNumber } = require('../../utils/generateCode');
const queries = require('./orders.queries');

/**
 * POS billing: fast checkout for walk-in / retail customers.
 * - Prices each line off today's daily_price_logs.retail_price.
 * - Deducts inventory batches FEFO and logs a stock_movement per batch touched.
 * - Records the payment immediately (retail sales are paid at the counter).
 */
async function createRetailOrder({ buyerId = null, sellerId, items, discountAmount = 0, taxAmount = 0, payment }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('At least one order item is required');
  }
  if (!payment || !payment.mode || payment.amount == null) {
    throw ApiError.badRequest('payment.mode and payment.amount are required for a retail sale');
  }

  return withTransaction(async (conn) => {
    const orderItems = [];
    let grossAmount = 0;

    for (const line of items) {
      const unit = await queries.getUnitConversion(conn, line.productId, line.unitId);
      const dailyPrice = await queries.getLatestDailyPrice(conn, line.productId);

      const quantity = Number(line.quantity);
      const quantityBaseUnits = quantity * Number(unit.conversion_factor);
      const unitPrice = Number(dailyPrice.retail_price) * Number(unit.conversion_factor);
      const totalPrice = Number((unitPrice * quantity).toFixed(2));

      await queries.deductInventoryFEFO(conn, line.productId, quantityBaseUnits, 'RETAIL_SALE', 'ORDER', null);

      grossAmount += totalPrice;
      orderItems.push({ productId: line.productId, unitId: line.unitId, quantity, unitPrice, totalPrice });
    }

    grossAmount = Number(grossAmount.toFixed(2));
    const netAmount = Number((grossAmount + Number(taxAmount) - Number(discountAmount)).toFixed(2));
    const paidAmount = Number(payment.amount);
    const paymentStatus = paidAmount >= netAmount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';

    const orderId = await queries.insertOrder(conn, {
      orderNumber: generateOrderNumber('RETAIL'),
      channel: 'RETAIL',
      buyerId,
      sellerId,
      grossAmount,
      taxAmount,
      discountAmount,
      netAmount,
      paymentStatus,
      orderStatus: 'COMPLETED',
    });

    for (const item of orderItems) {
      await queries.insertOrderItem(conn, { orderId, ...item });
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
      channel: 'RETAIL',
      grossAmount,
      taxAmount,
      discountAmount,
      netAmount,
      paidAmount,
      paymentStatus,
      items: orderItems,
    };
  });
}

module.exports = { createRetailOrder };
