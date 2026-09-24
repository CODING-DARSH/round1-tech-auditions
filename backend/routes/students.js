const express = require("express");
const path = require("path");
const { readJson } = require("../utils/jsonStore");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const STUDENTS_PATH = path.join(__dirname, "..", "..", "data", "students.json");
const ATTENDANCE_PATH = path.join(__dirname, "..", "..", "data", "attendance.json");

// GET /api/students?search=&department=
// Roster is the source of truth; each entry is annotated with whether that
// student has already checked in, which is handy for the frontend list/search.
router.get("/", requireAuth, (req, res) => {
  let students, attendance;
  try {
    students = readJson(STUDENTS_PATH, []);
    attendance = readJson(ATTENDANCE_PATH, []);
  } catch (err) {
    return res.status(500).json({ error: "ServerError", message: "Could not read roster data." });
  }

  const { search = "", department = "" } = req.query;
  const checkedInIds = new Set(attendance.map((a) => a.studentId));

  const term = String(search).trim().toLowerCase();
  const dept = String(department).trim().toLowerCase();

  const results = students
    .filter((s) => !term || s.studentId.toLowerCase().includes(term) || s.name.toLowerCase().includes(term))
    .filter((s) => !dept || s.department.toLowerCase() === dept)
    .map((s) => ({ ...s, checkedIn: checkedInIds.has(s.studentId) }));

  return res.status(200).json({ count: results.length, students: results });
});

module.exports = router;
