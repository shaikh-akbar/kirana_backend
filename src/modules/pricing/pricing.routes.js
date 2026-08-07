const { Router } = require('express');
const controller = require('./pricing.controller');
const { dailyPriceUpdateValidation } = require('./pricing.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

router.put(
  '/daily-update',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.SALES_REP),
  dailyPriceUpdateValidation,
  validate,
  controller.dailyPriceUpdate
);

module.exports = router;
