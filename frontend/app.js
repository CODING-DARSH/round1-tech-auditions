let token = localStorage.getItem("attendance_token");

const loginPage = document.getElementById("loginPage");
const dashboardPage = document.getElementById("dashboardPage");

const loginForm = document.getElementById("loginForm");
const checkInForm = document.getElementById("checkInForm");

const loginMessage = document.getElementById("loginMessage");
const checkInMessage = document.getElementById("checkInMessage");

const recordsBody = document.getElementById("recordsBody");


// --------------------------------------------------
// API helper
// --------------------------------------------------

async function api(url, options = {}) {

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json();

  if (response.status === 401) {
    logout();
  }

  return {
    response,
    data
  };
}


// --------------------------------------------------
// Login
// --------------------------------------------------

loginForm.addEventListener("submit", async (event) => {

  event.preventDefault();

  loginMessage.textContent = "Logging in...";
  loginMessage.className = "";

  const username =
    document.getElementById("username").value.trim();

  const password =
    document.getElementById("password").value;

  try {

    const { response, data } =
      await api("/api/v1/auth/login", {
        method: "POST",

        body: JSON.stringify({
          username,
          password
        })
      });

    if (!response.ok) {

      loginMessage.textContent =
        data.error?.message ||
        data.error ||
        "Login failed.";

      loginMessage.className =
        "message-error";

      return;
    }

    token = data.data.token;

    localStorage.setItem(
      "attendance_token",
      token
    );

    showDashboard();

  } catch (error) {

    loginMessage.textContent =
      "Unable to connect to server.";

    loginMessage.className =
      "message-error";
  }
});


// --------------------------------------------------
// Dashboard
// --------------------------------------------------

function showDashboard() {

  loginPage.classList.add("hidden");

  dashboardPage.classList.remove("hidden");

  loadDashboard();

  loadRecords();
}


// --------------------------------------------------
// Dashboard stats
// --------------------------------------------------

async function loadDashboard() {

  try {

    const { response, data } =
      await api("/api/v1/dashboard");

    if (!response.ok) {
      return;
    }

    const stats = data.data;

    document.getElementById(
      "totalStudents"
    ).textContent = stats.total_students;

    document.getElementById(
      "checkedIn"
    ).textContent = stats.checked_in;

    document.getElementById(
      "remaining"
    ).textContent = stats.remaining_capacity;

    document.getElementById(
      "occupancy"
    ).textContent =
      `${stats.occupancy_percentage}%`;

  } catch (error) {

    console.error(error);

  }
}


// --------------------------------------------------
// Check-in
// --------------------------------------------------

checkInForm.addEventListener("submit", async (event) => {

  event.preventDefault();

  const studentId =
    document.getElementById("studentId")
      .value
      .trim();

  if (!studentId) {
    showCheckInMessage(
      "Please enter a student ID.",
      false
    );

    return;
  }

  showCheckInMessage(
    "Processing...",
    true
  );

  // A unique request ID for idempotency
  const requestId =
    `req_${crypto.randomUUID()}`;

  try {

    const { response, data } =
      await api(
        "/api/v1/attendance/check-in",
        {
          method: "POST",

          body: JSON.stringify({
            student_id: studentId,
            request_id: requestId
          })
        }
      );

    if (!response.ok) {

      showCheckInMessage(
        data.error?.message ||
        data.error ||
        "Check-in failed.",
        false
      );

      return;
    }

    showCheckInMessage(
      `${data.data.attendance.name} checked in successfully.`,
      true
    );

    document.getElementById(
      "studentId"
    ).value = "";

    await loadDashboard();

    await loadRecords();

  } catch (error) {

    showCheckInMessage(
      "Unable to connect to server.",
      false
    );
  }
});


function showCheckInMessage(message, success) {

  checkInMessage.textContent = message;

  checkInMessage.className =
    success
      ? "message-success"
      : "message-error";
}


// --------------------------------------------------
// Search
// --------------------------------------------------

document
  .getElementById("searchButton")
  .addEventListener("click", loadRecords);

document
  .getElementById("refreshButton")
  .addEventListener("click", () => {

    document.getElementById(
      "searchInput"
    ).value = "";

    document.getElementById(
      "departmentInput"
    ).value = "";

    document.getElementById(
      "statusInput"
    ).value = "";

    loadDashboard();

    loadRecords();
  });


async function loadRecords() {

  const q =
    document.getElementById(
      "searchInput"
    ).value.trim();

  const department =
    document.getElementById(
      "departmentInput"
    ).value.trim();

  const status =
    document.getElementById(
      "statusInput"
    ).value;

  const params =
    new URLSearchParams();

  if (q) {
    params.set("q", q);
  }

  if (department) {
    params.set("department", department);
  }

  if (status) {
    params.set("status", status);
  }

  try {

    const { response, data } =
      await api(
        `/api/v1/attendance/search?${params.toString()}`
      );

    if (!response.ok) {
      return;
    }

    renderRecords(data.data);

  } catch (error) {

    console.error(error);

  }
}


// --------------------------------------------------
// Render records
// --------------------------------------------------

function renderRecords(records) {

  recordsBody.innerHTML = "";

  if (!records.length) {

    recordsBody.innerHTML = `
      <tr>
        <td colspan="5">
          No matching students found.
        </td>
      </tr>
    `;

    return;
  }

  for (const record of records) {

    const row =
      document.createElement("tr");

    const timestamp =
      record.timestamp
        ? new Date(
            record.timestamp
          ).toLocaleString()
        : "-";

    const statusClass =
      record.status === "INSIDE"
        ? "status-inside"
        : "status-not-entered";

    row.innerHTML = `
      <td>${escapeHtml(record.student_id)}</td>

      <td>${escapeHtml(record.name)}</td>

      <td>${escapeHtml(record.department)}</td>

      <td class="${statusClass}">
        ${escapeHtml(record.status)}
      </td>

      <td>${escapeHtml(timestamp)}</td>
    `;

    recordsBody.appendChild(row);
  }
}


// --------------------------------------------------
// Basic HTML escaping
// --------------------------------------------------

function escapeHtml(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


// --------------------------------------------------
// Logout
// --------------------------------------------------

document
  .getElementById("logoutButton")
  .addEventListener("click", logout);


function logout() {

  token = null;

  localStorage.removeItem(
    "attendance_token"
  );

  dashboardPage.classList.add("hidden");

  loginPage.classList.remove("hidden");
}


// --------------------------------------------------
// Auto-login if token exists
// --------------------------------------------------

if (token) {
  showDashboard();
}