const { Router } = require('express');
const controller = require('./firms.controller');
const { createFirmValidation, updateFirmValidation, addStaffValidation } = require('./firms.validation');
const { validate } = require('../../middlewares/validate.middleware');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');
const { firmScope } = require('../../middlewares/firm.middleware');
const { ROLES } = require('../../constants/roles');

const router = Router();

// GET /api/firms — every firm the caller may operate. No firmScope: this is
// what the client calls to discover which firm ids exist for it.
router.get('/', authenticate, controller.listMyFirms);

// POST /api/firms — onboarding. Any authenticated user may create their own
// firm and becomes its ADMIN; no firmScope, since no firm exists yet.
router.post('/', authenticate, createFirmValidation, validate, controller.createFirm);

// GET /api/firms/active — full record of the firm in X-Firm-Id, including the
// invoice header/footer settings the bill print-out needs.
router.get('/active', authenticate, firmScope, controller.getActiveFirm);

// PATCH /api/firms/active — Settings screen. Owner-only: statutory ids and the
// invoice series are not a cashier's business.
router.patch(
  '/active',
  authenticate,
  firmScope,
  authorize(ROLES.ADMIN),
  updateFirmValidation,
  validate,
  controller.updateActiveFirm
);

// GET /api/firms/active/staff — everyone with access to the active firm.
// ADMIN-only: staff shouldn't see who else has access, just the owner.
router.get('/active/staff', authenticate, firmScope, authorize(ROLES.ADMIN), controller.listStaff);

// POST /api/firms/active/staff — grants an EXISTING user (found by phone)
// RETAILER/WHOLESALER access to the active firm. This is the only way a
// staff account ends up with a firm to log into; ADMIN-only on purpose,
// since deciding who works at the firm is the owner's call.
router.post(
  '/active/staff',
  authenticate,
  firmScope,
  authorize(ROLES.ADMIN),
  addStaffValidation,
  validate,
  controller.addStaff
);

module.exports = router;
