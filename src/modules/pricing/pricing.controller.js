const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const pricingService = require('./pricing.service');

const dailyPriceUpdate = asyncHandler(async (req, res) => {
  const { effectiveDate, updates } = req.body;
  const result = await pricingService.bulkUpdateDailyPrices({
    effectiveDate,
    updates,
    updatedBy: req.user.id,
  });
  return new ApiResponse(200, result, 'Daily prices updated').send(res);
});

module.exports = { dailyPriceUpdate };
