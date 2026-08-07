const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const khataService = require('./khata.service');

const getLedger = asyncHandler(async (req, res) => {
  const { buyerId } = req.params;
  const { limit, offset } = req.query;
  const history = await khataService.getLedgerHistory(Number(buyerId), { limit, offset });
  return new ApiResponse(200, history, 'Ledger history fetched').send(res);
});

const recordPayment = asyncHandler(async (req, res) => {
  const result = await khataService.recordPayment(req.body);
  return new ApiResponse(201, result, 'Payment recorded against Khata ledger').send(res);
});

module.exports = { getLedger, recordPayment };
