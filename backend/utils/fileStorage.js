const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');

/**
 * readJSON — safely read and parse a JSON file from the data directory.
 * Returns null for missing/empty files. Throws on malformed JSON or I/O errors.
 */
const readJSON = (filename) => {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Malformed JSON in '${filename}': ${err.message}`);
    }
    throw new Error(`Failed to read '${filename}': ${err.message}`);
  }
};

/**
 * writeJSON — atomically write data to a JSON file.
 * Uses a .tmp file + rename to prevent partial writes corrupting the data.
 */
const writeJSON = (filename, data) => {
  const filePath = path.join(DATA_DIR, filename);
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up tmp on failure
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw new Error(`Failed to write '${filename}': ${err.message}`);
  }
};

/**
 * getStudents — returns the full students.json payload.
 * Throws if the file is missing, empty, or malformed.
 */
const getStudents = () => {
  const data = readJSON('students.json');
  if (!data || !Array.isArray(data.students)) {
    throw new Error('Student roster is unavailable or malformed.');
  }
  return data; // { event: {...}, students: [...] }
};

/**
 * getAttendance — returns attendance data, initialising the file if absent.
 * Always returns { records: [], processed_requests: [] } structure.
 */
const getAttendance = () => {
  let data = readJSON('attendance.json');
  if (!data) {
    data = { records: [], processed_requests: [] };
    writeJSON('attendance.json', data);
  }
  if (!Array.isArray(data.records)) data.records = [];
  if (!Array.isArray(data.processed_requests)) data.processed_requests = [];
  return data;
};

/** saveAttendance — persist updated attendance data. */
const saveAttendance = (data) => writeJSON('attendance.json', data);

module.exports = { readJSON, writeJSON, getStudents, getAttendance, saveAttendance };
