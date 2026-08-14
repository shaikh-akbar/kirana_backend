const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const khataService = require('./khata.service');

const listLedgers = asyncHandler(async (req, res) => {
  const ledgers = await khataService.listLedgers(req.firmId);
  return new ApiResponse(200, ledgers, 'Khata accounts fetched').send(res);
});

const getLedger = asyncHandler(async (req, res) => {
  const { buyerId } = req.params;
  const { limit, offset } = req.query;
  const history = await khataService.getLedgerHistory(req.firmId, Number(buyerId), { limit, offset });
  return new ApiResponse(200, history, 'Ledger history fetched').send(res);
});

const recordPayment = asyncHandler(async (req, res) => {
  const result = await khataService.recordPayment({ ...req.body, firmId: req.firmId });
  return new ApiResponse(201, result, 'Payment recorded against Khata ledger').send(res);
});

module.exports = { listLedgers, getLedger, recordPayment };
