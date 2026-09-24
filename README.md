# Event Attendance Tracker

A small full-stack attendance system for an authenticated event team. It validates check-ins against a pre-approved JSON roster, persists attendance safely to JSON, prevents duplicate submissions, enforces capacity, and exposes backend-powered roster search and dashboard statistics.

## Stack

- Backend: Node.js 18+ using only built-in modules (`http`, `fs`, `crypto`)
- Frontend: plain HTML, CSS, and browser JavaScript
- Storage: JSON files in `data/`
- Tests: built-in `node:test`

No database, frontend framework, external service, or runtime dependency is required.

## Project structure

```text
backend/server.js       HTTP server, authentication, RBAC, APIs, and file storage
frontend/index.html     Login, dashboard, check-in, search, and attendance UI
frontend/app.js         API integration and UI states
frontend/styles.css     Responsive styling
data/students.json      Approved roster and source of truth for student details
data/attendance.json    Backend-managed persistent attendance records
data/config.json        Event capacity
test/api.test.js        Integration tests for the important challenge scenarios
```

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm start
```

On Windows PowerShell with script execution disabled, use:

```powershell
npm.cmd start
```

Open `http://localhost:3000`. The backend serves the frontend from the same origin.

Development accounts:

| Username | Password | Role | Access |
| --- | --- | --- | --- |
| `organiser` | `organise123` | `ORGANISER` | Read APIs and check-in |
| `viewer` | `view123` | `VIEWER` | Dashboard and search only |

These defaults are for evaluation only. Set environment variables before any real deployment:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` |
| `AUTH_SECRET` | HMAC token signing secret | Development-only value |
| `ORGANISER_USERNAME` / `ORGANISER_PASSWORD` | Organiser credentials | Values above |
| `VIEWER_USERNAME` / `VIEWER_PASSWORD` | Viewer credentials | Values above |
| `DATA_DIR` | Alternate data directory | Repository `data/` |
| `RATE_LIMIT_LOGIN_MAX` | Login attempts per 60 seconds per IP | `5` |
| `RATE_LIMIT_CHECKIN_MAX` | Check-ins per 60 seconds per user | `20` |
| `RATE_LIMIT_SEARCH_MAX` | Searches per 60 seconds per user | `60` |

When `NODE_ENV=production`, the server refuses to start with the default `AUTH_SECRET`.

`data/students.json` is the official roster supplied for the round. The application and tests both read this single source of truth; do not add sample or fallback student datasets. Its shape is:

```json
{
  "event": {
    "event_id": "NEXUS_TECH_2026",
    "event_name": "Nexus Tech Challenge",
    "capacity": 100
  },
  "students": [
    { "student_id": "JAIN2026041", "name": "Aarav Mehta", "department": "AIML" }
  ]
}
```

The event capacity in `data/config.json` is set to the official value of `100`. Do not edit `attendance.json` from the frontend. All changes go through the backend.

## API

All responses use either `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`.

Except for health and login, endpoints require `Authorization: Bearer <token>`.

| Method and path | Role | Purpose |
| --- | --- | --- |
| `GET /api/v1/health` | Public | Health check |
| `POST /api/v1/auth/login` | Public | Authenticate and receive an 8-hour signed token |
| `GET /api/v1/auth/me` | Any authenticated | Return the current user and role |
| `POST /api/v1/attendance/check-in` | `ORGANISER` | Validate and persist a student check-in |
| `GET /api/v1/students/search` | `ORGANISER`, `VIEWER` | Search the combined roster and attendance view |
| `GET /api/v1/attendance/search` | `ORGANISER`, `VIEWER` | Alias for combined attendance-status searches |
| `GET /api/v1/dashboard` | `ORGANISER`, `VIEWER` | Statistics and recent records |

Check-in request:

```json
{
  "student_id": "JAIN2026041",
  "request_id": "req_12345"
}
```

Search parameters can be combined:

- `q`: case-insensitive full or partial student ID/name
- `department`: case-insensitive exact department
- `status`: `INSIDE` or `NOT_ENTERED`

Examples:

```text
GET /api/v1/students/search?q=rah
GET /api/v1/students/search?q=JAIN2026041
GET /api/v1/attendance/search?department=aiml&status=NOT_ENTERED
```

Important status codes include `200` for reads/idempotent replays, `201` for a new check-in, `400` for invalid input, `401` for missing/invalid authentication, `403` for a disallowed role, `404` for an unknown student, `409` for duplicates/request conflicts/capacity, `415` for a non-JSON POST, `429` for rate limiting, and `500` for a data-file failure.

## Duplicate requests and persistence

Check-in mutations are serialized inside the server process so concurrent double-clicks cannot both pass the duplicate check. Each successful record stores both `student_id` and `request_id`:

- Replaying the same request ID for the same student returns the original record with HTTP `200` and `idempotent: true`.
- Reusing a request ID for a different student returns `409 REQUEST_ID_CONFLICT`.
- Submitting a new request ID for a student already inside returns `409 DUPLICATE_ATTENDANCE`.

The request ID is stored in `attendance.json`, so replay protection survives a restart. Writes use a temporary file followed by rename, which avoids exposing partially written JSON and preserves existing records. Missing, malformed, or unreadable data returns a controlled `500 DATA_FILE_ERROR`; malformed files are not overwritten.

## Rate limiting and security

Login is limited by client IP. Check-in and search are limited by authenticated username. Exceeding a limit returns `429 RATE_LIMIT_EXCEEDED` with `Retry-After`. Limits are intentionally in memory to keep this JSON-based challenge dependency-free; they reset on restart and would need a shared store for multiple server instances.

Authentication tokens are HMAC-SHA256 signed and expire after eight hours. Authorization is enforced by the backend, not by hidden UI controls. Passwords and the signing secret should be supplied by environment variables outside this evaluation project.

## Tests

```bash
npm test
```

Windows PowerShell alternative:

```powershell
npm.cmd test
```

The integration suite verifies invalid credentials, missing authentication, forbidden viewer check-in, invalid/unknown students, concurrent identical requests, duplicate students, request-ID conflicts, capacity rejection, ID/name/department/status search, rate-limit responses, safe malformed-file handling, and persistence after a server restart.

## Assumptions and trade-offs

- The supplied `students.json` file is the only roster dataset and is treated as official. Development users remain local challenge credentials.
- Attendance is entry-only and status is therefore either `INSIDE` or `NOT_ENTERED`.
- A single Node process owns attendance writes. Multiple application processes would require an inter-process file lock or, at production scale, a transactional database and shared rate-limit store.
- JSON data is read for each request. This keeps changes visible and restart-safe, and is appropriate for a small event roster; an indexed store would be preferable for a large roster.
