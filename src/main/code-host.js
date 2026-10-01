/**
 * Code mode host: sessions on disk, one agent worker (utility process) per active session,
 * file browsing and previews for the side panel, revert of the last turn.
 *
 * Layout in userData/code:
 *   sessions/<id>.json          { id, title, folder, mode, model, effort, createdAt, updatedAt, messages, items, pendingNote }
 *   snapshots/<id>/<turn>.json  original file contents of a turn (for "Revertir")
 *   attachments/<id>/<x>.png    images pasted into the composer
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, ipcMain, dialog, utilityProcess, Notification, Menu, shell, net, BrowserWindow } = require('electron');
const Transcript = require('../shared/transcript');
const { T } = require('../shared/i18n');
const { createStore, readJson, writeJson } = require('./store');
const { resolveShellEnv } = require('./env');
const preview = require('./preview');
const computerHost = require('./computer-host');
const { createAttachmentStore } = require('./code-attachments');

const WORKER = path.join(__dirname, '../engine/worker.js');
const IDLE_KILL_MS = 15 * 60 * 1000;
const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif']);
const LANG_BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
  '.json': 'json', '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.svg': 'xml', '.vue': 'xml', '.css': 'css', '.scss': 'scss',
  '.py': 'python', '.sh': 'bash', '.zsh': 'bash', '.bash': 'bash', '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml',
  '.sql': 'sql', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.swift': 'swift', '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.cs': 'csharp', '.php': 'php', '.rb': 'ruby', '.toml': 'ini', '.ini': 'ini',
  '.env': 'ini', '.ps1': 'powershell', '.lua': 'lua', '.dart': 'dart', '.diff': 'diff', '.txt': 'plaintext',
};

// Solid 5 first: the default for Code (1M of context)
const MODELS = ['deiza-solid-5', 'deiza-omniscient', 'deiza-gas-4.5'];
const MODEL_ALIASES = { 'deiza-solid-4.6': 'deiza-solid-5', 'deiza-solid-4.5': 'deiza-solid-5', 'deiza-gas-4.1': 'deiza-gas-4.5', 'deiza-liquid-5': 'deiza-omniscient', 'deiza-liquid-5.1': 'deiza-omniscient', 'deiza-vainilla': 'deiza-gas-4.5' };
const EFFORTS = ['low', 'medium', 'high', 'ultra', 'max'];
const MODES = ['build', 'copilot', 'plan'];
const SKILLS_TTL_MS = 60 * 1000;

let ORIGIN = 'https://deiza.org';
let auth = null;
let ctx = null;           // { isTrusted, getWindow, send, setMode }
let dir = '';
let prefs = null;
let getLanguage = () => 'es';
let attachmentStore = null;
let skillsCache = { at: 0, token: '', list: [] };

const docs = new Map();     // id -> session doc (loaded lazily)
const workers = new Map();  // id -> { proc, alive, lastUsed }
const running = new Map();  // id -> { turnId, abortTimer }
const saveTimers = new Map();

const now = () => Date.now();
const uid = () => crypto.randomBytes(6).toString('hex');
const sessionFile = (id) => path.join(dir, 'sessions', `${id}.json`);
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{8,32}$/.test(id);

// ── persistence ───────────────────────────────────────────────────────────────

function loadDoc(id) {
  if (!validId(id)) return null;
  if (docs.has(id)) return docs.get(id);
  const doc = readJson(sessionFile(id));
  if (!doc) return null;
  doc.items = Array.isArray(doc.items) ? doc.items : [];
  doc.messages = Array.isArray(doc.messages) ? doc.messages : [];
  doc.seq = 0;
  docs.set(id, doc);
  return doc;
}

function saveNow(id) {
  const t = saveTimers.get(id);
  if (t) { clearTimeout(t); saveTimers.delete(id); }
  const doc = docs.get(id);
  if (!doc) return;
  const { seq, ...rest } = doc;
  try { writeJson(sessionFile(id), rest); } catch (err) { console.error('code save:', err.message); }
}

function scheduleSave(id) {
  if (saveTimers.has(id)) return;
  saveTimers.set(id, setTimeout(() => { saveTimers.delete(id); saveNow(id); }, 1500));
}

function gitBranch(folder) {
  // Walk up to the repository root; cheap enough to do on every open.
  let dirp = path.resolve(folder);
  for (let i = 0; i < 12; i++) {
    const head = path.join(dirp, '.git', 'HEAD');
    try {
      const txt = fs.readFileSync(head, 'utf8').trim();
      const m = /^ref:\s*refs\/heads\/(.+)$/.exec(txt);
      return m ? m[1] : txt.slice(0, 8);
    } catch { /* not here */ }
    const up = path.dirname(dirp);
    if (up === dirp) break;
    dirp = up;
  }
  return '';
}

