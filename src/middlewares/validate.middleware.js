const { validationResult } = require('express-validator');
const { ApiError } = require('../utils/ApiError');

/**
 * Runs after an express-validator chain and turns any accumulated errors
 * into a single 400 ApiError instead of letting each route handle it.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(ApiError.badRequest('Validation failed', errors.array()));
  }
  return next();
}

module.exports = { validate };
