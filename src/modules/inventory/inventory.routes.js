const { Router } = require('express');
const { body, query } = require('express-validator');
const controller = require('./inventory.controller');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { firmScope } = require('../../middlewares/firm.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

// Stock belongs to a firm's godown, so every read here is firm-scoped.
router.use(authenticate, firmScope);

const STAFF = [ROLES.ADMIN, ROLES.WHOLESALER, ROLES.RETAILER];

router.get('/low-stock', authorize(...STAFF), controller.getLowStock);

router.get(
  '/batches',
  authorize(...STAFF),
  [
    query('productId').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
    query('expiringWithinDays').optional({ values: 'falsy' }).isInt({ min: 0, max: 3650 }).toInt(),
  ],
  validate,
  controller.getBatches
);

router.get(
  '/movements',
  authorize(...STAFF),
  [
    query('productId').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
    query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 500 }).toInt(),
    query('offset').optional({ values: 'falsy' }).isInt({ min: 0 }).toInt(),
  ],
  validate,
  controller.getMovements
);

/**
 * Opening stock, recounts and write-offs. Restricted to ADMIN and WHOLESALER:
 * this is the one write that can conjure stock out of nothing, so it must not
 * sit behind the same role that merely rings up sales.
 */
router.post(
  '/adjust',
  authorize(ROLES.ADMIN, ROLES.WHOLESALER),
  [
    body('productId').isInt({ min: 1 }).toInt(),
    body('quantity').isFloat().toFloat().custom((value) => {
      if (Number(value) === 0) throw new Error('quantity must not be zero');
      return true;
    }),
    body('movementType').optional().isIn(['ADJUSTMENT', 'DAMAGE', 'RETURN', 'LOOSE_CONVERSION']),
    body('batchNumber').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
    body('mfgDate').optional({ values: 'falsy' }).isISO8601({ strict: true }),
    body('expiryDate').optional({ values: 'falsy' }).isISO8601({ strict: true }),
    body('costPrice').optional().isFloat({ min: 0 }).toFloat(),
    body('storageLocation').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
  ],
  validate,
  controller.adjustStock
);

module.exports = router;
