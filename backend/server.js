'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const DEFAULT_PORT = 3000;
const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 32 * 1024;

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  consume(key, policy) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= policy.windowMs) {
      bucket = { count: 0, startedAt: now };
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (this.buckets.size > 2000) {
      for (const [bucketKey, value] of this.buckets) {
        if (now - value.startedAt >= policy.windowMs) this.buckets.delete(bucketKey);
      }
    }

    return {
      allowed: bucket.count <= policy.max,
      remaining: Math.max(0, policy.max - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((policy.windowMs - (now - bucket.startedAt)) / 1000)),
    };
  }
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(body);
}

function success(res, status, data) {
  sendJson(res, status, { success: true, data });
}

function failure(res, status, code, message, headers) {
  sendJson(res, status, { success: false, error: { code, message } }, headers);
}

function encodeToken(user, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: user.username,
    role: user.role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeToken(token, secret) {
  const [payload, providedSignature, extra] = String(token || '').split('.');
  if (!payload || !providedSignature || extra) return null;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(providedSignature, expectedSignature)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!claims.sub || !claims.role || !Number.isFinite(claims.exp) || claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

function authenticate(req, secret) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'A valid bearer token is required.');
  }
  const claims = decodeToken(header.slice(7).trim(), secret);
  if (!claims) throw new AppError(401, 'INVALID_TOKEN', 'The authentication token is invalid or expired.');
  return claims;
}

function requireRole(claims, allowedRoles) {
  if (!allowedRoles.includes(claims.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Your role does not permit this action.');
  }
}

async function readJsonBody(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) throw new AppError(400, 'INVALID_JSON', 'A JSON request body is required.');

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Body must be an object');
    }
    return value;
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'The request body must be a valid JSON object.');
  }
}

function normalizeStudentId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function validateStudentId(value) {
  const normalized = normalizeStudentId(value);
  if (!/^[A-Z0-9_-]{2,40}$/.test(normalized)) {
    throw new AppError(400, 'INVALID_STUDENT_ID', 'student_id must be a valid non-empty identifier.');
  }
  return normalized;
}

function validateRequestId(value) {
  const requestId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_.:-]{3,100}$/.test(requestId)) {
    throw new AppError(400, 'INVALID_REQUEST_ID', 'request_id must be 3-100 characters using letters, numbers, dot, colon, underscore, or hyphen.');
  }
  return requestId;
}

async function readDataFile(dataDir, fileName) {
  const filePath = path.join(dataDir, fileName);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'is missing' : 'is unreadable or malformed';
    throw new AppError(500, 'DATA_FILE_ERROR', `${fileName} ${reason}.`);
  }
}

async function readStudents(dataDir) {
  const roster = await readDataFile(dataDir, 'students.json');
  const students = roster && roster.students;
  if (!Array.isArray(students) || students.some((student) => (
    !student || typeof student.student_id !== 'string' || typeof student.name !== 'string' ||
    typeof student.department !== 'string'
  ))) {
    throw new AppError(500, 'DATA_FILE_ERROR', 'students.json must contain an official students array.');
  }
  return students;
}

async function readAttendance(dataDir) {
  const attendance = await readDataFile(dataDir, 'attendance.json');
  const validRecord = (record) => record &&
    typeof record.attendance_id === 'string' &&
    typeof record.request_id === 'string' &&
    typeof record.student_id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.department === 'string' &&
    typeof record.timestamp === 'string';
  if (!attendance || !Array.isArray(attendance.records) || attendance.records.some((record) => !validRecord(record))) {
    throw new AppError(500, 'DATA_FILE_ERROR', 'attendance.json has an invalid structure.');
  }
  return attendance;
}

async function readCapacity(dataDir) {
  const config = await readDataFile(dataDir, 'config.json');
  if (!config || !Number.isInteger(config.capacity) || config.capacity < 1) {
    throw new AppError(500, 'DATA_FILE_ERROR', 'config.json must contain a positive integer capacity.');
  }
  return config.capacity;
}

