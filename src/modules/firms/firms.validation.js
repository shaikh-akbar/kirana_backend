const { body } = require('express-validator');

// 27ABCDE1234F1Z5 -> 2 state digits, 10-char PAN, 1 entity digit, 'Z', 1 check char
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Optional statutory ids: a small kirana may be unregistered, so these are only
 * format-checked when a non-empty value is actually sent.
 */
const optionalIdentityFields = [
  body('gstin')
    .optional({ values: 'falsy' })
    .trim()
    .toUpperCase()
    .matches(GSTIN_PATTERN)
    .withMessage('gstin must be a valid 15-character GSTIN'),
  body('pan')
    .optional({ values: 'falsy' })
    .trim()
    .toUpperCase()
    .matches(PAN_PATTERN)
    .withMessage('pan must be a valid 10-character PAN'),
  body('vatTin').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
  body('fssaiNumber').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
  body('stateCode')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[0-9]{2}$/)
    .withMessage('stateCode must be the 2-digit GST state code, e.g. 27'),
  body('pincode')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[1-9][0-9]{5}$/)
    .withMessage('pincode must be 6 digits'),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 15 }),
  body('altPhone').optional({ values: 'falsy' }).trim().isLength({ max: 15 }),
  body('address').optional({ values: 'falsy' }).trim(),
  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('state').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('legalName').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
];

const invoiceSettingFields = [
  body('invoicePrefix')
    .optional({ values: 'falsy' })
    .trim()
    .toUpperCase()
    .matches(/^[A-Z0-9/-]{1,10}$/)
    .withMessage('invoicePrefix may only contain A-Z, 0-9, / and -, max 10 chars'),
  body('invoicePadding')
    .optional()
    .isInt({ min: 1, max: 12 })
    .withMessage('invoicePadding must be between 1 and 12')
    .toInt(),
  body('invoiceFooterText').optional({ values: 'falsy' }).trim(),
  body('invoiceThanksText').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
];

const createFirmValidation = [
  body('firmName')
    .isString()
    .trim()
    .isLength({ min: 3, max: 150 })
    .withMessage('firmName is required (3-150 characters)'),
  body('firmType')
    .optional()
    .isIn(['RETAIL', 'WHOLESALE', 'BOTH'])
    .withMessage('firmType must be RETAIL, WHOLESALE or BOTH'),
  // Continuing an existing paper bill book: the owner sets where the series resumes.
  body('nextBillNumber')
    .optional()
    .isInt({ min: 1 })
    .withMessage('nextBillNumber must be a positive integer')
    .toInt(),
  ...optionalIdentityFields,
  ...invoiceSettingFields,
];

const updateFirmValidation = [
  body('firmName').optional().isString().trim().isLength({ min: 3, max: 150 }),
  body('firmType').optional().isIn(['RETAIL', 'WHOLESALE', 'BOTH']),
  body('isActive').optional().isBoolean().toBoolean(),
  ...optionalIdentityFields,
  ...invoiceSettingFields,
];

module.exports = { createFirmValidation, updateFirmValidation };
