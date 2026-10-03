/**
 * Updates. deiza.org/downloads/desktop/latest.json describes the current release.
 *
 * The builds are not signed with an Apple Developer ID or a Windows certificate, so the stock
 * Squirrel/electron-updater path is not available. Instead:
 *   macOS    download the .zip, unpack it with ditto, and on restart a detached script swaps the
 *            bundle in place (keeping the old one until the new one is in) and reopens it
 *   Windows  download the NSIS installer and run it silently (per-user: no UAC); --force-run
 *            reopens the app when it finishes
 *   Linux    AppImage: swap the file in place and reopen; .deb: install it with apt when sudo works
 *            without a password (the Linux container on Chromebooks), otherwise open the package
 * Every download is checked against the size (and sha256 when latest.json has it) before use.
 * If anything can't be done in place, the installer (or the download page) opens instead.
 */
const { app, net, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { T } = require('../shared/i18n');

const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
const FOCUS_CHECK_MIN_MS = 30 * 60 * 1000;

let ORIGIN = 'https://deiza.org';
let send = () => {};
let getWindow = () => null;
let isBusy = () => false;
let feedUrl = '';
let latest = null;
let lastCheck = 0;
let status = { state: 'idle' };
let prepared = null;   // { method, version, file, app? }

const workDir = () => path.join(app.getPath('temp'), 'deiza-update');

/** DEIZA_UPDATE_URL points a build at a local test feed (http://127.0.0.1 or localhost only). */
function testFeed() {
  const u = process.env.DEIZA_UPDATE_URL || '';
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u) ? u : '';
}

function setStatus(next) {
  status = { ...next, current: app.getVersion() };
  send('app:update-state', status);
}

function newer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

const archKey = () => (process.arch === 'arm64' ? 'arm64' : 'x64');
const fileUrl = (name) => new URL(name, feedUrl).toString();

/** The running .app bundle on macOS (…/Deiza.app), or '' when it can't be determined. */
function macBundle() {
  const exe = app.getPath('exe');
  const bundle = path.resolve(exe, '../../..');
  return bundle.endsWith('.app') ? bundle : '';
}

/** Installed from our .deb (/opt/Deiza, package deiza-desktop) rather than run from an AppImage. */
const debInstall = () => !process.env.APPIMAGE && app.getPath('exe').startsWith('/opt/') && fs.existsSync('/var/lib/dpkg/info/deiza-desktop.list');
// apt needs root. ChromeOS gives the Linux container's user sudo without a password, so updates can
// install by themselves there; probed once at start, never prompts.
let sudoWithoutPassword = false;
function probeSudo() {
  if (process.platform !== 'linux' || !debInstall()) return;
  execFile('sudo', ['-n', 'true'], { timeout: 5000 }, (err) => { sudoWithoutPassword = !err; });
}

