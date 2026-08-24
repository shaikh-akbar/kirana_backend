const { Router } = require('express');
const { query } = require('express-validator');
const controller = require('./pricing.controller');
const { dailyPriceUpdateValidation } = require('./pricing.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

// Rates are shared across the owner's firms (both buy at the same mandi rate),
// so this read is not firm-scoped. A retailer may see the sheet — the POS shows
// the day's rate — but only ADMIN/WHOLESALER may move it.
router.get(
  '/daily',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.WHOLESALER, ROLES.RETAILER),
  [query('date').optional({ values: 'falsy' }).isISO8601({ strict: true })],
  validate,
  controller.getRateSheet
);

router.put(
  '/daily-update',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.WHOLESALER),
  dailyPriceUpdateValidation,
  validate,
  controller.dailyPriceUpdate
);

module.exports = router;
