const { pool } = require('../config/db');
const { ApiError } = require('../utils/ApiError');

/**
 * Resolves the firm the caller is acting on behalf of and proves they are
 * allowed to. Must run AFTER `authenticate`.
 *
 * The firm is taken from the `X-Firm-Id` header (the frontend's firm-switcher
 * sets it on every request via an axios interceptor), falling back to
 * `firmId` in the query string or body for convenience in tools like curl.
 *
 * On success attaches:
 *   req.firmId   - BIGINT id, safe to interpolate into WHERE clauses
 *   req.firm     - { id, firmName, firmType, firmRole }
 *
 * Membership is checked against `firm_users`, not against `firms.seller_id`,
 * so staff (CASHIER / SALES_REP) can be granted access to a firm without
 * being its owner. Creating a firm inserts the owner's membership row, so the
 * owner always passes this check too.
 */
async function firmScope(req, res, next) {
  try {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }

    const raw = req.headers['x-firm-id'] || req.query.firmId || (req.body && req.body.firmId);
    if (raw === undefined || raw === null || raw === '') {
      return next(
        ApiError.badRequest('Missing firm context — send the active firm id in the X-Firm-Id header')
      );
    }

    const firmId = Number(raw);
    if (!Number.isInteger(firmId) || firmId < 1) {
      return next(ApiError.badRequest(`Invalid firm id '${raw}'`));
    }

    const [rows] = await pool.query(
      `SELECT f.id, f.firm_name, f.firm_type, f.is_active, r.name AS firm_role
       FROM firm_users fu
       JOIN firms f ON f.id = fu.firm_id
       JOIN roles r ON r.id = fu.role_id
       WHERE fu.firm_id = ? AND fu.user_id = ?
       LIMIT 1`,
      [firmId, req.user.id]
    );

    const membership = rows[0];
    if (!membership) {
      // Deliberately 404-shaped rather than 403: a caller must not be able to
      // enumerate which firm ids exist by comparing error codes.
      return next(ApiError.notFound(`Firm ${firmId} not found for this user`));
    }
    if (!membership.is_active) {
      return next(ApiError.forbidden(`Firm '${membership.firm_name}' is inactive`));
    }

    req.firmId = membership.id;
    req.firm = {
      id: membership.id,
      firmName: membership.firm_name,
      firmType: membership.firm_type,
      firmRole: membership.firm_role,
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { firmScope };
