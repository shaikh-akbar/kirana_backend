const { Router } = require('express');
const retailController = require('./retail.controller');
const wholesaleController = require('./wholesale.controller');
const {
  retailOrderValidation,
  wholesaleOrderValidation,
  orderIdParamValidation,
  listOrdersValidation,
} = require('./orders.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { firmScope } = require('../../middlewares/firm.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

// Every order route is firm-scoped: a bill, its stock deduction and its bill
// number all belong to exactly one firm's books.
router.use(authenticate, firmScope);

router.post(
  '/retail',
  authorize(ROLES.ADMIN, ROLES.RETAILER, ROLES.WHOLESALER),
  retailOrderValidation,
  validate,
  retailController.createRetailOrder
);

router.post(
  '/wholesale',
  authorize(ROLES.ADMIN, ROLES.WHOLESALER),
  wholesaleOrderValidation,
  validate,
  wholesaleController.createWholesaleOrder
);

// Bill register. Declared before /:orderId so "register" is never parsed as an id.
router.get(
  '/',
  authorize(ROLES.ADMIN, ROLES.WHOLESALER, ROLES.RETAILER),
  listOrdersValidation,
  validate,
  retailController.listOrders
);

// Printable bill payload (firm header + frozen lines + payments) — used for
// print and reprint.
router.get(
  '/:orderId/invoice',
  authorize(ROLES.ADMIN, ROLES.WHOLESALER, ROLES.RETAILER),
  orderIdParamValidation,
  validate,
  retailController.getInvoice
);

module.exports = router;
