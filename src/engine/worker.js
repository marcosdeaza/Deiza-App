/**
 * Deiza Code — desktop worker.
 *
 * Runs in an Electron utility process whose working directory is the project folder. It uses
 * the Deiza Code engine modules unchanged (tools, system prompt, context, compaction) and
 * replaces the terminal presentation with structured events for the app:
 *
 *   status        ephemeral "what is happening now" line
 *   text          assistant prose, streamed
 *   tool_start / tool_output / tool_end   one card per tool call (diffs, live command output)
 *   plan          checklist from update_plan
 *   approval      Copilot mode: the app shows the diff/command and answers approve/reject
 *   snapshot      original contents of files touched this turn (the app can revert them)
 *   history       the full model conversation after each round (persisted by the app)
 *   turn_end      stats and stop reason
 */
/* global DEIZA_FLAVOR */
globalThis.DEIZA_FLAVOR = 'closed';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const { Tools, TOOL_DEFINITIONS, MAX_TOOL_OUTPUT, isCommandRisky, isCommandCatastrophic } = require('./vendor/tools');
const { buildSystemPrompt } = require('./vendor/prompt');
const { compactContext, TOOL_SPECS } = require('./vendor/agent');
const { getActiveContextTokens } = require('./vendor/session');
const { diffText } = require('./diff');

const port = process.parentPort;
const post = (ev) => { try { port.postMessage(ev); } catch { /* app went away */ } };

const MAX_FAILED_ROUNDS = 4;
// Real context windows of the Code engines (tokens). The vendored CLI modules assume 1M, which made
// long sessions fail on every request; compaction starts at 70 % of the real window.
const CONTEXT_LIMITS = { 'deiza-omniscient': 262144, 'deiza-solid-5': 262144, 'deiza-gas-4.5': 131072 };
const contextLimit = (model) => CONTEXT_LIMITS[model] || 262144;
const MAX_TOKENS = 32768;

// Models the Code picker offers. All of them call tools; `effort` = honours reasoning_effort,
// `vision` = accepts images.
const MODELS = {
  'deiza-omniscient': { effort: true, vision: true },   // shown as Liquid 5.1
  'deiza-solid-5': { effort: true, vision: true },
  'deiza-gas-4.5': { effort: false, vision: false },
};
const DEFAULT_MODEL = 'deiza-omniscient';
// Sessions saved by earlier versions keep working under the new names.
const MODEL_ALIASES = { 'deiza-solid-4.6': 'deiza-solid-5', 'deiza-solid-4.5': 'deiza-solid-5', 'deiza-gas-4.1': 'deiza-gas-4.5', 'deiza-liquid-5': 'deiza-omniscient', 'deiza-liquid-5.1': 'deiza-omniscient', 'deiza-vainilla': 'deiza-gas-4.5' };
const normModel = (m) => (MODELS[m] ? m : MODEL_ALIASES[m] || DEFAULT_MODEL);

// Effort levels: how hard the model reasons (when it can) and how far the agent is allowed to go.
const EFFORTS = {
  low: {
    api: 'low', maxTokens: 16384, maxTurns: 40, continuations: 3,
    guide: 'Effort: LOW. Be fast and direct. Read only what the task needs, make the change, verify only if it is cheap, and answer in a few lines.',
  },
  medium: { api: 'medium', maxTokens: MAX_TOKENS, maxTurns: 90, continuations: 6, guide: '' },
  high: {
    api: 'high', maxTokens: MAX_TOKENS, maxTurns: 140, continuations: 8,
    guide: 'Effort: HIGH. Think before acting. Read the relevant code first, keep the existing style, and verify your work (run the tests or the build when the project has them) before you finish.',
  },
  ultra: {
    api: 'high', maxTokens: MAX_TOKENS, maxTurns: 180, continuations: 9,
    guide: 'Effort: ULTRA. Plan non-trivial work with update_plan, read every file you are about to change, verify each step by running tests, builds or linters when available, and review your own diff before you finish.',
  },
  max: {
    api: 'high', maxTokens: MAX_TOKENS, maxTurns: 220, continuations: 10,
    guide: 'Effort: OMNISCIENT (maximum). Take the time the task deserves. Map the project before changing it, keep a plan with update_plan for anything non-trivial, consider edge cases and failure modes, verify every change by running tests, builds or linters when available, then review your own diff and fix what you find before you finish. Prefer correctness over speed.',
  },
};
const DEFAULT_EFFORT = 'medium';
const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;
const MUTATING = new Set(['edit_file', 'write_file', 'append_file', 'run_command', 'delete_path', 'move_path']);
const FILE_MUTATING = new Set(['edit_file', 'write_file', 'append_file', 'delete_path', 'move_path']);
const TOOL_BY_NAME = Object.fromEntries(TOOL_DEFINITIONS.map(t => [t.name, t]));

let current = null;           // { abort: AbortController, approvals: Map }
let alwaysApprove = false;    // "Aplicar todo" for the rest of the current request

// ── small helpers ─────────────────────────────────────────────────────────────

