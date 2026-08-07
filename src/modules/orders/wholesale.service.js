const { withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const { generateOrderNumber } = require('../../utils/generateCode');
const queries = require('./orders.queries');

/**
 * Bulk/dealer billing: prices each line off the wholesale_pricing_tiers
 * slab matching the ordered quantity (falling back to daily_price_logs
 * when no tier matches), deducts inventory in the product's base unit,
 * and - when the buyer doesn't pay in full - books the shortfall as a
 * Khata (credit) debit against their customer_ledgers balance.
 */
async function createWholesaleOrder({ buyerId, sellerId, items, discountAmount = 0, taxAmount = 0, payment = null }) {
  if (!buyerId) {
    throw ApiError.badRequest('buyerId is required for wholesale orders');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('At least one order item is required');
  }
  if (payment && Number(payment.amount) > 0 && !payment.mode) {
    throw ApiError.badRequest('payment.mode is required when payment.amount is provided');
  }

  return withTransaction(async (conn) => {
    const orderItems = [];
    let grossAmount = 0;

    for (const line of items) {
      const unit = await queries.getUnitConversion(conn, line.productId, line.unitId);
      const quantity = Number(line.quantity);
      const quantityBaseUnits = quantity * Number(unit.conversion_factor);

      let pricePerBaseUnit = await queries.getWholesaleTierPrice(conn, line.productId, quantityBaseUnits);
      if (pricePerBaseUnit == null) {
        const dailyPrice = await queries.getLatestDailyPrice(conn, line.productId);
        pricePerBaseUnit = dailyPrice.wholesale_price;
      }

      const unitPrice = Number(pricePerBaseUnit) * Number(unit.conversion_factor);
      const totalPrice = Number((unitPrice * quantity).toFixed(2));

      await queries.deductInventoryFEFO(conn, line.productId, quantityBaseUnits, 'WHOLESALE_SALE', 'ORDER', null);

      grossAmount += totalPrice;
      orderItems.push({ productId: line.productId, unitId: line.unitId, quantity, unitPrice, totalPrice });
    }

    grossAmount = Number(grossAmount.toFixed(2));
    const netAmount = Number((grossAmount + Number(taxAmount) - Number(discountAmount)).toFixed(2));
    const paidAmount = payment ? Number(payment.amount) : 0;
    const creditAmount = Number((netAmount - paidAmount).toFixed(2));
    const paymentStatus = paidAmount >= netAmount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';

    const orderId = await queries.insertOrder(conn, {
      orderNumber: generateOrderNumber('WHOLESALE'),
      channel: 'WHOLESALE',
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

    let ledgerSummary = null;

    if (creditAmount > 0) {
      const ledger = await queries.getOrCreateLedger(conn, buyerId);
      const newBalance = Number((Number(ledger.current_udhaar_balance) + creditAmount).toFixed(2));

      if (Number(ledger.credit_limit) > 0 && newBalance > Number(ledger.credit_limit)) {
        throw ApiError.badRequest(
          `Order exceeds buyer's credit limit (limit ${ledger.credit_limit}, would-be balance ${newBalance})`
        );
      }

      await queries.insertLedgerTransaction(conn, {
        ledgerId: ledger.id,
        orderId,
        transactionType: 'DEBIT',
        amount: creditAmount,
        runningBalance: newBalance,
        description: `Credit sale on order ${orderId}`,
      });
      await queries.updateLedgerBalance(conn, ledger.id, newBalance);

      ledgerSummary = { ledgerId: ledger.id, creditAmount, newBalance };
    }

    if (paidAmount > 0) {
      await queries.insertPaymentTransaction(conn, {
        orderId,
        ledgerId: ledgerSummary ? ledgerSummary.ledgerId : null,
        paymentMode: payment.mode,
        amount: paidAmount,
        referenceNumber: payment.referenceNumber,
      });
    }

    return {
      orderId,
      channel: 'WHOLESALE',
      grossAmount,
      taxAmount,
      discountAmount,
      netAmount,
      paidAmount,
      paymentStatus,
      items: orderItems,
      ledger: ledgerSummary,
    };
  });
}

module.exports = { createWholesaleOrder };
