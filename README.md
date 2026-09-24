# Event Attendance Tracker — Turing Club (Round 1 Tech Audition)

**Candidate Name:** Vishad Jain  
**Branch:** `candidate/Vishad_Jain`  
**Target Branch for PR:** `main`

A production-grade, secure full-stack Event Attendance Tracking system built for authenticated event teams. It validates pre-approved roster entries, atomically updates JSON persistence, handles concurrent double-clicks and network retries via idempotency keys, prevents duplicate check-ins, enforces venue capacity limits, and provides real-time search, filtering, and live dashboard analytics.

---

## 📁 Project Structure

```
round1-tech-auditions/
├── backend/
│   ├── config/
│   │   └── auth.js             # JWT secret, role config, & demo credentials
│   ├── middleware/
│   │   └── auth.js             # Bearer JWT verification & role-based guards
│   ├── routes/
│   │   ├── auth.js             # /api/v1/auth (login & session endpoints)
│   │   ├── students.js         # /api/v1/students (roster lookup & search)
│   │   ├── attendance.js       # /api/v1/attendance (register, search, & list)
│   │   └── dashboard.js        # /api/v1/dashboard (metrics & capacity stats)
│   ├── utils/
│   │   └── fileStore.js        # Atomic file read/write with error resilience
│   ├── package.json
│   ├── server.js               # Express app, static hosting, & rate limiters
│   └── test_api.js             # 15-suite end-to-end automated test runner
├── data/
│   ├── students.json           # Pre-registered roster & event configuration
│   └── attendance.json         # Dynamic attendance records (entry-only)
├── frontend/
│   └── index.html              # Responsive SPA dashboard (CSS tokens & vanilla JS)
├── .gitignore
└── README.md
```

---

## 🛠️ Technology Stack & Assumptions

### Technology Stack
- **Backend:** Node.js, Express.js
- **Authentication:** JSON Web Tokens (`jsonwebtoken`), password hashing (`bcryptjs`)
- **Rate Limiting:** `express-rate-limit`
- **Unique Identifiers:** `uuid` v4
- **Storage:** Atomic JSON file store (`fs`) with `.tmp` write-and-rename semantics
- **Frontend:** Vanilla HTML5, modern CSS3 (custom properties, glassmorphism, responsive grid), Vanilla JavaScript (ES6+ async/await, Fetch API)

### Assumptions
1. **Entry-Only Tracking:** Exit tracking is not required for this round.
2. **Pre-Registered Roster as Ground Truth:** Only students present in `data/students.json` are eligible for check-in. The schema uses canonical `student_id` (also aliased to `id` for backwards compatibility).
3. **Event Capacity:** Event capacity defaults to the value defined in `students.json` (`event.capacity`). Registrations are strictly rejected with HTTP `403` once reached.
4. **Idempotency:** Repeated requests with the same `request_id` are recognized as duplicates and returned idempotently without modifying state.

---

## 🚀 Getting Started & Run Instructions

### 1. Prerequisites
- **Node.js** (v16.x or higher)
- **npm** (v8.x or higher)

### 2. Backend Setup & Startup
```bash
# Navigate to the backend directory
cd backend

# Install dependencies
npm install

# Start the application
npm start
```
The server will start on `http://localhost:5000`.

### 3. Accessing the Frontend
The backend automatically serves the frontend dashboard directly at the root URL:
- Open your browser and navigate to: **`http://localhost:5000`**
- Alternatively, you can open `frontend/index.html` directly in any web browser.

### 4. Running Automated Tests
A comprehensive 15-point verification suite covers authentication, role guards, student lookups, registration, duplicate prevention, idempotency, filtering, and dashboard stats:
```bash
cd backend
node test_api.js
```

---

## 🔐 Credentials & Role-Based Access

The backend implements role-based access control (RBAC):
- **`ADMIN`:** Full administrative access (search, registration, analytics, roster viewing).
- **`ORGANISER`:** Event staff access for attendance desk check-ins and search.

### Default Login Accounts:
| Username | Password | Role | Permissions |
|---|---|---|---|
| `admin` | `admin@turing2026` | `ADMIN` | All endpoints, stats, check-in |
| `organiser1` | `org@pass123` | `ORGANISER` | Student check-in, search, view |

---

## 📡 API Endpoint Documentation

All protected endpoints require the header:
```
Authorization: Bearer <jwt_token>
```

### 1. Authentication
- **`POST /api/v1/auth/login`**
  - **Body:** `{ "username": "admin", "password": "admin@turing2026" }`
  - **Success Response (200):**
    ```json
    {
      "success": true,
      "data": {
        "token": "<jwt_token>",
        "user": { "id": "org_001", "username": "admin", "role": "ADMIN", "name": "Admin Organiser" }
      }
    }
    ```
- **`POST /api/v1/auth/logout`**
  - Logs out the user session.

### 2. Students Roster
- **`GET /api/v1/students`**
  - Returns the complete pre-registered student roster from `data/students.json`.
- **`GET /api/v1/students/:id`**
  - Retrieves a single student by their ID (e.g. `JAIN2026041`).
- **`GET /api/v1/students/search?q=<query>&department=<dept>`**
  - Performs case-insensitive matching across `student_id` and `name`.
  - Supports optional department filtering (`AIML`, `CSE`, `ISE`, `ECE`).

