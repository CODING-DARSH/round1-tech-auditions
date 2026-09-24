/* ═══════════════════════════════════════════════════════════════════════════
   Event Attendance Tracker — Frontend JavaScript
   Responsibilities:
     • JWT auth (login / logout / token persistence)
     • Dashboard stats + department chart
     • Attendance registration with idempotency (request_id per submission)
     • Search & filtering via backend APIs
     • Toast notifications for all state transitions
     • Role-based UI gating (viewers cannot see the register panel)
   ═══════════════════════════════════════════════════════════════════════════ */

const API = '/api/v1';

// ── State ─────────────────────────────────────────────────────────────────
let authToken = localStorage.getItem('att_token') || null;
let currentUser = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    verifyAndBoot();
  } else {
    showLogin();
  }
});

// ── Auth ───────────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn   = document.getElementById('login-btn');
  const alert = document.getElementById('login-alert');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  setLoading(btn, true, 'Signing in…');
  hideAlert(alert);

  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
    });

    authToken = res.data.token;
    currentUser = res.data.user;
    localStorage.setItem('att_token', authToken);
    bootApp();
  } catch (err) {
    showAlert(alert, err.message || 'Login failed. Check credentials.');
  } finally {
    setLoading(btn, false, 'Sign In');
  }
});

async function verifyAndBoot() {
  try {
    const res = await apiFetch('/auth/me');
    currentUser = res.data.user;
    bootApp();
  } catch {
    logout(false);
  }
}

function bootApp() {
  document.getElementById('nav-name').textContent = currentUser.name;
  const roleEl = document.getElementById('nav-role');
  roleEl.textContent = currentUser.role;
  roleEl.className = `role-tag role-${currentUser.role}`;

  // Hide register panel for viewers
  if (!currentUser.permissions.includes('register')) {
    document.getElementById('register-panel').style.display = 'none';
  }

  showApp();
  loadDashboard();
  loadAttendance();
}

async function logout(callApi = true) {
  if (callApi && authToken) {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (_) {}
  }
  authToken = null;
  currentUser = null;
  localStorage.removeItem('att_token');
  showLogin();
}

// ── Dashboard ──────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const res = await apiFetch('/dashboard/stats');
    const { stats, department_breakdown, recent_check_ins } = res.data;

    document.getElementById('s-total').textContent    = stats.total_students;
    document.getElementById('s-checked').textContent  = stats.checked_in;
    document.getElementById('s-pending').textContent  = stats.not_entered;
    document.getElementById('s-remaining').textContent= stats.remaining_slots;
    document.getElementById('s-cap-sub').textContent  = `of ${stats.capacity} capacity`;
    document.getElementById('s-occ').textContent      = `${stats.occupancy_percentage}%`;
    document.getElementById('occ-fill').style.width   = `${stats.occupancy_percentage}%`;

    renderDeptChart(department_breakdown, stats.capacity);
    renderRecent(recent_check_ins);
  } catch (err) {
    toast('error', 'Stats Error', err.message);
  }
}

function renderDeptChart(breakdown, capacity) {
  const el = document.getElementById('dept-chart');
  const entries = Object.entries(breakdown);
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">📊</div><p>No check-ins yet</p></div>`;
    return;
  }
  const max = Math.max(...entries.map(([, v]) => v), 1);
  el.innerHTML = entries.map(([dept, count]) => `
    <div class="dept-bar-row">
      <div class="dept-bar-label">${dept}</div>
      <div class="dept-bar-track"><div class="dept-bar-fill" style="width:${(count/max)*100}%"></div></div>
      <div class="dept-bar-count">${count}</div>
    </div>`).join('');
}

function renderRecent(recent) {
  const el = document.getElementById('recent-list');
  if (!recent.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">🕒</div><p>No recent activity</p></div>`;
    return;
  }
  el.innerHTML = recent.map((r) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem 0;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:.85rem;font-weight:600;">${r.name}</div>
        <div style="font-size:.73rem;color:var(--muted);">${r.student_id} · <span class="badge badge-dept">${r.department}</span></div>
      </div>
      <div style="font-size:.72rem;color:var(--muted);text-align:right;">${fmtTime(r.attended_at)}</div>
    </div>`).join('');
}

// ── Attendance Table ───────────────────────────────────────────────────────
async function loadAttendance() {
  try {
    const res = await apiFetch('/attendance');
    renderTable(res.data.records, res.data.summary);
  } catch (err) {
    document.getElementById('table-wrap').innerHTML =
      `<div class="empty-state"><div class="icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

function renderTable(records, summary) {
  const wrap = document.getElementById('table-wrap');
  const countEl = document.getElementById('table-count');

  if (!records.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>No records yet. Check in a student to get started.</p></div>`;
    countEl.textContent = '';
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Attendance ID</th>
          <th>Student ID</th>
          <th>Name</th>
          <th>Dept</th>
          <th>Year</th>
          <th>Status</th>
          <th>Checked In At</th>
          <th>By</th>
        </tr>
      </thead>
      <tbody>
        ${records.map((r, i) => `
          <tr>
            <td class="text-muted">${i + 1}</td>
            <td style="font-family:monospace;font-size:.78rem;">${r.attendance_id}</td>
            <td style="font-family:monospace;">${r.student_id}</td>
            <td><b>${r.name}</b></td>
            <td><span class="badge badge-dept">${r.department}</span></td>
            <td>Yr ${r.year}</td>
            <td><span class="badge badge-inside">INSIDE</span></td>
            <td style="font-size:.8rem;">${fmtDateTime(r.attended_at)}</td>
            <td style="font-size:.78rem;color:var(--muted);">${r.registered_by || '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  if (summary) {
    countEl.textContent = `Showing ${records.length} check-in(s) · ${summary.remaining} slot(s) remaining`;
  }
}

// ── Search & Filtering ─────────────────────────────────────────────────────
let searchDebounce = null;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 350);
});

