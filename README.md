# Event Attendance Tracker - Turing Club (Round 1 Tech Audition)

Candidate Name: Vishad Jain  
Branch: candidate/Vishad_Jain  
Target Branch: main  

A full-stack Event Attendance Tracking system built for an authenticated event team. The application validates pre-approved student entries, dynamically and atomically updates JSON-based attendance records, handles network retries and duplicate submissions via request idempotency, enforces venue capacity restrictions, implements API rate limiting, and provides real-time search, filtering, and a live metrics dashboard.

---

## 1. Executive Summary & Audition Requirements

This project addresses all specifications defined for Round 1 Technical Auditions:
- Organiser Authentication & Role-Based Access: Secure login with JWT tokens, bcrypt password hashing, and role-based route guards (ADMIN, ORGANISER).
- Pre-Registered Student Roster: Uses data/students.json as the single source of truth; only roster-listed students can be checked in.
- Dynamic Attendance Data Management: Dynamic read/write operations to data/attendance.json with atomic file replacement to prevent data loss or corruption during restarts.
- Attendance Registration & Capacity Enforcement: Entry-only tracking with automatic capacity checks against event configurations. Blocks registrations when full.
- Search & Filtering System: Multi-parameter, case-insensitive search by student ID, full name, partial name, department (AIML, CSE, ISE, ECE, IT), and status (INSIDE vs NOT_ENTERED).
- Duplicate Request Handling: Two-tier duplicate prevention via client-generated request_id idempotency tokens and student ID duplicate attendance checks.
- Live Dashboard & API Responses: Consistent JSON schemas, real-time venue occupancy percentage, remaining seat counters, recent check-in timeline, and error messaging.
- Clean Bright Theme Interface: User-friendly dashboard using a bright, high-contrast, modern UI with SVG iconography, accessible forms, and zero emojis.

---

## 2. Technology Stack & Assumptions

### Technology Stack
- Backend Runtime: Node.js (v16.x or higher)
- Backend Framework: Express.js
- Authentication & Security: JSON Web Tokens (jsonwebtoken), Bcrypt password hashing (bcryptjs)
- Rate Limiting: express-rate-limit
- Unique Identifiers: UUID v4
- Persistence Layer: Atomic JSON file store (Node.js fs module with temp-file rename semantics)
- Frontend: Vanilla HTML5, Modern CSS3 (Plus Jakarta Sans typography, responsive CSS grid, light theme variables), Vanilla JavaScript (ES6+ async/await, Fetch API)

### Architectural Assumptions
1. Entry-Only Check-In: Exit tracking is out of scope for this round.
2. Single Source of Truth: data/students.json defines valid students. Each student has student_id, name, and department. The event configuration defines event_id, event_name, and capacity.
3. Capacity Enforcement: If event.capacity is 100, attendance records are strictly capped at 100 entries. Any subsequent check-in attempt returns HTTP 403 (CAPACITY_REACHED).
4. Idempotency Lifetime: In-memory idempotency cache deduplicates immediate retries, double-clicks, and network replay attacks.

---

## 3. Project Directory Structure

```
round1-tech-auditions/
|-- backend/
|   |-- config/
|   |   `-- auth.js             # Organiser credentials, JWT secret, and role definitions
|   |-- middleware/
|   |   `-- auth.js             # Bearer JWT verification and role-based guards
|   |-- routes/
|   |   |-- auth.js             # Authentication routes (/api/v1/auth)
|   |   |-- students.js         # Student roster and search routes (/api/v1/students)
|   |   |-- attendance.js       # Attendance registration and filtering (/api/v1/attendance)
|   |   `-- dashboard.js        # Analytics and occupancy metrics (/api/v1/dashboard)
|   |-- utils/
|   |   `-- fileStore.js        # Atomic read and write operations for JSON files
|   |-- package.json            # Node.js dependencies and scripts
|   |-- server.js               # Express application entry, static server, and rate limiters
|   `-- test_api.js             # Automated 15-suite end-to-end verification runner
|-- data/
|   |-- students.json           # Pre-registered roster and event metadata
|   `-- attendance.json         # Dynamic attendance records
|-- frontend/
|   `-- index.html              # Responsive bright-themed single-page dashboard
|-- .gitignore                  # Git ignore rules for dependencies and system files
`-- README.md                   # Complete project documentation and specifications
```

---

## 4. Setup & Running Instructions

### 4.1 Prerequisites
- Node.js (version 16.0 or higher)
- npm (version 8.0 or higher)

### 4.2 Installation & Server Startup
Open a terminal in the repository root:
```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Start the server
npm start
```
The server will initialize on: `http://localhost:5000`

