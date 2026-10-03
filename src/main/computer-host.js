/** Code's computer tools and an authenticated, loopback-only bridge for the terminal edition. */
'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createBrowserController } = require('./computer-browser');
const { createDesktopController } = require('./desktop-control');
const { COMPUTER_NAMES, COMPUTER_MUTATING, COMPUTER_TOOL_DEFINITIONS } = require('../engine/computer-tools');
let browser, desktop, server, bridgeFile, bridgeToken;
const requests = new Map();
let quitting = false;
const MODES = new Set(['build', 'copilot', 'plan']);
const MAX_BODY = 512000;
const specs = new Map(COMPUTER_TOOL_DEFINITIONS.map(tool => [tool.name, tool.parameters]));
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const validId = id => typeof id === 'string' && /^[a-z0-9_-]{1,140}$/i.test(id);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const aborted = () => ({ error: 'Operación detenida.', aborted: true });

function validateArgs(name, args) {
  const spec = specs.get(name);
  if (!spec || !isRecord(args)) throw new Error('Herramienta o argumentos de ordenador no válidos.');
  for (const key of spec.required || []) if (!has(args, key)) throw new Error(`Falta el argumento ${key}.`);
  for (const [key, value] of Object.entries(args)) {
    const rule = spec.properties[key];
    if (!rule || key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`Argumento no válido: ${key}.`);
    const valid = rule.type === 'string' ? typeof value === 'string' && !value.includes('\0') && value.length <= (key === 'text' ? 100000 : 2048)
      : rule.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : rule.type === 'integer' ? Number.isInteger(value)
      : rule.type === 'boolean' ? typeof value === 'boolean'
      : rule.type === 'array' ? Array.isArray(value) && value.length <= (rule.maxItems || 32) && value.every(v => typeof v === rule.items.type && (!rule.items.enum || rule.items.enum.includes(v))) : false;
    if (!valid || rule.enum && !rule.enum.includes(value) || rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum) throw new Error(`Argumento no válido: ${key}.`);
  }
}
function projectFolder(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value)) throw new Error('Carpeta del proyecto no válida.');
  let real;
  try { real = fs.realpathSync(value); if (!fs.statSync(real).isDirectory()) throw new Error(); }
  catch { throw new Error('Carpeta del proyecto no válida.'); }
  return real;
}
function capturePath(folder, relative, create = false) {
  if (!folder || typeof relative !== 'string' || !relative || relative.length > 1024 || relative.includes('\0') || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || !relative.toLowerCase().endsWith('.png')) throw new Error('Guarda la captura con una ruta PNG relativa dentro del proyecto.');
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.')) throw new Error('La captura debe guardarse dentro del proyecto.');
  let current = folder;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error('La ruta de captura no puede atravesar enlaces simbólicos.');
      if (i === parts.length - 1) throw new Error('La captura ya existe. Elige otro nombre.');
      if (!stat.isDirectory()) throw new Error('La ruta de captura debe atravesar carpetas.');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (create && i < parts.length - 1) fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  return current;
}
function saveCapture(folder, relative, dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 20 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error('La herramienta no devolvió una captura PNG válida.');
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('La herramienta no devolvió una captura PNG válida.');
  const target = capturePath(folder, relative, true);
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
  return target;
}
async function interruptible(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return aborted();
  let stop;
  const interrupt = new Promise(resolve => { stop = () => resolve(aborted()); signal.addEventListener('abort', stop, { once: true }); });
  try { return await Promise.race([promise, interrupt]); }
  finally { signal.removeEventListener('abort', stop); }
}

