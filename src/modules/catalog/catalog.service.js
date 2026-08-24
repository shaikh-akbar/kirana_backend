const { pool, withTransaction } = require('../../config/db');
const { ApiError } = require('../../utils/ApiError');
const queries = require('./catalog.queries');

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Flat list plus the same rows nested one level deep, for tree pickers. */
async function listCategories({ includeInactive } = {}) {
  const rows = await queries.listCategories(pool, { includeInactive });
  const byId = new Map(rows.map((row) => [row.id, { ...row, children: [] }]));

  const tree = [];
  for (const node of byId.values()) {
    const parent = node.parentId != null ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else tree.push(node);
  }

  return { rows, tree };
}

async function createCategory(input) {
  if (input.parentId) {
    const parent = await queries.findCategoryById(pool, input.parentId);
    if (!parent) throw ApiError.badRequest(`Parent category ${input.parentId} does not exist`);
  }

  try {
    const id = await queries.insertCategory(pool, {
      name: input.name,
      parentId: input.parentId || null,
      slug: input.slug ? slugify(input.slug) : slugify(input.name),
      status: input.status || 'ACTIVE',
    });
    return queries.findCategoryById(pool, id);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw ApiError.conflict(`A category with the slug '${slugify(input.slug || input.name)}' already exists`);
    }
    throw err;
  }
}

const CATEGORY_FIELDS = { name: 'name', parentId: 'parent_id', status: 'status' };

async function updateCategory(id, input) {
  const existing = await queries.findCategoryById(pool, id);
  if (!existing) throw ApiError.notFound(`Category ${id} not found`);

  // A category that is its own ancestor would make the tree walk above loop
  // forever; one self-reference is the only cycle a single-parent edit can make.
  if (input.parentId != null && Number(input.parentId) === Number(id)) {
    throw ApiError.badRequest('A category cannot be its own parent');
  }

  const fields = {};
  for (const [key, column] of Object.entries(CATEGORY_FIELDS)) {
    if (input[key] !== undefined) fields[column] = input[key] === '' ? null : input[key];
  }
  if (input.name !== undefined) fields.slug = slugify(input.name);

  if (Object.keys(fields).length === 0) throw ApiError.badRequest('No updatable fields supplied');

  await queries.updateCategory(pool, id, fields);
  return queries.findCategoryById(pool, id);
}

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

/**
 * A product with no `product_units` row cannot be billed — the order services
 * look up a base unit to convert quantities and to compute the bill's weight
 * footer. So a create that supplies no units still gets one, defaulting to
 * PACKET: the client's goods are billed by the piece, and a KG default would
 * print a weight on bills that should read `Total Wtt.: 0.000Kg`.
 */
const DEFAULT_BASE_UNIT = { unitName: 'PACKET', conversionFactor: 1, isBaseUnit: true };

function normaliseUnits(units) {
  if (!Array.isArray(units) || units.length === 0) return [DEFAULT_BASE_UNIT];

  const baseUnits = units.filter((u) => u.isBaseUnit);
  if (baseUnits.length > 1) {
    throw ApiError.badRequest('Exactly one unit may be marked as the base unit');
  }

  // With no explicit base, the smallest conversion factor is the base by
  // definition — every other factor is expressed as a multiple of it.
  const normalised = units.map((u) => ({
    unitName: u.unitName,
    conversionFactor: Number(u.conversionFactor ?? 1),
    isBaseUnit: Boolean(u.isBaseUnit),
  }));

  if (baseUnits.length === 0) {
    const smallest = normalised.reduce((min, u) => (u.conversionFactor < min.conversionFactor ? u : min));
    smallest.isBaseUnit = true;
  }

  const names = new Set(normalised.map((u) => u.unitName));
  if (names.size !== normalised.length) {
    throw ApiError.badRequest('A unit may only be configured once per product');
  }

  return normalised;
}

function normaliseTiers(tiers) {
  if (!Array.isArray(tiers)) return [];
  return tiers.map((tier) => {
    const minQuantity = Number(tier.minQuantity);
    const maxQuantity = tier.maxQuantity == null || tier.maxQuantity === '' ? null : Number(tier.maxQuantity);
    if (maxQuantity != null && maxQuantity < minQuantity) {
      throw ApiError.badRequest(`Pricing slab ${minQuantity}-${maxQuantity} ends before it starts`);
    }
    return { minQuantity, maxQuantity, tierPrice: Number(tier.tierPrice) };
  });
}

async function listProducts(firmId, filters) {
  const products = await queries.listProducts(pool, firmId, filters);

  // The POS grid needs each product's sellable units, so they are batched in
  // rather than fetched per tile.
  const units = await queries.findUnitsForProducts(pool, products.map((p) => p.id));
  const byProduct = new Map();
  for (const unit of units) {
    if (!byProduct.has(unit.productId)) byProduct.set(unit.productId, []);
    byProduct.get(unit.productId).push(unit);
  }

  return products.map((product) => ({ ...product, units: byProduct.get(product.id) || [] }));
}

