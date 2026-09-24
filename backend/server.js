require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const { apiLimiter } = require("./middleware/rateLimit");
const authRoutes = require("./routes/auth");
const studentRoutes = require("./routes/students");
const attendanceRoutes = require("./routes/attendance");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(apiLimiter); // applies to every route below

app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/attendance", attendanceRoutes);

// Serve the static frontend (simple vanilla JS app) so the whole thing runs
// from a single `npm start` in backend/.
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Central error handler — anything that slips past a route's own try/catch
// still gets a clean JSON response instead of an HTML stack trace / crash.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "ServerError", message: "Something went wrong on the server." });
});

app.use((req, res) => {
  res.status(404).json({ error: "NotFound", message: `No route for ${req.method} ${req.originalUrl}` });
});

app.listen(PORT, () => {
  console.log(`Event Attendance Tracker API running on http://localhost:${PORT}`);
});
