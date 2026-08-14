const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const purchasesService = require('./purchases.service');

const listPurchases = asyncHandler(async (req, res) => {
  const result = await purchasesService.listPurchases(req.firmId, {
    supplierId: req.query.supplierId,
    paymentStatus: req.query.paymentStatus,
    fromDate: req.query.fromDate,
    toDate: req.query.toDate,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  return new ApiResponse(200, result, 'Purchase orders fetched').send(res);
});

const getPurchase = asyncHandler(async (req, res) => {
  const purchase = await purchasesService.getPurchase(req.firmId, req.params.id);
  return new ApiResponse(200, purchase, 'Purchase order fetched').send(res);
});

const createPurchase = asyncHandler(async (req, res) => {
  const purchase = await purchasesService.createPurchase(req.firmId, req.body);
  return new ApiResponse(201, purchase, 'Purchase recorded and stock booked in').send(res);
});

module.exports = { listPurchases, getPurchase, createPurchase };
