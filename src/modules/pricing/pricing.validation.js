const { body } = require('express-validator');

const dailyPriceUpdateValidation = [
  body('effectiveDate').optional().isISO8601().withMessage('effectiveDate must be a valid date (YYYY-MM-DD)'),
  body('updates').isArray({ min: 1 }).withMessage('updates must be a non-empty array'),
  body('updates.*.productId').isInt({ min: 1 }).withMessage('updates[].productId is required'),
  body('updates.*.wholesalePrice').isFloat({ min: 0 }).withMessage('updates[].wholesalePrice is required'),
  body('updates.*.retailPrice').isFloat({ min: 0 }).withMessage('updates[].retailPrice is required'),
];

module.exports = { dailyPriceUpdateValidation };
