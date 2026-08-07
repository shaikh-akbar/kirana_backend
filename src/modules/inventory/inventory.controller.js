const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const inventoryService = require('./inventory.service');

const getLowStock = asyncHandler(async (req, res) => {
  const products = await inventoryService.getLowStockProducts();
  return new ApiResponse(200, products, 'Low stock products fetched').send(res);
});

module.exports = { getLowStock };
