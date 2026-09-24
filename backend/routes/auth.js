const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();

const USERS = require('../config/users');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/event.config');
const { authLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const { ok, fail } = require('../utils/response');

/**
 * POST /api/v1/auth/login
 * Body: { username, password }
 * Rate-limited to 10 requests / 15 min (brute-force protection).
 */
router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return fail(res, 'MISSING_CREDENTIALS', 'Username and password are required.', 400);
  }

  const user = USERS.find((u) => u.username === username);
  if (!user) {
    // Constant-time comparison to prevent username enumeration
    bcrypt.compareSync('dummy', '$2b$10$invalidhashinvalidhashinvalidha');
    return fail(res, 'INVALID_CREDENTIALS', 'Invalid username or password.', 401);
  }

  const isValid = bcrypt.compareSync(password, user.passwordHash);
  if (!isValid) {
    return fail(res, 'INVALID_CREDENTIALS', 'Invalid username or password.', 401);
  }

  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    permissions: user.permissions,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  return ok(res, { token, user: payload }, 'Login successful.');
});

/**
 * GET /api/v1/auth/me
 * Returns the decoded token payload for the authenticated user.
 */
router.get('/me', authenticate, (req, res) => {
  return ok(res, { user: req.user }, 'Authenticated user details.');
});

/**
 * POST /api/v1/auth/logout
 * JWT is stateless — the client must delete its stored token.
 * This endpoint simply confirms the action server-side.
 */
router.post('/logout', authenticate, (req, res) => {
  return ok(res, null, 'Logged out successfully. Please discard your token.');
});

module.exports = router;
