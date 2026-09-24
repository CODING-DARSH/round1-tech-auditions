const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { authenticate, requirePermission } = require('../middleware/auth');
const { registerLimiter, searchLimiter } = require('../middleware/rateLimiter');
const { getStudents, getAttendance, saveAttendance } = require('../utils/fileStorage');
const { ok, fail } = require('../utils/response');

/**
 * POST /api/v1/attendance/register
 * Body: { student_id: "STU1024", request_id?: "req_12345" }
 *
 * Idempotency: if request_id is provided and was already processed,
 * return the original response without creating a duplicate record.
 *
 * Validations (in order):
 *   1. student_id present
 *   2. Idempotency check (request_id already processed)
 *   3. Student on roster
 *   4. Not already checked in (duplicate attendance)
 *   5. Capacity not reached
 */
router.post('/register', authenticate, requirePermission('register'), registerLimiter, (req, res) => {
  try {
    const { student_id, request_id } = req.body;

    if (!student_id || typeof student_id !== 'string' || !student_id.trim()) {
      return fail(res, 'MISSING_STUDENT_ID', 'student_id is required and must be a non-empty string.', 400);
    }

    const studentData = getStudents();
    const attendanceData = getAttendance();

    // ── Idempotency check ──────────────────────────────────────────────────
    if (request_id) {
      const processed = attendanceData.processed_requests.find((r) => r.request_id === request_id);
      if (processed) {
        const existing = attendanceData.records.find((r) => r.student_id === processed.student_id);
        return ok(
          res,
          {
            attendance_id: processed.attendance_id,
            student_id: processed.student_id,
            attended_at: processed.processed_at,
            idempotent: true,
            ...(existing && { name: existing.name, department: existing.department }),
          },
          'Request already processed — returning original response (idempotent).'
        );
      }
    }

    // ── Student exists on roster ───────────────────────────────────────────
    const student = studentData.students.find((s) => s.student_id === student_id.trim());
    if (!student) {
      return fail(
        res,
        'STUDENT_NOT_FOUND',
        `Student '${student_id}' is not on the approved roster.`,
        404
      );
    }

    // ── Duplicate attendance check ─────────────────────────────────────────
    const alreadyIn = attendanceData.records.find((r) => r.student_id === student.student_id);
    if (alreadyIn) {
      return fail(res, 'DUPLICATE_ATTENDANCE', 'Student has already checked in.', 409);
    }

    // ── Capacity check ─────────────────────────────────────────────────────
    const capacity = studentData.event?.capacity ?? 15;
    if (attendanceData.records.length >= capacity) {
      return fail(
        res,
        'CAPACITY_REACHED',
        `Event capacity of ${capacity} has been reached. No further registrations allowed.`,
        422
      );
    }

    // ── Create attendance record ───────────────────────────────────────────
    const attendance_id = `ATT-${uuidv4().split('-')[0].toUpperCase()}`;
    const attended_at = new Date().toISOString();

    const newRecord = {
      attendance_id,
      student_id: student.student_id,
      name: student.name,
      department: student.department,
      year: student.year,
      status: 'INSIDE',
      attended_at,
      registered_by: req.user.username,
      request_id: request_id || null,
    };

    attendanceData.records.push(newRecord);

    // Track request for idempotency (only if caller supplied a request_id)
    if (request_id) {
      attendanceData.processed_requests.push({
        request_id,
        student_id: student.student_id,
        attendance_id,
        processed_at: attended_at,
      });
    }

    saveAttendance(attendanceData);

    const remaining = capacity - attendanceData.records.length;

    return ok(
      res,
      {
        attendance_id,
        student_id: student.student_id,
        name: student.name,
        department: student.department,
        year: student.year,
        status: 'INSIDE',
        attended_at,
        registered_by: req.user.username,
        capacity_info: {
          capacity,
          checked_in: attendanceData.records.length,
          remaining,
          is_full: remaining === 0,
        },
      },
      `${student.name} successfully checked in.`,
      201
    );
  } catch (err) {
    return fail(res, 'SERVER_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v1/attendance
 * Returns all attendance records with capacity summary (newest first).
 */
router.get('/', authenticate, requirePermission('view'), (req, res) => {
  try {
    const studentData = getStudents();
    const attendanceData = getAttendance();
    const capacity = studentData.event?.capacity ?? 15;
    const checkedIn = attendanceData.records.length;

    const sorted = [...attendanceData.records].sort(
      (a, b) => new Date(b.attended_at) - new Date(a.attended_at)
    );

    return ok(
      res,
      {
        summary: {
          total_students: studentData.students.length,
          capacity,
          checked_in: checkedIn,
          not_entered: studentData.students.length - checkedIn,
          remaining: Math.max(0, capacity - checkedIn),
          occupancy_percentage: Math.round((checkedIn / capacity) * 100),
          is_full: checkedIn >= capacity,
        },
        records: sorted,
      },
      'Attendance records retrieved.'
    );
  } catch (err) {
    return fail(res, 'SERVER_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v1/attendance/search
 * Query params (all optional, combinable):
 *   department=AIML
 *   status=INSIDE | NOT_ENTERED
 *   q=<student_id or name substring>
 *
 * Combines students.json + attendance.json for complete records.
 */
router.get('/search', authenticate, requirePermission('search'), searchLimiter, (req, res) => {
  try {
    const { department, status, q } = req.query;

    const studentData = getStudents();
    const attendanceData = getAttendance();

    // Build enriched list of all students with attendance data
    let results = studentData.students.map((s) => {
      const record = attendanceData.records.find((r) => r.student_id === s.student_id);
      return {
        ...s,
        status: record ? 'INSIDE' : 'NOT_ENTERED',
        attended_at: record ? record.attended_at : null,
        attendance_id: record ? record.attendance_id : null,
        registered_by: record ? record.registered_by : null,
      };
    });

    // Filter by department (exact, case-insensitive)
    if (department && department.trim()) {
      results = results.filter(
        (s) => s.department.toLowerCase() === department.trim().toLowerCase()
      );
    }

    // Filter by status
    if (status && status.trim()) {
      const statusUpper = status.trim().toUpperCase();
      if (!['INSIDE', 'NOT_ENTERED'].includes(statusUpper)) {
        return fail(res, 'INVALID_STATUS', 'status must be INSIDE or NOT_ENTERED.', 400);
      }
      results = results.filter((s) => s.status === statusUpper);
    }

    // Text search on student_id or name (partial, case-insensitive)
    if (q && q.trim()) {
      const query = q.trim().toLowerCase();
      results = results.filter(
        (s) =>
          s.student_id.toLowerCase().includes(query) ||
          s.name.toLowerCase().includes(query)
      );
    }

    return ok(
      res,
      {
        filters: {
          department: department?.trim() || null,
          status: status?.trim().toUpperCase() || null,
          q: q?.trim() || null,
        },
        total: results.length,
        records: results,
      },
      `Found ${results.length} record(s).`
    );
  } catch (err) {
    return fail(res, 'SERVER_ERROR', err.message, 500);
  }
});

module.exports = router;
