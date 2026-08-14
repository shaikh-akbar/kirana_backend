const queries = require('./orders.queries');

/**
 * Turns request line items into billable order lines, and rolls up the totals
 * the bill footer prints ("Items 3 / Total Qty 9 / Total Wtt.: 0.000Kg").
 *
 * Shared by retail and wholesale because everything except *how the rate is
 * decided* is identical between the two channels; the caller passes that in as
 * `resolvePricePerBaseUnit`.
 *
 * Rate precedence — an explicit `line.unitPrice` always wins. This is not a
 * convenience: a kirana counter types the day's rate straight onto the bill
 * (the client's own bills show hand-set rates like 114.00 for tuwar daal), and
 * a system that could only bill yesterday's stored rate would be unusable.
 * `unitPrice` is the rate per *selected* unit, exactly as printed in the Rate
 * column, so a rate for a BAG is not silently divided down to a per-kg figure.
 *
 * @param {object} conn                       active transactional connection
 * @param {Array}  items                      [{ productId, unitId, quantity, unitPrice? }]
 * @param {Function} resolvePricePerBaseUnit  async (conn, productId, quantityBaseUnits) => number
 */
async function buildOrderLines(conn, items, resolvePricePerBaseUnit) {
  const lines = [];
  let grossAmount = 0;
  let totalQuantity = 0;
  let totalWeightKg = 0;

  for (let index = 0; index < items.length; index += 1) {
    const line = items[index];

    const product = await queries.getProductForBilling(conn, line.productId);
    const unit = await queries.getUnitConversion(conn, line.productId, line.unitId);
    const baseUnit = await queries.getBaseUnit(conn, line.productId);

    const quantity = Number(line.quantity);
    const quantityBaseUnits = quantity * Number(unit.conversion_factor);

    let unitPrice;
    if (line.unitPrice != null) {
      unitPrice = Number(line.unitPrice);
    } else {
      const pricePerBaseUnit = await resolvePricePerBaseUnit(conn, line.productId, quantityBaseUnits);
      unitPrice = Number(pricePerBaseUnit) * Number(unit.conversion_factor);
    }

    const totalPrice = Number((unitPrice * quantity).toFixed(2));
    // Weight is derived from the base unit, not the selected one: a BAG's
    // conversion_factor says how many base units it holds, not its weight.
    const weightKg = baseUnit ? queries.baseUnitsToKg(baseUnit.unit_name, quantityBaseUnits) : 0;

    lines.push({
      lineNo: index + 1,
      productId: product.id,
      // Frozen so a reprint matches the original paper even if the product
      // is renamed later.
      description: product.name,
      unitId: unit.id,
      unitLabel: unit.unit_name,
      quantity,
      quantityBaseUnits,
      weightKg,
      unitPrice: Number(unitPrice.toFixed(2)),
      totalPrice,
    });

    grossAmount += totalPrice;
    totalQuantity += quantity;
    totalWeightKg += weightKg;
  }

  return {
    lines,
    grossAmount: Number(grossAmount.toFixed(2)),
    itemCount: lines.length,
    totalQuantity: Number(totalQuantity.toFixed(3)),
    totalWeightKg: Number(totalWeightKg.toFixed(3)),
  };
}

module.exports = { buildOrderLines };
