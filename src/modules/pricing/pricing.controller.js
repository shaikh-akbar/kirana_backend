const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const pricingService = require('./pricing.service');

const getRateSheet = asyncHandler(async (req, res) => {
  const sheet = await pricingService.getRateSheet(req.query.date);
  return new ApiResponse(200, sheet, 'Rate sheet fetched').send(res);
});

const dailyPriceUpdate = asyncHandler(async (req, res) => {
  const { effectiveDate, updates } = req.body;
  const result = await pricingService.bulkUpdateDailyPrices({
    effectiveDate,
    updates,
    updatedBy: req.user.id,
  });
  return new ApiResponse(200, result, 'Daily prices updated').send(res);
});

module.exports = { getRateSheet, dailyPriceUpdate };