const rel = (p) => {
  const r = path.relative(process.cwd(), path.resolve(process.cwd(), String(p || '')));
  return r || '.';
};
const insideRoot = (p) => {
  const r = path.relative(process.cwd(), path.resolve(process.cwd(), String(p || '')));
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const tail = (s, n) => (s.length > n ? s.slice(-n) : s);

function readTextSafe(p) {
  try {
    const full = path.resolve(process.cwd(), p);
    const st = fs.statSync(full);
    if (!st.isFile() || st.size > SNAPSHOT_MAX_BYTES) return { exists: true, text: null, size: st.size, dir: st.isDirectory() };
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return { exists: true, text: null, size: st.size, binary: true };
    return { exists: true, text: buf.toString('utf8'), size: st.size };
  } catch {
    return { exists: false, text: '' };
  }
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}

function looksTruncatedJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  try { JSON.parse(text); return false; } catch (err) { return !text.endsWith('}') || /unexpected end|unterminated/i.test(String(err.message)); }
}

function argField(raw, field) {
  const m = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(raw || '');
  if (!m) return '';
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}

function looksUnfinished(text) {
  const lines = String(text || '').trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  const last = lines[lines.length - 1];
  if (/[:：]$/.test(last)) return true;
  return /^(ahora|a continuación|seguidamente|luego|después|procedo|paso \d|voy a|vamos a|next|now)\b/i.test(last) && !/[.!?]$/.test(last);
}

function trimContext(messages, maxChars) {
  const size = () => messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
  while (messages.length > 6 && size() > maxChars) {
    messages.splice(1, 1);
    while (messages.length > 2 && messages[1].role === 'tool') messages.splice(1, 1);
  }
}

function toolTarget(name, a = {}) {
  switch (name) {
    case 'run_command': return a.command || '';
    case 'search_files': return a.query || '';
    case 'move_path': return `${a.from || ''} → ${a.to || ''}`;
    case 'fetch_url': return a.url || '';
    case 'invoke_subagent': return a.task || '';
    case 'update_plan': return '';
    case 'list_dir': return a.path || '.';
    default: return a.path || '';
  }
}

// ── desktop system prompt ─────────────────────────────────────────────────────

function systemPrompt(mode, desktop, opts = {}) {
  let s = buildSystemPrompt(mode, { toolMode: 'native' });
  s = s.replace("designed to run directly inside the user's terminal environment",
    "running inside the Deiza desktop app (Code mode), with direct access to the user's project folder");
  s = s.replace('Finish by telling the user to run /build (autonomous) or /copilot (change-by-change approval) to execute the plan.',
    'Finish by telling the user to switch the mode selector (next to the message box) to Build (autonomous) or Copilot (approve each change) to execute the plan.');
  const os = desktop.platform === 'win32' ? 'Windows' : desktop.platform === 'darwin' ? 'macOS' : 'Linux';
  const shell = desktop.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  s += `
# DESKTOP APP
- Operating system: ${os} (${desktop.arch || ''}). \`run_command\` runs through ${shell}${desktop.platform === 'win32' ? ' (use Windows syntax, or call powershell -NoProfile -Command "...")' : ''}.
- The user watches every tool call as a card: diffs for edits, live output for commands. Code belongs in files, not in chat messages.
- The side panel previews any file of the project, and HTML pages render live there. When you build a page or an app, end by naming the file to open (for example \`index.html\`) instead of pasting the code.
- \`run_command\` waits until the command exits: never start dev servers, watchers or interactive programs in the foreground. For static sites just write the files; for a server, tell the user the command to run it.
- Today is ${new Date().toISOString().slice(0, 10)}.
`;
  const effort = EFFORTS[opts.effort] || EFFORTS[DEFAULT_EFFORT];
  if (effort.guide) s += `- ${effort.guide}\n`;
  if (opts.language && !/^es/i.test(opts.language)) {
    s += `- The user's interface language is "${opts.language}": answer in that language unless the user writes in another one.\n`;
  }
  if (Array.isArray(opts.skills) && opts.skills.length) {
    let budget = 24000;
    const parts = [];
    for (const sk of opts.skills) {
      const block = `## ${String(sk.name || '').slice(0, 80)}${sk.description ? ` — ${String(sk.description).slice(0, 200)}` : ''}\n${String(sk.instructions || '').trim()}`;
      if (block.length > budget) break;
      budget -= block.length;
      parts.push(block);
    }
    if (parts.length) {
      s += `\n# USER SKILLS\nThe user enabled these skills in Deiza. Follow each one whenever it applies to the task; they never override the safety rules above.\n\n${parts.join('\n\n')}\n`;
    }
  }
  return s;
}

/** Text-only models get a placeholder instead of the images in the history. */
function stripImages(messages) {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const text = m.content.filter(p => p && p.type === 'text').map(p => p.text).join('\n');
    const n = m.content.filter(p => p && p.type === 'image_url').length;
    return { ...m, content: `${text}${n ? `\n\n[${n === 1 ? 'Imagen adjunta' : `${n} imágenes adjuntas`}: este modelo no puede verlas]` : ''}` };
  });
}

// ── streaming client (session-token auth against deiza.org) ───────────────────

let lastLimitMessage = '';

