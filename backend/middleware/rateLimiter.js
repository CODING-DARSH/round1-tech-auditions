const rateLimit = require('express-rate-limit');

/**
 * Rate limiter configurations.
 *
 * generalLimiter  — applied to all /api/ routes as a baseline
 * authLimiter     — strict limit on login attempts (brute-force protection)
 * registerLimiter — moderate limit on check-in POSTs
 * searchLimiter   — relaxed limit for read-heavy search endpoints
 */

const json429 = (message) => ({
  success: false,
  error: { code: 'RATE_LIMIT_EXCEEDED', message },
  timestamp: new Date().toISOString(),
});

/** 100 requests / 15 min — global API safety net */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429('Too many requests. Please try again after 15 minutes.'),
});

/** 10 login requests / 15 min — brute-force protection */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429('Too many login attempts. Please try again after 15 minutes.'),
});

/** 20 registrations / 1 min — prevents rapid-fire check-in spam */
const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429('Too many registration requests. Please slow down.'),
});

/** 60 search requests / 1 min — read-heavy but still guarded */
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429('Too many search requests. Please slow down.'),
});

module.exports = { generalLimiter, authLimiter, registerLimiter, searchLimiter };
