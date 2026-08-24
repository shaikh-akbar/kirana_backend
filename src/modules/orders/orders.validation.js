const { body, param, query } = require('express-validator');

const itemsValidation = [
  // Optional: the selling party is a property of the firm being billed for, and
  // the firm row already records it. A client that had to name a sellerId could
  // also name someone else's, attributing the bill to the wrong seller — so it
  // defaults from the firm and is only accepted as an explicit override.
  body('sellerId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.productId').isInt({ min: 1 }).withMessage('items[].productId is required'),
  body('items.*.unitId').isInt({ min: 1 }).withMessage('items[].unitId is required'),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('items[].quantity must be greater than 0'),
  // Counter-typed rate for this line, per the selected unit. Omit to fall back
  // to the stored daily/tier rate. 0 is allowed: free/replacement goods still
  // appear on the bill.
  body('items.*.unitPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('items[].unitPrice must be 0 or greater'),
  body('discountAmount').optional().isFloat({ min: 0 }),
  body('taxAmount').optional().isFloat({ min: 0 }),
  body('customerName').optional({ values: 'falsy' }).isString().trim().isLength({ max: 150 }),
  body('customerPhone').optional({ values: 'falsy' }).isString().trim().isLength({ max: 15 }),
  // Back-dating a bill is legitimate (entering a day-book written offline), so
  // this is accepted but must be a real datetime.
  body('billDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('billDate must be an ISO 8601 date or datetime'),
  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 255 }),
];

const retailOrderValidation = [
  ...itemsValidation,
  body('buyerId').optional({ values: 'null' }).isInt({ min: 1 }),
  body('payment.mode').isIn(['CASH', 'UPI', 'CARD', 'NET_BANKING', 'CHEQUE']).withMessage('valid payment.mode is required'),
  body('payment.amount').isFloat({ min: 0 }).withMessage('payment.amount is required'),
];

const wholesaleOrderValidation = [
  ...itemsValidation,
  body('buyerId').isInt({ min: 1 }).withMessage('buyerId is required for wholesale orders'),
  body('payment.mode').optional().isIn(['CASH', 'UPI', 'CARD', 'NET_BANKING', 'CHEQUE']),
  body('payment.amount').optional().isFloat({ min: 0 }),
];

const orderIdParamValidation = [
  param('orderId').isInt({ min: 1 }).withMessage('orderId must be a positive integer'),
];

const listOrdersValidation = [
  query('channel').optional({ values: 'falsy' }).isIn(['RETAIL', 'WHOLESALE']),
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  query('paymentStatus').optional({ values: 'falsy' }).isIn(['PAID', 'PARTIAL', 'UNPAID']),
  query('orderStatus').optional({ values: 'falsy' }).isIn(['PENDING', 'COMPLETED', 'CANCELLED']),
  query('fromDate').optional({ values: 'falsy' }).isISO8601().withMessage('fromDate must be YYYY-MM-DD'),
  query('toDate').optional({ values: 'falsy' }).isISO8601().withMessage('toDate must be YYYY-MM-DD'),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
];

module.exports = {
  retailOrderValidation,
  wholesaleOrderValidation,
  orderIdParamValidation,
  listOrdersValidation,
};
