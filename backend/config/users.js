/**
 * Organiser accounts — role-based access control.
 *
 * Roles:
 *   admin     → register + view + search + manage
 *   organizer → register + view + search
 *   viewer    → view + search  (read-only)
 *
 * Passwords are bcrypt-hashed at module load time.
 * In production replace these with a persistent store and never ship
 * plain-text passwords in source. Here they are shown for demo clarity.
 *
 * Default credentials:
 *   admin      / Admin@123
 *   organizer1 / Org@2026
 *   viewer1    / View@2026
 */

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

const USERS = [
  {
    id: 1,
    username: 'admin',
    passwordHash: bcrypt.hashSync('Admin@123', SALT_ROUNDS),
    role: 'admin',
    name: 'Admin User',
    permissions: ['register', 'view', 'search', 'manage'],
  },
  {
    id: 2,
    username: 'organizer1',
    passwordHash: bcrypt.hashSync('Org@2026', SALT_ROUNDS),
    role: 'organizer',
    name: 'Organizer One',
    permissions: ['register', 'view', 'search'],
  },
  {
    id: 3,
    username: 'viewer1',
    passwordHash: bcrypt.hashSync('View@2026', SALT_ROUNDS),
    role: 'viewer',
    name: 'Viewer One',
    permissions: ['view', 'search'],
  },
];

module.exports = USERS;
