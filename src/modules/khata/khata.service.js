const { pool, withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const queries = require('./khata.queries');

async function getLedgerHistory(buyerId, pagination) {
  const ledger = await queries.getLedgerByBuyerId(pool, buyerId);
  if (!ledger) {
    throw ApiError.notFound(`No Khata ledger found for buyer ${buyerId}`);
  }

  const transactions = await queries.getLedgerTransactions(pool, ledger.id, pagination);
  return { ledger, transactions };
}

/**
 * Records a full or partial credit repayment: books a CREDIT entry against
 * the buyer's Khata ledger, updates the running balance, and logs the
 * actual money movement in payment_transactions.
 */
async function recordPayment({ buyerId, amount, mode, referenceNumber }) {
  if (!(Number(amount) > 0)) {
    throw ApiError.badRequest('amount must be greater than 0');
  }

  return withTransaction(async (conn) => {
    const ledger = await queries.getLedgerByBuyerIdForUpdate(conn, buyerId);
    if (!ledger) {
      throw ApiError.notFound(`No Khata ledger found for buyer ${buyerId}`);
    }

    const newBalance = Number((Number(ledger.current_udhaar_balance) - Number(amount)).toFixed(2));

    await queries.insertLedgerTransaction(conn, {
      ledgerId: ledger.id,
      orderId: null,
      transactionType: 'CREDIT',
      amount,
      runningBalance: newBalance,
      description: `Repayment via ${mode}`,
    });
    await queries.updateLedgerBalance(conn, ledger.id, newBalance);
    await queries.insertPaymentTransaction(conn, {
      orderId: null,
      ledgerId: ledger.id,
      paymentMode: mode,
      amount,
      referenceNumber,
    });

    return { ledgerId: ledger.id, buyerId, amountPaid: Number(amount), newBalance };
  });
}

module.exports = { getLedgerHistory, recordPayment };