### 4.3 Accessing the Frontend
The Express backend automatically serves the frontend at the root path:
- Open your browser and navigate to: `http://localhost:5000`
- Alternatively, you can open `frontend/index.html` directly in any web browser.

### 4.4 Running Automated Verification Tests
An automated test runner is included in the backend directory. It starts an ephemeral server instance and validates all 15 core functional requirements:
```bash
cd backend
node test_api.js
```

---

## 5. Organiser Authentication & Role-Based Access Control (RBAC)

All endpoints under `/api/v1/students`, `/api/v1/attendance`, and `/api/v1/dashboard` are protected with JWT authentication. Requests must supply:
`Authorization: Bearer <token>`

### User Roles
- ADMIN: Full administrative privileges (roster inspection, student search, check-in registration, live metrics).
- ORGANISER: Event staff privileges (desk check-in registration, student lookup, search and filtering).

### Pre-Configured Accounts
| Username | Password | Role | Permissions |
|---|---|---|---|
| admin | admin@turing2026 | ADMIN | All endpoints, metrics, roster inspection, check-in |
| organiser1 | org@pass123 | ORGANISER | Check-in registration, student search, roster view |

---

## 6. Pre-Registered Student Roster

The system uses `data/students.json` as the ground truth. It supports canonical `student_id` fields as well as `id` aliases.

### Event Configuration Schema
```json
{
  "event": {
    "event_id": "NEXUS_TECH_2026",
    "event_name": "Nexus Tech Challenge",
    "capacity": 100
  }
}
```

### Student Profile Schema
```json
{
  "student_id": "JAIN2026041",
  "name": "Aarav Mehta",
  "department": "AIML"
}
```

---

## 7. Dynamic Attendance Data Management

Attendance records are persisted to `data/attendance.json`.
- Dynamic Updates: Successful check-ins dynamically append a record with a generated `attendance_id`, `student_id`, `request_id`, UTC ISO timestamp (`checked_in_at`), and `registered_by` organiser name.
- Atomic File Operations: `backend/utils/fileStore.js` writes the updated JSON payload to a temporary file (`attendance.json.tmp`) before performing an atomic filesystem rename (`fs.renameSync`). This prevents data corruption or partial writes during server restarts or concurrent writes.
- Client Separation: The frontend never directly accesses or mutates filesystem files. All mutations pass through authorized backend endpoints.

---

## 8. Duplicate Request Handling & Two-Tier Idempotency

To prevent duplicate entries from double-clicks, browser retries, or network replay attacks, the system implements a two-tier deduplication mechanism:

### Tier 1: Request Token Idempotency (Network & Double-Click Mitigation)
1. On each registration submission, the client generates a unique request token: `req_<timestamp>_<random>` (e.g. `req_1711283921000_abc123`).
2. The frontend disables the submit button and displays a progress spinner to eliminate multiple rapid clicks.
3. The backend checks an in-memory idempotency cache (`processedRequestIds`). If the token has already been fulfilled, the server returns HTTP 200 with `{ "success": true, "data": { "idempotent": true }, "message": "Request already processed. No duplicate record created." }`.

### Tier 2: Student Duplicate Check-In Prevention
1. Regardless of the request token, the backend inspects `attendance.json` for existing check-ins matching the `student_id`.
2. If the student has already checked in, the request is rejected with HTTP 409:
```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_ATTENDANCE",
    "message": "Student has already checked in."
  }
}
```

---

## 9. API Rate Limiting Configuration

The backend configures tiered rate limiting using `express-rate-limit`:

1. Global API Rate Limiter:
   - Window: 15 minutes
   - Maximum: 300 requests per IP across all `/api/*` endpoints
   - Purpose: Mitigates denial-of-service attempts and broad scanning.

2. Authentication Rate Limiter:
   - Window: 1 minute
   - Maximum: 15 requests per IP on `/api/v1/auth/*`
   - Purpose: Prevents brute-force credential stuffing attacks.

3. Registration Rate Limiter:
   - Window: 1 minute
   - Maximum: 30 check-ins per IP on `POST /api/v1/attendance/register`
   - Purpose: Protects against automated script abuse while providing ample headroom for event check-in staff.

---

## 10. Complete API Reference

All protected endpoints require `Authorization: Bearer <jwt_token>`.

### 10.1 Authentication Endpoints

#### POST /api/v1/auth/login
Authenticates an organiser and issues a signed JWT.

Request Body:
```json
{
  "username": "admin",
  "password": "admin@turing2026"
}
```

Success Response (HTTP 200):
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "org_001",
      "username": "admin",
      "role": "ADMIN",
      "name": "Admin Organiser"
    }
  }
}
```

Error Response - Invalid Credentials (HTTP 401):
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid username or password."
  }
}
```

#### POST /api/v1/auth/logout
Terminates the client session.

