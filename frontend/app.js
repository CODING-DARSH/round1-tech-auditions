'use strict';

const state = {
  token: sessionStorage.getItem('attendance_token') || '',
  user: null,
  pendingCheckIn: null,
};

const elements = {
  loginView: document.querySelector('#login-view'),
  appView: document.querySelector('#app-view'),
  loginForm: document.querySelector('#login-form'),
  loginButton: document.querySelector('#login-button'),
  loginMessage: document.querySelector('#login-message'),
  appMessage: document.querySelector('#app-message'),
  accountLabel: document.querySelector('#account-label'),
  logoutButton: document.querySelector('#logout-button'),
  refreshButton: document.querySelector('#refresh-button'),
  checkinPanel: document.querySelector('#checkin-panel'),
  checkinForm: document.querySelector('#checkin-form'),
  checkinButton: document.querySelector('#checkin-button'),
  studentId: document.querySelector('#student-id'),
  searchForm: document.querySelector('#search-form'),
  searchButton: document.querySelector('#search-button'),
  studentResults: document.querySelector('#student-results'),
  attendanceResults: document.querySelector('#attendance-results'),
  resultCount: document.querySelector('#result-count'),
  totalStudents: document.querySelector('#total-students'),
  checkedIn: document.querySelector('#checked-in'),
  remaining: document.querySelector('#remaining'),
  occupancy: document.querySelector('#occupancy'),
  capacityBar: document.querySelector('#capacity-bar'),
  capacityLabel: document.querySelector('#capacity-label'),
};

function setMessage(target, message = '', kind = '') {
  target.textContent = message;
  if (kind) target.dataset.kind = kind;
  else delete target.dataset.kind;
}

