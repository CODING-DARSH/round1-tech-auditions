const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");

const app = express();

const PORT = 3000;

const ROOT = path.join(__dirname, "..");

const STUDENTS_FILE = path.join(
  ROOT,
  "data",
  "students.json"
);

const ATTENDANCE_FILE = path.join(
  ROOT,
  "data",
  "attendance.json"
);

const FRONTEND_DIR = path.join(
  ROOT,
  "frontend"
);

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "nexus-tech-challenge-secret";

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME ||
  "organiser";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  "organiser123";

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(express.json());

app.use(express.static(FRONTEND_DIR));

// --------------------------------------------------
// JSON FILE HELPERS
// --------------------------------------------------

async function readJson(file) {
  const content = await fs.readFile(file, "utf8");
  return JSON.parse(content);
}

async function writeJson(file, data) {
  await fs.writeFile(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

// --------------------------------------------------
// SIMPLE WRITE LOCK
// Prevents two check-ins from writing attendance.json
// at the exact same time inside this server process.
// --------------------------------------------------

let attendanceWriteLock = Promise.resolve();

function withAttendanceLock(operation) {
  const nextOperation = attendanceWriteLock.then(operation);

  attendanceWriteLock = nextOperation.catch(() => {});

  return nextOperation;
}

// --------------------------------------------------
// RATE LIMITERS
// --------------------------------------------------

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many login attempts. Try again later."
  }
});

const checkInLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many check-in requests. Try again later."
  }
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many search requests. Try again later."
  }
});

// --------------------------------------------------
// JWT AUTHENTICATION
// --------------------------------------------------

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (
    !authHeader ||
    !authHeader.startsWith("Bearer ")
  ) {
    return res.status(401).json({
      error: "Authentication required"
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }
}

// --------------------------------------------------
// RBAC
// --------------------------------------------------

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({
        error: "Insufficient permissions"
      });
    }

    next();
  };
}

// --------------------------------------------------
// SWAGGER
// --------------------------------------------------

const swaggerDocument = {
  openapi: "3.0.0",

  info: {
    title: "Nexus Tech Challenge - Attendance API",
    version: "1.0.0",
    description:
      "Backend API for event attendance tracking"
  },

  servers: [
    {
      url: "http://localhost:3000"
    }
  ],

  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    },

    schemas: {
      LoginRequest: {
        type: "object",
        required: [
          "username",
          "password"
        ],
        properties: {
          username: {
            type: "string",
            example: "organiser"
          },
          password: {
            type: "string",
            example: "organiser123"
          }
        }
      },

      CheckInRequest: {
        type: "object",
        required: [
          "student_id",
          "request_id"
        ],
        properties: {
          student_id: {
            type: "string",
            example: "JAIN2026041"
          },
          request_id: {
            type: "string",
            example: "req-12345"
          }
        }
      }
    }
  },

  paths: {
    // ------------------------------------------------
    // LOGIN
    // ------------------------------------------------

    "/api/v1/auth/login": {
      post: {
        summary: "Organiser login",

        requestBody: {
          required: true,

          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/LoginRequest"
              }
            }
          }
        },

        responses: {
          200: {
            description: "Login successful"
          },

          400: {
            description: "Missing credentials"
          },

          401: {
            description: "Invalid credentials"
          },

          429: {
            description: "Rate limit exceeded"
          }
        }
      }
    },

    // ------------------------------------------------
    // DASHBOARD
    // ------------------------------------------------

    "/api/v1/dashboard": {
      get: {
        summary: "Get dashboard statistics",

        security: [
          {
            bearerAuth: []
          }
        ],

        responses: {
          200: {
            description: "Dashboard statistics"
          },

          401: {
            description: "Authentication required"
          },

          403: {
            description: "Insufficient permissions"
          }
        }
      }
    },

    // ------------------------------------------------
    // CHECK-IN
    // ------------------------------------------------

    "/api/v1/attendance/check-in": {
      post: {
        summary: "Check in a student",

        security: [
          {
            bearerAuth: []
          }
        ],

        requestBody: {
          required: true,

          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CheckInRequest"
              }
            }
          }
        },

        responses: {
          201: {
            description: "Student checked in"
          },

          400: {
            description: "Invalid request"
          },

          401: {
            description: "Authentication required"
          },

          403: {
            description: "Insufficient permissions"
          },

          404: {
            description: "Student not found"
          },

          409: {
            description:
              "Duplicate check-in, duplicate request, or capacity reached"
          },

          429: {
            description: "Rate limit exceeded"
          }
        }
      }
    },

    // ------------------------------------------------
    // STUDENT SEARCH
    // ------------------------------------------------

    "/api/v1/students/search": {
      get: {
        summary: "Search students",

        security: [
          {
            bearerAuth: []
          }
        ],

        parameters: [
          {
            name: "q",
            in: "query",
            required: false,

            schema: {
              type: "string"
            },

            example: "Aarav"
          }
        ],

        responses: {
          200: {
            description: "Student search results"
          },

          401: {
            description: "Authentication required"
          },

          403: {
            description: "Insufficient permissions"
          },

          429: {
            description: "Rate limit exceeded"
          }
        }
      }
    },

    // ------------------------------------------------
    // ATTENDANCE SEARCH
    // ------------------------------------------------

    "/api/v1/attendance/search": {
      get: {
        summary: "Search attendance records",

        security: [
          {
            bearerAuth: []
          }
        ],

        parameters: [
          {
            name: "q",
            in: "query",

            schema: {
              type: "string"
            },

            example: "Aarav"
          },

          {
            name: "department",
            in: "query",

            schema: {
              type: "string"
            },

            example: "AIML"
          },

          {
            name: "status",
            in: "query",

            schema: {
              type: "string"
            },

            example: "INSIDE"
          }
        ],

        responses: {
          200: {
            description: "Attendance search results"
          },

          401: {
            description: "Authentication required"
          },

          403: {
            description: "Insufficient permissions"
          },

          429: {
            description: "Rate limit exceeded"
          }
        }
      }
    }
  }
};

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument)
);

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