Success Response (HTTP 200):
```json
{
  "success": true,
  "message": "Logged out. Please discard your token on the client side."
}
```

---

### 10.2 Student Roster Endpoints

#### GET /api/v1/students
Retrieves all pre-approved students from `data/students.json`.

Success Response (HTTP 200):
```json
{
  "success": true,
  "data": {
    "students": [
      {
        "student_id": "JAIN2026041",
        "id": "JAIN2026041",
        "name": "Aarav Mehta",
        "department": "AIML"
      }
    ],
    "total": 10
  }
}
```

#### GET /api/v1/students/:id
Retrieves a single student by their ID.

Success Response (HTTP 200):
```json
{
  "success": true,
  "data": {
    "student": {
      "student_id": "JAIN2026041",
      "id": "JAIN2026041",
      "name": "Aarav Mehta",
      "department": "AIML"
    }
  }
}
```

Error Response - Not Found (HTTP 404):
```json
{
  "success": false,
  "error": {
    "code": "STUDENT_NOT_FOUND",
    "message": "No student found with ID: INVALID_ID"
  }
}
```

#### GET /api/v1/students/search?q=<query>&department=<dept>
Performs case-insensitive search across student ID and name, with optional department filtering.

Query Parameters:
- `q`: Partial or full name, or student ID (e.g. `Aarav` or `JAIN2026`)
- `department`: Department code (e.g. `AIML`, `CSE`, `ISE`, `ECE`, `IT`)

Success Response (HTTP 200):
```json
{
  "success": true,
  "data": {
    "students": [
      {
        "student_id": "JAIN2026041",
        "id": "JAIN2026041",
        "name": "Aarav Mehta",
        "department": "AIML"
      }
    ],
    "count": 1
  }
}
```

---

### 10.3 Attendance Endpoints

#### POST /api/v1/attendance/register
Registers a student check-in. Requires `ADMIN` or `ORGANISER` role.

Request Body:
```json
{
  "student_id": "JAIN2026041",
  "request_id": "req_1711283921000_abc123"
}
```

Success Response (HTTP 201):
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

Error Response - Student Not on Roster (HTTP 404):
```json
{
  "success": false,
  "error": {
    "code": "STUDENT_NOT_FOUND",
    "message": "Student UNKNOWN_ID is not on the pre-registered roster."
  }
}
```

Error Response - Duplicate Check-In (HTTP 409):
```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_ATTENDANCE",
    "message": "Student has already checked in."
  }
}
```

Error Response - Capacity Reached (HTTP 403):
```json
{
  "success": false,
  "error": {
    "code": "CAPACITY_REACHED",
    "message": "Event capacity has been reached. No more check-ins allowed."
  }
}
```

Idempotent Replay Response (HTTP 200):
```json
{
  "success": true,
  "data": {
    "idempotent": true
  },
  "message": "Request already processed. No duplicate record created."
}
```

#### GET /api/v1/attendance
Returns all checked-in records enriched with student profile details.

Success Response (HTTP 200):
```json
{
  "success": true,
  "data": {
    "records": [
      {
        "attendance_id": "ATT-85021372",
        "student_id": "JAIN2026041",
        "request_id": "req_1711283921000_abc123",
        "checked_in_at": "2026-09-24T06:10:39.763Z",
        "registered_by": "admin",
        "name": "Aarav Mehta",
        "department": "AIML"
      }
    ],
    "count": 1
  }
}
```

#### GET /api/v1/attendance/search?department=<dept>&status=<status>&q=<query>
Merges the student roster with attendance records to return the full status for every student.

Query Parameters:
- `department`: Filter by department (e.g. `AIML`, `CSE`, `ISE`, `ECE`)
- `status`: Filter by attendance status (`INSIDE` or `NOT_ENTERED`)
- `q`: Search query matching student ID or name

Success Response (HTTP 200):
```json
{
  "success": true,
  "data": {
    "records": [
      {
        "student_id": "JAIN2026041",
        "id": "JAIN2026041",
        "name": "Aarav Mehta",
        "department": "AIML",
        "status": "INSIDE",
        "attendance_id": "ATT-85021372",
        "checked_in_at": "2026-09-24T06:10:39.763Z"
      },
      {
        "student_id": "JAIN2026042",
        "id": "JAIN2026042",
        "name": "Diya Sharma",
        "department": "CSE",
        "status": "NOT_ENTERED",
        "attendance_id": null,
        "checked_in_at": null
      }
    ],
    "count": 2
  }
}
```

---

### 10.4 Live Dashboard Endpoint

#### GET /api/v1/dashboard
Aggregates event capacity, student check-ins, available seats, occupancy percentage, and recent activity.

