const express = require('express');
const router = express.Router();

const { authenticate, requirePermission } = require('../middleware/auth');
const { searchLimiter } = require('../middleware/rateLimiter');
const { getStudents, getAttendance } = require('../utils/fileStorage');
const { ok, fail } = require('../utils/response');

/** Combine a student record with its current attendance status. */
const enrichStudent = (student, attendanceRecords) => {
  const record = attendanceRecords.find((r) => r.student_id === student.student_id);
  return {
    ...student,
    status: record ? 'INSIDE' : 'NOT_ENTERED',
    attended_at: record ? record.attended_at : null,
    attendance_id: record ? record.attendance_id : null,
  };
};

/**
 * GET /api/v1/students
 * Returns the full student roster enriched with live attendance status.
 */
router.get('/', authenticate, requirePermission('view'), (req, res) => {
  try {
    const { students } = getStudents();
    const { records } = getAttendance();
    const enriched = students.map((s) => enrichStudent(s, records));
    return ok(res, { total: enriched.length, students: enriched }, 'Student roster retrieved.');
  } catch (err) {
    return fail(res, 'SERVER_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v1/students/search?q=<query>
 * Case-insensitive search across student_id, name, and department.
 * Rate-limited to 60 requests / min.
 */
router.get('/search', authenticate, requirePermission('search'), searchLimiter, (req, res) => {
  try {
    const { q } = req.query;

    if (!q || !q.trim()) {
      return fail(res, 'MISSING_QUERY', 'Query parameter "q" is required.', 400);
    }

    const query = q.trim().toLowerCase();
    const { students } = getStudents();
    const { records } = getAttendance();

    const results = students
      .filter(
        (s) =>
          s.student_id.toLowerCase().includes(query) ||
          s.name.toLowerCase().includes(query) ||
          s.department.toLowerCase().includes(query)
      )
      .map((s) => enrichStudent(s, records));

    return ok(
      res,
      { query: q.trim(), total: results.length, students: results },
      `Found ${results.length} student(s) matching "${q.trim()}".`
    );
  } catch (err) {
    return fail(res, 'SERVER_ERROR', err.message, 500);
  }
});

module.exports = router;
