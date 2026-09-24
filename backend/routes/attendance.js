const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { readJson, updateJson, JsonStoreError } = require("../utils/jsonStore");
const { requireAuth, requireRole } = require("../middleware/auth");
const { checkinLimiter } = require("../middleware/rateLimit");

const router = express.Router();
const STUDENTS_PATH = path.join(__dirname, "..", "..", "data", "students.json");
const ATTENDANCE_PATH = path.join(__dirname, "..", "..", "data", "attendance.json");
const CONFIG_PATH = path.join(__dirname, "..", "..", "data", "config.json");

function getCapacity() {
  try {
    const config = readJson(CONFIG_PATH, { capacity: 0, eventName: "Event" });
    return { capacity: Number(config.capacity) || 0, eventName: config.eventName || "Event" };
  } catch {
    return { capacity: 0, eventName: "Event" };
  }
}

// GET /api/attendance?search=&department=
router.get("/", requireAuth, (req, res) => {
  let attendance;
  try {
    attendance = readJson(ATTENDANCE_PATH, []);
  } catch (err) {
    return res.status(500).json({ error: "ServerError", message: "attendance.json is unreadable or corrupted." });
  }

  const { search = "", department = "" } = req.query;
  const term = String(search).trim().toLowerCase();
  const dept = String(department).trim().toLowerCase();

  const results = attendance
    .filter((a) => !term || a.studentId.toLowerCase().includes(term) || a.name.toLowerCase().includes(term))
    .filter((a) => !dept || a.department.toLowerCase() === dept)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return res.status(200).json({ count: results.length, attendance: results });
});

// GET /api/attendance/stats
router.get("/stats", requireAuth, (req, res) => {
  let attendance;
  try {
    attendance = readJson(ATTENDANCE_PATH, []);
  } catch (err) {
    return res.status(500).json({ error: "ServerError", message: "attendance.json is unreadable or corrupted." });
  }
  const { capacity, eventName } = getCapacity();
  const current = attendance.length;
  return res.status(200).json({
    eventName,
    capacity,
    current,
    remaining: Math.max(capacity - current, 0),
    full: current >= capacity,
  });
});

// POST /api/attendance/checkin  { studentId }
// organiser or volunteer role required — this is the only mutating endpoint.
router.post("/checkin", requireAuth, requireRole("organiser", "volunteer"), checkinLimiter, (req, res) => {
  const { studentId } = req.body || {};

  if (!studentId || typeof studentId !== "string" || !studentId.trim()) {
    return res.status(400).json({ error: "BadRequest", message: "studentId is required." });
  }
  const id = studentId.trim();

  let students;
  try {
    students = readJson(STUDENTS_PATH, []);
  } catch (err) {
    return res.status(500).json({ error: "ServerError", message: "students.json is unreadable or corrupted." });
  }

  const student = students.find((s) => s.studentId === id);
  if (!student) {
    return res.status(404).json({ error: "NotFound", message: `Student ID "${id}" is not on the pre-approved roster.` });
  }

  const { capacity, eventName } = getCapacity();

  try {
    const result = updateJson(ATTENDANCE_PATH, [], (current) => {
      if (!Array.isArray(current)) {
        throw new JsonStoreError("attendance.json does not contain a JSON array.");
      }

      // Duplicate check happens inside the queued mutation, so two
      // simultaneous check-ins for the same student can't both pass.
      const alreadyIn = current.find((a) => a.studentId === id);
      if (alreadyIn) {
        return { data: current, result: { conflict: "duplicate", record: alreadyIn } };
      }

      if (current.length >= capacity) {
        return { data: current, result: { conflict: "capacity" } };
      }

      const record = {
        attendanceId: crypto.randomUUID(),
        studentId: student.studentId,
        name: student.name,
        department: student.department,
        timestamp: new Date().toISOString(),
      };

      const updated = [...current, record];
      return { data: updated, result: { conflict: null, record } };
    });

    result.then((outcome) => {
      if (res.headersSent) return;
      if (outcome.conflict === "duplicate") {
        return res.status(409).json({
          error: "DuplicateCheckIn",
          message: `${student.name} (${id}) is already checked in.`,
          record: outcome.record,
        });
      }
      if (outcome.conflict === "capacity") {
        return res.status(409).json({
          error: "CapacityReached",
          message: `${eventName} is at full capacity (${capacity}). Registration closed.`,
        });
      }
      return res.status(201).json({ message: "Checked in successfully.", record: outcome.record });
    }).catch((err) => {
      if (res.headersSent) return;
      return res.status(500).json({ error: "ServerError", message: "Failed to persist attendance record.", detail: err.message });
    });
  } catch (err) {
    return res.status(500).json({ error: "ServerError", message: "Unexpected error while checking in.", detail: err.message });
  }
});

module.exports = router;
