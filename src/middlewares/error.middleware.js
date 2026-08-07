const { ApiError } = require('../utils/ApiError');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isApiError = err instanceof ApiError;
  const statusCode = isApiError ? err.statusCode : 500;

  if (!isApiError) {
    // Unexpected/programmer error - log full detail server-side only.
    console.error('[UNHANDLED ERROR]', err);
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message: isApiError ? err.message : 'Internal server error',
    details: isApiError ? err.details : undefined,
  });
}

module.exports = { notFoundHandler, errorHandler };
