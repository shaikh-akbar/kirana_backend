const { body, param, query } = require('express-validator');

// Mirrors the ENUM on product_units.unit_name — an unlisted value is rejected
// here with a readable message instead of surfacing as a raw MySQL error.
const UNIT_NAMES = ['KG', 'GRAM', 'BAG', 'QUINTAL', 'BOX', 'PACKET'];

const idParam = [param('id').isInt({ min: 1 }).toInt()];

const listProductsValidation = [
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  query('categoryId').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
];

const productUnitRules = (field) => [
  body(`${field}`).optional().isArray({ max: 10 }).withMessage('units must be an array'),
  body(`${field}.*.unitName`).isIn(UNIT_NAMES).withMessage(`unitName must be one of ${UNIT_NAMES.join(', ')}`),
  body(`${field}.*.conversionFactor`).optional().isFloat({ gt: 0 }).toFloat(),
  body(`${field}.*.isBaseUnit`).optional().isBoolean().toBoolean(),
];

const pricingTierRules = (field) => [
  body(`${field}`).optional().isArray({ max: 20 }).withMessage('tiers must be an array'),
  body(`${field}.*.minQuantity`).isFloat({ min: 0 }).toFloat(),
  body(`${field}.*.maxQuantity`).optional({ values: 'null' }).isFloat({ min: 0 }).toFloat(),
  body(`${field}.*.tierPrice`).isFloat({ gt: 0 }).toFloat(),
];

const createProductValidation = [
  body('name').isString().trim().notEmpty().isLength({ max: 150 }),
  body('sku').isString().trim().notEmpty().isLength({ max: 50 }),
  body('barcode').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
  body('categoryId').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
  body('hsnCode').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }),
  body('minStockAlert').optional().isFloat({ min: 0 }).toFloat(),
  body('isActive').optional().isBoolean().toBoolean(),
  ...productUnitRules('units'),
  ...pricingTierRules('tiers'),
];

const updateProductValidation = [
  ...idParam,
  body('name').optional().isString().trim().notEmpty().isLength({ max: 150 }),
  body('sku').optional().isString().trim().notEmpty().isLength({ max: 50 }),
  body('barcode').optional({ values: 'null' }).isString().trim().isLength({ max: 50 }),
  body('categoryId').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
  body('hsnCode').optional({ values: 'null' }).isString().trim().isLength({ max: 20 }),
  body('minStockAlert').optional().isFloat({ min: 0 }).toFloat(),
  body('isActive').optional().isBoolean().toBoolean(),
  ...productUnitRules('units'),
  ...pricingTierRules('tiers'),
];

const createCategoryValidation = [
  body('name').isString().trim().notEmpty().isLength({ max: 100 }),
  body('parentId').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
  body('status').optional().isIn(['ACTIVE', 'INACTIVE']),
];

const updateCategoryValidation = [
  ...idParam,
  body('name').optional().isString().trim().notEmpty().isLength({ max: 100 }),
  body('parentId').optional({ values: 'null' }).isInt({ min: 1 }).toInt(),
  body('status').optional().isIn(['ACTIVE', 'INACTIVE']),
];

const createSupplierValidation = [
  body('vendorName').isString().trim().notEmpty().isLength({ max: 150 }),
  body('phone').optional({ values: 'falsy' }).isString().trim().isLength({ max: 15 }),
  body('gstin').optional({ values: 'falsy' }).isString().trim().isLength({ max: 15 }),
  body('address').optional({ values: 'falsy' }).isString().trim(),
  body('openingBalance').optional().isFloat({ min: 0 }).toFloat(),
];

const updateSupplierValidation = [
  ...idParam,
  body('vendorName').optional().isString().trim().notEmpty().isLength({ max: 150 }),
  body('phone').optional({ values: 'null' }).isString().trim().isLength({ max: 15 }),
  body('gstin').optional({ values: 'null' }).isString().trim().isLength({ max: 15 }),
  body('address').optional({ values: 'null' }).isString().trim(),
];

module.exports = {
  UNIT_NAMES,
  idParam,
  listProductsValidation,
  createProductValidation,
  updateProductValidation,
  createCategoryValidation,
  updateCategoryValidation,
  createSupplierValidation,
  updateSupplierValidation,
};
