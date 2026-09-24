'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAppServer } = require('../backend/server');

const TEST_USERS = [
  { username: 'organiser', password: 'secret123', role: 'ORGANISER' },
  { username: 'viewer', password: 'view123', role: 'VIEWER' },
];

// Tests consume the same official roster file as the application. Keeping no
// second student list prevents fixtures from drifting away from round data.
const OFFICIAL_ROSTER = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'students.json'), 'utf8'));
const STUDENTS = OFFICIAL_ROSTER.students;

async function createFixture({ capacity = 3, attendance = { records: [] } } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attendance-api-'));
  await Promise.all([
    fs.writeFile(path.join(dataDir, 'students.json'), JSON.stringify(OFFICIAL_ROSTER, null, 2)),
    fs.writeFile(path.join(dataDir, 'attendance.json'), JSON.stringify(attendance, null, 2)),
    fs.writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ capacity }, null, 2)),
  ]);
  return dataDir;
}

async function startServer(dataDir, options = {}) {
  const server = createAppServer({
    dataDir,
    authSecret: 'test-auth-secret',
    users: TEST_USERS,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function jsonRequest(baseUrl, route, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function login(baseUrl, username = 'organiser', password = 'secret123') {
  const { response, payload } = await jsonRequest(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(response.status, 200);
  return payload.data.token;
}

test('authentication and RBAC return 401 and 403 correctly', async (t) => {
  const dataDir = await createFixture();
  const { server, baseUrl } = await startServer(dataDir);
  t.after(async () => {
    await closeServer(server);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const invalidLogin = await jsonRequest(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'organiser', password: 'wrong' },
  });
  assert.equal(invalidLogin.response.status, 401);
  assert.equal(invalidLogin.payload.error.code, 'INVALID_CREDENTIALS');

  const noToken = await jsonRequest(baseUrl, '/api/v1/dashboard');
  assert.equal(noToken.response.status, 401);

  const viewerToken = await login(baseUrl, 'viewer', 'view123');
  const forbidden = await jsonRequest(baseUrl, '/api/v1/attendance/check-in', {
    method: 'POST',
    token: viewerToken,
    body: { student_id: 'JAIN2026041', request_id: 'viewer-request' },
  });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.payload.error.code, 'FORBIDDEN');
});

test('frontend and health check are served by the backend', async (t) => {
  const dataDir = await createFixture();
  const { server, baseUrl } = await startServer(dataDir);
  t.after(async () => {
    await closeServer(server);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(await page.text(), /Attendance Tracker/);

  const script = await fetch(`${baseUrl}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /^text\/javascript/);

  const health = await jsonRequest(baseUrl, '/api/v1/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.data.status, 'ok');
});

test('registration is atomic, idempotent, duplicate-safe, and persistent after restart', async (t) => {
  const dataDir = await createFixture();
  let running = await startServer(dataDir);
  t.after(async () => {
    if (running) await closeServer(running.server);
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const token = await login(running.baseUrl);

  const invalid = await jsonRequest(running.baseUrl, '/api/v1/attendance/check-in', {
    method: 'POST', token, body: { student_id: '', request_id: 'invalid-id' },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.error.code, 'INVALID_STUDENT_ID');

  const unknown = await jsonRequest(running.baseUrl, '/api/v1/attendance/check-in', {
    method: 'POST', token, body: { student_id: 'JAIN9999999', request_id: 'unknown-student' },
  });
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.payload.error.code, 'STUDENT_NOT_FOUND');

  const checkIn = () => jsonRequest(running.baseUrl, '/api/v1/attendance/check-in', {
    method: 'POST', token, body: { student_id: 'jain2026041', request_id: 'req-concurrent-1' },
  });
  const concurrent = await Promise.all([checkIn(), checkIn()]);
  assert.deepEqual(concurrent.map((result) => result.response.status).sort(), [200, 201]);
  assert.equal(concurrent[0].payload.data.attendance.attendance_id, concurrent[1].payload.data.attendance.attendance_id);

  const duplicate = await jsonRequest(running.baseUrl, '/api/v1/attendance/check-in', {
    method: 'POST', token, body: { student_id: 'JAIN2026041', request_id: 'req-different' },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.error.code, 'DUPLICATE_ATTENDANCE');

  const conflict = await jsonRequest(running.baseUrl, '/api/v1/attendance/check-in', {
    method: 'POST', token, body: { student_id: 'JAIN2026042', request_id: 'req-concurrent-1' },
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.error.code, 'REQUEST_ID_CONFLICT');

  const persisted = JSON.parse(await fs.readFile(path.join(dataDir, 'attendance.json'), 'utf8'));
  assert.equal(persisted.records.length, 1);

  await closeServer(running.server);
  running = await startServer(dataDir);
  const dashboard = await jsonRequest(running.baseUrl, '/api/v1/dashboard', { token });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.payload.data.statistics.checked_in, 1);
  assert.equal(dashboard.payload.data.records[0].student_id, 'JAIN2026041');
});

test('capacity is enforced after the configured number of registrations', async (t) => {
  const dataDir = await createFixture({ capacity: 1 });
  const { server, baseUrl } = await startServer(dataDir);
  t.after(async () => {
    await closeServer(server);
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const token = await login(baseUrl);

  const first = await jsonRequest(baseUrl, '/api/v1/attendance/check-in', {
    method: 'POST', token, body: { student_id: 'JAIN2026041', request_id: 'capacity-1' },
  });
  assert.equal(first.response.status, 201);

  const second = await jsonRequest(baseUrl, '/api/v1/attendance/check-in', {
    method: 'POST', token, body: { student_id: 'JAIN2026042', request_id: 'capacity-2' },
  });
  assert.equal(second.response.status, 409);
  assert.equal(second.payload.error.code, 'CAPACITY_REACHED');

  const dashboard = await jsonRequest(baseUrl, '/api/v1/dashboard', { token });
  assert.deepEqual(dashboard.payload.data.statistics, {
    total_students: 10,
    capacity: 1,
    checked_in: 1,
    remaining: 0,
    occupancy_percentage: 100,
  });
});

test('search combines roster and attendance with case-insensitive filters', async (t) => {
  const attendance = {
    records: [{
      attendance_id: 'ATT-TEST-1', request_id: 'seed-request', student_id: 'JAIN2026041',
      name: 'Aarav Mehta', department: 'AIML', timestamp: '2026-09-24T08:00:00.000Z',
      status: 'INSIDE', registered_by: 'organiser',
    }],
  };
  const dataDir = await createFixture({ attendance });
  const { server, baseUrl } = await startServer(dataDir);
  t.after(async () => {
    await closeServer(server);
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const token = await login(baseUrl, 'viewer', 'view123');

  const byId = await jsonRequest(baseUrl, '/api/v1/students/search?q=jain2026041', { token });
  assert.equal(byId.payload.data.results.length, 1);
  assert.equal(byId.payload.data.results[0].status, 'INSIDE');

  const byPartialName = await jsonRequest(baseUrl, '/api/v1/students/search?q=HaR', { token });
  assert.equal(byPartialName.payload.data.results[0].student_id, 'JAIN2026042');

  const byDepartment = await jsonRequest(baseUrl, '/api/v1/attendance/search?department=cse', { token });
  assert.deepEqual(
    byDepartment.payload.data.results.map((student) => student.student_id),
    STUDENTS.filter((student) => student.department === 'CSE').map((student) => student.student_id),
  );

  const byStatus = await jsonRequest(baseUrl, '/api/v1/attendance/search?status=not_entered', { token });
  assert.deepEqual(
    byStatus.payload.data.results.map((student) => student.student_id),
    STUDENTS.slice(1).map((student) => student.student_id),
  );

  const invalidStatus = await jsonRequest(baseUrl, '/api/v1/students/search?status=LEFT', { token });
  assert.equal(invalidStatus.response.status, 400);
  assert.equal(invalidStatus.payload.error.code, 'INVALID_STATUS');
});

test('login rate limiting returns 429 with a Retry-After header', async (t) => {
  const dataDir = await createFixture();
  const { server, baseUrl } = await startServer(dataDir, {
    rateLimits: { login: { max: 2, windowMs: 60_000 } },
  });
  t.after(async () => {
    await closeServer(server);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await jsonRequest(baseUrl, '/api/v1/auth/login', {
      method: 'POST', body: { username: 'organiser', password: 'wrong' },
    });
    assert.equal(result.response.status, 401);
  }
  const limited = await jsonRequest(baseUrl, '/api/v1/auth/login', {
    method: 'POST', body: { username: 'organiser', password: 'wrong' },
  });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.payload.error.code, 'RATE_LIMIT_EXCEEDED');
  assert.ok(Number(limited.response.headers.get('retry-after')) >= 1);
});

test('malformed JSON data is reported without overwriting the file', async (t) => {
  const dataDir = await createFixture();
  await fs.writeFile(path.join(dataDir, 'attendance.json'), '{not valid json');
  const { server, baseUrl } = await startServer(dataDir);
  t.after(async () => {
    await closeServer(server);
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const token = await login(baseUrl);
  const dashboard = await jsonRequest(baseUrl, '/api/v1/dashboard', { token });
  assert.equal(dashboard.response.status, 500);
  assert.equal(dashboard.payload.error.code, 'DATA_FILE_ERROR');
  assert.equal(await fs.readFile(path.join(dataDir, 'attendance.json'), 'utf8'), '{not valid json');
});
