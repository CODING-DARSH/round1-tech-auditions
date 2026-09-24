const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { readJson } = require("../utils/jsonStore");
const { JWT_SECRET } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimit");

const router = express.Router();
const ORGANISERS_PATH = path.join(__dirname, "..", "..", "data", "organisers.json");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

router.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "BadRequest", message: "username and password are required." });
  }

  let organisers;
  try {
    organisers = readJson(ORGANISERS_PATH, []);
  } catch (err) {
    return res.status(500).json({ error: "ServerError", message: "Could not read organiser accounts." });
  }

  const user = organisers.find((o) => o.username === username);
  const passwordOk = user ? bcrypt.compareSync(password, user.passwordHash) : false;

  if (!user || !passwordOk) {
    // Same generic message for "no such user" and "wrong password" —
    // never leak which one it was.
    return res.status(401).json({ error: "InvalidCredentials", message: "Invalid username or password." });
  }

  const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  return res.status(200).json({
    token,
    user: { username: user.username, role: user.role },
    expiresIn: JWT_EXPIRES_IN,
  });
});

module.exports = router;
