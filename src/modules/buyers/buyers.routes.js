const { Router } = require('express');
const { body, param, query } = require('express-validator');
const controller = require('./buyers.controller');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { firmScope } = require('../../middlewares/firm.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

// Buyer rows are shared, but every balance shown next to one belongs to a
// firm, so the whole module is firm-scoped.
router.use(authenticate, firmScope);

const STAFF = [ROLES.ADMIN, ROLES.WHOLESALER];

router.get(
  '/',
  authorize(...STAFF),
  [
    query('search').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
    query('buyerType').optional({ values: 'falsy' }).isIn(['WHOLESALE', 'RETAIL']),
  ],
  validate,
  controller.listBuyers
);

router.get('/:id', authorize(...STAFF), [param('id').isInt({ min: 1 }).toInt()], validate, controller.getBuyer);

// A retailer rings up walk-in cash sales; opening a credit account is a
// commitment of the firm's money, so it stays with ADMIN and WHOLESALER.
router.post(
  '/',
  authorize(ROLES.ADMIN, ROLES.WHOLESALER),
  [
    body('name').isString().trim().notEmpty().isLength({ max: 100 }),
    body('phone').isString().trim().notEmpty().isLength({ max: 15 }),
    body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
    body('buyerType').optional().isIn(['WHOLESALE', 'RETAIL']),
    body('contactPerson').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
    body('area').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 }),
    body('address').optional({ values: 'falsy' }).isString().trim(),
    body('creditLimit').optional().isFloat({ min: 0 }).toFloat(),
  ],
  validate,
  controller.createBuyer
);

router.patch(
  '/:id',
  authorize(ROLES.ADMIN, ROLES.WHOLESALER),
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('name').optional().isString().trim().notEmpty().isLength({ max: 100 }),
    body('phone').optional().isString().trim().notEmpty().isLength({ max: 15 }),
    body('email').optional({ values: 'null' }).isEmail().normalizeEmail(),
    body('buyerType').optional().isIn(['WHOLESALE', 'RETAIL']),
    body('contactPerson').optional({ values: 'null' }).isString().trim().isLength({ max: 100 }),
    body('area').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
    body('address').optional({ values: 'null' }).isString().trim(),
    body('creditLimit').optional().isFloat({ min: 0 }).toFloat(),
    body('isActive').optional().isBoolean().toBoolean(),
  ],
  validate,
  controller.updateBuyer
);

module.exports = router;