const pickModel = (m) => {
  const v = MODEL_ALIASES[m] || m;
  if (MODELS.includes(v)) return v;
  const d = MODEL_ALIASES[prefs.get('defaultModel')] || prefs.get('defaultModel');
  return MODELS.includes(d) ? d : MODELS[0];
};
const pickEffort = (e) => (EFFORTS.includes(e) ? e : (EFFORTS.includes(prefs.get('defaultEffort')) ? prefs.get('defaultEffort') : 'medium'));

function meta(doc) {
  return {
    id: doc.id, title: doc.title, folder: doc.folder, mode: doc.mode, model: pickModel(doc.model), effort: pickEffort(doc.effort),
    pinned: Boolean(doc.pinned),
    createdAt: doc.createdAt, updatedAt: doc.updatedAt, running: running.has(doc.id),
    folderMissing: !fs.existsSync(doc.folder),
  };
}

function listSessions() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'sessions')); } catch { /* none yet */ }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    const doc = docs.get(id) || readJson(sessionFile(id));
    if (doc && doc.id) out.push(meta(doc));
  }
  return out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt - a.updatedAt));
}

function broadcastList() {
  ctx?.send('code:sessions', listSessions());
}

function addRecent(folder) {
  const rec = [folder, ...(prefs.get('recents') || []).filter(f => f !== folder)].slice(0, 12);
  prefs.set('recents', rec);
}

// ── workers ───────────────────────────────────────────────────────────────────

async function ensureWorker(id, folder) {
  const w = workers.get(id);
  if (w && w.alive) { w.lastUsed = now(); return w; }
  const env = await resolveShellEnv();
  const proc = utilityProcess.fork(WORKER, [], {
    cwd: folder,
    env: { ...env, DEIZA_FLAVOR: 'closed', DEIZA_DESKTOP: '1' },
    serviceName: 'Deiza Code',
    stdio: app.isPackaged ? 'ignore' : 'inherit',
  });
  const entry = { proc, alive: true, lastUsed: now() };
  workers.set(id, entry);
  proc.on('message', (ev) => onWorkerEvent(id, ev));
  proc.on('exit', (code) => {
    computerHost.cancelSession(id);
    entry.alive = false;
    if (workers.get(id) === entry) workers.delete(id);
    const r = running.get(id);
    if (r) {
      if (!r.aborting) emit(id, { t: 'error', code: 'crash', message: `El proceso del agente se detuvo (código ${code}).` });
      emit(id, { t: 'turn_end', turnId: r.turnId, stopReason: r.aborting ? 'aborted' : 'error', elapsedMs: now() - r.startedAt, stats: {}, revertible: fs.existsSync(snapshotFile(id, r.turnId)) });
    }
  });
  return entry;
}

function snapshotFile(id, turnId) {
  return path.join(dir, 'snapshots', id, `${String(turnId).replace(/[^a-z0-9_]/gi, '')}.json`);
}

