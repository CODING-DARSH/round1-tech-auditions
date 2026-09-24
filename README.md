# Event Attendance Tracker — Tech Auditions 2026

A full-stack web application for managing event attendance with authentication, role-based access control, real-time capacity tracking, duplicate-request prevention, and API rate limiting.

---

## 🚀 Setup & Run

### Prerequisites
- Node.js ≥ 18
- npm

### 1 — Install backend dependencies
```bash
cd backend
npm install
```

### 2 — Start the server
```bash
# Production
npm start

# Development (auto-restart on changes)
npm run dev
```

The server starts on **http://localhost:3000**  
The frontend is served from the same origin — open your browser at `http://localhost:3000`.

> `data/students.json` and `data/attendance.json` are included in the repo.  
> `attendance.json` is automatically re-created if deleted (empty state).

---

## 🔐 Default Credentials

| Role       | Username     | Password    | Permissions                        |
|------------|--------------|-------------|------------------------------------|
| Admin      | `admin`      | `Admin@123` | register, view, search, manage     |
| Organizer  | `organizer1` | `Org@2026`  | register, view, search             |
| Viewer     | `viewer1`    | `View@2026`  | view, search (read-only)           |

---

## 🛠 Technology Stack

| Layer     | Technology                                  |
|-----------|---------------------------------------------|
| Runtime   | Node.js 18+                                 |
| Framework | Express.js 4                                |
| Auth      | JSON Web Tokens (`jsonwebtoken`)            |
| Passwords | bcrypt (`bcryptjs`, cost factor 10)         |
| Rate Limit| `express-rate-limit`                        |
| IDs       | UUID v4 (`uuid`)                            |
| Storage   | JSON flat-file (no database required)       |
| Frontend  | Vanilla HTML5 / CSS3 / JavaScript (no framework) |

---

## 📁 Project Structure

```
├── backend/
│   ├── server.js                 # Express entry point
│   ├── package.json
│   ├── config/
│   │   ├── event.config.js       # JWT secret, expiry
│   │   └── users.js              # Organiser accounts (bcrypt-hashed)
│   ├── middleware/
│   │   ├── auth.js               # JWT verify, authorize(), requirePermission()
│   │   └── rateLimiter.js        # 4 tiered rate limiters
│   ├── routes/
│   │   ├── auth.js               # POST /login, GET /me, POST /logout
│   │   ├── students.js           # GET /, GET /search
│   │   ├── attendance.js         # POST /register, GET /, GET /search
│   │   └── dashboard.js          # GET /stats
│   └── utils/
│       ├── fileStorage.js        # Atomic JSON read/write helpers
│       └── response.js           # Consistent API response helpers
├── frontend/
│   ├── index.html                # Single-page application
│   ├── style.css                 # Dark theme UI
│   └── app.js                    # Auth, dashboard, registration, search
├── data/
│   ├── students.json             # 20 pre-registered students + event config
│   └── attendance.json           # Dynamic check-in records (backend-managed)
├── .gitignore
└── README.md
```

---

## 📡 API Endpoint Documentation

All endpoints return:
```json
{ "success": true|false, "message": "...", "data": {}, "timestamp": "ISO-8601" }
```
Error responses:
```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Human-readable message" }, "timestamp": "..." }
```

### Auth — `/api/v1/auth`

| Method | Path      | Auth | Rate Limit    | Description                |
|--------|-----------|------|---------------|----------------------------|
| POST   | `/login`  | ✗    | 10 / 15 min   | Login, returns JWT         |
| GET    | `/me`     | ✓    | General       | Return current user info   |
| POST   | `/logout` | ✓    | General       | Acknowledge logout         |

**POST /login request:**
```json
{ "username": "admin", "password": "Admin@123" }
```

---

### Students — `/api/v1/students`

| Method | Path      | Auth | Permission | Rate Limit  | Description                              |
|--------|-----------|------|------------|-------------|------------------------------------------|
| GET    | `/`       | ✓    | view       | General     | Full roster enriched with status         |
| GET    | `/search` | ✓    | search     | 60 / 1 min  | Search by name, ID, or department        |

**GET /search?q=rah** — case-insensitive, matches student_id, name, department.

---

### Attendance — `/api/v1/attendance`

| Method | Path        | Auth | Permission | Rate Limit  | Description                              |
|--------|-------------|------|------------|-------------|------------------------------------------|
| POST   | `/register` | ✓    | register   | 20 / 1 min  | Check in a student                       |
| GET    | `/`         | ✓    | view       | General     | All records + capacity summary           |
| GET    | `/search`   | ✓    | search     | 60 / 1 min  | Filter by department, status, text       |