/** `: deiza-usage {...}` comment lines carry the live quota state (see backend usage v2). */
function parseQuotaComment(line) {
  const m = /^:\s*deiza-usage\s+(\{.*\})\s*$/.exec(line);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function describeError(status, body) {
  try {
    const parsed = JSON.parse(body);
    const err = parsed.error;
    const detail = typeof err === 'string' ? err : (err?.message || parsed.message || '');
    if (detail === 'plan_required' || err?.type === 'plan_required') return 'PLAN_REQUIRED';
    if (detail === 'model_sublimit') return 'MODEL_LIMIT';
    if (detail === 'usage_limit') { lastLimitMessage = String(parsed.message || ''); return 'USAGE_LIMIT'; }
    return `Error del motor (${status})${detail ? `: ${detail}` : ''}`;
  } catch {
    return `Error del motor (${status})`;
  }
}

function streamCompletion(auth, { model = DEFAULT_MODEL, effort, messages, tools, onChunk, onReasoning, onToolProgress, onQuota, maxTokens = MAX_TOKENS, signal }) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${auth.origin}/api/code/chat/completions`);
    const client = url.protocol === 'https:' ? https : http;
    const spec = MODELS[model] || MODELS[DEFAULT_MODEL];
    const body = {
      model: MODELS[model] ? model : DEFAULT_MODEL,
      messages: spec.vision ? messages : stripImages(messages),
      stream: true, temperature: 0.2, max_tokens: maxTokens, stream_options: { include_usage: true },
    };
    if (spec.effort && EFFORTS[effort]) body.reasoning_effort = EFFORTS[effort].api;
    if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    const payload = JSON.stringify(body);
    let settled = false;
    let req = null;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (err) reject(err); else resolve(value);
    };
    const onAbort = () => { try { req && req.destroy(); } catch { /* noop */ } finish(new Error('ABORTED')); };

    req = client.request(url, {
      method: 'POST',
      timeout: 300000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': `deiza-desktop/${auth.appVersion || '1'}`,
        'X-Auth-Token': auth.token,
        'X-Deiza-Client': 'desktop',
      },
    }, (res) => {
      if (res.statusCode === 401) { res.resume(); return finish(new Error('AUTH_EXPIRED')); }
      if (res.statusCode >= 400) {
        let b = '';
        res.on('data', c => { b += c; });
        res.on('end', () => {
          const d = describeError(res.statusCode, b);
          const err = new Error(res.statusCode === 429 && d.startsWith('Error') ? 'USAGE_LIMIT' : (res.statusCode === 403 && d.startsWith('Error') ? 'AUTH_EXPIRED' : d));
          err.status = res.statusCode;
          finish(err);
        });
        return;
      }
      if (onQuota && String(res.headers['x-deiza-usage-state'] || '') === 'grace') onQuota({ state: 'grace' });
      let buffer = '';
      let text = '';
      let finishReason = null;
      let usage = null;
      const calls = new Map();
      const decoder = new StringDecoder('utf8');
      const handle = (data) => {
        if (data === '[DONE]') return;
        let parsed;
        try { parsed = JSON.parse(data); } catch { return; }
        if (parsed.error) throw new Error(typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || 'Error del modelo'));
        if (parsed.usage) usage = parsed.usage;
        const choice = parsed.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || choice.message || {};
        const thought = delta.reasoning ?? delta.reasoning_content ?? '';
        if (thought && onReasoning) onReasoning(thought);
        const chunk = delta.content ?? '';
        if (chunk) { text += chunk; onChunk && onChunk(chunk); }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = Number.isInteger(tc.index) ? tc.index : calls.size;
            let cur = calls.get(idx);
            if (!cur) { cur = { id: '', name: '', arguments: '' }; calls.set(idx, cur); }
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (typeof tc.function?.arguments === 'string') cur.arguments += tc.function.arguments;
            onToolProgress && onToolProgress({ index: idx, name: cur.name, args: cur.arguments });
          }
        }
      };
      res.on('data', (chunk) => {
        buffer += decoder.write(chunk);
        const lines = buffer.split('\n');
        buffer = lines.pop();
        try {
          for (const line of lines) {
            const t = line.trim();
            if (t.startsWith(':') && onQuota) { const q = parseQuotaComment(t); if (q) onQuota(q); continue; }
            if (!t || t.startsWith(':') || t.startsWith('event:')) continue;
            handle(t.startsWith('data:') ? t.slice(5).trim() : t);
          }
        } catch (err) { req.destroy(); finish(err); }
      });
      res.on('end', () => {
        buffer += decoder.end();
        if (buffer.trim()) { try { handle(buffer.trim().replace(/^data:\s*/, '')); } catch (err) { return finish(err); } }
        const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c], i) => ({
          id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, arguments: c.arguments,
        }));
        finish(null, { text, toolCalls, finishReason, usage });
      });
      res.on('close', () => { if (!res.complete && !settled) finish(new Error('La conexión con el motor se cerró antes de terminar.')); });
      res.on('error', finish);
    });
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('timeout', () => req.destroy(new Error('El motor no respondió a tiempo.')));
    req.on('error', (err) => finish(new Error(err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' ? 'Sin conexión con deiza.org.' : err.message)));
    req.write(payload);
    req.end();
  });
}

async function streamWithRetry(auth, params) {
  // Resilient multi-minute backoff: keeps autonomous overnight runs alive across transient 429/503/drops
  const delays = [2000, 3000, 5000, 8000, 12000, 15000, 20000, 25000, 30000, 30000, 30000, 30000];
  let last;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      if (attempt) {
        post({ t: 'status', text: `Reconectando con el motor (${attempt}/${delays.length})…`, kind: 'thinking' });
        await new Promise(r => setTimeout(r, delays[attempt - 1]));
      }
      return await streamCompletion(auth, params);
    } catch (err) {
      last = err;
      const msg = String(err.message || '');
      if (params.signal?.aborted || ['ABORTED', 'AUTH_EXPIRED', 'PLAN_REQUIRED', 'USAGE_LIMIT', 'MODEL_LIMIT'].includes(msg)) throw err;
      const transient = /timeout|tiempo|cerró antes|interrumpid|aborted|econnreset|econnrefused|epipe|reset|socket|upstream|502|503|504|conexión|solicitado/i.test(msg)
        || /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN/.test(String(err.code || ''))
        || (err.status >= 500);
      if (!transient) throw err;
    }
  }
  throw last;
}

// ── run_command with live output and real cancellation ────────────────────────

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* gone */ }
  }
}

function runCommandLive({ command, cwd, timeout_ms = 120000 }, { signal, onOutput }) {
  if (isCommandCatastrophic(command)) {
    return Promise.resolve({ command, exit_code: 126, stdout: '', stderr: 'Comando bloqueado por Deiza Code: destruiría el sistema o el disco.', blocked: true });
  }
  return new Promise((resolve) => {
    const execCwd = cwd ? path.resolve(process.cwd(), cwd) : process.cwd();
    const limit = Math.min(Math.max(Number(timeout_ms) || 120000, 1000), 600000);
    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    let aborted = false;
    let flushTimer = null;
    const flush = () => { flushTimer = null; if (pending) { onOutput(pending); pending = ''; } };
    const push = (which, data) => {
      const s = data.toString('utf8');
      if (which === 'out') stdout = tail(stdout + s, 200000); else stderr = tail(stderr + s, 100000);
      pending += s;
      if (!flushTimer) flushTimer = setTimeout(flush, 120);
    };
    let child;
    try {
      child = spawn(command, {
        cwd: execCwd,
        shell: true,
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: { ...process.env, CI: 'true', DEBIAN_FRONTEND: 'noninteractive', FORCE_COLOR: '0', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return resolve({ command, exit_code: 127, stdout: '', stderr: err.message });
    }
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, limit);
    const onAbort = () => { aborted = true; killTree(child); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', d => push('out', d));
    child.stderr.on('data', d => push('err', d));
    const done = (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (flushTimer) { clearTimeout(flushTimer); flush(); }
      resolve({
        command,
        exit_code: aborted ? 130 : (code ?? (timedOut ? 124 : 1)),
        stdout: tail(stdout.trim(), 30000),
        stderr: tail(stderr.trim(), 10000),
        killed_by_timeout: timedOut,
        aborted,
      });
    };
    child.on('error', (err) => { stderr += err.message; done(127); });
    child.on('close', done);
  });
}

// ── file snapshots (revert) and diffs ─────────────────────────────────────────

function affectedPaths(name, a) {
  if (name === 'move_path') return [a.from, a.to].filter(Boolean);
  if (FILE_MUTATING.has(name)) return [a.path].filter(Boolean);
  return [];
}

function simulate(name, a) {
  // What the file would contain after the call (Copilot preview), without touching the disk.
  const before = readTextSafe(a.path);
  if (name === 'write_file') return { ok: true, before, after: String(a.content ?? '') };
  if (name === 'append_file') return { ok: true, before, after: (before.text || '') + String(a.content ?? '') };
  if (name === 'edit_file') {
    if (!before.exists) return { ok: false, error: `No existe ${a.path}` };
    if (before.text === null) return { ok: false, error: `${a.path} no es un archivo de texto editable` };
    const oldStr = String(a.old_string ?? '');
    const count = oldStr ? before.text.split(oldStr).length - 1 : 0;
    if (!count) return { ok: false, error: `No se encontró el texto exacto en ${a.path}.` };
    if (count > 1) return { ok: false, error: `El texto aparece ${count} veces en ${a.path}; debe ser único.` };
    return { ok: true, before, after: before.text.replace(oldStr, String(a.new_string ?? '')) };
  }
  return { ok: true, before, after: '' };
}

// ── the loop ──────────────────────────────────────────────────────────────────

async function run(msg) {
  const { auth, desktop = {}, turnId } = msg;
  const mode = ['build', 'copilot', 'plan'].includes(msg.mode) ? msg.mode : 'build';
  const model = normModel(msg.model);
  const effort = EFFORTS[msg.effort] ? msg.effort : DEFAULT_EFFORT;
  const E = EFFORTS[effort];
  const messages = Array.isArray(msg.messages) ? msg.messages : [];
  const abort = new AbortController();
  const approvals = new Map();
  current = { abort, approvals };
  alwaysApprove = false;
  const startedAt = Date.now();
  const stats = { tools: 0, files: new Set(), commands: 0, prompt: 0, completion: 0, rounds: 0, cmds: [] };
  let grace = false;
  const onQuota = (q) => {
    if (!q || typeof q !== 'object') return;
    if (q.state === 'grace' && !grace) {
      grace = true;
      post({ t: 'notice', kind: 'grace', text: 'Has llegado al límite de uso. Deiza termina lo que estaba haciendo con un margen de cortesía y deja el traspaso en DEIZA_HANDOFF.md.' });
    }
    post({ t: 'quota', ...q });
  };
  const snapshots = new Map();   // rel path -> { path, existed, content|null }
  let stopReason = 'done';

  const sys = systemPrompt(mode, desktop, { effort, skills: msg.skills, language: msg.language });
  if (!messages.length || messages[0].role !== 'system') messages.unshift({ role: 'system', content: sys });
  else messages[0].content = sys;

  const input = String(msg.input || '');
  if (Array.isArray(msg.images) && msg.images.length) {
    const content = [{ type: 'text', text: input || 'Mira esta imagen.' }];
    for (const url of msg.images.slice(0, 6)) content.push({ type: 'image_url', image_url: { url } });
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: input });
  }

  const snapshot = (p) => {
    if (!p || !insideRoot(p)) return;
    const key = rel(p);
    if (snapshots.has(key)) return;
    const cur = readTextSafe(key);
    snapshots.set(key, { path: key, existed: cur.exists, content: cur.exists ? cur.text : null, revertible: !cur.exists || cur.text !== null });
  };

  const pushResult = (call, payload) => {
    let s = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    if (s.length > MAX_TOOL_OUTPUT) s = s.slice(0, MAX_TOOL_OUTPUT) + '\n... (salida truncada)';
    messages.push({ role: 'tool', tool_call_id: call.id, content: s });
  };

  let continuations = 0;
  let nudged = false;
  let failedRounds = 0;

  try {
    while (stats.rounds < E.maxTurns) {
      if (abort.signal.aborted) { stopReason = 'aborted'; break; }
      stats.rounds++;

      if (getActiveContextTokens(messages) >= Math.floor(contextLimit(model) * 0.7)) {
        const comp = compactContext(messages, { force: true });
        if (comp.compacted) post({ t: 'notice', text: `Contexto compactado: de ${comp.beforeTokens.toLocaleString('es')} a ${comp.afterTokens.toLocaleString('es')} tokens.` });
      }
      trimContext(messages, Math.floor(contextLimit(model) * 2.6));

      post({ t: 'status', text: stats.rounds === 1 ? 'Pensando' : 'Continuando', kind: 'thinking' });
      let lastStreamIdx = -1;
      let lastStreamAt = 0;
      let textOpen = false;
      // Reasoning arrives in tiny deltas: batch them so the UI redraws a few times a second.
      let thinkBuf = '';
      let thinkTimer = null;
      let thinking = false;
      const flushThink = () => {
        if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; }
        if (thinkBuf) { post({ t: 'reasoning', delta: thinkBuf }); thinkBuf = ''; }
      };
      const endThink = () => {
        if (!thinking) return;
        flushThink();
        thinking = false;
        post({ t: 'reasoning_end' });
      };
      const result = await streamWithRetry(auth, {
        model,
        effort,
        messages,
        tools: TOOL_SPECS,
        maxTokens: E.maxTokens,
        signal: abort.signal,
        onQuota,
        onReasoning: (delta) => {
          if (!thinking) { thinking = true; post({ t: 'status', text: 'Razonando', kind: 'thinking' }); }
          thinkBuf += delta;
          if (!thinkTimer) thinkTimer = setTimeout(flushThink, 120);
        },
        onChunk: (chunk) => { endThink(); textOpen = true; post({ t: 'text', delta: chunk }); },
        onToolProgress: ({ index, name, args }) => {
          endThink();
          if (textOpen) { post({ t: 'text_end' }); textOpen = false; }
          const now = Date.now();
          if (index === lastStreamIdx && now - lastStreamAt < 150) return;
          lastStreamIdx = index;
          lastStreamAt = now;
          const target = name === 'run_command' ? argField(args, 'command') : (argField(args, 'path') || argField(args, 'url') || argField(args, 'from'));
          post({ t: 'status', kind: 'tool', name, text: target, bytes: args.length });
        },
      });
      endThink();
      if (textOpen) post({ t: 'text_end' });

      const assistantText = result.text || '';
      {
        const used = Number(result.usage?.prompt_tokens || 0) + Number(result.usage?.completion_tokens || 0);
        post({ t: 'context', used: used || getActiveContextTokens(messages), limit: contextLimit(model), model, estimated: !used });
      }
      stats.prompt += Number(result.usage?.prompt_tokens || Math.ceil(JSON.stringify(messages).length / 3.8));
      stats.completion += Number(result.usage?.completion_tokens || Math.ceil((assistantText.length + result.toolCalls.reduce((n, c) => n + c.arguments.length, 0)) / 3.8));

      const toolCalls = result.toolCalls.map(c => {
        const args = parseArgs(c.arguments);
        return { ...c, args, cut: args === null && looksTruncatedJson(c.arguments) };
      });
      const assistantMsg = { role: 'assistant', content: assistantText || (toolCalls.length ? null : '') };
      if (toolCalls.length) {
        assistantMsg.tool_calls = toolCalls.map(c => ({
          id: c.id, type: 'function',
          function: { name: c.name, arguments: c.args ? c.arguments : JSON.stringify({ truncated: true, path: argField(c.arguments, 'path') || undefined }) },
        }));
      }
      messages.push(assistantMsg);
      const truncated = result.finishReason === 'length' || toolCalls.some(c => c.cut);

      if (!toolCalls.length) {
        if (truncated && continuations < E.continuations) {
          continuations++;
          messages.push({ role: 'user', content: 'Tu respuesta se cortó por el límite de longitud. Continúa exactamente donde lo dejaste, sin repetir nada. Si estabas escribiendo un archivo, hazlo con las herramientas (write_file + append_file por partes).' });
          continue;
        }
        if (!nudged && looksUnfinished(assistantText)) {
          nudged = true;
          messages.push({ role: 'user', content: 'Has anunciado una acción pero no has llamado a ninguna herramienta. Ejecútala ahora con las herramientas. No repitas la explicación.' });
          continue;
        }
        post({ t: 'history', messages });
        break;
      }

      let roundOk = 0;
      for (const call of toolCalls) {
        if (abort.signal.aborted) { stopReason = 'aborted'; break; }
        const a = call.args || {};
        const target = toolTarget(call.name, a);

        if (!call.args || typeof call.args !== 'object') {
          const cut = call.cut || result.finishReason === 'length';
          post({ t: 'tool_start', id: call.id, name: call.name || 'herramienta', target: argField(call.arguments, 'path') });
          post({ t: 'tool_end', id: call.id, status: 'error', summary: cut ? 'Llamada cortada por el límite de salida; se reintenta por partes' : 'Argumentos no válidos' });
          pushResult(call, cut
            ? 'Error: los argumentos de esta llamada se cortaron por el límite de longitud de salida (el archivo no se ha escrito). Vuelve a hacerlo en varias llamadas más pequeñas: write_file con la primera parte (máximo ~150 líneas / 6 KB) y después append_file con cada parte siguiente. Cada llamada debe incluir path y content.'
            : 'Error: los argumentos de la herramienta no son JSON válido. Vuelve a emitir la llamada con JSON correcto.');
          continue;
        }
        const fn = call.name === 'run_command' ? null : Tools[call.name];
        if (call.name !== 'run_command' && !fn) {
          pushResult(call, `Error: herramienta '${call.name}' no reconocida. Disponibles: ${TOOL_DEFINITIONS.map(t => t.name).join(', ')}.`);
          continue;
        }
        const spec = TOOL_BY_NAME[call.name];
        const missing = (spec?.parameters?.required || []).filter(k => a[k] === undefined || a[k] === null);
        if (missing.length) {
          pushResult(call, `Error: faltan parámetros obligatorios para ${call.name}: ${missing.join(', ')}.`);
          continue;
        }

        if (call.name === 'update_plan') {
          const res = await Tools.update_plan(a);
          if (!res.error) post({ t: 'plan', steps: res.steps });
          pushResult(call, res);
          if (!res.error) roundOk++;
          continue;
        }

        if (mode === 'plan' && MUTATING.has(call.name)) {
          const readOnly = call.name === 'run_command' && /^\s*(git\s+(status|log|diff|branch|show)|ls|dir|cat|type|pwd|npm\s+(test|run\s+(test|lint|build))|pytest|cargo\s+(check|test)|go\s+(test|vet))\b/i.test(a.command || '');
          if (!readOnly) {
            post({ t: 'tool_start', id: call.id, name: call.name, target, path: a.path ? rel(a.path) : undefined });
            post({ t: 'tool_end', id: call.id, status: 'skipped', summary: 'Modo Plan: no se modifica nada' });
            pushResult(call, `[PLAN MODE] La acción ${call.name} fue interceptada: en modo PLAN no se modifica nada. Describe el cambio en el plan y continúa.`);
            continue;
          }
        }

        if (call.name === 'run_command' && isCommandCatastrophic(a.command || '')) {
          post({ t: 'tool_start', id: call.id, name: call.name, target });
          post({ t: 'tool_end', id: call.id, status: 'blocked', summary: 'Bloqueado: destruiría el sistema o el disco' });
          pushResult(call, 'Comando bloqueado por Deiza Code (destruiría el sistema o el disco). Busca otra forma.');
          continue;
        }

        if (FILE_MUTATING.has(call.name) && affectedPaths(call.name, a).some(p => !insideRoot(p))) {
          // Outside the project folder: always ask, whatever the mode.
          const ok = await askApproval(call, a, target, true);
          if (!ok) { pushResult(call, 'El usuario ha RECHAZADO esta acción fuera de la carpeta del proyecto. No la repitas.'); continue; }
        } else if (mode === 'copilot' && MUTATING.has(call.name) && !alwaysApprove) {
          const ok = await askApproval(call, a, target, false);
          if (ok === null) { pushResult(call, 'Error: no se pudo preparar la vista previa del cambio.'); continue; }
          if (!ok) { pushResult(call, 'El usuario ha RECHAZADO esta acción. No la repitas; pregunta qué prefiere o propón una alternativa.'); continue; }
        }
        if (abort.signal.aborted) { stopReason = 'aborted'; break; }

        // Execute
        stats.tools++;
        const t0 = Date.now();
        const paths = affectedPaths(call.name, a);
        const before = {};
        for (const p of paths) { snapshot(p); before[p] = readTextSafe(p); }
        post({ t: 'tool_start', id: call.id, name: call.name, target, path: a.path ? rel(a.path) : undefined });
        post({ t: 'status', kind: 'running', name: call.name, text: target });

        let res;
        try {
          if (call.name === 'run_command') {
            stats.commands++;
            if (stats.cmds.length < 30) stats.cmds.push(String(a.command || '').slice(0, 200));
            res = await runCommandLive(a, { signal: abort.signal, onOutput: (chunk) => post({ t: 'tool_output', id: call.id, chunk }) });
          } else {
            res = await fn(a, {
              cfg: { apiBase: auth.origin, apiKey: '', model, isCustomEndpoint: false },
              mode, messages, quietDiff: true,
              streamCompletion: (p) => streamCompletion(auth, { model, effort: effort === 'low' ? 'low' : 'medium', messages: p.messages, onChunk: p.onChunk, signal: abort.signal, maxTokens: 8192 }),
            });
          }
        } catch (err) {
          res = { error: err.message };
        }
        const ms = Date.now() - t0;
        if (['write_file', 'append_file', 'edit_file'].includes(call.name) && !res?.error) stats.files.add(rel(a.path));
        post({ t: 'tool_end', id: call.id, ms, ...describeResult(call.name, a, res, before) });
        pushResult(call, res);
        if (!(res && res.error)) roundOk++;
      }
      post({ t: 'history', messages });
      if (stopReason === 'aborted') break;

      if (!roundOk && toolCalls.length) failedRounds++; else failedRounds = 0;
      if (failedRounds >= MAX_FAILED_ROUNDS) { stopReason = 'stuck'; break; }
      if (truncated && continuations < E.continuations) {
        continuations++;
        messages.push({ role: 'user', content: 'Continúa exactamente desde donde se cortó la respuesta.' });
      }
    }
    if (stats.rounds >= E.maxTurns) stopReason = 'max_turns';
  } catch (err) {
    const m = String(err.message || err);
    if (m === 'ABORTED' || abort.signal.aborted) stopReason = 'aborted';
    else {
      stopReason = 'error';
      const code = m === 'AUTH_EXPIRED' ? 'auth' : m === 'PLAN_REQUIRED' ? 'plan' : m === 'USAGE_LIMIT' ? 'usage' : m === 'MODEL_LIMIT' ? 'model_limit' : 'engine';
      post({ t: 'error', code, message: code === 'engine' ? m : code === 'model_limit' ? model : code === 'usage' ? lastLimitMessage : '' });
      if (code === 'usage' && (stats.files.size || stats.rounds > 1)) grace = true;
      // Keep the history consistent: drop an assistant tool_calls message without all its results.
      repairHistory(messages);
    }
  }

  if (grace) {
    try { ensureHandoff({ startedAt, input, stats, messages, mode }); } catch (err) { post({ t: 'notice', text: `No se pudo guardar el traspaso: ${err.message}` }); }
  }

  const changed = [...snapshots.values()];
  if (changed.length) post({ t: 'snapshot', turnId, files: changed });
  post({ t: 'history', messages });
  post({
    t: 'turn_end', turnId, stopReason, elapsedMs: Date.now() - startedAt,
    stats: { tools: stats.tools, files: [...stats.files], commands: stats.commands, tokens: stats.prompt + stats.completion },
    revertible: changed.some(f => f.revertible),
  });
  current = null;
}

/**
 * Courtesy margin: the agent is told (server side) to leave DEIZA_HANDOFF.md. If it did not manage
 * to (the margin ran out, Plan mode, a cut connection), the app writes one from the session so the
 * next session, or another tool, can pick the work up.
 */
function ensureHandoff({ startedAt, input, stats, messages, mode }) {
  const file = path.join(process.cwd(), 'DEIZA_HANDOFF.md');
  let st = null;
  try { st = fs.statSync(file); } catch { st = null; }
  if (st && st.mtimeMs >= startedAt - 1000) {
    post({ t: 'handoff', path: 'DEIZA_HANDOFF.md', by: 'agent' });
    return;
  }
  const lastText = [...messages].reverse().find(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim());
  const firstAsk = (() => {
    const users = messages.filter(m => m.role === 'user' && typeof m.content === 'string' && !/^(Continúa|Has anunciado|Tu respuesta se cortó)/.test(m.content));
    return users.length ? users[users.length - 1].content : input;
  })();
  const date = new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
  const files = [...stats.files];
  const md = [
    '# Traspaso de Deiza Code',
    '',
    `Sesión cortada por el límite de uso el ${date}. Este resumen lo ha escrito la app a partir de la sesión porque el agente no llegó a dejar el suyo.`,
    '',
    '## Objetivo',
    String(firstAsk || input || '').trim().slice(0, 2000) || '(sin descripción)',
    '',
    '## Cambios hechos en la última petición',
    files.length ? files.map(f => `- ${f}`).join('\n') : '- Ningún archivo modificado.',
    '',
    ...(stats.cmds.length ? ['## Comandos ejecutados', stats.cmds.map(c => `- \`${c.replace(/`/g, "'")}\``).join('\n'), ''] : []),
    '## Última respuesta del agente',
    lastText ? String(lastText.content).trim().slice(0, 3000) : '(sin texto)',
    '',
    '## Pendiente',
    '- [ ] Revisar que los archivos listados arriba están completos y funcionan.',
    '- [ ] Terminar lo que pedía el objetivo.',
    '',
    '## Cómo continuar',
    'Abre una sesión nueva en esta carpeta y pega:',
    '',
    '```text',
    'Continúa el trabajo descrito en DEIZA_HANDOFF.md. Revisa primero el estado de los archivos que lista, termina lo pendiente y actualiza el traspaso al acabar.',
    '```',
    '',
  ].join('\n');
  if (mode === 'plan') {
    post({ t: 'handoff', path: '', by: 'app', content: md });
    return;
  }
  fs.writeFileSync(file, md, 'utf8');
  post({ t: 'handoff', path: 'DEIZA_HANDOFF.md', by: 'app' });
}