/** Apply an event to the stored transcript and forward it to the UI. */
function emit(id, ev) {
  const doc = loadDoc(id);
  if (!doc) return;
  if (ev.t !== 'status') Transcript.apply(doc.items, ev);
  doc.seq = (doc.seq || 0) + 1;
  ctx?.send('code:event', { id, seq: doc.seq, ev });
  if (ev.t === 'turn_end') {
    const r = running.get(id);
    if (r && r.abortTimer) clearTimeout(r.abortTimer);
    running.delete(id);
    doc.updatedAt = now();
    saveNow(id);
    broadcastList();
    notifyDone(doc, ev);
  } else if (ev.t !== 'status' && ev.t !== 'text') {
    scheduleSave(id);
  } else if (ev.t === 'text') {
    scheduleSave(id);
  }
}

function onWorkerEvent(id, ev) {
  if (!ev || typeof ev !== 'object') return;
  const doc = loadDoc(id);
  if (!doc) return;
  if (ev.t === 'ready') return;
  if (ev.t === 'computer_request') {
    const proc = workers.get(id)?.proc;
    if (!proc || !running.has(id)) return;
    computerHost.request(id, ev.requestId, ev.name, ev.args || {}, doc.folder, doc.mode)
      .then(result => { if (workers.get(id)?.proc === proc) proc.postMessage({ t: 'computer_result', requestId: ev.requestId, result }); })
      .catch(err => { if (workers.get(id)?.proc === proc) proc.postMessage({ t: 'computer_result', requestId: ev.requestId, result: { error: err.message } }); });
    return;
  }
  if (ev.t === 'computer_cancel') { computerHost.cancel(id, ev.requestId); return; }
  if (ev.t === 'history') { doc.messages = ev.messages; scheduleSave(id); return; }
  if (ev.t === 'context') { doc.context = { used: ev.used, limit: ev.limit, model: ev.model, estimated: Boolean(ev.estimated) }; }
  if (ev.t === 'quota') { ctx?.send('code:event', { id, seq: 0, ev }); return; }
  if (ev.t === 'snapshot') {
    try { writeJson(snapshotFile(id, ev.turnId), { turnId: ev.turnId, files: ev.files }); } catch (err) { console.error('snapshot:', err.message); }
    return;
  }
  emit(id, ev);
}

