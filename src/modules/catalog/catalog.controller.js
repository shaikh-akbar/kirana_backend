const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const catalogService = require('./catalog.service');

/* Categories */

const listCategories = asyncHandler(async (req, res) => {
  const result = await catalogService.listCategories({ includeInactive: req.query.includeInactive === 'true' });
  return new ApiResponse(200, result, 'Categories fetched').send(res);
});

const createCategory = asyncHandler(async (req, res) => {
  const category = await catalogService.createCategory(req.body);
  return new ApiResponse(201, category, 'Category created').send(res);
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await catalogService.updateCategory(req.params.id, req.body);
  return new ApiResponse(200, category, 'Category updated').send(res);
});

/* Products */

const listProducts = asyncHandler(async (req, res) => {
  const products = await catalogService.listProducts(req.firmId, {
    search: req.query.search,
    categoryId: req.query.categoryId,
    includeInactive: req.query.includeInactive === 'true',
    lowStockOnly: req.query.lowStockOnly === 'true',
  });
  return new ApiResponse(200, products, 'Products fetched').send(res);
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await catalogService.getProduct(req.firmId, req.params.id);
  return new ApiResponse(200, product, 'Product fetched').send(res);
});

const createProduct = asyncHandler(async (req, res) => {
  const product = await catalogService.createProduct(req.firmId, req.body);
  return new ApiResponse(201, product, 'Product created').send(res);
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await catalogService.updateProduct(req.firmId, req.params.id, req.body);
  return new ApiResponse(200, product, 'Product updated').send(res);
});

const deactivateProduct = asyncHandler(async (req, res) => {
  const result = await catalogService.deactivateProduct(req.params.id);
  return new ApiResponse(200, result, 'Product retired').send(res);
});

/* Suppliers */

const listSuppliers = asyncHandler(async (req, res) => {
  const suppliers = await catalogService.listSuppliers(req.firmId, {
    search: req.query.search,
    fromDate: req.query.fromDate,
    toDate: req.query.toDate,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  return new ApiResponse(200, suppliers, 'Suppliers fetched').send(res);
});

const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await catalogService.getSupplier(req.params.id);
  return new ApiResponse(200, supplier, 'Supplier fetched').send(res);
});

const createSupplier = asyncHandler(async (req, res) => {
  const supplier = await catalogService.createSupplier(req.body);
  return new ApiResponse(201, supplier, 'Supplier created').send(res);
});

const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await catalogService.updateSupplier(req.params.id, req.body);
  return new ApiResponse(200, supplier, 'Supplier updated').send(res);
});

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deactivateProduct,
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
};
