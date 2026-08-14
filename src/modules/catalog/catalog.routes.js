const { Router } = require('express');
const controller = require('./catalog.controller');
const validation = require('./catalog.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { firmScope } = require('../../middlewares/firm.middleware');
const { ROLES } = require('../../constants/roles');

/**
 * Three routers, one module: categories, products and suppliers are all the
 * shared catalog, edited from the same screens, and share the query file.
 * They are mounted under separate paths in routes/index.js.
 *
 * Only ADMIN may write the catalog — a cashier keying in a new product would
 * quietly change what every firm under the owner sells. Reads are open to all
 * staff, since POS and stock screens need them.
 */

const STAFF = [ROLES.ADMIN, ROLES.SALES_REP, ROLES.CASHIER];

/* ------------------------------------------------------------------ */

const categoriesRouter = Router();
categoriesRouter.use(authenticate);

categoriesRouter.get('/', authorize(...STAFF), controller.listCategories);

categoriesRouter.post(
  '/',
  authorize(ROLES.ADMIN),
  validation.createCategoryValidation,
  validate,
  controller.createCategory
);

categoriesRouter.patch(
  '/:id',
  authorize(ROLES.ADMIN),
  validation.updateCategoryValidation,
  validate,
  controller.updateCategory
);

/* ------------------------------------------------------------------ */

const productsRouter = Router();
// Products carry stock-on-hand and the firm's current rate, so the listing is
// firm-aware even though the catalog rows themselves are shared.
productsRouter.use(authenticate, firmScope);

productsRouter.get(
  '/',
  authorize(...STAFF),
  validation.listProductsValidation,
  validate,
  controller.listProducts
);

productsRouter.get('/:id', authorize(...STAFF), validation.idParam, validate, controller.getProduct);

productsRouter.post(
  '/',
  authorize(ROLES.ADMIN),
  validation.createProductValidation,
  validate,
  controller.createProduct
);

productsRouter.patch(
  '/:id',
  authorize(ROLES.ADMIN),
  validation.updateProductValidation,
  validate,
  controller.updateProduct
);

// Retires the product (is_active = 0) rather than deleting it, so historic
// bills that reference it stay intact.
productsRouter.delete(
  '/:id',
  authorize(ROLES.ADMIN),
  validation.idParam,
  validate,
  controller.deactivateProduct
);

/* ------------------------------------------------------------------ */

const suppliersRouter = Router();
suppliersRouter.use(authenticate);

suppliersRouter.get('/', authorize(...STAFF), controller.listSuppliers);
suppliersRouter.get('/:id', authorize(...STAFF), validation.idParam, validate, controller.getSupplier);

suppliersRouter.post(
  '/',
  authorize(ROLES.ADMIN, ROLES.SALES_REP),
  validation.createSupplierValidation,
  validate,
  controller.createSupplier
);

suppliersRouter.patch(
  '/:id',
  authorize(ROLES.ADMIN, ROLES.SALES_REP),
  validation.updateSupplierValidation,
  validate,
  controller.updateSupplier
);

module.exports = { categoriesRouter, productsRouter, suppliersRouter };
