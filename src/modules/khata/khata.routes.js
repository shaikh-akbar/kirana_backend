const { Router } = require('express');
const controller = require('./khata.controller');
const { buyerIdParamValidation, recordPaymentValidation } = require('./khata.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

router.get(
  '/:buyerId',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.SALES_REP, ROLES.CASHIER),
  buyerIdParamValidation,
  validate,
  controller.getLedger
);

router.post(
  '/payment',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CASHIER),
  recordPaymentValidation,
  validate,
  controller.recordPayment
);

module.exports = router;
