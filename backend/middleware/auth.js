const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev_only_insecure_secret_change_me";

/** Rejects unauthenticated requests (401) with a clear, consistent shape. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized", message: "Missing or malformed Authorization header." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { username, role, iat, exp }
    return next();
  } catch (err) {
    const message = err.name === "TokenExpiredError" ? "Session expired, please log in again." : "Invalid or tampered token.";
    return res.status(401).json({ error: "Unauthorized", message });
  }
}

/** Rejects authenticated-but-not-permitted requests (403). */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden", message: `Requires role: ${allowedRoles.join(" or ")}.` });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole, JWT_SECRET };