/** An interrupted round can leave tool_calls without their tool results; the engine rejects that. */
function repairHistory(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    const answered = new Set(messages.slice(i + 1).filter(x => x.role === 'tool').map(x => x.tool_call_id));
    for (const tc of m.tool_calls) {
      if (!answered.has(tc.id)) messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Interrumpido antes de ejecutarse.' });
    }
    break;
  }
}

async function askApproval(call, a, target, outside) {
  const id = `ap_${call.id}`;
  let diff = null;
  if (['write_file', 'append_file', 'edit_file'].includes(call.name)) {
    const sim = simulate(call.name, a);
    if (!sim.ok) return null;
    diff = sim.before.text === null ? null : diffText(sim.before.exists ? sim.before.text : '', sim.after, { isNew: !sim.before.exists });
  }
  post({
    t: 'approval', id, name: call.name, target, path: a.path ? rel(a.path) : undefined, diff, outside,
    command: call.name === 'run_command' ? a.command : undefined,
    risky: call.name === 'run_command' ? isCommandRisky(a.command || '') : call.name === 'delete_path',
  });
  post({ t: 'status', kind: 'approval', text: 'Esperando tu aprobación' });
  const answer = await new Promise((resolve) => {
    current.approvals.set(id, resolve);
    current.abort.signal.addEventListener('abort', () => resolve({ approved: false }), { once: true });
  });
  current && current.approvals.delete(id);
  if (answer.always && !outside) alwaysApprove = true;
  post({ t: 'approval_resolved', id, approved: Boolean(answer.approved) });
  return Boolean(answer.approved);
}

