const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const buyersService = require('./buyers.service');

const listBuyers = asyncHandler(async (req, res) => {
  const buyers = await buyersService.listBuyers(req.firmId, {
    search: req.query.search,
    buyerType: req.query.buyerType,
    withLedgerOnly: req.query.withLedgerOnly === 'true',
    includeInactive: req.query.includeInactive === 'true',
  });
  return new ApiResponse(200, buyers, 'Buyers fetched').send(res);
});

const getBuyer = asyncHandler(async (req, res) => {
  const buyer = await buyersService.getBuyer(req.firmId, req.params.id);
  return new ApiResponse(200, buyer, 'Buyer fetched').send(res);
});

const createBuyer = asyncHandler(async (req, res) => {
  const buyer = await buyersService.createBuyer(req.firmId, req.body);
  return new ApiResponse(201, buyer, 'Buyer created').send(res);
});

const updateBuyer = asyncHandler(async (req, res) => {
  const buyer = await buyersService.updateBuyer(req.firmId, req.params.id, req.body);
  return new ApiResponse(200, buyer, 'Buyer updated').send(res);
});

module.exports = { listBuyers, getBuyer, createBuyer, updateBuyer };