function writable(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

/** What to download and how to apply it on this machine. */
function plan(info) {
  if (!app.isPackaged && !testFeed()) return null;
  if (process.platform === 'darwin') {
    const zip = info.zip && info.zip[`mac-${archKey()}`];
    const bundle = macBundle();
    if (zip && bundle && writable(path.dirname(bundle))) return { method: 'mac-swap', file: zip, bundle };
    const dmg = info.files && info.files[`mac-${archKey()}`];
    return dmg ? { method: 'open', file: dmg } : null;
  }
  if (process.platform === 'win32') {
    const exe = info.files && info.files['win-x64'];
    return exe ? { method: 'win-silent', file: exe } : null;
  }
  if (process.platform === 'linux') {
    const image = info.files && (info.files[`linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`]);
    if (process.env.APPIMAGE && image && /\.AppImage$/i.test(image) && writable(path.dirname(process.env.APPIMAGE))) {
      return { method: 'appimage-swap', file: image, target: process.env.APPIMAGE };
    }
    const deb = info.files && (info.files[`linux-deb${process.arch === 'arm64' ? '-arm64' : ''}`] || info.files['linux-deb']);
    if (deb && debInstall() && sudoWithoutPassword) return { method: 'deb-install', file: deb };
    return deb ? { method: 'open', file: deb } : null;
  }
  return null;
}

async function check({ manual = false, quiet = false } = {}) {
  lastCheck = Date.now();
  try {
    const res = await net.fetch(`${feedUrl}latest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const info = await res.json();
    const available = Boolean(info && info.version && newer(info.version, app.getVersion()));
    if (available) {
      latest = info;
      const busyWithIt = ['downloading', 'ready', 'installing'].includes(status.state) && status.version === info.version;
      if (!busyWithIt) setStatus({ state: 'available', version: info.version, notes: info.notes || '' });
      if (!busyWithIt && testFeed() && process.env.DEIZA_UPDATE_AUTO === '1') start();
      if (manual) {
        const r = await dialog.showMessageBox(getWindow(), {
          type: 'info', buttons: [T('Actualizar'), T('Más tarde')], defaultId: 0, cancelId: 1,
          message: T('Deiza {v} está disponible', { v: info.version }), detail: info.notes || T('Tienes la {v}.', { v: app.getVersion() }),
        });
        if (r.response === 0) start();
      }
    } else if (manual) {
      dialog.showMessageBox(getWindow(), { type: 'info', message: T('Tienes la última versión'), detail: `Deiza ${app.getVersion()}` });
    }
    return { current: app.getVersion(), latest: info && info.version, available };
  } catch {
    if (manual) dialog.showMessageBox(getWindow(), { type: 'warning', message: T('No se pudo comprobar si hay actualizaciones'), detail: T('Revisa tu conexión e inténtalo de nuevo.') });
    return quiet ? { error: 'offline' } : null;
  }
}

async function download(url, dest, expected, onProgress) {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || expected.size || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      received += buf.length;
      if (!out.write(buf)) await new Promise(r => out.once('drain', r));
      onProgress(received, total);
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }
  if (expected.size && received !== expected.size) throw new Error(T('La descarga llegó incompleta.'));
  if (expected.sha256 && hash.digest('hex') !== String(expected.sha256).toLowerCase()) throw new Error(T('La descarga no coincide con la publicada.'));
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
});

async function start() {
  if (!latest || ['downloading', 'installing'].includes(status.state)) return;
  if (status.state === 'ready' && prepared && prepared.version === latest.version) return restart();
  const p = plan(latest);
  if (!p) { openDownload(); return; }
  const version = latest.version;
  const dir = path.join(workDir(), version);
  fs.rmSync(workDir(), { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, p.file);
  const expected = {
    size: Number((latest.bytes && latest.bytes[p.file]) || 0),
    sha256: (latest.sha256 && latest.sha256[p.file]) || '',
  };
  const t0 = Date.now();
  let lastSent = 0;
  setStatus({ state: 'downloading', version, pct: 0 });
  try {
    await download(fileUrl(p.file), dest, expected, (received, total) => {
      const now = Date.now();
      if (now - lastSent < 250) return;
      lastSent = now;
      const speed = received / Math.max(0.5, (now - t0) / 1000);
      setStatus({ state: 'downloading', version, pct: total ? Math.min(99, Math.floor((received / total) * 100)) : 0, eta: total ? Math.round((total - received) / speed) : 0 });
    });
    const ready = { method: p.method, version, file: dest };
    if (p.method === 'mac-swap') {
      const unpacked = path.join(dir, 'app');
      fs.mkdirSync(unpacked, { recursive: true });
      await run('/usr/bin/ditto', ['-x', '-k', dest, unpacked]);
      const bundle = fs.readdirSync(unpacked).find(n => n.endsWith('.app'));
      if (!bundle) throw new Error(T('El paquete descargado no contiene la app.'));
      ready.app = path.join(unpacked, bundle);
      ready.bundle = p.bundle;
      await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', ready.app]).catch(() => {});
      fs.rmSync(dest, { force: true });
    } else if (p.method === 'appimage-swap') {
      fs.chmodSync(dest, 0o755);
      ready.target = p.target;
    }
    prepared = ready;
    setStatus({ state: 'ready', version, method: p.method });
    if (testFeed() && process.env.DEIZA_UPDATE_AUTO === '1') setTimeout(restart, 1500);
    if (p.method === 'open') shell.openPath(dest).then((err) => { if (err) shell.showItemInFolder(dest); });
  } catch (err) {
    prepared = null;
    setStatus({ state: 'error', version, error: String(err.message || err).slice(0, 160) });
  }
}

/** Apply the prepared update and quit; the helper reopens the new version. */
async function restart() {
  const p = prepared;
  if (!p || status.state !== 'ready') return;
  if (p.method === 'open') { shell.openPath(p.file); return; }
  if (isBusy()) {
    const r = await dialog.showMessageBox(getWindow(), {
      type: 'warning', buttons: [T('Reiniciar igualmente'), T('Esperar')], defaultId: 1, cancelId: 1,
      message: T('Deiza Code está trabajando'), detail: T('Si reinicias ahora, la tarea en curso se detiene. Los cambios ya hechos en tus archivos se quedan.'),
    });
    if (r.response !== 0) return;
  }
  setStatus({ state: 'installing', version: p.version });
  try {
    if (p.method === 'mac-swap') {
      const script = path.join(workDir(), 'apply.sh');
      fs.writeFileSync(script, `#!/bin/sh
PID="$1"; NEW="$2"; DEST="$3"; BK="$DEST.previous"
unset DEIZA_UPDATE_URL DEIZA_UPDATE_AUTO
i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 150 ]; do sleep 0.2; i=$((i+1)); done
rm -rf "$BK"
if ! mv "$DEST" "$BK"; then open "$DEST"; exit 1; fi
if mv "$NEW" "$DEST" 2>/dev/null || /usr/bin/ditto "$NEW" "$DEST"; then
  /usr/bin/xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
  rm -rf "$BK"
else
  rm -rf "$DEST"; mv "$BK" "$DEST"
fi
open "$DEST"
`, { mode: 0o755 });
      spawn('/bin/sh', [script, String(process.pid), p.app, p.bundle], { detached: true, stdio: 'ignore' }).unref();
    } else if (p.method === 'win-silent') {
      spawn(p.file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    } else if (p.method === 'appimage-swap') {
      const script = path.join(workDir(), 'apply.sh');
      fs.writeFileSync(script, `#!/bin/sh
PID="$1"; NEW="$2"; DEST="$3"
unset DEIZA_UPDATE_URL DEIZA_UPDATE_AUTO
i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 150 ]; do sleep 0.2; i=$((i+1)); done
cp "$DEST" "$DEST.previous" 2>/dev/null
if mv -f "$NEW" "$DEST" || cp -f "$NEW" "$DEST"; then chmod +x "$DEST"; rm -f "$DEST.previous"; else mv -f "$DEST.previous" "$DEST"; fi
nohup "$DEST" >/dev/null 2>&1 &
`, { mode: 0o755 });
      spawn('/bin/sh', [script, String(process.pid), p.file, p.target], { detached: true, stdio: 'ignore' }).unref();
    } else if (p.method === 'deb-install') {
      // apt replaces /opt/Deiza, so it runs after this process is gone; if it fails, the old
      // version is still installed and reopens.
      const script = path.join(workDir(), 'apply.sh');
      fs.writeFileSync(script, `#!/bin/sh
PID="$1"; DEB="$2"; EXE="$3"; LOG="$4"
unset DEIZA_UPDATE_URL DEIZA_UPDATE_AUTO
i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 150 ]; do sleep 0.2; i=$((i+1)); done
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades "$DEB" >"$LOG" 2>&1 || sudo -n dpkg -i "$DEB" >>"$LOG" 2>&1
nohup "$EXE" >/dev/null 2>&1 &
`, { mode: 0o755 });
      const log = path.join(app.getPath('userData'), 'update.log');
      spawn('/bin/sh', [script, String(process.pid), p.file, app.getPath('exe'), log], { detached: true, stdio: 'ignore' }).unref();
    }
    setTimeout(() => app.quit(), 150);
  } catch (err) {
    setStatus({ state: 'error', version: p.version, error: String(err.message || err).slice(0, 160) });
  }
}

function openDownload() {
  shell.openExternal(`${ORIGIN}/desktop`);
}

function onFocus() {
  if (process.windowsStore || !feedUrl) return;
  if (Date.now() - lastCheck > FOCUS_CHECK_MIN_MS && !['downloading', 'ready', 'installing'].includes(status.state)) check();
}

function init(opts) {
  // Microsoft Store builds are signed and updated by the Store itself.
  if (process.windowsStore) return;
  ORIGIN = opts.origin;
  send = opts.send;
  getWindow = opts.getWindow;
  if (opts.isBusy) isBusy = opts.isBusy;
  feedUrl = testFeed() || `${ORIGIN}/downloads/desktop/`;
  if (!feedUrl.endsWith('/')) feedUrl += '/';
  fs.rm(workDir(), { recursive: true, force: true }, () => {});
  probeSudo();
  setTimeout(() => check(), 6000);
  setInterval(() => check(), CHECK_EVERY_MS).unref();
}

module.exports = { init, check, start, restart, openDownload, onFocus, state: () => status };
