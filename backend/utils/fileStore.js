const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');

/**
 * Read and parse a JSON file safely.
 * Returns null on any read/parse error.
 */
function readJSON(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[JSON READ ERROR] ${filename}:`, err.message);
    return null;
  }
}

/**
 * Write data to a JSON file atomically (write to temp, then rename).
 * Returns true on success, false on failure.
 */
function writeJSON(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    console.error(`[JSON WRITE ERROR] ${filename}:`, err.message);
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    return false;
  }
}

module.exports = { readJSON, writeJSON };
