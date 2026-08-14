const { Router } = require('express');
const controller = require('./khata.controller');
const { buyerIdParamValidation, recordPaymentValidation } = require('./khata.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { firmScope } = require('../../middlewares/firm.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

// Khata balances are per (firm, buyer) — always scoped.
router.use(authenticate, firmScope);

router.get(
  '/',
  authorize(ROLES.ADMIN, ROLES.SALES_REP, ROLES.CASHIER),
  controller.listLedgers
);

router.post(
  '/payment',
  authorize(ROLES.ADMIN, ROLES.CASHIER),
  recordPaymentValidation,
  validate,
  controller.recordPayment
);

// Declared last so a literal path segment is never swallowed by :buyerId.
router.get(
  '/:buyerId',
  authorize(ROLES.ADMIN, ROLES.SALES_REP, ROLES.CASHIER),
  buyerIdParamValidation,
  validate,
  controller.getLedger
);

module.exports = router;
