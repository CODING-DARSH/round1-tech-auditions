from flask import Flask, jsonify, request
from datetime import datetime
from functools import wraps
import json, os, time, secrets

app = Flask(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
STUDENTS_FILE = os.path.join(DATA_DIR, 'students.json')
ATTENDANCE_FILE = os.path.join(DATA_DIR, 'attendance.json')

TOKENS = {}
PROCESSED_REQUESTS = {}
RATE_LIMIT = {}
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 10
ADMIN_USER, ADMIN_PASS = "admin", "admin123"

@app.after_request
def add_cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return resp

@app.route('/api/v1/<path:path>', methods=['OPTIONS'])
def options_handler(path):
    return '', 200

def load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, 'r') as f:
            content = f.read().strip()
            return json.loads(content) if content else default
    except (json.JSONDecodeError, IOError):
        return default

def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)

def get_students():
    return load_json(STUDENTS_FILE, {"event": {}, "students": []})

def get_attendance():
    data = load_json(ATTENDANCE_FILE, [])
    return data.get('records', []) if isinstance(data, dict) else data

def require_auth(f):
    @wraps(f)
    def wrapper(*a, **kw):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if token not in TOKENS:
            return jsonify({"success": False, "error": {"code": "UNAUTHORIZED", "message": "Login required"}}), 401
        return f(*a, **kw)
    return wrapper

def rate_limited(key):
    now = time.time()
    bucket = RATE_LIMIT.setdefault(key, [])
    bucket[:] = [t for t in bucket if now - t < RATE_LIMIT_WINDOW]
    if len(bucket) >= RATE_LIMIT_MAX:
        return True
    bucket.append(now)
    return False

@app.route('/api/v1/health')
def health():
    return jsonify({"status": "server is alive"})

@app.route('/api/v1/login', methods=['POST'])
def login():
    body = request.get_json(silent=True) or {}
    if body.get('username') == ADMIN_USER and body.get('password') == ADMIN_PASS:
        token = secrets.token_hex(16)
        TOKENS[token] = body.get('username')
        return jsonify({"success": True, "token": token, "user": body.get('username')})
    return jsonify({"success": False, "error": {"code": "INVALID_CREDENTIALS", "message": "Wrong username or password"}}), 401

@app.route('/api/v1/students/search')
@require_auth
def search_students():
    q = (request.args.get('q') or '').strip().lower()
    data = get_students()
    attendance = get_attendance()
    att_map = {a['student_id']: a for a in attendance}
    results = []
    for s in data.get('students', []):
        if q and q != s['student_id'].lower() and q not in s['name'].lower():
            continue
        att = att_map.get(s['student_id'])
        results.append({**s, "status": "INSIDE" if att else "NOT_ENTERED", "timestamp": att['timestamp'] if att else None})
    return jsonify({"success": True, "count": len(results), "students": results})

@app.route('/api/v1/attendance/search')
@require_auth
def search_attendance():
    department = (request.args.get('department') or '').strip().lower()
    status = (request.args.get('status') or '').strip().upper()
    data = get_students()
    attendance = get_attendance()
    att_map = {a['student_id']: a for a in attendance}
    results = []
    for s in data.get('students', []):
        if department and s.get('department', '').lower() != department:
            continue
        att = att_map.get(s['student_id'])
        s_status = "INSIDE" if att else "NOT_ENTERED"
        if status and status != s_status:
            continue
        results.append({**s, "status": s_status, "timestamp": att['timestamp'] if att else None})
    return jsonify({"success": True, "count": len(results), "students": results})

@app.route('/api/v1/attendance/checkin', methods=['POST'])
@require_auth
def checkin():
    if rate_limited(request.remote_addr or 'unknown'):
        return jsonify({"success": False, "error": {"code": "RATE_LIMITED", "message": "Too many requests, slow down"}}), 429

    body = request.get_json(silent=True) or {}
    student_id = (body.get('student_id') or '').strip()
    request_id = (body.get('request_id') or '').strip()

    if not student_id:
        return jsonify({"success": False, "error": {"code": "INVALID_INPUT", "message": "student_id is required"}}), 400

    if request_id and request_id in PROCESSED_REQUESTS:
        return jsonify(PROCESSED_REQUESTS[request_id])

    data = get_students()
    student = next((s for s in data.get('students', []) if s['student_id'] == student_id), None)
    if not student:
        return jsonify({"success": False, "error": {"code": "STUDENT_NOT_FOUND", "message": "Unknown student ID"}}), 404

    attendance = get_attendance()
    if any(a['student_id'] == student_id for a in attendance):
        return jsonify({"success": False, "error": {"code": "DUPLICATE_ATTENDANCE", "message": "Student has already checked in."}}), 409

    capacity = data.get('event', {}).get('capacity', 100)
    if len(attendance) >= capacity:
        return jsonify({"success": False, "error": {"code": "CAPACITY_REACHED", "message": "Event is at full capacity"}}), 403

    record = {
        "attendance_id": "ATT" + secrets.token_hex(4).upper(),
        "student_id": student['student_id'],
        "name": student['name'],
        "department": student['department'],
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "status": "INSIDE"
    }
    attendance.append(record)
    save_json(ATTENDANCE_FILE, attendance)

    result = {"success": True, "message": "Checked in successfully", "record": record}
    if request_id:
        PROCESSED_REQUESTS[request_id] = result
    return jsonify(result), 200

@app.route('/api/v1/stats')
@require_auth
def stats():
    data = get_students()
    students = data.get('students', [])
    capacity = data.get('event', {}).get('capacity', len(students) or 100)
    attendance = get_attendance()
    checked_in = len(attendance)
    return jsonify({
        "success": True,
        "total_students": len(students),
        "checked_in": checked_in,
        "remaining": max(capacity - checked_in, 0),
        "capacity": capacity,
        "occupancy_percent": round((checked_in / capacity) * 100, 1) if capacity else 0
    })

if __name__ == '__main__':
    app.run(debug=True, port=5000)