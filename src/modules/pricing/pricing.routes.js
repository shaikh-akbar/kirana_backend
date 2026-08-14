const { Router } = require('express');
const { query } = require('express-validator');
const controller = require('./pricing.controller');
const { dailyPriceUpdateValidation } = require('./pricing.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

// Rates are shared across the owner's firms (both buy at the same mandi rate),
// so this read is not firm-scoped. A cashier may see the sheet — the POS shows
// the day's rate — but only ADMIN/SALES_REP may move it.
router.get(
  '/daily',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.SALES_REP, ROLES.CASHIER),
  [query('date').optional({ values: 'falsy' }).isISO8601({ strict: true })],
  validate,
  controller.getRateSheet
);

router.put(
  '/daily-update',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.SALES_REP),
  dailyPriceUpdateValidation,
  validate,
  controller.dailyPriceUpdate
);

module.exports = router;
