const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/event.config');

/**
 * authenticate — verifies the Bearer JWT on every protected route.
 * Sets req.user = decoded token payload on success.
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication token required.' },
      timestamp: new Date().toISOString(),
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Session expired. Please log in again.' },
        timestamp: new Date().toISOString(),
      });
    }
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid authentication token.' },
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * authorize — role-based guard. Call after authenticate.
 * Usage: router.get('/route', authenticate, authorize('admin', 'organizer'), handler)
 */
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' },
      timestamp: new Date().toISOString(),
    });
  }
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: `Role '${req.user.role}' is not permitted to perform this action.`,
      },
      timestamp: new Date().toISOString(),
    });
  }
  next();
};

/**
 * requirePermission — fine-grained permission guard.
 * Usage: router.post('/register', authenticate, requirePermission('register'), handler)
 */
const requirePermission = (permission) => (req, res, next) => {
  if (!req.user || !Array.isArray(req.user.permissions) || !req.user.permissions.includes(permission)) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: `Permission '${permission}' is required for this action.`,
      },
      timestamp: new Date().toISOString(),
    });
  }
  next();
};

module.exports = { authenticate, authorize, requirePermission };
