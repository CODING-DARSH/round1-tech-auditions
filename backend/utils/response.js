/**
 * Centralised API response helpers for consistent JSON shapes across all routes.
 *
 * Success shape:
 *   { success: true, message, data, timestamp }
 *
 * Error shape:
 *   { success: false, error: { code, message }, timestamp }
 */

const ok = (res, data, message = 'Success', statusCode = 200) =>
  res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });

const fail = (res, code, message, statusCode = 400) =>
  res.status(statusCode).json({
    success: false,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });

module.exports = { ok, fail };
