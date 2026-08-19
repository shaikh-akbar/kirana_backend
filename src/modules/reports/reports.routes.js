const { Router } = require('express');
const { query } = require('express-validator');
const controller = require('./reports.controller');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { firmScope } = require('../../middlewares/firm.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

router.use(authenticate, firmScope);

// Every figure here is one firm's books, so a retailer seeing the dashboard sees
// only the firm they are rostered to — that is already enforced by firmScope.
const STAFF = [ROLES.ADMIN, ROLES.WHOLESALER];

router.get('/dashboard', authorize(...STAFF), controller.getDashboard);

router.get(
  '/sales',
  authorize(ROLES.ADMIN, ROLES.WHOLESALER),
  [
    query('fromDate').optional({ values: 'falsy' }).isISO8601({ strict: true }),
    query('toDate').optional({ values: 'falsy' }).isISO8601({ strict: true }),
  ],
  validate,
  controller.getSalesReport
);

module.exports = router;
