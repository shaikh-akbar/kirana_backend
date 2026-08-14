const { pool, withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const queries = require('./inventory.queries');
// FEFO deduction lives with the order flow that first needed it. A stock write-
// off must consume batches in exactly the same order a sale does, so this
// reuses that implementation rather than keeping a second copy in step.
const { deductInventoryFEFO } = require('../orders/orders.queries');

async function getLowStockProducts(firmId) {
  return queries.findLowStockProducts(pool, firmId);
}

async function getBatches(firmId, filters) {
  return queries.findBatches(pool, firmId, filters);
}

async function getStockMovements(firmId, filters) {
  return queries.findStockMovements(pool, firmId, filters);
}

/**
 * Moves stock without a sale or a supplier bill behind it: opening stock when a
 * firm is first set up, a recount, or spoilage written off.
 *
 * The sign of `quantity` decides the direction, because that is how the
 * `stock_movements` ledger already reads (positive = in, negative = out) and a
 * separate direction flag could contradict it.
 */
async function adjustStock(firmId, input) {
  const quantity = Number(input.quantity);
  if (!quantity) throw ApiError.badRequest('quantity must be a non-zero number');

  const movementType = input.movementType || (quantity > 0 ? 'ADJUSTMENT' : 'DAMAGE');

  return withTransaction(async (conn) => {
    const product = await queries.findProductForAdjustment(conn, input.productId);
    if (!product) throw ApiError.badRequest(`Product ${input.productId} does not exist or is inactive`);

    if (quantity > 0) {
      // Stock in has no existing batch to attach to — expiry and cost differ per
      // intake — so it opens one, exactly as a purchase would.
      const batchId = await queries.insertAdjustmentBatch(conn, {
        firmId,
        productId: product.id,
        batchNumber: input.batchNumber || `OPEN-${new Date().toISOString().slice(0, 10)}`,
        mfgDate: input.mfgDate || null,
        expiryDate: input.expiryDate || null,
        costPrice: input.costPrice != null ? input.costPrice : 0,
        quantity,
        storageLocation: input.storageLocation || null,
      });

      await queries.insertStockMovement(conn, {
        firmId,
        productId: product.id,
        batchId,
        movementType,
        quantity,
        referenceType: 'MANUAL',
        referenceId: null,
      });

      return {
        productId: product.id,
        productName: product.name,
        movementType,
        quantity,
        batchId,
      };
    }

    // Stock out: deductInventoryFEFO writes one movement per batch it touches
    // and throws if the firm does not hold enough, which is what stops a
    // write-off from driving a batch negative.
    const deductions = await deductInventoryFEFO(
      conn,
      firmId,
      product.id,
      Math.abs(quantity),
      movementType,
      'MANUAL',
      null
    );

    return {
      productId: product.id,
      productName: product.name,
      movementType,
      quantity,
      batches: deductions,
    };
  });
}

module.exports = { getLowStockProducts, getBatches, getStockMovements, adjustStock };
