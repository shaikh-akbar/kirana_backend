const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const firmsService = require('./firms.service');

const createFirm = asyncHandler(async (req, res) => {
  const firm = await firmsService.createFirm(req.user.id, req.body);
  return new ApiResponse(201, firm, 'Firm created').send(res);
});

/**
 * Deliberately NOT firm-scoped: this is the call the frontend makes to populate
 * the firm-switcher, i.e. before any firm is selected.
 */
const listMyFirms = asyncHandler(async (req, res) => {
  const firms = await firmsService.listMyFirms(req.user.id);
  return new ApiResponse(200, firms, 'Firms available to this user').send(res);
});

const getActiveFirm = asyncHandler(async (req, res) => {
  const firm = await firmsService.getFirm(req.firmId);
  return new ApiResponse(200, firm, 'Active firm').send(res);
});

const updateActiveFirm = asyncHandler(async (req, res) => {
  const firm = await firmsService.updateFirmDetails(req.firmId, req.body);
  return new ApiResponse(200, firm, 'Firm updated').send(res);
});

const addStaff = asyncHandler(async (req, res) => {
  const staff = await firmsService.addStaff(req.firmId, req.body);
  return new ApiResponse(201, staff, 'Staff member added').send(res);
});

const listStaff = asyncHandler(async (req, res) => {
  const staff = await firmsService.listStaff(req.firmId);
  return new ApiResponse(200, staff, 'Staff with access to this firm').send(res);
});

module.exports = { createFirm, listMyFirms, getActiveFirm, updateActiveFirm, addStaff, listStaff };
