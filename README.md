# Event Attendance Tracker

A full-stack attendance system for an authenticated event team: organisers log
in, look up pre-approved students, and register their attendance in real
time, with capacity enforcement and duplicate protection.

## Stack

- **Backend:** Node.js, Express, JWT auth, bcryptjs, express-rate-limit
- **Frontend:** Vanilla HTML/CSS/JS (no build step), served statically by the backend
- **Storage:** Flat JSON files under `data/` (no database required for this round)

## Project structure

```
backend/            Express API (auth, students, attendance)
frontend/            Static organiser dashboard (login, search, check-in)
data/students.json   Pre-approved roster — source of truth
data/attendance.json Attendance records — written only by the backend
data/organisers.json Hashed organiser/volunteer credentials
data/config.json      Event name + capacity
README.md
.gitignore
```

## Setup

```bash
cd backend
npm install
cp .env.example .env      # then edit JWT_SECRET to something random
npm start                 # -> http://localhost:5000
```

Open `http://localhost:5000` in a browser — the backend also serves the
frontend, so no separate dev server is needed.

**Demo accounts** (seeded into `data/organisers.json`, regenerate with
`npm run seed` from `backend/`):

| username   | password        | role       |
|------------|-----------------|------------|
| organiser  | Organiser@123   | organiser  |
| volunteer  | Volunteer@123   | volunteer  |

## 1. Organiser authentication & role-based access

- `POST /api/auth/login` checks the submitted credentials against
  `data/organisers.json` (bcrypt-hashed passwords) and returns a signed JWT
  (`{ username, role }`) plus its expiry.
- `requireAuth` middleware guards every `/api/students` and `/api/attendance`
  route — a missing/invalid/expired token gets a `401`.
- `requireRole("organiser", "volunteer")` guards the mutating check-in route —
  an authenticated-but-unpermitted caller gets `403`.
- Bad credentials return a single generic `401 InvalidCredentials` message
  (never reveals whether the username or the password was wrong).
- Login itself is rate-limited (10 attempts / 15 min) to slow down
  credential-guessing.

## 2. Pre-registered student roster

- `data/students.json` is the only source of truth for `studentId`, `name`,
  `department`.
- `GET /api/students?search=&department=` reads the roster, applies
  case-insensitive search (id or name) and department filtering, and
  annotates each student with whether they've already checked in.
- Check-in (`POST /api/attendance/checkin`) looks the submitted `studentId`
  up against the roster first; unknown, missing, or empty IDs are rejected
  with `400`/`404` before anything is written.

## 3. Dynamic attendance data management

- `backend/utils/jsonStore.js` provides atomic, queued reads/writes:
  - Writes go to a temp file and are then renamed into place, so a crash
    mid-write can never truncate `attendance.json`.
  - A per-file promise queue serializes read-modify-write cycles, so two
    near-simultaneous check-ins can't race and clobber each other's record
    (the duplicate/capacity checks run *inside* the same queued
    transaction as the write).
  - Malformed or unreadable JSON raises a typed `JsonStoreError` that every
    route catches and turns into a clean `500` response instead of crashing
    the server.
- Every successful check-in gets a generated `attendanceId` (UUID) and an
  ISO `timestamp`.
- Data lives on disk in `data/attendance.json`, so it survives both frontend
  refreshes and backend restarts.
- The frontend only ever talks to the API — it has no filesystem access and
  cannot write to `attendance.json` directly.

## 4. Attendance registration & capacity

- `POST /api/attendance/checkin { studentId }` — registers a roster-listed
  student.
- Re-submitting an already-checked-in student returns `409 DuplicateCheckIn`
  with the existing record, and never creates a second entry.
- Capacity is read from `data/config.json` (`capacity` field); once
  `attendance.length >= capacity`, further check-ins return
  `409 CapacityReached`.
- `GET /api/attendance/stats` returns `{ capacity, current, remaining, full }`
  for the dashboard's stat cards.
- Check-in is entry-only in this round — there is no exit/checkout flow.

## API summary

| Method | Route                     | Auth              | Purpose                          |
|--------|----------------------------|-------------------|-----------------------------------|
| POST   | `/api/auth/login`          | —                  | Get a JWT                        |
| GET    | `/api/students`             | any logged-in role | Search/filter roster              |
| GET    | `/api/attendance`           | any logged-in role | Search/filter attendance log      |
| GET    | `/api/attendance/stats`     | any logged-in role | Capacity / current / remaining    |
| POST   | `/api/attendance/checkin`   | organiser, volunteer | Register a student's attendance |

## Rate limiting

- General API: 100 requests/minute per IP.
- Login: 10 attempts/15 minutes per IP.
- Check-in: 20 requests/minute per IP.

All limiters respond with `429 TooManyRequests` and standard `RateLimit-*`
headers.

## Notes / known limits (round 1 scope)

- Storage is flat JSON files, per the brief — fine at this scale, would move
  to a real database for production volume.
- Single-process write queue assumes one backend instance; a multi-instance
  deployment would need a real lock (e.g. DB transaction) instead.
