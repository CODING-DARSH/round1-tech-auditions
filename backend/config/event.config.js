/**
 * Event configuration — single source of truth for capacity and JWT settings.
 * In production, override JWT_SECRET via process.env.JWT_SECRET.
 */
module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'event_tracker_jwt_s3cr3t_2026_CHANGE_IN_PROD',
  JWT_EXPIRES_IN: '8h',
};
