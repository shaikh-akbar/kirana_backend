const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiResponse } = require('../../utils/ApiResponse');
const authService = require('./auth.service');

const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  return new ApiResponse(201, user, 'User registered successfully').send(res);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  return new ApiResponse(200, result, 'Login successful').send(res);
});

const me = asyncHandler(async (req, res) => {
  return new ApiResponse(200, req.user, 'Current session').send(res);
});

module.exports = { register, login, me };
