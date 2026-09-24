const express = require('express');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { readJSON, writeJSON } = require('../utils/fileStore');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Strict rate limiter for registration endpoint
const registerLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many registration requests. Please slow down.' }
  }
});

// In-memory set to track processed request_ids for idempotency (deduplication)
const processedRequestIds = new Set();

/**
 * Helper to get canonical student ID
 */
function getStudentId(s) {
  return s.student_id || s.id || '';
}

/**
 * GET /api/v1/attendance/search?department=<dept>&status=<INSIDE|NOT_ENTERED>&q=<query>
 * Returns merged student + attendance data with optional filters.
 * Declared before dynamic routes.
 */
router.get('/search', (req, res) => {
  const students = readJSON('students.json');
  const attendanceData = readJSON('attendance.json');

  if (!students || !attendanceData || !Array.isArray(students.students)) {
    return res.status(500).json({
      success: false,
      error: { code: 'DATA_READ_ERROR', message: 'Failed to read data files.' }
    });
  }

  const dept = (req.query.department || '').toUpperCase().trim();
  const status = (req.query.status || '').toUpperCase().trim();
  const q = (req.query.q || '').toLowerCase().trim();

  // Build lookup map from attendance records (case-insensitive key)
  const attendanceMap = {};
  for (const record of (attendanceData.records || [])) {
    if (record.student_id) {
      attendanceMap[record.student_id.toUpperCase()] = record;
    }
  }

  // Merge and filter
  let results = students.students.map(s => {
    const sId = getStudentId(s);
    const attRecord = attendanceMap[sId.toUpperCase()];
    return {
      student_id: sId,
      id: sId,
      name: s.name,
      department: s.department,
      status: attRecord ? 'INSIDE' : 'NOT_ENTERED',
      attendance_id: attRecord?.attendance_id || null,
      checked_in_at: attRecord?.checked_in_at || null
    };
  });

  if (dept) {
    results = results.filter(r => r.department.toUpperCase() === dept);
  }
  if (status && (status === 'INSIDE' || status === 'NOT_ENTERED')) {
    results = results.filter(r => r.status === status);
  }
  if (q) {
    results = results.filter(r =>
      r.student_id.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q)
    );
  }

  return res.json({ success: true, data: { records: results, count: results.length } });
});

/**
 * GET /api/v1/attendance
 * List all attendance records (merged with student info).
 */
router.get('/', (req, res) => {
  const students = readJSON('students.json');
  const attendanceData = readJSON('attendance.json');

  if (!students || !attendanceData || !Array.isArray(students.students)) {
    return res.status(500).json({
      success: false,
      error: { code: 'DATA_READ_ERROR', message: 'Failed to read data files.' }
    });
  }

  const studentMap = {};
  for (const s of students.students) {
    studentMap[getStudentId(s).toUpperCase()] = s;
  }

  const enrichedRecords = (attendanceData.records || []).map(r => {
    const s = studentMap[(r.student_id || '').toUpperCase()];
    return {
      ...r,
      name: s?.name || 'Unknown',
      department: s?.department || 'Unknown'
    };
  });

  return res.json({
    success: true,
    data: { records: enrichedRecords, count: enrichedRecords.length }
  });
});

/**
 * POST /api/v1/attendance/register
 * Body: { student_id: string, request_id: string }
 *
 * Requires ADMIN or ORGANISER role.
 * Handles: capacity check, duplicate student, idempotent request_id dedup.
 */
router.post('/register', registerLimiter, requireRole('ADMIN', 'ORGANISER'), (req, res) => {
  const { student_id, request_id } = req.body;

  if (!student_id || typeof student_id !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_STUDENT_ID', message: 'student_id is required.' }
    });
  }

  if (!request_id || typeof request_id !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_REQUEST_ID', message: 'request_id is required for idempotency.' }
    });
  }

  // ── Idempotency: duplicate request_id check ─────────────────────────────
  if (processedRequestIds.has(request_id.trim())) {
    return res.status(200).json({
      success: true,
      data: { idempotent: true },
      message: 'Request already processed. No duplicate record created.'
    });
  }

  // ── Read data files ──────────────────────────────────────────────────────
  const students = readJSON('students.json');
  const attendanceData = readJSON('attendance.json') || { records: [] };

  if (!students || !Array.isArray(students.students)) {
    return res.status(500).json({
      success: false,
      error: { code: 'DATA_READ_ERROR', message: 'Failed to read data files.' }
    });
  }

  // ── Validate student exists in roster ────────────────────────────────────
  const normalizedId = student_id.toUpperCase().trim();
  const student = students.students.find(
    s => getStudentId(s).toUpperCase() === normalizedId
  );
  if (!student) {
    return res.status(404).json({
      success: false,
      error: { code: 'STUDENT_NOT_FOUND', message: `Student ${student_id} is not on the pre-registered roster.` }
    });
  }

  const canonicalStudentId = getStudentId(student);

  // ── Duplicate attendance check ───────────────────────────────────────────
  const alreadyCheckedIn = (attendanceData.records || []).some(
    r => (r.student_id || '').toUpperCase() === canonicalStudentId.toUpperCase()
  );
  if (alreadyCheckedIn) {
    return res.status(409).json({
      success: false,
      error: { code: 'DUPLICATE_ATTENDANCE', message: 'Student has already checked in.' }
    });
  }

  // ── Capacity check ───────────────────────────────────────────────────────
  const capacity = students.event?.capacity || 100;
  if ((attendanceData.records || []).length >= capacity) {
    return res.status(403).json({
      success: false,
      error: { code: 'CAPACITY_REACHED', message: 'Event capacity has been reached. No more check-ins allowed.' }
    });
  }

  // ── Create attendance record ─────────────────────────────────────────────
  const newRecord = {
    attendance_id: `ATT-${uuidv4().split('-')[0].toUpperCase()}`,
    student_id: canonicalStudentId,
    request_id: request_id.trim(),
    checked_in_at: new Date().toISOString(),
    registered_by: req.user.username
  };

  if (!Array.isArray(attendanceData.records)) {
    attendanceData.records = [];
  }
  attendanceData.records.push(newRecord);

  const saved = writeJSON('attendance.json', attendanceData);
  if (!saved) {
    return res.status(500).json({
      success: false,
      error: { code: 'DATA_WRITE_ERROR', message: 'Failed to persist attendance record.' }
    });
  }

  // Mark request_id as processed AFTER successful write
  processedRequestIds.add(request_id.trim());

  return res.status(201).json({
    success: true,
    data: {
      attendance_id: newRecord.attendance_id,
      student_id: newRecord.student_id,
      name: student.name,
      department: student.department,
      checked_in_at: newRecord.checked_in_at,
      registered_by: newRecord.registered_by,
      current_count: attendanceData.records.length,
      capacity,
      remaining: capacity - attendanceData.records.length
    }
  });
});

module.exports = router;
