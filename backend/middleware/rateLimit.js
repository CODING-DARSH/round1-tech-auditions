const rateLimit = require("express-rate-limit");

// General API limiter: generous, just stops abuse/looping clients.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "TooManyRequests", message: "Too many requests. Please slow down and try again shortly." },
});

// Tighter limiter for login: slows down credential-guessing attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "TooManyRequests", message: "Too many login attempts. Please try again in a few minutes." },
});

// Tighter limiter for check-in: prevents duplicate-click / scripted spamming
// of the same endpoint from a single client.
const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "TooManyRequests", message: "Too many check-in attempts. Please slow down." },
});

module.exports = { apiLimiter, loginLimiter, checkinLimiter };
