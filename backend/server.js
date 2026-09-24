const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const attendanceRoutes = require('./routes/attendance');
const dashboardRoutes = require('./routes/dashboard');

const { authenticate } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

// ── Serve Frontend static files ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Global rate limiter (all routes) ────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' }
  }
});
app.use('/api', globalLimiter);

// ── Strict rate limiter for auth endpoints ──────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many login attempts. Slow down.' }
  }
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/students', authenticate, studentRoutes);
app.use('/api/v1/attendance', authenticate, attendanceRoutes);
app.use('/api/v1/dashboard', authenticate, dashboardRoutes);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/v1/health', (_req, res) => {
  res.json({ success: true, message: 'Event Attendance API is running.' });
});

// ── Fallback to frontend index.html for root or SPA navigation ───────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── 404 handler for API routes ───────────────────────────────────────────────
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
});

// Start listening if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅  Attendance API listening on http://localhost:${PORT}`);
    console.log(`🌐  Frontend dashboard available at http://localhost:${PORT}`);
  });
}

module.exports = app;
