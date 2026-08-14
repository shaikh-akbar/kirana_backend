const { withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const { generateOrderNumber } = require('../../utils/generateCode');
const { reserveBillNumber, findSellerIdForFirm } = require('../firms/firms.queries');
const { buildOrderLines } = require('./orders.lines');
const queries = require('./orders.queries');

/**
 * Bulk/dealer billing for ONE firm: prices each line off the
 * wholesale_pricing_tiers slab matching the ordered quantity (falling back to
 * daily_price_logs when no tier matches, and overridden by an explicit
 * `unitPrice` on the line), deducts that firm's inventory in the product's base
 * unit, and - when the buyer doesn't pay in full - books the shortfall as a
 * Khata (credit) debit against their customer_ledgers balance at this firm.
 */
async function createWholesaleOrder({
  firmId,
  buyerId,
  customerName,
  customerPhone = null,
  billDate = null,
  sellerId,
  items,
  discountAmount = 0,
  taxAmount = 0,
  payment = null,
  notes = null,
}) {
  if (!firmId) {
    throw ApiError.badRequest('firmId is required');
  }
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
    const { lines, grossAmount, itemCount, totalQuantity, totalWeightKg } = await buildOrderLines(
      conn,
      items,
      async (c, productId, quantityBaseUnits) => {
        const tierPrice = await queries.getWholesaleTierPrice(c, productId, quantityBaseUnits);
        if (tierPrice != null) return tierPrice;
        const dailyPrice = await queries.getLatestDailyPrice(c, productId);
        return dailyPrice.wholesale_price;
      }
    );

    // Defaults from the firm — see retail.service for why the client does not
    // get to name the selling party.
    const resolvedSellerId = sellerId || (await findSellerIdForFirm(conn, firmId));

    const netAmount = Number((grossAmount + Number(taxAmount) - Number(discountAmount)).toFixed(2));
    const paidAmount = payment ? Number(payment.amount) : 0;
    const creditAmount = Number((netAmount - paidAmount).toFixed(2));
    const paymentStatus = paidAmount >= netAmount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';

    const { billNumber, billSequence } = await reserveBillNumber(conn, firmId);

    const orderId = await queries.insertOrder(conn, {
      firmId,
      orderNumber: generateOrderNumber('WHOLESALE'),
      billNumber,
      billSequence,
      billDate,
      channel: 'WHOLESALE',
      buyerId,
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

    for (const line of lines) {
      await queries.deductInventoryFEFO(
        conn,
        firmId,
        line.productId,
        line.quantityBaseUnits,
        'WHOLESALE_SALE',
        'ORDER',
        orderId
      );
    }

    for (const line of lines) {
      await queries.insertOrderItem(conn, { orderId, ...line });
    }

    let ledgerSummary = null;

    if (creditAmount > 0) {
      const ledger = await queries.getOrCreateLedger(conn, firmId, buyerId);
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
        description: `Credit sale on bill ${billNumber}`,
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
      billNumber,
      channel: 'WHOLESALE',
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
      ledger: ledgerSummary,
    };
  });
}

module.exports = { createWholesaleOrder };
