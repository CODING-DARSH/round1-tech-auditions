const express = require('express');
const bcrypt = require('bcryptjs');
const { ORGANISERS, signToken } = require('../config/auth');

const router = express.Router();

/**
 * POST /api/v1/auth/login
 * Body: { username, password }
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_CREDENTIALS', message: 'Username and password are required.' }
    });
  }

  const organiser = ORGANISERS.find(o => o.username === username.toLowerCase().trim());
  if (!organiser) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }
    });
  }

  const isMatch = await bcrypt.compare(password, organiser.passwordHash);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }
    });
  }

  const token = signToken({ id: organiser.id, username: organiser.username, role: organiser.role, name: organiser.name });

  return res.status(200).json({
    success: true,
    data: {
      token,
      user: { id: organiser.id, username: organiser.username, role: organiser.role, name: organiser.name }
    }
  });
});

/**
 * POST /api/v1/auth/logout
 * JWT is stateless — client must discard the token. Endpoint for completeness.
 */
router.post('/logout', (_req, res) => {
  res.json({ success: true, message: 'Logged out. Please discard your token on the client side.' });
});

module.exports = router;
