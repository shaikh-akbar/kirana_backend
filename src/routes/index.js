const { Router } = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const firmsRoutes = require('../modules/firms/firms.routes');
const ordersRoutes = require('../modules/orders/orders.routes');
const khataRoutes = require('../modules/khata/khata.routes');
const pricingRoutes = require('../modules/pricing/pricing.routes');
const inventoryRoutes = require('../modules/inventory/inventory.routes');
const buyersRoutes = require('../modules/buyers/buyers.routes');
const purchasesRoutes = require('../modules/purchases/purchases.routes');
const reportsRoutes = require('../modules/reports/reports.routes');
// One module, three mount points: categories, products and suppliers are all
// the shared catalog and share a query layer.
const {
  categoriesRouter,
  productsRouter,
  suppliersRouter,
} = require('../modules/catalog/catalog.routes');

const router = Router();

router.get('/health', (req, res) => res.status(200).json({ success: true, message: 'OK' }));

router.use('/auth', authRoutes);
router.use('/firms', firmsRoutes);
router.use('/categories', categoriesRouter);
router.use('/products', productsRouter);
router.use('/suppliers', suppliersRouter);
router.use('/buyers', buyersRoutes);
router.use('/orders', ordersRoutes);
router.use('/purchases', purchasesRoutes);
router.use('/khata', khataRoutes);
router.use('/prices', pricingRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/reports', reportsRoutes);

module.exports = router;