**POST /register request:**
```json
{ "student_id": "STU1001", "request_id": "req_12345" }
```

**GET /search query params (all optional, combinable):**
- `department=AIML`
- `status=INSIDE | NOT_ENTERED`
- `q=rahul`

---

### Dashboard — `/api/v1/dashboard`

| Method | Path     | Auth | Description                                     |
|--------|----------|------|-------------------------------------------------|
| GET    | `/stats` | ✓    | Live stats: occupancy, dept breakdown, recents  |

---

## 🔁 Duplicate Request Handling

**Two complementary layers:**

1. **Business-logic guard (server-side):**  
   Before every check-in, the backend checks `attendance.json` for an existing record with the same `student_id`. If found, it returns:
   ```json
   { "success": false, "error": { "code": "DUPLICATE_ATTENDANCE", "message": "Student has already checked in." } }
   ```

2. **Idempotency key (`request_id`):**  
   Clients send a unique `request_id` with each registration request. The backend stores processed request IDs in `attendance.json → processed_requests[]`. If the **same** `request_id` arrives again (e.g., from a double-click, network retry, or browser refresh), the server detects it and returns the **original response** without creating a duplicate record.

3. **Frontend double-click guard:**  
   The `isRegistering` boolean flag in `app.js` disables the submit handler while a request is in flight, preventing rapid re-submissions before the server responds.

---

## ⚡ Rate Limiting Configuration

| Limiter           | Endpoint(s)               | Window   | Max Requests |
|-------------------|---------------------------|----------|-------------|
| `authLimiter`     | POST /auth/login           | 15 min   | 10           |
| `registerLimiter` | POST /attendance/register  | 1 min    | 20           |
| `searchLimiter`   | GET /*/search              | 1 min    | 60           |
| `generalLimiter`  | ALL /api/*                 | 15 min   | 100          |

Rate limit responses use HTTP 429 with:
```json
{ "success": false, "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "..." } }
```
Headers `RateLimit-Limit` and `RateLimit-Remaining` are included in every API response.

---

## 🗄 Data Model

### `data/students.json`
```json
{
  "event": { "name": "...", "capacity": 15, "venue": "...", "date": "..." },
  "students": [
    { "student_id": "STU1001", "name": "Rahul Sharma", "department": "CS", "year": 2, "email": "..." }
  ]
}
```
- **Single source of truth** for the approved student roster and event capacity.
- Never modified by the backend at runtime.

### `data/attendance.json`
```json
{
  "records": [
    {
      "attendance_id": "ATT-A1B2C3D4",
      "student_id": "STU1001",
      "name": "Rahul Sharma",
      "department": "CS",
      "year": 2,
      "status": "INSIDE",
      "attended_at": "2026-09-24T07:30:00.000Z",
      "registered_by": "admin",
      "request_id": "req_12345"
    }
  ],
  "processed_requests": [
    { "request_id": "req_12345", "student_id": "STU1001", "attendance_id": "ATT-A1B2C3D4", "processed_at": "..." }
  ]
}
```
- **Only the backend writes to this file.** The frontend never touches it directly.
- Atomic writes (write to `.tmp`, then rename) prevent partial writes from corrupting data.

### Search Approach
- All search and filtering happens **server-side** via dedicated API endpoints.
- Student and attendance data are **joined at query time** — no denormalisation.
- Filtering order: department (exact) → status → text (substring, case-insensitive).

### Trade-offs
| Decision | Trade-off |
|---|---|
| JSON flat-file storage | Simple, no DB setup; not suited for concurrent high-volume writes (file lock contention) |
| Passwords hashed in-memory config | Avoids a setup step; not suitable for dynamic user management |
| JWT stateless auth | No server-side session store; token cannot be revoked before expiry (8h) |
| No exit tracking | Simplifies state model per spec; "status" field is present for future extension |

---

## 🔧 Assumptions

1. Event capacity is configured in `data/students.json → event.capacity` (currently 15).
2. Only the 20 students in `students.json` may check in; no self-registration.
3. Attendance is entry-only (INSIDE / NOT_ENTERED); exit tracking is out of scope.
4. A single Node.js process handles all requests (no clustering/concurrency concerns with file writes).
5. JWT secret should be replaced via the `JWT_SECRET` environment variable in production.

---

## 🌿 Git Workflow

```bash
# Clone the repo
git clone https://github.com/CODING-DARSH/round1-tech-auditions
cd round1-tech-auditions

# Create candidate branch
git checkout -b candidate/your-name

# Push and open PR to main
git push origin candidate/your-name
```
