const express = require('express');
const { readJSON } = require('../utils/fileStore');

const router = express.Router();

/**
 * Normalizes student object to have both student_id and id
 */
function normalizeStudent(s) {
  const student_id = s.student_id || s.id || '';
  return {
    student_id,
    id: student_id,
    name: s.name,
    department: s.department
  };
}

/**
 * GET /api/v1/students/search?q=<query>&department=<dept>
 * Search by student ID, full name, or partial name (case-insensitive).
 * Optional department filter.
 * MUST be declared before /:id to avoid Express matching 'search' as an id.
 */
router.get('/search', (req, res) => {
  const data = readJSON('students.json');
  if (!data || !Array.isArray(data.students)) {
    return res.status(500).json({
      success: false,
      error: { code: 'DATA_READ_ERROR', message: 'Failed to read student roster.' }
    });
  }

  const q = (req.query.q || '').toLowerCase().trim();
  const dept = (req.query.department || '').toUpperCase().trim();

  let results = data.students.map(normalizeStudent);

  // Apply text search (student ID, full name, or partial name)
  if (q) {
    results = results.filter(s =>
      s.student_id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q)
    );
  }

  // Apply department filter
  if (dept) {
    results = results.filter(s => s.department.toUpperCase() === dept);
  }

  return res.json({
    success: true,
    data: { students: results, count: results.length }
  });
});

/**
 * GET /api/v1/students
 * List all students from roster.
 */
router.get('/', (req, res) => {
  const data = readJSON('students.json');
  if (!data || !Array.isArray(data.students)) {
    return res.status(500).json({
      success: false,
      error: { code: 'DATA_READ_ERROR', message: 'Failed to read student roster.' }
    });
  }
  const students = data.students.map(normalizeStudent);
  return res.json({
    success: true,
    data: { students, total: students.length }
  });
});

/**
 * GET /api/v1/students/:id
 * Get a single student by ID.
 */
router.get('/:id', (req, res) => {
  const data = readJSON('students.json');
  if (!data || !Array.isArray(data.students)) {
    return res.status(500).json({
      success: false,
      error: { code: 'DATA_READ_ERROR', message: 'Failed to read student roster.' }
    });
  }

  const queryId = req.params.id.toUpperCase().trim();
  const rawStudent = data.students.find(
    s => (s.student_id || s.id || '').toUpperCase() === queryId
  );

  if (!rawStudent) {
    return res.status(404).json({
      success: false,
      error: { code: 'STUDENT_NOT_FOUND', message: `No student found with ID: ${req.params.id}` }
    });
  }

  return res.json({ success: true, data: { student: normalizeStudent(rawStudent) } });
});

module.exports = router;
