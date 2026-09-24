const express = require('express');
const { readJSON } = require('../utils/fileStore');

const router = express.Router();

function getStudentId(s) {
  return s.student_id || s.id || '';
}

/**
 * GET /api/v1/dashboard
 * Returns aggregate stats: total students, checked-in, remaining slots, occupancy%.
 */
router.get('/', (req, res) => {
  const students = readJSON('students.json');
  const attendanceData = readJSON('attendance.json') || { records: [] };

  if (!students || !Array.isArray(students.students)) {
    return res.status(500).json({
      success: false,
      error: { code: 'DATA_READ_ERROR', message: 'Failed to read data files.' }
    });
  }

  const studentMap = {};
  for (const s of students.students) {
    studentMap[getStudentId(s).toUpperCase()] = s;
  }

  const capacity = students.event?.capacity || 100;
  const totalStudents = students.students.length;
  const records = attendanceData.records || [];
  const checkedIn = records.length;
  const remaining = Math.max(0, capacity - checkedIn);
  const occupancyPct = capacity > 0 ? Math.round((checkedIn / capacity) * 100) : 0;

  const recentCheckIns = records.slice(-5).reverse().map(r => {
    const s = studentMap[(r.student_id || '').toUpperCase()];
    return {
      ...r,
      name: s?.name || 'Unknown',
      department: s?.department || 'Unknown'
    };
  });

  return res.json({
    success: true,
    data: {
      event: students.event,
      capacity,
      total_registered_students: totalStudents,
      checked_in: checkedIn,
      remaining_slots: remaining,
      occupancy_percentage: occupancyPct,
      recent_check_ins: recentCheckIns
    }
  });
});

module.exports = router;