async function state(id) { return browser && !quitting ? { browser: browser.state(validId(id) ? id : 'manual'), desktop: await desktop.capabilities() } : { browser: { available: false, tabs: [] }, desktop: { available: false } }; }
async function execute(name, args = {}, ctx = {}) {
  if (quitting || !browser) return { error: 'Deiza se está cerrando.' };
  if (!COMPUTER_NAMES.has(name)) return { error: 'Herramienta de ordenador no válida.' };
  if (!ctx || !isRecord(ctx)) return { error: 'Contexto de ordenador no válido.' };
  if (ctx.signal?.aborted) return aborted();
  try {
    validateArgs(name, args);
    const mode = ctx.mode === undefined ? 'plan' : ctx.mode;
    if (!MODES.has(mode) || ctx.sessionId !== undefined && !validId(ctx.sessionId)) throw new Error('Modo o sesión de ordenador no válidos.');
    if (mode === 'plan' && (COMPUTER_MUTATING.has(name) || /screenshot$/.test(name) && has(args, 'path'))) return { error: 'Modo Plan: esta acción modifica el estado del ordenador o guarda un archivo.' };
    const folder = projectFolder(ctx.folder);
    const save = /screenshot$/.test(name) && has(args, 'path');
    if (save) capturePath(folder, args.path);
    // The broker owns screenshot writes, so both controllers use the same path/symlink policy.
    const safeArgs = { ...args };
    if (save) delete safeArgs.path;
    const context = { ...ctx, mode, folder, png: save };
    const task = name.startsWith('browser_') ? browser.execute(name, safeArgs, context) : desktop.execute(name, safeArgs, context);
    const result = await interruptible(task, ctx.signal);
    if (ctx.signal?.aborted) return aborted();
    if (save && result && !result.error) return { ...result, path: saveCapture(folder, args.path, result.data_url) };
    return result;
  } catch (err) { return ctx.signal?.aborted ? aborted() : { error: String(err.message || err).slice(0, 1000) }; }
}
async function request(sessionId, requestId, name, args, folder, mode) {
  if (!validId(sessionId) || !validId(requestId)) return { error: 'Operación o sesión no válida.' };
  const key = `${sessionId}:${requestId}`;
  if (requests.has(key)) return { error: 'La operación ya está en curso.' };
  if (requests.size >= 32) return { error: 'Hay demasiadas operaciones de ordenador en curso.' };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 55000);
  timer.unref?.();
  requests.set(key, { abort, sessionId });
  try { return await execute(name, args, { sessionId, folder, mode, signal: abort.signal }); }
  finally { clearTimeout(timer); requests.delete(key); }
}
function cancel(sessionId, requestId) { if (validId(sessionId) && validId(requestId)) requests.get(`${sessionId}:${requestId}`)?.abort.abort(); }
function cancelSession(id) { if (!validId(id)) return; for (const entry of requests.values()) if (entry.sessionId === id) entry.abort.abort(); desktop?.forget(id); }
function reply(res, status, data) {
  if (res.destroyed || res.writableEnded || res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function authenticated(req) {
  const address = server?.address();
  if (quitting || !bridgeToken || !address || req.socket.remoteAddress !== '127.0.0.1' || has(req.headers, 'origin') || has(req.headers, 'sec-fetch-site') || req.method === 'OPTIONS' || req.headers.host !== `127.0.0.1:${address.port}`) return false;
  const value = req.headers.authorization;
  if (typeof value !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(value)) return false;
  const actual = Buffer.from(value, 'utf8'), expected = Buffer.from(`Bearer ${bridgeToken}`, 'utf8');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
async function handleBridge(req, res) {
  if (!authenticated(req)) { reply(res, 403, { error: 'Acceso no autorizado.' }); return; }
  if (req.method === 'GET' && req.url === '/state') { reply(res, 200, { result: await state('cli') }); return; }
  if (req.method !== 'POST' || req.url !== '/tool') { reply(res, 404, { error: 'Ruta desconocida.' }); return; }
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(String(req.headers['content-type'] || '')) || req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') { reply(res, 415, { error: 'Se requiere JSON UTF-8 sin compresión.' }); return; }
  if (Number(req.headers['content-length']) > MAX_BODY) { reply(res, 413, { error: 'Petición demasiado grande.' }); req.resume(); return; }
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) { reply(res, 413, { error: 'Petición demasiado grande.' }); req.resume(); return; }
    parts.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { reply(res, 400, { error: 'JSON no válido.' }); return; }
  if (!isRecord(payload) || Object.keys(payload).some(key => !['sessionId', 'name', 'args', 'folder', 'mode'].includes(key))) { reply(res, 400, { error: 'Petición no válida.' }); return; }
  const id = payload.sessionId;
  if (!/^cli_[a-z0-9_-]{1,100}$/i.test(id) || !COMPUTER_NAMES.has(payload.name) || typeof payload.args !== 'object' || !payload.args || Array.isArray(payload.args)) {
    reply(res, 400, { error: 'Operación o sesión no válida.' }); return;
  }
  let folder;
  try { folder = projectFolder(payload.folder); validateArgs(payload.name, payload.args); } catch (err) { reply(res, 400, { error: err.message }); return; }
  const mode = payload.mode === undefined ? 'plan' : payload.mode;
  if (!MODES.has(mode)) { reply(res, 400, { error: 'Modo no válido.' }); return; }
  if (res.destroyed || req.aborted) return;
  if (requests.size >= 32) { reply(res, 429, { error: 'Hay demasiadas operaciones de ordenador en curso.' }); return; }
  const abort = new AbortController();
  const key = `${id}:http_${crypto.randomBytes(8).toString('hex')}`;
  requests.set(key, { abort, sessionId: id });
  const disconnect = () => { if (!res.writableEnded) abort.abort(); };
  res.once('close', disconnect);
  const timer = setTimeout(() => abort.abort(), 55000);
  timer.unref?.();
  try { reply(res, 200, { result: await execute(payload.name, payload.args, { sessionId: id, folder, mode, signal: abort.signal }) }); }
  finally { clearTimeout(timer); requests.delete(key); res.removeListener('close', disconnect); }
}
function writeBridgeFile(file, data) {
  const existing = fs.lstatSync(file, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink > 1)) throw new Error('Perfil de puente no válido.');
  const temp = path.join(path.dirname(file), `.computer-bridge-${crypto.randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch {} }
}
function init({ getOwner } = {}) {
  if (server || browser || desktop) shutdown();
  quitting = false;
  browser = createBrowserController({ getOwner });
  desktop = createDesktopController({ getOwner });
  bridgeToken = crypto.randomBytes(32).toString('hex');
  bridgeFile = path.join(app.getPath('userData'), 'computer-bridge.json');
  server = http.createServer((req, res) => { handleBridge(req, res).catch(() => reply(res, 500, { error: 'No se pudo completar la operación.' })); });
  server.requestTimeout = 65000;
  server.headersTimeout = 10000;
  const instance = server, token = bridgeToken, file = bridgeFile;
  server.listen(0, '127.0.0.1', () => {
    if (quitting || server !== instance) { instance.close(); return; }
    const data = { url: `http://127.0.0.1:${instance.address().port}`, token, pid: process.pid, version: app.getVersion() };
    try { writeBridgeFile(file, data); }
    catch { instance.close(); instance.closeAllConnections?.(); if (server === instance) { server = undefined; bridgeToken = undefined; } }
  });
  server.on('error', () => { /* Desktop tools still work even when the terminal bridge is unavailable. */ });
}
function shutdown() {
  quitting = true;
  for (const entry of requests.values()) entry.abort.abort();
  browser?.shutdown(); desktop?.dispose(); server?.close(); server?.closeAllConnections?.();
  if (bridgeFile) {
    try { const stat = fs.lstatSync(bridgeFile); if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1) { const saved = JSON.parse(fs.readFileSync(bridgeFile, 'utf8')); if (saved.pid === process.pid && saved.token === bridgeToken) fs.unlinkSync(bridgeFile); } } catch { /* already removed */ }
  }
  browser = desktop = server = bridgeToken = bridgeFile = undefined;
}
module.exports = { init, state, execute, request, cancel, cancelSession, shutdown,
  open: payload => browser.open(payload), focus: id => browser.focus(id), close: id => browser.close(id) };