function notifyDone(doc, ev) {
  const win = ctx?.getWindow();
  if ((win && win.isFocused()) || !Notification.isSupported() || prefs.get('notify') === false) return;
  const secs = Math.round((ev.elapsedMs || 0) / 1000);
  const took = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`;
  const files = ev.stats?.files?.length || 0;
  const body = ev.stopReason === 'done'
    ? `Terminado en ${took}${files ? ` · ${files} archivo${files === 1 ? '' : 's'}` : ''}`
    : ev.stopReason === 'aborted' ? 'Detenido' : 'Se detuvo con un problema';
  const n = new Notification({ title: doc.title || 'Deiza Code', body, silent: false });
  n.on('click', () => {
    const w = ctx.getWindow();
    if (w) { w.show(); w.focus(); }
    ctx.setMode('code');
    ctx.send('code:command', { open: doc.id });
  });
  n.show();
}

// ── session operations ────────────────────────────────────────────────────────

function createSession(folder, mode, model, effort) {
  const id = uid();
  const doc = {
    id, title: 'Nueva sesión', folder, mode: MODES.includes(mode) ? mode : (prefs.get('defaultMode') || 'build'),
    model: pickModel(model), effort: pickEffort(effort),
    pinned: false,
    createdAt: now(), updatedAt: now(), messages: [], items: [], pendingNote: '', seq: 0,
  };
  docs.set(id, doc);
  saveNow(id);
  addRecent(folder);
  prefs.set('lastSession', id);
  broadcastList();
  return meta(doc);
}

function saveAttachments(id, images) {
  const out = [];
  const dataUrls = [];
  const base = path.join(dir, 'attachments', id);
  for (const img of (Array.isArray(images) ? images : []).slice(0, 6)) {
    const m = /^data:(image\/(png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(img || ''));
    if (!m) continue;
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 8 * 1024 * 1024) continue;
    fs.mkdirSync(base, { recursive: true });
    const file = path.join(base, `${uid()}.${m[2] === 'jpeg' ? 'jpg' : m[2]}`);
    fs.writeFileSync(file, buf);
    out.push(file);
    dataUrls.push(img);
  }
  return { paths: out, dataUrls };
}

/** The user's enabled Skills (same ones the web chat uses), cached for a minute. */
async function enabledSkills() {
  const token = auth.getToken();
  if (!token) return [];
  if (skillsCache.token === token && now() - skillsCache.at < SKILLS_TTL_MS) return skillsCache.list;
  try {
    const res = await net.fetch(`${ORIGIN}/api/skills`, { headers: { 'X-Auth-Token': token, 'X-Deiza-Client': 'desktop' } });
    if (!res.ok) return skillsCache.token === token ? skillsCache.list : [];
    const body = await res.json();
    const list = (body.custom || []).filter(sk => sk && sk.enabled !== false && sk.instructions)
      .map(sk => ({ name: sk.name, description: sk.description || '', instructions: sk.instructions }));
    skillsCache = { at: now(), token, list };
    return list;
  } catch {
    return skillsCache.token === token ? skillsCache.list : [];
  }
}

function invalidateSkills() { skillsCache = { at: 0, token: '', list: [] }; }

async function send({ id, text, images, attachments = [], mode, model, effort }) {
  const doc = loadDoc(id);
  if (!doc) return { error: 'not_found' };
  if (running.has(id)) return { error: 'busy' };
  if (!auth.getToken()) return { error: 'auth' };
  if (!fs.existsSync(doc.folder)) return { error: 'folder' };
  const input = String(text || '').trim();
  const att = saveAttachments(id, images);
  let selected;
  try {
    selected = attachmentStore.resolve(attachments, id);
    att.dataUrls.push(...attachmentStore.images(selected));
    att.paths.push(...selected.filter(a => a.kind === 'image').map(a => a.path));
    if (att.dataUrls.length > 6) throw new Error('Adjunta como máximo 6 imágenes por mensaje.');
  } catch (err) { return { error: 'attachments', message: err.message }; }
  if (!input && !att.paths.length && !selected.length) return { error: 'empty' };

  if (mode && MODES.includes(mode)) doc.mode = mode;
  if (MODELS.includes(model)) doc.model = model;
  if (EFFORTS.includes(effort)) doc.effort = effort;
  if (doc.title === 'Nueva sesión' && input) {
    const first = input.split('\n')[0].trim();
    doc.title = first.length > 64 ? `${first.slice(0, 61).trimEnd()}…` : first;
  }
  const turnId = `turn_${uid()}`;
  emit(id, { t: 'user', text: input, images: att.paths, attachments: selected.map(({ id, name, path, kind, size }) => ({ id, name, path, kind, size })), turnId });
  const note = doc.pendingNote;
  doc.pendingNote = '';
  running.set(id, { turnId, startedAt: now() });
  doc.updatedAt = now();
  saveNow(id);
  broadcastList();

  try {
    const [w, skills] = await Promise.all([ensureWorker(id, doc.folder), enabledSkills()]);
    w.proc.postMessage({
      type: 'run',
      turnId,
      mode: doc.mode,
      model: pickModel(doc.model),
      effort: pickEffort(doc.effort),
      skills,
      language: getLanguage(),
      messages: doc.messages,
      input: note ? `${note}\n\n${input}` : input,
      images: att.dataUrls,
      attachments: selected,
      auth: { token: auth.getToken(), origin: ORIGIN, appVersion: app.getVersion() },
      desktop: { platform: process.platform, arch: process.arch },
    });
  } catch (err) {
    emit(id, { t: 'error', code: 'engine', message: err.message });
    emit(id, { t: 'turn_end', turnId, stopReason: 'error', elapsedMs: 0, stats: {}, revertible: false });
  }
  return { ok: true, turnId };
}

function abort(id) {
  const r = running.get(id);
  if (!r) return;
  r.aborting = true;
  computerHost.cancelSession(id);
  const w = workers.get(id);
  if (w && w.alive) w.proc.postMessage({ type: 'abort' });
  // A command that ignores the signal (or a stuck request) must not keep the session hostage.
  r.abortTimer = setTimeout(() => {
    if (!running.has(id)) return;
    const ww = workers.get(id);
    if (ww && ww.alive) ww.proc.kill();
    else emit(id, { t: 'turn_end', turnId: r.turnId, stopReason: 'aborted', elapsedMs: now() - r.startedAt, stats: {}, revertible: false });
  }, 4000);
}

function revert(id, turnId) {
  const doc = loadDoc(id);
  if (!doc || running.has(id)) return { error: 'busy' };
  const snap = readJson(snapshotFile(id, turnId));
  if (!snap || !Array.isArray(snap.files)) return { error: 'no_snapshot' };
  const root = path.resolve(doc.folder);
  const restored = [];
  const skipped = [];
  for (const f of snap.files) {
    const full = path.resolve(root, f.path);
    const relp = path.relative(root, full);
    if (!f.revertible || relp.startsWith('..') || path.isAbsolute(relp)) { skipped.push(f.path); continue; }
    try {
      if (f.existed) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, f.content ?? '', 'utf8');
      } else if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        fs.rmSync(full);
      }
      restored.push(f.path);
    } catch {
      skipped.push(f.path);
    }
  }
  emit(id, { t: 'reverted', turnId });
  emit(id, { t: 'notice', text: `Cambios revertidos: ${restored.join(', ') || 'ninguno'}${skipped.length ? ` · sin revertir: ${skipped.join(', ')}` : ''}` });
  doc.pendingNote = `[Nota del sistema: el usuario ha revertido los cambios de archivos de tu última respuesta (${restored.join(', ')}). Esos archivos vuelven a su estado anterior; los comandos ejecutados no se deshacen.]`;
  saveNow(id);
  return { ok: true, restored, skipped };
}

function deleteSession(id) {
  computerHost.cancelSession(id);
  computerHost.close(id);
  attachmentStore?.removeSession(id);
  const w = workers.get(id);
  if (w && w.alive) w.proc.kill();
  workers.delete(id);
  running.delete(id);
  docs.delete(id);
  for (const p of [sessionFile(id), path.join(dir, 'snapshots', id), path.join(dir, 'attachments', id)]) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (prefs.get('lastSession') === id) prefs.set('lastSession', '');
  broadcastList();
}

// ── files for the side panel ──────────────────────────────────────────────────

function resolveInside(doc, relPath) {
  const root = path.resolve(doc.folder);
  const full = path.resolve(root, String(relPath || '.'));
  const r = path.relative(root, full);
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return { root, full, rel: r.split(path.sep).join('/') };
}

function listDir(id, relPath) {
  const doc = loadDoc(id);
  if (!doc) return { error: 'not_found' };
  const loc = resolveInside(doc, relPath);
  if (!loc) return { error: 'outside' };
  try {
    const entries = fs.readdirSync(loc.full, { withFileTypes: true })
      .filter(e => !HIDDEN.has(e.name))
      .map(e => {
        const relp = path.posix.join(loc.rel || '', e.name);
        const isDir = e.isDirectory() || (e.isSymbolicLink() && (() => { try { return fs.statSync(path.join(loc.full, e.name)).isDirectory(); } catch { return false; } })());
        return { name: e.name, rel: relp, dir: isDir };
      })
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'es', { numeric: true }) : a.dir ? -1 : 1))
      .slice(0, 800);
    return { entries };
  } catch (err) {
    return { error: err.message };
  }
}

function readFile(id, relPath) {
  const doc = loadDoc(id);
  if (!doc) return { error: 'not_found' };
  const loc = resolveInside(doc, relPath);
  if (!loc) return { error: 'outside' };
  try {
    const st = fs.statSync(loc.full);
    if (st.isDirectory()) return { kind: 'dir' };
    const ext = path.extname(loc.full).toLowerCase();
    const url = preview.urlFor(doc.folder, loc.rel);
    const base = { rel: loc.rel, full: loc.full, size: st.size, mtime: st.mtimeMs, url, ext };
    if (IMAGE_EXT.has(ext) && ext !== '.svg') return { ...base, kind: 'image' };
    if (st.size > 2 * 1024 * 1024) return { ...base, kind: 'large' };
    const buf = fs.readFileSync(loc.full);
    if (buf.subarray(0, 8000).includes(0)) return { ...base, kind: ext === '.pdf' ? 'pdf' : 'binary' };
    return { ...base, kind: 'text', content: buf.toString('utf8'), lang: LANG_BY_EXT[ext] || (path.basename(loc.full).toLowerCase() === 'dockerfile' ? 'dockerfile' : '') };
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'missing' : err.message };
  }
}

/** Dictation: the recorded clip goes to the same speech service as the web's microphone. */
async function transcribe({ audio, mime, durationMs, language }) {
  const token = auth.getToken();
  if (!token) return { error: 'auth' };
  let buf;
  try { buf = Buffer.from(audio); } catch { return { error: 'empty' }; }
  if (!buf || buf.length < 400) return { error: 'empty' };
  if (buf.length > 24 * 1024 * 1024) return { error: 'too_long' };
  const type = /^audio\/(webm|ogg|mp4|wav)/.test(String(mime || '')) ? String(mime).split(';')[0] : 'audio/webm';
  const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/wav': 'wav' }[type] || 'webm';
  const boundary = `----deiza${crypto.randomBytes(9).toString('hex')}`;
  const field = (name, value) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  const lang = String(language || getLanguage() || 'es').slice(0, 5);
  const body = Buffer.concat([
    field('language', lang),
    field('duration_ms', String(Math.max(0, Math.round(Number(durationMs) || 0)))),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="dictado.${ext}"\r\nContent-Type: ${type}\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  try {
    const res = await net.fetch(`${ORIGIN}/api/transcribe`, {
      method: 'POST',
      headers: { 'X-Auth-Token': token, 'X-Deiza-Client': 'desktop', 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) return { error: 'auth' };
    if (res.status === 429) return { error: 'rate' };
    if (!res.ok) return { error: 'server' };
    return { text: String(out.transcript || '').trim() };
  } catch {
    return { error: 'offline' };
  }
}

async function usage() {
  const token = auth.getToken();
  if (!token) return { error: 'auth' };
  try {
    const res = await net.fetch(`${ORIGIN}/api/code/usage`, { headers: { 'X-Auth-Token': token, 'X-Deiza-Client': 'desktop' } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) return { error: 'auth' };
    if (res.status === 403) return { error: 'plan', plan: body.plan || 'free' };
    if (!res.ok) return { error: 'server' };
    return body;
  } catch {
    return { error: 'offline' };
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────

function setupIpc(c) {
  ctx = c;
  const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => (ctx.isTrusted(e) ? fn(...args) : null));

  handle('code:list', () => ({ sessions: listSessions(), recents: (prefs.get('recents') || []).filter(f => fs.existsSync(f)), lastSession: prefs.get('lastSession') || '' }));
  handle('code:get', (id) => {
    const doc = loadDoc(id);
    if (!doc) return null;
    prefs.set('lastSession', id);
    return { ...meta(doc), branch: gitBranch(doc.folder), items: doc.items, seq: doc.seq || 0, context: doc.context || null };
  });
  handle('code:create', ({ folder, mode, model, effort } = {}) => {
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return { error: 'folder' };
    return createSession(path.resolve(folder), mode, model, effort);
  });
  handle('code:pick-folder', async () => {
    const win = ctx.getWindow();
    const r = await dialog.showOpenDialog(win, { title: 'Elige la carpeta del proyecto', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Abrir' });
    if (r.canceled || !r.filePaths[0]) return null;
    addRecent(r.filePaths[0]);
    return r.filePaths[0];
  });
  handle('code:send', (payload) => send(payload || {}));
  handle('code:attach', (payload = {}) => {
    if (payload.id && !loadDoc(payload.id)) return { attachments: [], errors: ['La sesión ya no existe.'] };
    return attachmentStore.attach(payload);
  });
  handle('code:abort', (id) => { abort(id); return true; });
  handle('code:approve', ({ id, approvalId, approved, always } = {}) => {
    const w = workers.get(id);
    if (w && w.alive) w.proc.postMessage({ type: 'approval', id: approvalId, approved, always });
    return true;
  });
  handle('code:set-model', ({ id, model, effort } = {}) => {
    const doc = id ? loadDoc(id) : null;
    if (MODELS.includes(model)) { prefs.set('defaultModel', model); if (doc) doc.model = model; }
    if (EFFORTS.includes(effort)) { prefs.set('defaultEffort', effort); if (doc) doc.effort = effort; }
    if (doc) saveNow(id);
    return { model: pickModel(doc ? doc.model : model), effort: pickEffort(doc ? doc.effort : effort) };
  });
  handle('code:prefs', () => ({ model: pickModel(), effort: pickEffort(), mode: prefs.get('defaultMode') || 'build', notify: prefs.get('notify') !== false }));
  handle('code:transcribe', (payload) => transcribe(payload || {}));
  handle('code:set-mode', ({ id, mode } = {}) => {
    if (!MODES.includes(mode)) return false;
    prefs.set('defaultMode', mode);
    const doc = loadDoc(id);
    if (doc) { doc.mode = mode; saveNow(id); }
    return true;
  });
  handle('code:rename', ({ id, title } = {}) => {
    const doc = loadDoc(id);
    if (!doc) return false;
    doc.title = String(title || '').trim().slice(0, 120) || doc.title;
    saveNow(id);
    broadcastList();
    return true;
  });
  handle('code:delete', async (payload) => {
    const id = typeof payload === 'object' && payload !== null ? payload.id : payload;
    const doc = loadDoc(id);
    if (!doc) return false;
    deleteSession(id);
    return true;
  });
  handle('code:pin', ({ id, pinned } = {}) => {
    const doc = loadDoc(id);
    if (!doc) return false;
    doc.pinned = pinned !== undefined ? Boolean(pinned) : !doc.pinned;
    saveNow(id);
    broadcastList();
    return doc.pinned;
  });
  handle('code:session-menu', (id) => new Promise((resolve) => {
    const doc = loadDoc(id);
    if (!doc) return resolve(null);
    const isPinned = Boolean(doc.pinned);
    const menu = Menu.buildFromTemplate([
      { label: isPinned ? T('Desfijar sesión') : T('Fijar sesión'), click: () => resolve(isPinned ? 'unpin' : 'pin') },
      { label: T('Renombrar'), click: () => resolve('rename') },
      { label: process.platform === 'darwin' ? T('Mostrar en Finder') : T('Mostrar en el Explorador'), click: () => { shell.openPath(doc.folder); resolve(null); } },
      { type: 'separator' },
      { label: T('Eliminar sesión'), click: () => resolve('delete') },
    ]);
    menu.popup({ window: ctx.getWindow() || undefined, callback: () => setTimeout(() => resolve(null), 50) });
  }));
  handle('code:revert', ({ id, turnId } = {}) => revert(id, turnId));
  // Manual compaction (the agent also compacts on its own at 70 % of the window)
  handle('code:compact', ({ id } = {}) => {
    if (running.has(id)) return { error: 'busy' };
    const doc = loadDoc(id);
    if (!doc || !Array.isArray(doc.messages)) return { error: 'empty' };
    const { compactContext } = require('../engine/vendor/agent');
    const { getActiveContextTokens } = require('../engine/vendor/session');
    const r = compactContext(doc.messages, { force: true });
    if (!r.compacted) return { compacted: false, reason: r.reason };
    const used = getActiveContextTokens(doc.messages);
    emit(id, { t: 'notice', text: `Contexto compactado: de ${Number(r.beforeTokens).toLocaleString('es')} a ${Number(r.afterTokens).toLocaleString('es')} tokens.` });
    doc.context = { ...(doc.context || { limit: 262144 }), used, estimated: true };
    ctx?.send('code:event', { id, seq: 0, ev: { t: 'context_set', used, limit: doc.context.limit } });
    saveNow(id);
    return { compacted: true, before: r.beforeTokens, after: r.afterTokens };
  });
  handle('code:fs-list', ({ id, rel } = {}) => listDir(id, rel));
  handle('code:fs-read', ({ id, rel } = {}) => readFile(id, rel));
  handle('code:fs-reveal', ({ id, rel } = {}) => {
    const doc = loadDoc(id);
    const loc = doc && resolveInside(doc, rel);
    if (loc) shell.showItemInFolder(loc.full);
    return true;
  });
  handle('code:fs-open', ({ id, rel } = {}) => {
    const doc = loadDoc(id);
    const loc = doc && resolveInside(doc, rel);
    if (loc) shell.openPath(loc.full);
    return true;
  });
  handle('code:usage', () => usage());
  handle('code:open-preview-window', ({ url, title } = {}) => {
    if (typeof url !== 'string' || !(url.startsWith(`${preview.SCHEME}://`) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url))) return false;
    const w = new BrowserWindow({
      width: 1200, height: 820, title: title || 'Vista previa', autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    w.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });
    w.loadURL(url);
    return true;
  });
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

