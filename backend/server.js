const express = require('express');
const cors = require('cors');
const path = require('path');

const { generalLimiter } = require('./middleware/rateLimiter');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const attendanceRoutes = require('./routes/attendance');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve frontend static files ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Global rate limit for all API routes ──────────────────────────────────────
app.use('/api/', generalLimiter);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',       authRoutes);
app.use('/api/v1/students',   studentRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/dashboard',  dashboardRoutes);

// ── 404 for unmatched API routes ──────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.path} does not exist.`,
    },
    timestamp: new Date().toISOString(),
  });
});

// ── SPA catch-all — serve index.html for all non-API routes ──────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
    timestamp: new Date().toISOString(),
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║  🎟  Event Attendance Tracker — Backend API    ║`);
  console.log(`╠════════════════════════════════════════════════╣`);
  console.log(`║  URL  : http://localhost:${PORT}                   ║`);
  console.log(`║  Data : ${path.join(__dirname, '../data')}  ║`);
  console.log(`║  Auth : JWT (8h expiry) + RBAC                 ║`);
  console.log(`║  Rate : 100 req/15min (global)                 ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
});

module.exports = app;