async function getProduct(firmId, id) {
  const product = await queries.findProductById(pool, firmId, id);
  if (!product) throw ApiError.notFound(`Product ${id} not found`);

  const [units, tiers] = await Promise.all([
    queries.findProductUnits(pool, id),
    queries.findPricingTiers(pool, id),
  ]);
  return { ...product, units, tiers };
}

async function createProduct(firmId, input) {
  const units = normaliseUnits(input.units);
  const tiers = normaliseTiers(input.tiers);

  if (input.categoryId) {
    const category = await queries.findCategoryById(pool, input.categoryId);
    if (!category) throw ApiError.badRequest(`Category ${input.categoryId} does not exist`);
  }

  const productId = await withTransaction(async (conn) => {
    let id;
    try {
      id = await queries.insertProduct(conn, {
        categoryId: input.categoryId || null,
        name: input.name,
        sku: input.sku,
        // '' would collide with another blank barcode on the unique index;
        // "no barcode" has to be NULL.
        barcode: input.barcode || null,
        description: input.description || null,
        hsnCode: input.hsnCode || null,
        minStockAlert: input.minStockAlert != null ? input.minStockAlert : 0,
        isActive: input.isActive === false ? 0 : 1,
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        const onBarcode = String(err.sqlMessage || '').includes('uq_products_barcode');
        throw ApiError.conflict(
          onBarcode
            ? `Barcode ${input.barcode} is already assigned to another product`
            : `SKU ${input.sku} is already in use`
        );
      }
      throw err;
    }

    await queries.replaceProductUnits(conn, id, units);
    if (tiers.length) await queries.replacePricingTiers(conn, id, tiers);
    return id;
  });

  return getProduct(firmId, productId);
}

const PRODUCT_FIELDS = {
  name: 'name',
  sku: 'sku',
  barcode: 'barcode',
  description: 'description',
  hsnCode: 'hsn_code',
  categoryId: 'category_id',
  minStockAlert: 'min_stock_alert',
};

async function updateProduct(firmId, id, input) {
  const existing = await queries.findProductById(pool, firmId, id);
  if (!existing) throw ApiError.notFound(`Product ${id} not found`);

  const fields = {};
  for (const [key, column] of Object.entries(PRODUCT_FIELDS)) {
    if (input[key] !== undefined) fields[column] = input[key] === '' ? null : input[key];
  }
  if (input.isActive !== undefined) fields.is_active = input.isActive ? 1 : 0;

  const units = input.units !== undefined ? normaliseUnits(input.units) : null;
  const tiers = input.tiers !== undefined ? normaliseTiers(input.tiers) : null;

  if (Object.keys(fields).length === 0 && !units && !tiers) {
    throw ApiError.badRequest('No updatable fields supplied');
  }

  await withTransaction(async (conn) => {
    try {
      await queries.updateProduct(conn, id, fields);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw ApiError.conflict('Another product already uses that SKU or barcode');
      }
      throw err;
    }
    if (units) await queries.replaceProductUnits(conn, id, units);
    if (tiers) await queries.replacePricingTiers(conn, id, tiers);
  });

  return getProduct(firmId, id);
}

async function deactivateProduct(id) {
  await queries.deactivateProduct(pool, id);
  return { id: Number(id), isActive: 0 };
}

/* ------------------------------------------------------------------ *
 * Suppliers
 * ------------------------------------------------------------------ */

async function listSuppliers(firmId, filters) {
  const { rows, total } = await queries.listSuppliers(pool, firmId, filters);
  return {
    rows: rows.map((row) => ({
      ...row,
      purchaseCount: Number(row.purchaseCount),
      totalQty: Number(row.totalQty),
      totalAmount: Number(row.totalAmount),
      currentBalance: Number(row.currentBalance),
    })),
    total,
  };
}

async function getSupplier(id) {
  const supplier = await queries.findSupplierById(pool, id);
  if (!supplier) throw ApiError.notFound(`Supplier ${id} not found`);
  return supplier;
}

async function createSupplier(input) {
  const id = await queries.insertSupplier(pool, {
    vendorName: input.vendorName,
    phone: input.phone || null,
    gstin: input.gstin || null,
    address: input.address || null,
    openingBalance: input.openingBalance != null ? input.openingBalance : 0,
  });
  return getSupplier(id);
}

const SUPPLIER_FIELDS = {
  vendorName: 'vendor_name',
  phone: 'phone',
  gstin: 'gstin',
  address: 'address',
};

async function updateSupplier(id, input) {
  await getSupplier(id);

  const fields = {};
  for (const [key, column] of Object.entries(SUPPLIER_FIELDS)) {
    if (input[key] !== undefined) fields[column] = input[key] === '' ? null : input[key];
  }
  // current_balance is deliberately absent: it is moved by purchase and payment
  // postings, never typed in, or the supplier ledger stops reconciling.
  if (Object.keys(fields).length === 0) throw ApiError.badRequest('No updatable fields supplied');

  await queries.updateSupplier(pool, id, fields);
  return getSupplier(id);
}

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
