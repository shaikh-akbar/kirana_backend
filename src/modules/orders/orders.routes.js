const { Router } = require('express');
const retailController = require('./retail.controller');
const wholesaleController = require('./wholesale.controller');
const { retailOrderValidation, wholesaleOrderValidation } = require('./orders.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

router.post(
  '/retail',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CASHIER, ROLES.SALES_REP),
  retailOrderValidation,
  validate,
  retailController.createRetailOrder
);

router.post(
  '/wholesale',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.SALES_REP),
  wholesaleOrderValidation,
  validate,
  wholesaleController.createWholesaleOrder
);

module.exports = router;
