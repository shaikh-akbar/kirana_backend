const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const wholesaleService = require('./wholesale.service');

const createWholesaleOrder = asyncHandler(async (req, res) => {
  const order = await wholesaleService.createWholesaleOrder({ ...req.body, firmId: req.firmId });
  return new ApiResponse(201, order, `Bill ${order.billNumber} created`).send(res);
});

module.exports = { createWholesaleOrder };