app.post(
  "/api/v1/auth/login",
  loginLimiter,
  async (req, res) => {
    try {
      const {
        username,
        password
      } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          error:
            "Username and password are required"
        });
      }

      if (
        username !== ADMIN_USERNAME ||
        password !== ADMIN_PASSWORD
      ) {
        return res.status(401).json({
          error:
            "Invalid username or password"
        });
      }

      const token = jwt.sign(
        {
          username,
          role: "organiser"
        },
        JWT_SECRET,
        {
          expiresIn: "2h"
        }
      );

      return res.status(200).json({
        message: "Login successful",
        data: {
          token
        }
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: "Internal server error"
      });
    }
  }
);

// --------------------------------------------------
// DASHBOARD
// --------------------------------------------------

app.get(
  "/api/v1/dashboard",
  authenticateToken,
  requireRole("organiser"),
  async (req, res) => {
    try {
      const studentsData =
        await readJson(STUDENTS_FILE);

      const attendance =
        await readJson(ATTENDANCE_FILE);

      const totalStudents =
        studentsData.students.length;

      const capacity =
        studentsData.event.capacity;

      const checkedIn =
        attendance.filter(
          record =>
            record.status === "INSIDE"
        ).length;

      const remaining =
        Math.max(
          capacity - checkedIn,
          0
        );

      const occupancyPercentage =
        capacity > 0
          ? Number(
              (
                (checkedIn / capacity) *
                100
              ).toFixed(2)
            )
          : 0;

      return res.status(200).json({
        data: {
          event: studentsData.event,
          total_students: totalStudents,
          capacity,
          checked_in: checkedIn,
          remaining_capacity: remaining,
          occupancy_percentage:
            occupancyPercentage
        }
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error:
          "Unable to load dashboard"
      });
    }
  }
);

// --------------------------------------------------
// CHECK-IN
// --------------------------------------------------

