const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const reportsService = require('./reports.service');

const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await reportsService.getDashboard(req.firmId);
  return new ApiResponse(200, dashboard, 'Dashboard fetched').send(res);
});

const getSalesReport = asyncHandler(async (req, res) => {
  const report = await reportsService.getSalesReport(req.firmId, {
    fromDate: req.query.fromDate,
    toDate: req.query.toDate,
  });
  return new ApiResponse(200, report, 'Sales report fetched').send(res);
});

module.exports = { getDashboard, getSalesReport };
