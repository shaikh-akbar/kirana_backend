const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const inventoryService = require('./inventory.service');

const getLowStock = asyncHandler(async (req, res) => {
  const products = await inventoryService.getLowStockProducts(req.firmId);
  return new ApiResponse(200, products, 'Low stock products fetched').send(res);
});

const getBatches = asyncHandler(async (req, res) => {
  const { productId, expiringWithinDays } = req.query;
  const batches = await inventoryService.getBatches(req.firmId, { productId, expiringWithinDays });
  return new ApiResponse(200, batches, 'Inventory batches fetched').send(res);
});

const getMovements = asyncHandler(async (req, res) => {
  const movements = await inventoryService.getStockMovements(req.firmId, {
    productId: req.query.productId,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  return new ApiResponse(200, movements, 'Stock movements fetched').send(res);
});

const adjustStock = asyncHandler(async (req, res) => {
  const result = await inventoryService.adjustStock(req.firmId, req.body);
  return new ApiResponse(201, result, 'Stock adjusted').send(res);
});

module.exports = { getLowStock, getBatches, getMovements, adjustStock };
