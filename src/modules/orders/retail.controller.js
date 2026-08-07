const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const retailService = require('./retail.service');

const createRetailOrder = asyncHandler(async (req, res) => {
  const order = await retailService.createRetailOrder(req.body);
  return new ApiResponse(201, order, 'Retail order created').send(res);
});

module.exports = { createRetailOrder };
