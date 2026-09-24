const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { getStudents, getAttendance } = require('../utils/fileStorage');
const { ok, fail } = require('../utils/response');

/**
 * GET /api/v1/dashboard/stats
 * Returns live statistics for the dashboard — no permission beyond auth required.
 */
router.get('/stats', authenticate, (req, res) => {
  try {
    const studentData = getStudents();
    const attendanceData = getAttendance();

    const capacity = studentData.event?.capacity ?? 15;
    const checkedIn = attendanceData.records.length;

    // Per-department breakdown
    const deptBreakdown = {};
    attendanceData.records.forEach((r) => {
      deptBreakdown[r.department] = (deptBreakdown[r.department] || 0) + 1;
    });

    // Year-wise breakdown
    const yearBreakdown = {};
    studentData.students.forEach((s) => {
      const record = attendanceData.records.find((r) => r.student_id === s.student_id);
      if (record) {
        const key = `Year ${s.year}`;
        yearBreakdown[key] = (yearBreakdown[key] || 0) + 1;
      }
    });

    // Most recent 5 check-ins
    const recentCheckIns = [...attendanceData.records]
      .sort((a, b) => new Date(b.attended_at) - new Date(a.attended_at))
      .slice(0, 5);

    return ok(
      res,
      {
        event: studentData.event ?? {},
        stats: {
          total_students: studentData.students.length,
          capacity,
          checked_in: checkedIn,
          not_entered: studentData.students.length - checkedIn,
          remaining_slots: Math.max(0, capacity - checkedIn),
          occupancy_percentage: capacity > 0 ? Math.round((checkedIn / capacity) * 100) : 0,
          is_full: checkedIn >= capacity,
        },
        department_breakdown: deptBreakdown,
        year_breakdown: yearBreakdown,
        recent_check_ins: recentCheckIns,
      },
      'Dashboard statistics retrieved.'
    );
  } catch (err) {
    return fail(res, 'SERVER_ERROR', err.message, 500);
  }
});

module.exports = router;
