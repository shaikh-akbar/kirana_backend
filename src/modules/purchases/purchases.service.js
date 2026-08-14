const { pool, withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const queries = require('./purchases.queries');

/**
 * A purchase order here is a *goods-received* document, not a request sent to a
 * supplier: posting one creates the stock. That is what a kirana actually does
 * — the supplier's delivery slip is keyed in when the sacks land, and stock has
 * to be sellable the same minute. So a PO write is a single transaction over
 * four tables (order, lines, batches, movements) plus the supplier's payable;
 * committing any subset would leave the godown and the books disagreeing.
 */

function paymentStatusFor(totalAmount, paidAmount) {
  if (paidAmount <= 0) return 'PENDING';
  // Rounded to paise before comparing: DECIMAL(10,2) columns cannot hold the
  // sub-paise residue a float multiplication leaves behind, so an exact-payment
  // bill would otherwise land as PARTIAL and haunt the supplier ledger.
  if (Math.round(paidAmount * 100) >= Math.round(totalAmount * 100)) return 'PAID';
  return 'PARTIAL';
}

/**
 * Batch numbers come off the supplier's carton when there is one. When there
 * is not — loose grain out of a sack — the invoice number plus the line number
 * is a stable, human-traceable substitute that still points back at one
 * delivery.
 */
function fallbackBatchNumber(invoiceNumber, lineNo) {
  return `${String(invoiceNumber).slice(0, 44)}-${lineNo}`;
}

async function listPurchases(firmId, filters) {
  const { rows, total } = await queries.listPurchaseOrders(pool, firmId, filters);

  const items = await queries.findItemsForPurchaseOrders(pool, rows.map((r) => r.id));
  const byOrder = new Map();
  for (const item of items) {
    if (!byOrder.has(item.purchaseOrderId)) byOrder.set(item.purchaseOrderId, []);
    byOrder.get(item.purchaseOrderId).push(item);
  }

  return {
    rows: rows.map((row) => ({
      ...row,
      totalQty: Number(row.totalQty),
      items: byOrder.get(row.id) || [],
    })),
    total,
  };
}

async function getPurchase(firmId, id) {
  const order = await queries.findPurchaseOrderById(pool, firmId, id);
  if (!order) throw ApiError.notFound(`Purchase order ${id} not found for this firm`);

  const items = await queries.findItemsForPurchaseOrders(pool, [order.id]);
  return { ...order, items };
}

/**
 * Posts a supplier bill: books the stock in, and books what is still owed for
 * it onto the supplier's balance.
 */
async function createPurchase(firmId, input) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw ApiError.badRequest('A purchase must have at least one line item');
  }

  const purchaseDate = input.purchaseDate || new Date().toISOString().slice(0, 10);

  const purchaseOrderId = await withTransaction(async (conn) => {
    const supplier = await queries.findSupplierForUpdate(conn, input.supplierId);
    if (!supplier) throw ApiError.badRequest(`Supplier ${input.supplierId} does not exist`);

    // Lines are priced before the header is written, because the header stores
    // the total.
    const lines = [];
    let totalAmount = 0;

    for (const [index, item] of input.items.entries()) {
      const { product, baseUnit, unit } = await queries.getProductForPurchase(
        conn,
        item.productId,
        item.unitId
      );

      // Batch quantities are always in the product's base unit — that is the
      // unit FEFO deducts in at checkout. A line keyed in as "10 BAG" is
      // converted here rather than at every read site.
      const factor = unit ? Number(unit.conversion_factor) : 1;
      const quantityBase = Number((Number(item.quantity) * factor).toFixed(3));
      if (quantityBase <= 0) {
        throw ApiError.badRequest(`Line ${index + 1} (${product.name}) has no quantity`);
      }

      const costPerBaseUnit = Number((Number(item.unitCostPrice) / factor).toFixed(4));
      const lineTotal = Number((quantityBase * costPerBaseUnit).toFixed(2));
      totalAmount += lineTotal;

      lines.push({
        productId: product.id,
        productName: product.name,
        quantityBase,
        costPerBaseUnit,
        lineTotal,
        baseUnitName: baseUnit ? baseUnit.unit_name : null,
        batchNumber: item.batchNumber || null,
        mfgDate: item.mfgDate || null,
        expiryDate: item.expiryDate || null,
        storageLocation: item.storageLocation || null,
      });
    }

    totalAmount = Number(totalAmount.toFixed(2));
    const paidAmount = Number(input.paidAmount || 0);
    if (paidAmount > totalAmount) {
      throw ApiError.badRequest(
        `Paid amount ${paidAmount} exceeds the bill total ${totalAmount} — record the excess as an advance instead`
      );
    }

    let orderId;
    try {
      orderId = await queries.insertPurchaseOrder(conn, {
        firmId,
        supplierId: input.supplierId,
        totalAmount,
        paidAmount,
        paymentStatus: paymentStatusFor(totalAmount, paidAmount),
        invoiceNumber: input.invoiceNumber,
        purchaseDate,
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw ApiError.conflict(
          `Invoice ${input.invoiceNumber} has already been entered for this firm`
        );
      }
      throw err;
    }

    for (const [index, line] of lines.entries()) {
      const batchId = await queries.insertBatch(conn, {
        firmId,
        productId: line.productId,
        supplierId: input.supplierId,
        batchNumber: line.batchNumber || fallbackBatchNumber(input.invoiceNumber, index + 1),
        mfgDate: line.mfgDate,
        expiryDate: line.expiryDate,
        costPrice: line.costPerBaseUnit,
        quantity: line.quantityBase,
        storageLocation: line.storageLocation,
      });

      await queries.insertPurchaseOrderItem(conn, {
        purchaseOrderId: orderId,
        productId: line.productId,
        batchId,
        quantity: line.quantityBase,
        unitCostPrice: line.costPerBaseUnit,
        totalPrice: line.lineTotal,
      });

      // Positive quantity = stock in. The reference pair is what makes a
      // movement traceable back to the delivery that caused it.
      await queries.insertStockMovement(conn, {
        firmId,
        productId: line.productId,
        batchId,
        movementType: 'PURCHASE',
        quantity: line.quantityBase,
        referenceType: 'PURCHASE_ORDER',
        referenceId: orderId,
      });
    }

    await queries.addSupplierBalance(conn, input.supplierId, Number((totalAmount - paidAmount).toFixed(2)));

    return orderId;
  });

  return getPurchase(firmId, purchaseOrderId);
}

module.exports = { listPurchases, getPurchase, createPurchase, paymentStatusFor };