function describeResult(name, a, res, before) {
  const err = res && res.error;
  if (err) return { status: 'error', summary: String(err).slice(0, 300) };
  switch (name) {
    case 'write_file':
    case 'append_file':
    case 'edit_file': {
      const p = a.path;
      const was = before[p] || { exists: false, text: '' };
      const now = readTextSafe(p);
      const diff = was.text === null || now.text === null ? null : diffText(was.exists ? was.text : '', now.text, { isNew: !was.exists });
      const summary = diff
        ? (diff.isNew ? `Nuevo · ${now.text.split('\n').length} líneas` : `+${diff.added} −${diff.removed}`)
        : `${fmtBytes(now.size || 0)}`;
      return { status: 'ok', summary, detail: { diff, path: rel(p), size: now.size } };
    }
    case 'delete_path':
      return { status: 'ok', summary: 'Eliminado', detail: { path: rel(a.path) } };
    case 'move_path':
      return { status: 'ok', summary: 'Movido', detail: { from: rel(a.from), to: rel(a.to) } };
    case 'read_file':
      return { status: 'ok', summary: `${res.total_lines ?? '?'} líneas${res.showing_range && (res.showing_range[0] > 1 || res.showing_range[1] < res.total_lines) ? ` · ${res.showing_range[0]}–${res.showing_range[1]}` : ''}`, detail: { path: rel(a.path) } };
    case 'list_dir':
      return { status: 'ok', summary: `${res.total_items ?? 0} elementos`, detail: { items: (res.items || []).slice(0, 80).map(i => ({ name: i.name, dir: i.type === 'directory' })) } };
    case 'search_files': {
      const matches = (res.matches || res.results || []).slice(0, 40).map(m => ({ file: m.file || m.path, line: m.line || m.line_number, text: String(m.text || m.content || m.preview || '').slice(0, 200) }));
      return { status: 'ok', summary: `${res.matches_count ?? matches.length} coincidencias`, detail: { matches } };
    }
    case 'fetch_url':
      return { status: res.status && res.status < 400 ? 'ok' : 'error', summary: `HTTP ${res.status} · ${fmtBytes((res.content || '').length)}`, detail: { url: a.url } };
    case 'run_command': {
      const status = res.blocked ? 'blocked' : res.aborted ? 'aborted' : res.killed_by_timeout ? 'timeout' : res.exit_code === 0 ? 'ok' : 'error';
      const summary = res.blocked ? 'Bloqueado' : res.aborted ? 'Detenido' : res.killed_by_timeout ? 'Tiempo agotado' : `exit ${res.exit_code}`;
      return { status, summary, detail: { command: a.command, exit: res.exit_code, stdout: tail(res.stdout || '', 12000), stderr: tail(res.stderr || '', 6000) } };
    }
    case 'invoke_subagent':
      return { status: 'ok', summary: `Informe de ${res.role || a.role || 'subagente'}`, detail: { report: String(res.report || '').slice(0, 20000) } };
    case 'view_image':
      return { status: 'ok', summary: `${fmtBytes(res.size_bytes || 0)} · ${res.mime_type || ''}`, detail: { path: rel(a.path) } };
    default:
      return { status: 'ok', summary: 'Hecho' };
  }
}

// ── messages from the app ─────────────────────────────────────────────────────

port.on('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'run') {
    if (current) { post({ t: 'error', code: 'busy', message: 'Ya hay una petición en curso en esta sesión.' }); return; }
    run(msg).catch((err) => {
      post({ t: 'error', code: 'engine', message: String(err && err.message || err) });
      post({ t: 'turn_end', turnId: msg.turnId, stopReason: 'error', elapsedMs: 0, stats: { tools: 0, files: [], commands: 0, tokens: 0 }, revertible: false });
      current = null;
    });
  } else if (msg.type === 'abort') {
    if (current) current.abort.abort();
  } else if (msg.type === 'approval') {
    const resolve = current && current.approvals.get(msg.id);
    if (resolve) resolve({ approved: Boolean(msg.approved), always: Boolean(msg.always) });
  }
});

post({ t: 'ready', cwd: process.cwd(), engine: fs.readFileSync(path.join(__dirname, 'vendor/VERSION'), 'utf8').trim() });
