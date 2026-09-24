const API = "/api";

const state = {
  token: localStorage.getItem("eat_token") || null,
  user: JSON.parse(localStorage.getItem("eat_user") || "null"),
};

const el = (id) => document.getElementById(id);

function showMsg(target, text, kind) {
  target.innerHTML = text ? `<div class="msg ${kind}">${escapeHtml(text)}</div>` : "";
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401) logout();
    const err = new Error((body && body.message) || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("eat_token", token);
  localStorage.setItem("eat_user", JSON.stringify(user));
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("eat_token");
  localStorage.removeItem("eat_user");
  render();
}

function render() {
  const loggedIn = !!state.token;
  el("login-view").classList.toggle("hidden", loggedIn);
  el("app-view").classList.toggle("hidden", !loggedIn);
  el("who-box").classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    el("who-label").textContent = `${state.user.username} (${state.user.role})`;
    refreshAll();
  }
}

/* ---------- login ---------- */
el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = el("username").value.trim();
  const password = el("password").value;
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  showMsg(el("login-msg"), "", "");
  try {
    const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    setSession(data.token, data.user);
    render();
  } catch (err) {
    showMsg(el("login-msg"), err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

el("logout-btn").addEventListener("click", logout);

/* ---------- stats ---------- */
async function loadStats() {
  try {
    const s = await api("/attendance/stats");
    el("event-title").textContent = s.eventName;
    el("stat-capacity").textContent = s.capacity;
    el("stat-current").textContent = s.current;
    el("stat-remaining").textContent = s.remaining;
    el("stat-remaining-card").classList.toggle("full", s.full);
  } catch {}
}

/* ---------- check-in ---------- */
el("checkin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = el("checkin-id");
  const id = input.value.trim();
  const msgBox = el("checkin-msg");
  if (!id) return;
  showMsg(msgBox, "", "");
  try {
    const data = await api("/attendance/checkin", { method: "POST", body: JSON.stringify({ studentId: id }) });
    showMsg(msgBox, `Checked in: ${data.record.name} (${data.record.studentId})`, "ok");
    input.value = "";
    refreshAll();
  } catch (err) {
    showMsg(msgBox, err.message, "error");
  }
});

/* ---------- roster ---------- */
let allStudents = [];

async function loadRoster() {
  const search = el("roster-search").value.trim();
  const department = el("roster-dept").value;
  const qs = new URLSearchParams({ search, department }).toString();
  try {
    const data = await api(`/students?${qs}`);
    if (allStudents.length === 0) {
      allStudents = data.students;
      populateDeptOptions(el("roster-dept"), allStudents);
      populateDeptOptions(el("log-dept"), allStudents);
    }
    renderRosterTable(data.students);
  } catch (err) {
    el("roster-table-wrap").innerHTML = `<p class="empty">Could not load roster.</p>`;
  }
}

function populateDeptOptions(selectEl, students) {
  const existing = new Set(Array.from(selectEl.options).map((o) => o.value));
  const depts = [...new Set(students.map((s) => s.department))].sort();
  depts.forEach((d) => {
    if (!existing.has(d)) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      selectEl.appendChild(opt);
    }
  });
}

function renderRosterTable(students) {
  if (!students.length) {
    el("roster-table-wrap").innerHTML = `<p class="empty">No matching students.</p>`;
    return;
  }
  const rows = students.map((s) => `
    <tr>
      <td>${escapeHtml(s.studentId)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.department)}</td>
      <td>${s.checkedIn ? '<span class="badge in">Checked in</span>' : '<span class="badge out">Not yet</span>'}</td>
    </tr>`).join("");
  el("roster-table-wrap").innerHTML = `
    <table>
      <thead><tr><th>Student ID</th><th>Name</th><th>Department</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ---------- attendance log ---------- */
async function loadLog() {
  const search = el("log-search").value.trim();
  const department = el("log-dept").value;
  const qs = new URLSearchParams({ search, department }).toString();
  try {
    const data = await api(`/attendance?${qs}`);
    renderLogTable(data.attendance);
  } catch (err) {
    el("log-table-wrap").innerHTML = `<p class="empty">Could not load attendance log.</p>`;
  }
}

function renderLogTable(records) {
  if (!records.length) {
    el("log-table-wrap").innerHTML = `<p class="empty">No check-ins yet.</p>`;
    return;
  }
  const rows = records.map((r) => `
    <tr>
      <td>${escapeHtml(r.studentId)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.department)}</td>
      <td>${new Date(r.timestamp).toLocaleString()}</td>
    </tr>`).join("");
  el("log-table-wrap").innerHTML = `
    <table>
      <thead><tr><th>Student ID</th><th>Name</th><th>Department</th><th>Checked in at</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ---------- wiring ---------- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

el("roster-search").addEventListener("input", debounce(loadRoster, 250));
el("roster-dept").addEventListener("change", loadRoster);
el("log-search").addEventListener("input", debounce(loadLog, 250));
el("log-dept").addEventListener("change", loadLog);

function refreshAll() {
  loadStats();
  loadRoster();
  loadLog();
}

render();
