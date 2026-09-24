const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'turing_club_super_secret_2026';
const JWT_EXPIRES_IN = '8h';

/**
 * Authorised organisers (in production, these would be in a DB).
 * Passwords are bcrypt hashes. For simplicity the plaintext is noted in comments.
 * Hash generated with bcrypt rounds=10.
 */
const ORGANISERS = [
  {
    id: 'org_001',
    username: 'admin',
    // password: "admin@turing2026"
    passwordHash: '$2a$10$5K5G.56IfDuFD7unotZKwOWORhZEx9yNoXFgyPxghNzfc5KmcvVIO',
    role: 'ADMIN',
    name: 'Admin Organiser'
  },
  {
    id: 'org_002',
    username: 'organiser1',
    // password: "org@pass123"
    passwordHash: '$2a$10$P1fTG0KB6Hwj95cpqdjALewq9DDZgxUaoW0IghH14LEzzqRNl/r3.',
    role: 'ORGANISER',
    name: 'Event Staff 1'
  }
];

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { ORGANISERS, signToken, verifyToken };