Success Response (HTTP 200):
```json
{
  "success": true,
  "data": {
    "event": {
      "event_id": "NEXUS_TECH_2026",
      "event_name": "Nexus Tech Challenge",
      "capacity": 100
    },
    "capacity": 100,
    "total_registered_students": 10,
    "checked_in": 1,
    "remaining_slots": 99,
    "occupancy_percentage": 1,
    "recent_check_ins": [
      {
        "attendance_id": "ATT-85021372",
        "student_id": "JAIN2026041",
        "request_id": "req_1711283921000_abc123",
        "checked_in_at": "2026-09-24T06:10:39.763Z",
        "registered_by": "admin",
        "name": "Aarav Mehta",
        "department": "AIML"
      }
    ]
  }
}
```

---

## 11. Data Model, Search Approach & Architectural Trade-offs

### 11.1 Data Model
1. Student Roster (`data/students.json`):
   - Static list of authorized participants.
   - Includes event configuration (`event_id`, `event_name`, `capacity`).
   - Each item includes `student_id`, `name`, and `department`.
2. Attendance Ledger (`data/attendance.json`):
   - Dynamic append-only record set.
   - Each item includes `attendance_id`, `student_id`, `request_id`, `checked_in_at`, and `registered_by`.

### 11.2 Search & Join Approach
- The `/api/v1/attendance/search` endpoint reads `data/students.json` and `data/attendance.json`.
- It indexes attendance records into an in-memory hash map using uppercase `student_id` keys for O(1) status lookup.
- It maps through all students to produce a unified model containing name, ID, department, attendance status (`INSIDE` or `NOT_ENTERED`), attendance ID, and entry timestamp.
- Filtering is executed in-memory with case-insensitive comparisons across query text, department, and status.

### 11.3 Architectural Trade-Offs

| Decision | Context & Trade-Off | Production Recommendation |
|---|---|---|
| JSON File Storage | Satisfies constraints with zero external database dependencies. Atomic temp-rename avoids race conditions during single-node execution. | Relational DB (PostgreSQL) with unique constraints and ACID transactions for multi-node deployments. |
| In-Memory Idempotency Cache | Provides fast, zero-dependency double-click protection during the audition runtime. | Distributed key-value cache (Redis) with TTL keys for cross-instance coordination. |
| Single Integrated Server | Serves both the REST API and the frontend dashboard on a single port (5000) with zero CORS issues. | CDN-hosted static frontend (S3/Cloudflare) communicating with containerized microservices. |
| In-Memory Search Filtering | Fast and responsive for rosters under 10,000 entries with no query engine overhead. | Database indexes (`B-Tree` on student ID, trigram indexes for partial name search). |

---

## 12. Automated Test Suite Results

The automated test runner (`backend/test_api.js`) validates all 15 core behaviors against a live ephemeral server:

```
[TEST] Server listening on ephemeral port 64201
1. Health Check: 200 { success: true, message: 'Event Attendance API is running.' }
2. Auth Login: 200 User: admin Role: ADMIN
3. Unauthenticated rejection: 401 UNAUTHENTICATED
4. Students roster loaded. Total count: 10
5. Search student by name "Aarav": [ 'JAIN2026041: Aarav Mehta' ]
6. Search student by ID "JAIN2026045": [ 'JAIN2026045: Vihaan Patel (ECE)' ]
7. Lookup JAIN2026041: Aarav Mehta
8. First registration status: 201 Record ID: ATT-85021372
9. Duplicate request_id idempotent response: true Request already processed. No duplicate record created.
10. Duplicate attendance rejected: 409 DUPLICATE_ATTENDANCE Student has already checked in.
11. Second registration status: 201 Record ID: ATT-7017155F
12. Attendance search dept=AIML count: 3
13. Attendance search status=INSIDE count: 2 [ 'JAIN2026041 (INSIDE)', 'JAIN2026042 (INSIDE)' ]
14. Attendance search status=NOT_ENTERED count: 8
15. Dashboard Stats: {
  event: 'Nexus Tech Challenge',
  capacity: 100,
  checked_in: 2,
  remaining: 98,
  occupancy: '2%'
}

ALL 15 VERIFICATION SUITES PASSED FLAWLESSLY.
```

---

## 13. Git Workflow & Submission

1. Branch Name: `candidate/Vishad_Jain`
2. Direct pushes to `main` are restricted. All modifications must be submitted via a Pull Request targeting `main`.
3. To push your submission:
   ```bash
   # Add your fork remote if direct push to upstream returns 403
   git remote add myfork https://github.com/<your-username>/round1-tech-auditions.git
   git push -u myfork candidate/Vishad_Jain
   ```
4. Open a Pull Request from `candidate/Vishad_Jain` to `CODING-DARSH/round1-tech-auditions:main`.