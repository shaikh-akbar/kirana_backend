const { Router } = require('express');
const { body, param, query } = require('express-validator');
const controller = require('./purchases.controller');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { firmScope } = require('../../middlewares/firm.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

router.use(authenticate, firmScope);

const STAFF = [ROLES.ADMIN, ROLES.SALES_REP, ROLES.CASHIER];

router.get(
  '/',
  authorize(...STAFF),
  [
    query('supplierId').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
    query('paymentStatus').optional({ values: 'falsy' }).isIn(['PAID', 'PENDING', 'PARTIAL']),
    query('fromDate').optional({ values: 'falsy' }).isISO8601({ strict: true }),
    query('toDate').optional({ values: 'falsy' }).isISO8601({ strict: true }),
    query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 200 }).toInt(),
    query('offset').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt(),
  ],
  validate,
  controller.listPurchases
);

router.get('/:id', authorize(...STAFF), [param('id').isInt({ min: 1 }).toInt()], validate, controller.getPurchase);

// Posting a purchase creates stock and moves money owed, so it is not a
// cashier's action.
router.post(
  '/',
  authorize(ROLES.ADMIN, ROLES.SALES_REP),
  [
    body('supplierId').isInt({ min: 1 }).toInt(),
    body('invoiceNumber').isString().trim().notEmpty().isLength({ max: 50 }),
    body('purchaseDate').optional({ values: 'falsy' }).isISO8601({ strict: true }),
    body('paidAmount').optional().isFloat({ min: 0 }).toFloat(),
    body('items').isArray({ min: 1 }).withMessage('At least one line item is required'),
    body('items.*.productId').isInt({ min: 1 }).toInt(),
    body('items.*.unitId').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
    body('items.*.quantity').isFloat({ gt: 0 }).toFloat(),
    body('items.*.unitCostPrice').isFloat({ gt: 0 }).toFloat(),
    body('items.*.batchNumber').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
    body('items.*.mfgDate').optional({ values: 'falsy' }).isISO8601({ strict: true }),
    body('items.*.expiryDate').optional({ values: 'falsy' }).isISO8601({ strict: true }),
    body('items.*.storageLocation').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
  ],
  validate,
  controller.createPurchase
);

module.exports = router;
