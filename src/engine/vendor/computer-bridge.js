/** Authenticated loopback client. Browser/native control is performed by the running desktop app. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { COMPUTER_NAMES } = require('./computer-tools');

const COMPUTER_BRIDGE_HINT = 'Abre Deiza para usar el navegador y el control del equipo desde la terminal.';
const CLI_COMPUTER_SESSION = `cli_${crypto.randomBytes(12).toString('hex')}`;

function computerBridgeFile() {
  if (process.env.DEIZA_COMPUTER_BRIDGE_FILE || process.env.DEIZA_COMPUTER_BRIDGE) return path.resolve(process.env.DEIZA_COMPUTER_BRIDGE_FILE || process.env.DEIZA_COMPUTER_BRIDGE);
  const profile = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
      : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  return path.join(profile, 'Deiza', 'computer-bridge.json');
}

function readComputerBridge() {
  let file;
  try {
    const filename = computerBridgeFile();
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size > 16384) throw new Error('invalid');
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('permissions');
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('owner');
    file = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch { throw new Error(COMPUTER_BRIDGE_HINT); }
  let url;
  try { url = new URL(file.url); } catch { throw new Error(COMPUTER_BRIDGE_HINT); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('El enlace de control de Deiza debe apuntar a 127.0.0.1 en este equipo. Abre Deiza para regenerarlo.');
  }
  if (typeof file.token !== 'string' || !/^[a-z0-9_-]{24,512}$/i.test(file.token)) throw new Error(COMPUTER_BRIDGE_HINT);
  return { url, token: file.token };
}

function requestComputerBridge(endpoint, body, { signal } = {}) {
  let config;
  try { config = readComputerBridge(); } catch (err) { return Promise.reject(err); }
  if (signal?.aborted) return Promise.reject(new Error('ABORTED'));
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const onAbort = () => { req?.destroy(); finish(new Error('ABORTED')); };
    const timer = setTimeout(() => { req?.destroy(); finish(new Error('El control de Deiza agotó el tiempo de espera. Lee el estado antes de reintentar.')); }, 60000);
    const payload = body ? JSON.stringify(body) : null;
    if (payload && Buffer.byteLength(payload) > 512 * 1024) return finish(new Error('La acción de control es demasiado grande; divídela en pasos más pequeños.'));
    req = http.request(new URL(endpoint, config.url), {
      method: payload ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${config.token}`, Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) { req.destroy(); finish(new Error('La captura de Deiza es demasiado grande. Pide una ventana o una captura menor.')); }
        else chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode !== 200) return finish(new Error(res.statusCode === 401 || res.statusCode === 403 ? 'El enlace de control caducó. Vuelve a abrir Deiza.' : `Deiza no pudo completar la acción (${res.statusCode}).`));
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { finish(new Error('Deiza devolvió un resultado de control no válido.')); }
      });
      res.on('error', () => finish(new Error(COMPUTER_BRIDGE_HINT)));
      res.on('aborted', () => finish(new Error(COMPUTER_BRIDGE_HINT)));
    });
    req.on('error', () => finish(new Error(COMPUTER_BRIDGE_HINT)));
    signal?.addEventListener('abort', onAbort, { once: true });
    req.end(payload || undefined);
  });
}

const ComputerTools = Object.fromEntries([...COMPUTER_NAMES].map(name => [name, async (args, ctx = {}) => {
  try {
    const response = await requestComputerBridge('/tool', {
      name, args, sessionId: ctx.cfg?.computerSessionId || CLI_COMPUTER_SESSION,
      folder: process.cwd(), mode: ctx.mode || 'build',
    }, { signal: ctx.signal });
    if (!response?.result || typeof response.result !== 'object') return { error: 'Deiza no devolvió el resultado de la acción.' };
    return response.result;
  } catch (err) {
    return err.message === 'ABORTED' ? { error: 'Acción detenida.', aborted: true } : { error: err.message };
  }
}]));

function computerModelHasVision(cfg) {
  return cfg?.isCustomEndpoint ? cfg.vision !== false : !/^deiza-gas(?:-|$)/.test(String(cfg?.model || ''));
}

module.exports = { ComputerTools, computerBridgeFile, requestComputerBridge, computerModelHasVision };