function init(opts) {
  ORIGIN = opts.origin;
  auth = opts.auth;
  if (opts.getLanguage) getLanguage = opts.getLanguage;
  dir = path.join(app.getPath('userData'), 'code');
  attachmentStore = createAttachmentStore(path.join(dir, 'file-attachments'));
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  prefs = createStore('code-prefs', { recents: [], lastSession: '', defaultMode: 'build', defaultModel: MODELS[0], defaultEffort: 'medium', notify: true });
  // 1.1.11: Solid 5 (1M context) becomes the default model for Code, once, for everyone still on the old default
  if (prefs.get('modelDefaultV') !== 2) {
    const cur = MODEL_ALIASES[prefs.get('defaultModel')] || prefs.get('defaultModel');
    if (!cur || cur === 'deiza-omniscient') prefs.set('defaultModel', 'deiza-solid-5');
    prefs.set('modelDefaultV', 2);
  }
  resolveShellEnv(); // warm up: the first message should not wait for the login shell
  setInterval(() => {
    for (const [id, w] of workers) {
      if (!running.has(id) && now() - w.lastUsed > IDLE_KILL_MS) { try { w.proc.kill(); } catch { /* gone */ } workers.delete(id); }
    }
  }, 5 * 60 * 1000).unref();
}

function shutdown() {
  for (const id of saveTimers.keys()) saveNow(id);
  prefs?.flush();
  for (const [, w] of workers) { try { w.proc.kill(); } catch { /* gone */ } }
}

function setPref(key, value) {
  if (key === 'notify') prefs.set('notify', Boolean(value));
  else if (key === 'defaultMode' && MODES.includes(value)) prefs.set('defaultMode', value);
  else if (key === 'defaultModel' && MODELS.includes(value)) prefs.set('defaultModel', value);
  else if (key === 'defaultEffort' && EFFORTS.includes(value)) prefs.set('defaultEffort', value);
}

module.exports = { init, setupIpc, shutdown, invalidateSkills, setPref, isBusy: () => running.size > 0 };
