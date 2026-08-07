const { Router } = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const ordersRoutes = require('../modules/orders/orders.routes');
const khataRoutes = require('../modules/khata/khata.routes');
const pricingRoutes = require('../modules/pricing/pricing.routes');
const inventoryRoutes = require('../modules/inventory/inventory.routes');

const router = Router();

router.get('/health', (req, res) => res.status(200).json({ success: true, message: 'OK' }));

router.use('/auth', authRoutes);
router.use('/orders', ordersRoutes);
router.use('/khata', khataRoutes);
router.use('/prices', pricingRoutes);
router.use('/inventory', inventoryRoutes);

module.exports = router;
