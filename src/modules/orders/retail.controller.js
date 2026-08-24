const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const retailService = require('./retail.service');

/**
 * firmId comes from req.firmId (set by firmScope from the X-Firm-Id header),
 * never from the body — otherwise a caller could bill against a firm they have
 * no access to just by naming its id.
 */
const createRetailOrder = asyncHandler(async (req, res) => {
  const order = await retailService.createRetailOrder({ ...req.body, firmId: req.firmId });
  return new ApiResponse(201, order, `Bill ${order.billNumber} created`).send(res);
});

const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await retailService.getInvoice(req.firmId, Number(req.params.orderId));
  return new ApiResponse(200, invoice, 'Invoice').send(res);
});

const listOrders = asyncHandler(async (req, res) => {
  const { channel, search, paymentStatus, orderStatus, fromDate, toDate, limit, offset } = req.query;
  const result = await retailService.listOrders(req.firmId, {
    channel,
    search,
    paymentStatus,
    orderStatus,
    fromDate,
    toDate,
    limit,
    offset,
  });
  return new ApiResponse(200, result, 'Bill register').send(res);
});

module.exports = { createRetailOrder, getInvoice, listOrders };