async function runSearch() {
  const q      = document.getElementById('search-input').value.trim();
  const dept   = document.getElementById('filter-dept').value;
  const status = document.getElementById('filter-status').value;

  // If nothing is set, just load all attendance
  if (!q && !dept && !status) {
    loadAttendance();
    return;
  }

  const params = new URLSearchParams();
  if (q)      params.set('q', q);
  if (dept)   params.set('department', dept);
  if (status) params.set('status', status);

  try {
    const res = await apiFetch(`/attendance/search?${params}`);
    const records = res.data.records.map((r) => ({
      ...r,
      status: r.status,
    }));

    // Re-use renderTable for search results too
    renderSearchResults(res.data.records, res.data.total, res.data.filters);
  } catch (err) {
    toast('error', 'Search Error', err.message);
  }
}

function renderSearchResults(records, total, filters) {
  const wrap    = document.getElementById('table-wrap');
  const countEl = document.getElementById('table-count');

  if (!records.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>No results match your filters.</p></div>`;
    countEl.textContent = `0 results`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Student ID</th>
          <th>Name</th>
          <th>Dept</th>
          <th>Year</th>
          <th>Status</th>
          <th>Checked In At</th>
        </tr>
      </thead>
      <tbody>
        ${records.map((r, i) => `
          <tr>
            <td class="text-muted">${i + 1}</td>
            <td style="font-family:monospace;">${r.student_id}</td>
            <td><b>${r.name}</b></td>
            <td><span class="badge badge-dept">${r.department}</span></td>
            <td>Yr ${r.year}</td>
            <td>
              ${r.status === 'INSIDE'
                ? '<span class="badge badge-inside">INSIDE</span>'
                : '<span class="badge badge-not-entered">NOT ENTERED</span>'}
            </td>
            <td style="font-size:.8rem;">${r.attended_at ? fmtDateTime(r.attended_at) : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  countEl.textContent = `${total} result(s) found`;
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('filter-dept').value   = '';
  document.getElementById('filter-status').value = '';
  loadAttendance();
}

// ── Registration ───────────────────────────────────────────────────────────
let isRegistering = false; // double-click guard

document.getElementById('reg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isRegistering) return; // prevent double submission

  const btn     = document.getElementById('reg-btn');
  const alertEl = document.getElementById('reg-alert');
  const input   = document.getElementById('reg-student-id');
  const studentId = input.value.trim().toUpperCase();

  if (!studentId) {
    showAlert(alertEl, 'Please enter a Student ID.', 'error');
    return;
  }

  isRegistering = true;
  setLoading(btn, true, 'Checking in…');
  hideAlert(alertEl);

  // Generate a unique request_id for idempotency
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    const res = await apiFetch('/attendance/register', {
      method: 'POST',
      body: { student_id: studentId, request_id: requestId },
    });

    const d = res.data;
    showAlert(
      alertEl,
      `✅ ${d.name} checked in! (${d.department}) — ${d.capacity_info.remaining} slots left`,
      'success'
    );
    toast('success', 'Checked In!', `${d.name} (${d.student_id}) is now INSIDE.`);
    input.value = '';
    input.focus();

    // Refresh dashboard and table
    await Promise.all([loadDashboard(), loadAttendance()]);
  } catch (err) {
    const code = err.code || '';
    if (code === 'DUPLICATE_ATTENDANCE') {
      showAlert(alertEl, `⚠️ ${err.message}`, 'error');
      toast('error', 'Already Checked In', err.message);
    } else if (code === 'CAPACITY_REACHED') {
      showAlert(alertEl, `🚫 ${err.message}`, 'error');
      toast('error', 'Capacity Reached', err.message);
    } else if (code === 'STUDENT_NOT_FOUND') {
      showAlert(alertEl, `❌ ${err.message}`, 'error');
    } else {
      showAlert(alertEl, err.message || 'Registration failed.', 'error');
      toast('error', 'Error', err.message);
    }
  } finally {
    isRegistering = false;
    setLoading(btn, false, 'Check In');
  }
});

function quickFill(id) {
  event.preventDefault();
  document.getElementById('reg-student-id').value = id;
  document.getElementById('reg-student-id').focus();
}

// ── API Helper ─────────────────────────────────────────────────────────────
async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API}${path}`, opts);
  const json = await res.json();

  if (!json.success) {
    const err = new Error(json.error?.message || 'Unknown error');
    err.code = json.error?.code;
    err.status = res.status;
    throw err;
  }

  if (res.status === 401) {
    logout(false);
  }

  return json;
}

// ── UI Helpers ─────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('app-page').classList.remove('active');
}
function showApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app-page').classList.add('active');
}

function showAlert(el, msg, type = 'error') {
  el.textContent = msg;
  el.className = `alert alert-${type} show`;
}
function hideAlert(el) {
  el.className = 'alert';
  el.textContent = '';
}

function setLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.innerHTML = loading ? `<span class="spinner"></span> ${label}` : label;
}

let toastTimer = {};
function toast(type, title, message) {
  const container = document.getElementById('toast-container');
  const id = `toast_${Date.now()}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.id = id;
  el.className = `toast toast-${type}`;
  el.innerHTML = `<div class="toast-icon">${icons[type] || 'ℹ️'}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div>${message}</div>
    </div>`;
  container.appendChild(el);
  el.addEventListener('click', () => el.remove());
  toastTimer[id] = setTimeout(() => el.remove(), 4500);
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}
