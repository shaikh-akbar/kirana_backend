const { body } = require('express-validator');

const itemsValidation = [
  body('sellerId').isInt({ min: 1 }).withMessage('sellerId is required'),
  body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
  body('items.*.productId').isInt({ min: 1 }).withMessage('items[].productId is required'),
  body('items.*.unitId').isInt({ min: 1 }).withMessage('items[].unitId is required'),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('items[].quantity must be greater than 0'),
  body('discountAmount').optional().isFloat({ min: 0 }),
  body('taxAmount').optional().isFloat({ min: 0 }),
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

module.exports = { retailOrderValidation, wholesaleOrderValidation };
