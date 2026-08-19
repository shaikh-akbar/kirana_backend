const jwt = require('jsonwebtoken');
const { ApiError } = require('../utils/ApiError');

/**
 * Verifies the Bearer JWT and attaches { id, roleId, roleName } to req.user.
 * Tokens are issued by auth.controller.js at login and carry the user's role
 * so downstream handlers/RBAC checks never need an extra DB round-trip.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, roleId: payload.roleId, roleName: payload.roleName };
    return next();
  } catch (err) {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }
}

/**
 * Role-based access control. Usage: authorize(ROLES.ADMIN, ROLES.RETAILER)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.roleName)) {
      return next(ApiError.forbidden(`Role '${req.user.roleName}' is not permitted to perform this action`));
    }
    return next();
  };
}

module.exports = { authenticate, authorize };
