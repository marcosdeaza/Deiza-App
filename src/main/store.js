/**
 * Tiny JSON store in userData. Writes are atomic (tmp + rename) and debounced so a burst of
 * window moves or session updates becomes one write.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function createStore(name, defaults = {}) {
  const file = path.join(app.getPath('userData'), `${name}.json`);
  let data = { ...defaults };
  try {
    data = { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch { /* first run or unreadable: defaults */ }
  let timer = null;

  const flush = () => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`store ${name}:`, err.message);
    }
  };

  return {
    get: (key) => data[key],
    set(key, value) {
      data[key] = value;
      if (!timer) timer = setTimeout(flush, 300);
    },
    all: () => data,
    flush() { if (timer) { clearTimeout(timer); flush(); } },
  };
}

/** Atomic JSON file helpers for per-session documents. */
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

module.exports = { createStore, readJson, writeJson };
