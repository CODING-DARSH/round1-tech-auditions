const fs = require("fs");
const path = require("path");

/**
 * A tiny safe JSON file store.
 * - Reads defensively: missing file -> fallback, malformed JSON -> throws a
 *   typed error the caller can turn into a clean 500/409 response instead of
 *   crashing the process.
 * - Writes atomically: write to a temp file then rename, so a crash mid-write
 *   can never leave attendance.json truncated or half-written.
 * - Serializes writes per-file with an in-memory promise queue, so two
 *   near-simultaneous check-ins can't read-modify-write and clobber each
 *   other (classic lost-update race).
 */

class JsonStoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "JsonStoreError";
    this.cause = cause;
  }
}

const writeQueues = new Map(); // filePath -> Promise chain

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      if (fallback !== undefined) return fallback;
      throw new JsonStoreError(`File not found: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw || !raw.trim()) {
      if (fallback !== undefined) return fallback;
      throw new JsonStoreError(`File is empty: ${filePath}`);
    }
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof JsonStoreError) throw err;
    // Malformed / unreadable JSON — never crash the server for this.
    throw new JsonStoreError(`Failed to read/parse ${filePath}: ${err.message}`, err);
  }
}

function atomicWriteSync(filePath, data) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath); // atomic on the same filesystem
}

/**
 * Queue a read-modify-write against a JSON file so concurrent callers never
 * interleave. `mutator(currentData)` returns the new data to persist and
 * (optionally) a result value to hand back to the caller.
 */
function updateJson(filePath, fallback, mutator) {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev
    .catch(() => {}) // don't let a previous failure jam the queue
    .then(() => {
      const current = readJson(filePath, fallback);
      const { data, result } = mutator(current);
      atomicWriteSync(filePath, data);
      return result;
    });
  writeQueues.set(filePath, next);
  return next;
}

module.exports = { readJson, atomicWriteSync, updateJson, JsonStoreError };