function setButtonLoading(button, isLoading, loadingLabel) {
  if (isLoading) {
    button.dataset.label = button.textContent;
    button.textContent = loadingLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

async function api(route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(route, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    const error = new Error('Unable to reach the server. Check your connection and retry.');
    error.code = 'NETWORK_ERROR';
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The server returned an unreadable response.');
  }
  if (!response.ok) {
    if (response.status === 401 && route !== '/api/v1/auth/login') logout(false);
    const error = new Error(payload.error?.message || 'Request failed.');
    error.code = payload.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

function showLogin() {
  elements.loginView.hidden = false;
  elements.appView.hidden = true;
}

function showApp() {
  elements.loginView.hidden = true;
  elements.appView.hidden = false;
  elements.accountLabel.textContent = `${state.user.username} · ${state.user.role}`;
  elements.checkinPanel.hidden = state.user.role !== 'ORGANISER';
}

function logout(showMessage = true) {
  state.token = '';
  state.user = null;
  state.pendingCheckIn = null;
  sessionStorage.removeItem('attendance_token');
  showLogin();
  if (showMessage) setMessage(elements.loginMessage, 'Signed out.', 'success');
}

function escapeText(value) {
  const span = document.createElement('span');
  span.textContent = value == null ? '' : String(value);
  return span.innerHTML;
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderStudents(results) {
  elements.resultCount.textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;
  if (!results.length) {
    elements.studentResults.innerHTML = '<tr><td colspan="5" class="empty-row">No students match these filters.</td></tr>';
    return;
  }
  elements.studentResults.innerHTML = results.map((student) => {
    const statusClass = student.status === 'INSIDE' ? 'status-inside' : 'status-not-entered';
    return `<tr>
      <td><strong>${escapeText(student.student_id)}</strong></td>
      <td>${escapeText(student.name)}</td>
      <td>${escapeText(student.department)}</td>
      <td><span class="status ${statusClass}">${escapeText(student.status.replace('_', ' '))}</span></td>
      <td>${escapeText(formatTimestamp(student.checked_in_at))}</td>
    </tr>`;
  }).join('');
}

function renderAttendance(records) {
  if (!records.length) {
    elements.attendanceResults.innerHTML = '<tr><td colspan="5" class="empty-row">No check-ins recorded yet.</td></tr>';
    return;
  }
  elements.attendanceResults.innerHTML = records.map((record) => `<tr>
    <td><strong>${escapeText(record.attendance_id)}</strong></td>
    <td>${escapeText(record.name)} <span class="muted">(${escapeText(record.student_id)})</span></td>
    <td>${escapeText(record.department)}</td>
    <td>${escapeText(formatTimestamp(record.timestamp))}</td>
    <td>${escapeText(record.registered_by)}</td>
  </tr>`).join('');
}

async function loadDashboard() {
  const data = await api('/api/v1/dashboard');
  const stats = data.statistics;
  elements.totalStudents.textContent = stats.total_students;
  elements.checkedIn.textContent = stats.checked_in;
  elements.remaining.textContent = stats.remaining;
  elements.occupancy.textContent = `${stats.occupancy_percentage}%`;
  const percentage = Math.max(0, Math.min(100, stats.occupancy_percentage));
  elements.capacityBar.style.setProperty('--occupancy', `${percentage}%`);
  elements.capacityBar.setAttribute('aria-valuenow', String(percentage));
  elements.capacityLabel.textContent = `Capacity: ${stats.checked_in} / ${stats.capacity}`;
  renderAttendance(data.records);
}

async function loadStudents() {
  const params = new URLSearchParams();
  const q = document.querySelector('#search-query').value.trim();
  const department = document.querySelector('#department-filter').value.trim();
  const status = document.querySelector('#status-filter').value;
  if (q) params.set('q', q);
  if (department) params.set('department', department);
  if (status) params.set('status', status);
  const data = await api(`/api/v1/students/search?${params}`);
  renderStudents(data.results);
}

async function refreshAll(message = '') {
  setButtonLoading(elements.refreshButton, true, 'Refreshing…');
  setMessage(elements.appMessage, 'Loading current attendance data…', 'loading');
  try {
    await Promise.all([loadDashboard(), loadStudents()]);
    setMessage(elements.appMessage, message, message ? 'success' : '');
  } catch (error) {
    setMessage(elements.appMessage, error.message, 'error');
  } finally {
    setButtonLoading(elements.refreshButton, false);
  }
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setButtonLoading(elements.loginButton, true, 'Signing in…');
  setMessage(elements.loginMessage, 'Checking credentials…', 'loading');
  try {
    const data = await api('/api/v1/auth/login', {
      method: 'POST',
      body: {
        username: document.querySelector('#username').value.trim(),
        password: document.querySelector('#password').value,
      },
    });
    state.token = data.token;
    state.user = data.user;
    sessionStorage.setItem('attendance_token', state.token);
    setMessage(elements.loginMessage);
    showApp();
    await refreshAll('Dashboard loaded.');
  } catch (error) {
    setMessage(elements.loginMessage, error.message, 'error');
  } finally {
    setButtonLoading(elements.loginButton, false);
  }
});

elements.checkinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const studentId = elements.studentId.value.trim().toUpperCase();
  if (!studentId) {
    setMessage(elements.appMessage, 'Enter a student ID.', 'error');
    return;
  }
  if (!state.pendingCheckIn || state.pendingCheckIn.studentId !== studentId) {
    state.pendingCheckIn = {
      studentId,
      requestId: globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
  }

  setButtonLoading(elements.checkinButton, true, 'Checking in…');
  setMessage(elements.appMessage, `Registering ${studentId}…`, 'loading');
  try {
    const data = await api('/api/v1/attendance/check-in', {
      method: 'POST',
      body: { student_id: studentId, request_id: state.pendingCheckIn.requestId },
    });
    state.pendingCheckIn = null;
    elements.studentId.value = '';
    await refreshAll(data.message);
    elements.studentId.focus();
  } catch (error) {
    if (error.code !== 'NETWORK_ERROR') state.pendingCheckIn = null;
    setMessage(elements.appMessage, error.message, 'error');
  } finally {
    setButtonLoading(elements.checkinButton, false);
  }
});

elements.searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setButtonLoading(elements.searchButton, true, 'Searching…');
  setMessage(elements.appMessage, 'Searching the roster…', 'loading');
  try {
    await loadStudents();
    setMessage(elements.appMessage, 'Search results updated.', 'success');
  } catch (error) {
    setMessage(elements.appMessage, error.message, 'error');
  } finally {
    setButtonLoading(elements.searchButton, false);
  }
});

elements.refreshButton.addEventListener('click', () => refreshAll('Dashboard refreshed.'));
elements.logoutButton.addEventListener('click', () => logout(true));

async function restoreSession() {
  if (!state.token) return showLogin();
  try {
    state.user = await api('/api/v1/auth/me');
    showApp();
    await refreshAll();
  } catch {
    logout(false);
  }
}

restoreSession();
