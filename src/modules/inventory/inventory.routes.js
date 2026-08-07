const { Router } = require('express');
const controller = require('./inventory.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

router.get(
  '/low-stock',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.SALES_REP, ROLES.CASHIER),
  controller.getLowStock
);

module.exports = router;