### 3. Attendance Management
- **`POST /api/v1/attendance/register`**
  - Registers a student's entry into the venue.
  - **Body:**
    ```json
    {
      "student_id": "JAIN2026041",
      "request_id": "req_1711283921000_abc"
    }
    ```
  - **Success Response (201):**
    ```json
    {
      "success": true,
      "data": {
        "attendance_id": "ATT-85021372",
        "student_id": "JAIN2026041",
        "name": "Aarav Mehta",
        "department": "AIML",
        "checked_in_at": "2026-09-24T06:10:39.763Z",
        "registered_by": "admin",
        "current_count": 1,
        "capacity": 100,
        "remaining": 99
      }
    }
    ```
  - **Duplicate Attendance (409):**
    ```json
    {
      "success": false,
      "error": {
        "code": "DUPLICATE_ATTENDANCE",
        "message": "Student has already checked in."
      }
    }
    ```
  - **Capacity Reached (403):**
    ```json
    {
      "success": false,
      "error": {
        "code": "CAPACITY_REACHED",
        "message": "Event capacity has been reached. No more check-ins allowed."
      }
    }
    ```

- **`GET /api/v1/attendance`**
  - Returns all registered attendance records enriched with student profile data.
- **`GET /api/v1/attendance/search?department=<dept>&status=<INSIDE|NOT_ENTERED>&q=<query>`**
  - Merges `students.json` with `attendance.json` to return real-time status (`INSIDE` vs `NOT_ENTERED`) for every student.

### 4. Live Dashboard Analytics
- **`GET /api/v1/dashboard`**
  - Returns live event metrics: total students, current checked-in count, remaining capacity, occupancy percentage, and recent check-in timeline.

---

## 🛡️ Duplicate Request Handling & Rate Limiting

### 1. Duplicate Request Handling (Two-Tier Idempotency)
Double-clicks, network lag, and browser retries are handled through a two-phase check:
1. **Network Retries / Double Clicks (`request_id` Idempotency):**
   - The frontend generates a unique idempotency key (`req_<timestamp>_<random>`) per registration attempt.
   - If the backend receives an identical `request_id` that was already completed, it recognizes the operation has already succeeded and immediately returns HTTP `200` with `{ idempotent: true }` without inserting a second record.
   - The frontend submit button is also disabled in-flight to prevent duplicate dispatch.
2. **Duplicate Student Check-In Prevention:**
   - Even with different `request_id`s, the backend checks `attendance.json` for any existing record with the target `student_id`.
   - If already inside, the request is rejected with HTTP `409` (`DUPLICATE_ATTENDANCE`).

### 2. Rate Limiting Configuration
Powered by `express-rate-limit`:
- **Global API Limiter:**
  - `300 requests per 15-minute window` per IP for all `/api` endpoints to mitigate scanning and DoS attempts.
- **Authentication Limiter (`/api/v1/auth/*`):**
  - `15 requests per 1-minute window` to protect against credential stuffing and brute force attacks.
- **Registration Limiter (`POST /api/v1/attendance/register`):**
  - `30 check-ins per 1-minute window` per IP, preventing automated script flooding while providing comfortable headroom for high-throughput entry desk scanning.

---

## 💾 Data Model, Search Approach & Architectural Trade-offs

### 1. Data Model
- **`students.json` (Source of Truth):**
  - Immutable pre-approved roster containing `event` metadata (`event_id`, `event_name`, `capacity`) and an array of `students` (`student_id`, `name`, `department`).
- **`attendance.json` (Dynamic Append-Only Log):**
  - Contains array of `records`:
    - `attendance_id`: Generated UUID prefix (e.g. `ATT-85021372`)
    - `student_id`: Foreign key reference to `students.json`
    - `request_id`: Client idempotency token
    - `checked_in_at`: ISO 8601 UTC timestamp
    - `registered_by`: Username of the authenticated organiser who authorized the check-in

### 2. Search & Filter Architecture
- **In-Memory Joining:** The `/api/v1/attendance/search` endpoint reads both `students.json` and `attendance.json`, indexes the attendance records into an $O(1)$ hash map by `student_id`, and merges each student profile with their status (`INSIDE` if present in attendance, otherwise `NOT_ENTERED`).
- **Case-Insensitive Multi-Field Querying:** Supports full-name, partial-name, and exact student ID queries along with department and status filtering.

### 3. Trade-offs & Production Considerations
| Approach | Advantage in Audit Context | Production Alternative |
|---|---|---|
| **JSON File Storage** | Zero external infrastructure requirements; highly portable and inspectable directly in Git. | PostgreSQL / MongoDB with ACID transactions and unique indexes (`student_id` index). |
| **Atomic File Writes (`.tmp` rename)** | Prevents file corruption during unexpected crashes or concurrent writes. | Database transaction locks (`SELECT ... FOR UPDATE`). |
| **In-Memory Idempotency Cache** | Instant lookup speeds for double-click mitigation without Redis setup. | Distributed Redis key-value store with TTL (e.g. `SETNX` with 24-hour expiration). |
| **Unified Single Server** | Serves backend API and client dashboard on one port, zero CORS frictions for deployment. | CDN-hosted static frontend (S3/Vercel) communicating with scalable containerized backend (ECS/Cloud Run). |