app.post(
  "/api/v1/attendance/check-in",
  authenticateToken,
  requireRole("organiser"),
  checkInLimiter,
  async (req, res) => {

    try {
      const {
        student_id,
        request_id
      } = req.body;

      if (
        !student_id ||
        !request_id
      ) {
        return res.status(400).json({
          error:
            "student_id and request_id are required"
        });
      }

      return await withAttendanceLock(
        async () => {

          const studentsData =
            await readJson(
              STUDENTS_FILE
            );

          const attendance =
            await readJson(
              ATTENDANCE_FILE
            );

          // ------------------------------------------
          // Idempotency check
          // ------------------------------------------

          const existingRequest =
            attendance.find(
              record =>
                record.request_id ===
                request_id
            );

          if (existingRequest) {
            return res.status(409).json({
              error:
                "Duplicate request",
              code:
                "DUPLICATE_REQUEST",
              attendance:
                existingRequest
            });
          }

          // ------------------------------------------
          // Find student in source of truth
          // ------------------------------------------

          const student =
            studentsData.students.find(
              student =>
                student.student_id ===
                student_id
            );

          if (!student) {
            return res.status(404).json({
              error:
                "Student not found",
              code:
                "STUDENT_NOT_FOUND"
            });
          }

          // ------------------------------------------
          // Duplicate student check
          // ------------------------------------------

          const alreadyCheckedIn =
            attendance.find(
              record =>
                record.student_id ===
                student_id
            );

          if (alreadyCheckedIn) {
            return res.status(409).json({
              error:
                "Student already checked in",
              code:
                "DUPLICATE_ATTENDANCE",
              attendance:
                alreadyCheckedIn
            });
          }

          // ------------------------------------------
          // Capacity check
          // ------------------------------------------

          const checkedIn =
            attendance.filter(
              record =>
                record.status ===
                "INSIDE"
            ).length;

          const capacity =
            studentsData.event.capacity;

          if (checkedIn >= capacity) {
            return res.status(409).json({
              error:
                "Event capacity reached",
              code:
                "CAPACITY_REACHED"
            });
          }

          // ------------------------------------------
          // Create attendance record
          // ------------------------------------------

          const attendanceRecord = {
            attendance_id:
              `ATT-${crypto
                .randomBytes(4)
                .toString("hex")
                .toUpperCase()}`,

            student_id:
              student.student_id,

            name:
              student.name,

            department:
              student.department,

            timestamp:
              new Date().toISOString(),

            status:
              "INSIDE",

            request_id
          };

          attendance.push(
            attendanceRecord
          );

          await writeJson(
            ATTENDANCE_FILE,
            attendance
          );

          return res.status(201).json({
            message:
              "Student checked in successfully",
            data: {
              attendance:
                attendanceRecord
            }
          });
        }
      );

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error:
          "Unable to process check-in"
      });
    }
  }
);

// --------------------------------------------------
// STUDENT SEARCH
// --------------------------------------------------

app.get(
  "/api/v1/students/search",
  authenticateToken,
  requireRole("organiser"),
  searchLimiter,
  async (req, res) => {
    try {
      const {
        q = ""
      } = req.query;

      const studentsData =
        await readJson(
          STUDENTS_FILE
        );

      const attendance =
        await readJson(
          ATTENDANCE_FILE
        );

      const search =
        q.trim().toLowerCase();

      const results =
        studentsData.students
          .filter(student => {

            if (!search) {
              return true;
            }

            return (
              student.student_id
                .toLowerCase()
                .includes(search) ||

              student.name
                .toLowerCase()
                .includes(search) ||

              student.department
                .toLowerCase()
                .includes(search)
            );
          })
          .map(student => {

            const record =
              attendance.find(
                attendanceRecord =>
                  attendanceRecord.student_id ===
                  student.student_id
              );

            return {
              student_id:
                student.student_id,

              name:
                student.name,

              department:
                student.department,

              status:
                record
                  ? record.status
                  : "NOT_ENTERED",

              timestamp:
                record
                  ? record.timestamp
                  : null
            };
          });

      return res.status(200).json({
        data: results,
        count: results.length
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error:
          "Unable to search students"
      });
    }
  }
);

// --------------------------------------------------
// ATTENDANCE SEARCH
// --------------------------------------------------

app.get(
  "/api/v1/attendance/search",
  authenticateToken,
  requireRole("organiser"),
  searchLimiter,
  async (req, res) => {

    try {
      const {
        q = "",
        department = "",
        status = ""
      } = req.query;

      const attendance =
        await readJson(
          ATTENDANCE_FILE
        );

      const search =
        q.trim().toLowerCase();

      const departmentFilter =
        department.trim().toLowerCase();

      const statusFilter =
        status.trim().toLowerCase();

      const results =
        attendance.filter(record => {

          const matchesSearch =
            !search ||
            record.student_id
              .toLowerCase()
              .includes(search) ||
            record.name
              .toLowerCase()
              .includes(search) ||
            record.department
              .toLowerCase()
              .includes(search);

          const matchesDepartment =
            !departmentFilter ||
            record.department
              .toLowerCase() ===
              departmentFilter;

          const matchesStatus =
            !statusFilter ||
            record.status
              .toLowerCase() ===
              statusFilter;

          return (
            matchesSearch &&
            matchesDepartment &&
            matchesStatus
          );
        });

      return res.status(200).json({
        data: results,
        count: results.length
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error:
          "Unable to search attendance"
      });
    }
  }
);

// --------------------------------------------------
// ROOT
// --------------------------------------------------

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      FRONTEND_DIR,
      "index.html"
    )
  );
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(
    `Server running at http://localhost:${PORT}`
  );

  console.log(
    `Swagger docs at http://localhost:${PORT}/api-docs/`
  );
});