async function writeAttendance(dataDir, attendance) {
  const destination = path.join(dataDir, 'attendance.json');
  const temporary = path.join(dataDir, `attendance.json.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(attendance, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw new AppError(500, 'ATTENDANCE_WRITE_FAILED', 'Attendance could not be persisted.');
  }
}

function combineStudentData(students, records) {
  const recordByStudentId = new Map(records.map((record) => [normalizeStudentId(record.student_id), record]));
  return students.map((student) => {
    const record = recordByStudentId.get(normalizeStudentId(student.student_id));
    return {
      student_id: student.student_id,
      name: student.name,
      department: student.department,
      status: record ? 'INSIDE' : 'NOT_ENTERED',
      attendance_id: record?.attendance_id || null,
      checked_in_at: record?.timestamp || null,
    };
  });
}

function parseSearchFilters(url) {
  const q = (url.searchParams.get('q') || '').trim();
  const department = (url.searchParams.get('department') || '').trim();
  const rawStatus = (url.searchParams.get('status') || '').trim().toUpperCase();
  if (q.length > 100 || department.length > 100) {
    throw new AppError(400, 'INVALID_QUERY', 'Search values must not exceed 100 characters.');
  }
  if (rawStatus && !['INSIDE', 'NOT_ENTERED'].includes(rawStatus)) {
    throw new AppError(400, 'INVALID_STATUS', 'status must be INSIDE or NOT_ENTERED.');
  }
  return { q, department, status: rawStatus };
}

function applySearchFilters(students, filters) {
  const query = filters.q.toLocaleLowerCase();
  const department = filters.department.toLocaleLowerCase();
  return students.filter((student) => {
    const queryMatches = !query || student.student_id.toLocaleLowerCase().includes(query) ||
      student.name.toLocaleLowerCase().includes(query);
    const departmentMatches = !department || student.department.toLocaleLowerCase() === department;
    const statusMatches = !filters.status || student.status === filters.status;
    return queryMatches && departmentMatches && statusMatches;
  });
}

function rateLimitOrThrow(limiter, key, policy) {
  const result = limiter.consume(key, policy);
  if (!result.allowed) {
    const error = new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests. Please try again later.');
    error.headers = { 'Retry-After': String(result.retryAfterSeconds) };
    throw error;
  }
  return result;
}

function defaultUsers() {
  return [
    {
      username: process.env.ORGANISER_USERNAME || 'organiser',
      password: process.env.ORGANISER_PASSWORD || 'organise123',
      role: 'ORGANISER',
    },
    {
      username: process.env.VIEWER_USERNAME || 'viewer',
      password: process.env.VIEWER_PASSWORD || 'view123',
      role: 'VIEWER',
    },
  ];
}

function createAppServer(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const frontendDir = path.resolve(options.frontendDir || path.join(__dirname, '..', 'frontend'));
  const authSecret = options.authSecret || process.env.AUTH_SECRET || 'development-only-change-me';
  const users = options.users || defaultUsers();
  const limiter = new RateLimiter();
  const configuredLimits = options.rateLimits || {};
  const rateLimits = {
    login: { max: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 5, windowMs: 60_000, ...configuredLimits.login },
    checkIn: { max: Number(process.env.RATE_LIMIT_CHECKIN_MAX) || 20, windowMs: 60_000, ...configuredLimits.checkIn },
    search: { max: Number(process.env.RATE_LIMIT_SEARCH_MAX) || 60, windowMs: 60_000, ...configuredLimits.search },
  };

  if (process.env.NODE_ENV === 'production' && authSecret === 'development-only-change-me') {
    throw new Error('AUTH_SECRET must be configured in production.');
  }

  let attendanceQueue = Promise.resolve();
  function withAttendanceLock(work) {
    const current = attendanceQueue.then(work, work);
    attendanceQueue = current.catch(() => {});
    return current;
  }

  async function serveFrontend(req, res, pathname) {
    const files = {
      '/': ['index.html', 'text/html; charset=utf-8'],
      '/index.html': ['index.html', 'text/html; charset=utf-8'],
      '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
      '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    };
    const entry = files[pathname];
    if (!entry || req.method !== 'GET') return false;
    try {
      const content = await fs.readFile(path.join(frontendDir, entry[0]));
      res.writeHead(200, {
        'Content-Type': entry[1],
        'Content-Length': content.length,
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(content);
    } catch {
      failure(res, 500, 'FRONTEND_UNAVAILABLE', 'The frontend could not be loaded.');
    }
    return true;
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/api/v1/health' && req.method === 'GET') {
        return success(res, 200, { status: 'ok' });
      }

      if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown';
        rateLimitOrThrow(limiter, `login:${ip}`, rateLimits.login);
        const body = await readJsonBody(req);
        const username = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const user = users.find((candidate) => candidate.username === username);
        if (!user || !safeEqual(user.password, password)) {
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
        }
        const token = encodeToken(user, authSecret);
        return success(res, 200, {
          token,
          token_type: 'Bearer',
          expires_in: TOKEN_TTL_SECONDS,
          user: { username: user.username, role: user.role },
        });
      }

      if (pathname.startsWith('/api/v1/')) {
        const claims = authenticate(req, authSecret);

        if (pathname === '/api/v1/auth/me' && req.method === 'GET') {
          return success(res, 200, { username: claims.sub, role: claims.role });
        }

        if (pathname === '/api/v1/attendance/check-in' && req.method === 'POST') {
          requireRole(claims, ['ORGANISER']);
          rateLimitOrThrow(limiter, `checkin:${claims.sub}`, rateLimits.checkIn);
          const body = await readJsonBody(req);
          const studentId = validateStudentId(body.student_id);
          const requestId = validateRequestId(body.request_id);

          const result = await withAttendanceLock(async () => {
            const [students, attendance, capacity] = await Promise.all([
              readStudents(dataDir),
              readAttendance(dataDir),
              readCapacity(dataDir),
            ]);

            const priorRequest = attendance.records.find((record) => record.request_id === requestId);
            if (priorRequest) {
              if (normalizeStudentId(priorRequest.student_id) !== studentId) {
                throw new AppError(409, 'REQUEST_ID_CONFLICT', 'request_id has already been used for another student.');
              }
              return { status: 200, record: priorRequest, idempotent: true };
            }

            const student = students.find((candidate) => normalizeStudentId(candidate.student_id) === studentId);
            if (!student) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student is not present in the approved roster.');

            const duplicate = attendance.records.find((record) => normalizeStudentId(record.student_id) === studentId);
            if (duplicate) {
              throw new AppError(409, 'DUPLICATE_ATTENDANCE', 'Student has already checked in.');
            }
            if (attendance.records.length >= capacity) {
              throw new AppError(409, 'CAPACITY_REACHED', 'Event capacity has been reached.');
            }

            const record = {
              attendance_id: `ATT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
              request_id: requestId,
              student_id: student.student_id,
              name: student.name,
              department: student.department,
              timestamp: new Date().toISOString(),
              status: 'INSIDE',
              registered_by: claims.sub,
            };
            attendance.records.push(record);
            await writeAttendance(dataDir, attendance);
            return { status: 201, record, idempotent: false };
          });

          return success(res, result.status, {
            attendance: result.record,
            idempotent: result.idempotent,
            message: result.idempotent ? 'This request was already processed.' : 'Student checked in successfully.',
          });
        }

        if ((pathname === '/api/v1/students/search' || pathname === '/api/v1/attendance/search') && req.method === 'GET') {
          requireRole(claims, ['ORGANISER', 'VIEWER']);
          rateLimitOrThrow(limiter, `search:${claims.sub}`, rateLimits.search);
          const filters = parseSearchFilters(url);
          const [students, attendance] = await Promise.all([readStudents(dataDir), readAttendance(dataDir)]);
          const combined = combineStudentData(students, attendance.records);
          const results = applySearchFilters(combined, filters);
          return success(res, 200, { results, count: results.length, filters });
        }

        if (pathname === '/api/v1/dashboard' && req.method === 'GET') {
          requireRole(claims, ['ORGANISER', 'VIEWER']);
          const [students, attendance, capacity] = await Promise.all([
            readStudents(dataDir),
            readAttendance(dataDir),
            readCapacity(dataDir),
          ]);
          const checkedIn = attendance.records.length;
          const remaining = Math.max(0, capacity - checkedIn);
          const records = [...attendance.records].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
          return success(res, 200, {
            statistics: {
              total_students: students.length,
              capacity,
              checked_in: checkedIn,
              remaining,
              occupancy_percentage: Number(((checkedIn / capacity) * 100).toFixed(1)),
            },
            records,
          });
        }

        throw new AppError(404, 'NOT_FOUND', 'API endpoint not found.');
      }

      if (await serveFrontend(req, res, pathname)) return;
      throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
    } catch (error) {
      if (error instanceof AppError) {
        return failure(res, error.status, error.code, error.message, error.headers);
      }
      console.error('Unexpected request error:', error);
      return failure(res, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`Event Attendance Tracker running at http://localhost:${port}`);
  });
}

module.exports = { createAppServer };
