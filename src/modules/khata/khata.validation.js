const { param, body } = require('express-validator');

const buyerIdParamValidation = [param('buyerId').isInt({ min: 1 }).withMessage('buyerId must be a valid id')];

const recordPaymentValidation = [
  body('buyerId').isInt({ min: 1 }).withMessage('buyerId is required'),
  body('amount').isFloat({ gt: 0 }).withMessage('amount must be greater than 0'),
  body('mode').isIn(['CASH', 'UPI', 'CARD', 'NET_BANKING', 'CHEQUE']).withMessage('valid mode is required'),
  body('referenceNumber').optional({ values: 'falsy' }).isString(),
];

module.exports = { buyerIdParamValidation, recordPaymentValidation };
