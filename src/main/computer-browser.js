/**
 * Browser controlled by Code. One window per Code session that covers the screen Deiza is on,
 * with tabs, Deiza's visible pointer and a toolbar that says what the agent is doing.
 * Remote pages have no preload, Node or app IPC bridge.
 */
'use strict';
const { BrowserWindow, WebContentsView, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const preview = require('./preview');
const I18n = require('../shared/i18n');
const { POINTER_SOURCE } = require('./browser-pointer');

const IS_MAC = process.platform === 'darwin';
const BAR_H = 46;              // address row; the macOS traffic lights and the Windows/Linux caption buttons live in it
const TABS_H = 36;             // tab row, shown from the second tab on
const SHOT_MAX_W = 1440;       // captures keep the window's shape, scaled down to this box for the model
const SHOT_MAX_H = 960;
const BG = '#1c1917';
const ICON = path.join(__dirname, '../renderer/icon.png');
const TOOLBAR_FILE = path.join(__dirname, '../renderer/computer/index.html');
const TOOLBAR_URL = pathToFileURL(TOOLBAR_FILE).href;
const TOOLBAR_ACTIONS = ['state', 'navigate', 'back', 'forward', 'reload', 'stop', 'tab', 'close-tab', 'new-tab', 'fullscreen', 'stop-agent'];
const toolbarRoutes = new Map();
let toolbarIPCInstalled = false;
function installToolbarIPC() {
  if (toolbarIPCInstalled) return;
  toolbarIPCInstalled = true;
  for (const action of TOOLBAR_ACTIONS) {
    ipcMain.handle(`computer-browser:${action}`, async (event, payload) => {
      const route = toolbarRoutes.get(event.sender.id);
      if (!route || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== TOOLBAR_URL) return { error: 'Acceso al navegador no permitido.' };
      return route(action, payload);
    });
  }
}

const WORDS = {
  es: { click: 'Clic', type: 'Escribiendo…', key: 'Tecla', scroll: 'Desplazando', drag: 'Arrastrando', hover: 'Señalando',
    open: 'Abriendo', read: 'Leyendo la página', look: 'Mirando la página', back: 'Atrás', forward: 'Adelante', reload: 'Recargando', newTab: 'Nueva pestaña' },
  en: { click: 'Click', type: 'Typing…', key: 'Key', scroll: 'Scrolling', drag: 'Dragging', hover: 'Pointing',
    open: 'Opening', read: 'Reading the page', look: 'Looking at the page', back: 'Back', forward: 'Forward', reload: 'Reloading', newTab: 'New tab' },
};
const words = () => WORDS[I18n.uiLanguage()];
const MODS = { alt: 1, control: 2, ctrl: 2, meta: 4, command: 4, cmd: 4, shift: 8 };
const KEYS = { Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'],
  Delete: [46, 'Delete'], ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'],
  ArrowDown: [40, 'ArrowDown'], Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'], Space: [32, 'Space', ' '] };
const inside = (root, file) => { const rel = path.relative(root, file); return !rel.startsWith('..') && !path.isAbsolute(rel); };
const cleanText = (v, max = 300) => String(v || '').replace(/[\x00-\x08\x0b-\x1f]/g, '').slice(0, max);
const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };
const named = (verb, name) => (name ? `${verb} · ${cleanText(name, 48)}` : verb);
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('Operación detenida'));
  const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Operación detenida')); };
  signal?.addEventListener('abort', abort, { once: true });
});
/** What the address bar turns into a URL: addresses, localhost, or a search. */
function addressToURL(text) {
  const v = String(text || '').trim();
  if (!v || v === 'about:blank') return 'about:blank';
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(v)) return `http://${v}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  if (/\s/.test(v) || !/^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(v)) return `https://duckduckgo.com/?q=${encodeURIComponent(v)}`;
  return `https://${v}`;
}

function createBrowserController({ getOwner = () => null, onStopAgent = () => {}, navigationTimeoutMs = 15000, commandTimeoutMs = 10000 } = {}) {
  installToolbarIPC();
  const tabs = new Map();       // tab_id -> tab
  const shells = new Map();     // owner (Code session) -> its browser window
  const sessions = new Map();   // owner -> whether Code is running a turn there
  let sequence = 0;
  let elementSequence = 0;
  let shuttingDown = false;
  let wantFullscreen = null;    // the user's last choice on a browser window, for the next ones

  const scope = (ctx = {}) => String(ctx.sessionId || 'manual');
  const alive = (t) => Boolean(t && !t.wc.isDestroyed() && t.shell && !t.shell.win.isDestroyed());
  const activeTab = (shell) => shell.tabs.find(t => t.id === shell.active) || shell.tabs[shell.tabs.length - 1];
  const chromeHeight = (shell) => BAR_H + (shell.tabs.length > 1 ? TABS_H : 0);

  function adopt(key, ctx) {
    // A browser opened by hand before the session existed belongs to the first session that uses it.
    if (key === 'manual' || shells.has(key)) return;
    const manual = shells.get('manual');
    if (!manual || manual.win.isDestroyed()) return;
    shells.delete('manual');
    manual.owner = key;
    shells.set(key, manual);
    for (const t of manual.tabs) { t.owner = key; t.context = { sessionId: key, folder: ctx.folder }; }
  }
  function owned(ctx) {
    const key = scope(ctx);
    adopt(key, ctx);
    const shell = shells.get(key);
    return shell && !shell.win.isDestroyed() ? shell.tabs.filter(alive) : [];
  }
  function select(args = {}, ctx = {}) {
    const list = owned(ctx);
    const shell = shells.get(scope(ctx));
    const id = args.tab_id || shell?.active || list[list.length - 1]?.id;
    const tab = list.find(t => t.id === id);
    if (!tab) throw new Error('No hay una página abierta en esta sesión. Usa browser_open primero.');
    if (ctx.folder) tab.context.folder = ctx.folder;
    return tab;
  }
  function info(t) { return { tab_id: t.id, title: cleanText(t.wc.getTitle()), url: t.wc.getURL(), active: t.shell.active === t.id }; }
  function validateURL(value, ctx = {}) {
    const raw = String(value || '').trim();
    if (!raw) return 'about:blank';
    if (raw === 'about:blank') return raw;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      if (!ctx.folder) throw new Error('Indica una URL http/https o un archivo del proyecto.');
      const root = fs.realpathSync(ctx.folder), file = fs.realpathSync(path.resolve(root, raw));
      if (!inside(root, file) || !fs.statSync(file).isFile()) throw new Error('El archivo debe estar dentro del proyecto.');
      return preview.urlFor(root, path.relative(root, file));
    }
    const u = new URL(raw);
    if (!['http:', 'https:', `${preview.SCHEME}:`].includes(u.protocol)) throw new Error('El navegador admite http, https y vistas previas del proyecto.');
    if (u.username || u.password) throw new Error('Inicia sesión en la página; no incluyas contraseñas en la URL.');
    if (u.protocol === `${preview.SCHEME}:`) {
      if (!ctx.folder) throw new Error('La vista previa debe pertenecer al proyecto de esta sesión.');
      const root = fs.realpathSync(ctx.folder), registered = new URL(preview.urlFor(root, ''));
      if (u.hostname !== registered.hostname) throw new Error('La vista previa debe pertenecer al proyecto de esta sesión.');
      let rel;
      try { rel = decodeURIComponent(u.pathname); } catch { throw new Error('Ruta de vista previa no válida.'); }
      const target = fs.realpathSync(path.resolve(root, `.${rel}`));
      if (!inside(root, target)) throw new Error('La vista previa debe estar dentro del proyecto.');
    }
    return u.toString();
  }

  // ── toolbar state ──────────────────────────────────────────────────────────
  function agentState(shell) {
    const known = sessions.has(shell.owner);
    const recent = Date.now() - (shell.activityAt || 0) < 12000;
    const running = known ? sessions.get(shell.owner) : recent;
    return { running: Boolean(running), label: running && recent ? shell.activity || '' : '' };
  }
  function shellState(shell) {
    const t = activeTab(shell);
    const w = words();
    const tab = t && alive(t) ? {
      ...info(t), loading: t.wc.isLoading(), canGoBack: t.wc.navigationHistory.canGoBack(),
      canGoForward: t.wc.navigationHistory.canGoForward(), error: t.error || '', blank: t.blank,
    } : { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: '', blank: true };
    return {
      ...tab, language: I18n.uiLanguage(), platform: process.platform, fullscreen: shell.win.isFullScreen(),
      chrome: chromeHeight(shell), agent: agentState(shell),
      tabs: shell.tabs.filter(alive).map(x => ({ id: x.id, title: cleanText(x.wc.getTitle(), 90) || hostOf(x.wc.getURL()) || w.newTab,
        loading: x.wc.isLoading(), active: x.id === shell.active, blank: x.blank })),
    };
  }
  function publishShell(shell) {
    if (!shell || shell.win.isDestroyed() || shell.win.webContents.isDestroyed()) return;
    if (shell.publishQueued) return;
    // Loading events come in bursts; one message per tick is enough for the toolbar.
    shell.publishQueued = true;
    setImmediate(() => {
      shell.publishQueued = false;
      if (shell.win.isDestroyed() || shell.win.webContents.isDestroyed()) return;
      shell.win.webContents.send('computer-browser:state', shellState(shell));
    });
  }
  const publish = (t) => publishShell(t.shell);
  function activity(t, label) {
    const shell = t.shell;
    shell.activity = cleanText(label, 120);
    shell.activityAt = Date.now();
    clearTimeout(shell.activityTimer);
    shell.activityTimer = setTimeout(() => publishShell(shell), 12500);
    publishShell(shell);
  }

  // ── windows, tabs and layout ───────────────────────────────────────────────
  function layoutShell(shell) {
    if (!shell || shell.win.isDestroyed()) return;
    const [w, h] = shell.win.getContentSize();
    const top = chromeHeight(shell);
    const bounds = { x: 0, y: top, width: Math.max(1, w), height: Math.max(1, h - top) };
    for (const t of shell.tabs) {
      if (t.wc.isDestroyed()) continue;
      t.view.setBounds(bounds);
      t.view.setVisible(t.id === shell.active && !t.blank);
    }
  }
  function placement() {
    // The browser opens on the screen Deiza is on and covers it: the page has the screen's shape.
    const parent = getOwner();
    const live = parent && !parent.isDestroyed();
    const display = live ? screen.getDisplayMatching(parent.getBounds()) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return { area: display.workArea, fullscreen: wantFullscreen ?? Boolean(live && parent.isFullScreen()) };
  }
  function shellFor(owner) {
    const existing = shells.get(owner);
    if (existing && !existing.win.isDestroyed()) return existing;
    const { area, fullscreen } = placement();
    const win = new BrowserWindow({
      x: area.x, y: area.y, width: area.width, height: area.height, minWidth: 640, minHeight: 420,
      show: false, title: 'Navegador · Deiza Code', backgroundColor: BG, autoHideMenuBar: true,
      fullscreenable: true, fullscreen,
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
      trafficLightPosition: IS_MAC ? { x: 16, y: 16 } : undefined,
      titleBarOverlay: IS_MAC ? undefined : { color: BG, symbolColor: '#a8998a', height: BAR_H },
      icon: IS_MAC ? undefined : ICON,
      webPreferences: { preload: path.join(__dirname, '../preload/computer.js'), sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true },
    });
    const shell = { owner, win, tabs: [], active: null, toolbarId: win.webContents.id, activity: '', activityAt: 0 };
    shells.set(owner, shell);
    const relayout = () => { layoutShell(shell); setImmediate(() => layoutShell(shell)); };
    for (const ev of ['resize', 'resized', 'maximize', 'unmaximize', 'restore', 'show']) win.on(ev, relayout);
    for (const ev of ['enter-full-screen', 'leave-full-screen']) {
      win.on(ev, () => { wantFullscreen = ev === 'enter-full-screen'; relayout(); publishShell(shell); });
    }
    toolbarRoutes.set(shell.toolbarId, (action, value) => manual(shell, action, value));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== TOOLBAR_URL) event.preventDefault(); });
    win.webContents.on('will-redirect', event => event.preventDefault());
    win.webContents.on('did-finish-load', () => publishShell(shell));
    win.webContents.on('before-input-event', (event, input) => shortcut(shell, event, input));
    win.loadFile(TOOLBAR_FILE).catch(() => {});
    win.on('focus', () => { const t = activeTab(shell); if (t && alive(t) && !t.blank) t.wc.focus(); });
    win.on('closed', () => {
      toolbarRoutes.delete(shell.toolbarId);
      clearTimeout(shell.activityTimer);
      for (const t of [...shell.tabs]) dispose(t);
      shell.tabs = [];
      if (shells.get(shell.owner) === shell) shells.delete(shell.owner);
    });
    if (!fullscreen && !IS_MAC) win.maximize();
    return shell;
  }
  function present(t, focus) {
    const win = t.shell.win;
    if (win.isDestroyed()) return;
    if (t.shell.active !== t.id) activate(t);
    if (win.isMinimized()) win.restore();
    if (focus) { win.show(); win.focus(); } else if (!win.isVisible()) win.showInactive();
    // Some Linux window managers ignore a maximise sent before the window is mapped.
    if (!t.shell.shown) { t.shell.shown = true; if (!IS_MAC && !win.isFullScreen() && !win.isMaximized()) win.maximize(); }
  }
  function activate(t) {
    t.shell.active = t.id;
    layoutShell(t.shell);
    publish(t);
  }
  function dispose(t) {
    tabs.delete(t.id);
    const shell = t.shell;
    shell.tabs = shell.tabs.filter(x => x !== t);
    if (!shell.win.isDestroyed()) { try { shell.win.contentView.removeChildView(t.view); } catch { /* already gone */ } }
    if (!t.wc.isDestroyed()) t.wc.close();
  }
  function closeTab(t) {
    const shell = t.shell;
    dispose(t);
    if (shell.win.isDestroyed()) return;
    if (!shell.tabs.length) { shell.win.close(); return; }
    if (shell.active === t.id) shell.active = shell.tabs[shell.tabs.length - 1].id;
    layoutShell(shell);
    publishShell(shell);
  }
  function createTab(ctx = {}, inherited) {
    if (shuttingDown) throw new Error('Deiza se está cerrando.');
    const owner = inherited || scope(ctx);
    const shell = shellFor(owner);
    const view = new WebContentsView({ webPreferences: { partition: 'persist:deiza-computer', sandbox: true, nodeIntegration: false,
      contextIsolation: true, webSecurity: true, backgroundThrottling: false, scrollBounce: IS_MAC } });
    const wc = view.webContents;
    view.setBackgroundColor('#ffffff');
    const t = { id: `tab_${++sequence}`, owner, shell, view, wc, context: { sessionId: owner, folder: ctx.folder }, refs: new Map(),
      queue: Promise.resolve(), error: '', navs: 0, blank: true, emulated: false, busy: false, pointer: { x: NaN, y: NaN, ctx: 0 } };
    shell.win.contentView.addChildView(view);
    shell.tabs.push(t);
    tabs.set(t.id, t);
    activate(t);
    wc.loadURL('about:blank').catch(() => {});
    preview.register(wc.session);
    // No mic, camera, screen sharing or notifications are granted by an agent navigation.
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    wc.session.setPermissionCheckHandler(() => false);
    wc.on('will-navigate', (event, url) => { try { validateURL(url, t.context); } catch { event.preventDefault(); } });
    wc.on('will-redirect', (event, url) => { try { validateURL(url, t.context); } catch { event.preventDefault(); } });
    wc.on('did-start-navigation', (event, url, inPlace, mainFrame) => {
      const main = event?.isMainFrame ?? mainFrame, same = event?.isSameDocument ?? inPlace;
      if (main && !same) t.navs++;
    });
    wc.on('did-navigate', (_e, url) => {
      t.refs.clear(); t.error = ''; t.pointer.ctx = 0;
      const blank = !url || url === 'about:blank';
      if (blank !== t.blank) { t.blank = blank; layoutShell(shell); }
      publish(t);
    });
    wc.on('did-navigate-in-page', () => { t.refs.clear(); t.error = ''; publish(t); });
    for (const event of ['did-start-loading', 'did-stop-loading', 'page-title-updated']) wc.on(event, () => publish(t));
    wc.on('render-process-gone', () => { t.pointer.ctx = 0; t.emulated = false; t.refs.clear(); });
    wc.debugger.on('detach', () => { t.pointer.ctx = 0; t.emulated = false; });
    wc.on('before-input-event', (event, input) => { if (!t.busy) shortcut(shell, event, input); });
    wc.setWindowOpenHandler(({ url }) => {
      // Pop-ups and target=_blank links open as a tab of the same window, never as a new window.
      try {
        const safe = validateURL(url, t.context);
        const child = createTab(t.context, t.owner);
        navigate(child, safe).catch(() => {});
      } catch { /* reject unknown protocols */ }
      return { action: 'deny' };
    });
    return t;
  }
  function shortcut(shell, event, input) {
    if (input.type !== 'keyDown' || shell.win.isDestroyed()) return;
    const mod = IS_MAC ? input.meta : input.control;
    const key = String(input.key || '');
    const k = key.toLowerCase();
    let run = null;
    if (mod && !input.alt && k === 'l') run = () => shell.win.webContents.send('computer-browser:focus-address');
    else if ((mod && !input.alt && k === 'r') || key === 'F5') run = () => manual(shell, 'reload');
    else if ((IS_MAC && input.meta && key === '[') || (!IS_MAC && input.alt && key === 'ArrowLeft')) run = () => manual(shell, 'back');
    else if ((IS_MAC && input.meta && key === ']') || (!IS_MAC && input.alt && key === 'ArrowRight')) run = () => manual(shell, 'forward');
    else if ((!IS_MAC && key === 'F11') || (IS_MAC && input.meta && input.control && k === 'f')) run = () => manual(shell, 'fullscreen');
    else if (mod && !input.shift && !input.alt && k === 't') run = () => manual(shell, 'new-tab');
    else if (mod && !input.shift && !input.alt && k === 'w') run = () => { const t = activeTab(shell); if (t) closeTab(t); };
    // Page zoom would shift every coordinate the agent reads from a capture: keep the page at 100 %.
    else if (mod && ['+', '=', '-', '_', '0'].includes(key)) run = () => {};
    if (!run) return;
    event.preventDefault();
    run();
  }

  // ── plumbing ───────────────────────────────────────────────────────────────
  function bound(t, task, signal, timeout, cancel, message) {
    if (signal?.aborted) return Promise.reject(new Error('Operación detenida'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); err ? reject(err) : resolve(result); };
      const stop = (error) => { try { cancel?.(); } catch {} finish(error); };
      const abort = () => stop(new Error('Operación detenida'));
      const timer = setTimeout(() => stop(new Error(message || 'La página tardó demasiado. Vuelve a intentarlo.')), timeout);
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => {
        if (signal?.aborted) throw new Error('Operación detenida');
        if (!alive(t)) throw new Error('El navegador se ha cerrado.');
        return task();
      }).then(result => finish(null, result), error => finish(error));
    });
  }
  function queued(t, task) {
    const result = t.queue.then(task, task);
    t.queue = result.catch(() => {});
    return result;
  }
  function enqueue(t, task, signal) {
    const run = () => { if (signal?.aborted) throw new Error('Operación detenida'); return task(); };
    const result = queued(t, run);
    if (!signal) return result;
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Operación detenida')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      result.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  /** Resolves once the page is usable: DOM ready plus a short grace, not every image and ad. */
  function untilUsable(t, signal, max) {
    return new Promise((resolve) => {
      if (!alive(t) || !t.wc.isLoading()) return resolve();
      let grace;
      const done = () => {
        clearTimeout(timer); clearTimeout(grace);
        if (!t.wc.isDestroyed()) { t.wc.removeListener('did-stop-loading', done); t.wc.removeListener('dom-ready', ready); }
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const ready = () => { grace = setTimeout(done, 450); };
      const timer = setTimeout(done, max);
      t.wc.once('did-stop-loading', done);
      t.wc.once('dom-ready', ready);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
  async function navigate(t, url, signal) {
    t.refs.clear(); t.error = '';
    try {
      await bound(t, () => new Promise((resolve, reject) => {
        let grace;
        const ready = () => { grace = setTimeout(resolve, 450); };
        t.wc.once('dom-ready', ready);
        t.wc.loadURL(url).then(resolve, (err) => {
          // A page that redirects itself by script aborts the first load; the second one is the page.
          if (err && (err.errno === -3 || err.code === 'ERR_ABORTED') && t.wc.getURL() && t.wc.getURL() !== 'about:blank') resolve();
          else reject(err);
        }).finally(() => { clearTimeout(grace); if (!t.wc.isDestroyed()) t.wc.removeListener('dom-ready', ready); });
      }), signal, navigationTimeoutMs, () => t.wc.stop(), 'La página tardó demasiado en cargar. Vuelve a intentarlo.');
      if (signal?.aborted) throw new Error('Operación detenida');
    } catch (error) { t.error = cleanText(error.message, 250); throw error; }
    finally { publish(t); }
  }
  async function manual(shell, action, value) {
    const t = activeTab(shell);
    try {
      if (action === 'state') return shellState(shell);
      if (action === 'fullscreen') { shell.win.setFullScreen(!shell.win.isFullScreen()); return shellState(shell); }
      if (action === 'stop-agent') {
        onStopAgent(shell.owner);
        shell.activityAt = 0;
        for (const x of shell.tabs) if (alive(x)) pointer(x, { kind: 'hide' }).catch(() => {});
        publishShell(shell);
        return shellState(shell);
      }
      if (action === 'new-tab') {
        createTab(t ? t.context : { sessionId: shell.owner }, shell.owner);
        shell.win.webContents.send('computer-browser:focus-address');
        return shellState(shell);
      }
      if (action === 'tab') { const target = shell.tabs.find(x => x.id === value); if (target) activate(target); return shellState(shell); }
      if (action === 'close-tab') {
        const target = shell.tabs.find(x => x.id === value);
        if (target) closeTab(target);
        return shell.win.isDestroyed() ? {} : shellState(shell);
      }
      if (!t || !alive(t)) return shellState(shell);
      if (action === 'stop') { t.wc.stop(); publish(t); return shellState(shell); }
      return await enqueue(t, async () => {
        if (action === 'navigate') {
          await navigate(t, validateURL(addressToURL(value), t.context));
        } else {
          const history = t.wc.navigationHistory;
          if (action === 'back' && history.canGoBack()) history.goBack();
          else if (action === 'forward' && history.canGoForward()) history.goForward();
          else if (action === 'reload') t.wc.reload();
          else return shellState(shell);
          await wait(40);
          await untilUsable(t, undefined, navigationTimeoutMs);
        }
        t.wc.focus(); publish(t); return shellState(shell);
      });
    } catch (error) {
      if (t) { t.error = cleanText(error.message, 250); publish(t); }
      return shell.win.isDestroyed() ? {} : { ...shellState(shell), error: cleanText(error.message, 250) };
    }
  }
  async function command(t, name, params = {}, signal) {
    if (signal?.aborted) throw new Error('Operación detenida');
    if (!alive(t)) throw new Error('El navegador se ha cerrado.');
    const debug = t.wc.debugger;
    if (!debug.isAttached()) debug.attach('1.3');
    const result = await bound(t, () => debug.sendCommand(name, params), signal, commandTimeoutMs, () => { t.refs.clear(); if (debug.isAttached()) debug.detach(); }, 'La página tardó demasiado en responder. Actualiza su estado.');
    if (signal?.aborted) throw new Error('Operación detenida');
    return result;
  }
  async function prepare(t, signal) {
    if (t.emulated && t.wc.debugger.isAttached()) return;
    // The page keeps "focus" while the user looks at another window: typing and :focus work
    // without bringing the browser to the front on every action.
    await command(t, 'Emulation.setFocusEmulationEnabled', { enabled: true }, signal).catch(() => {});
    t.emulated = true;
  }

  // ── Deiza's pointer ────────────────────────────────────────────────────────
  async function pointer(t, op, signal) {
    if (!alive(t) || t.blank) return null;
    if (op.kind === 'hide' && !Number.isFinite(t.pointer.x)) return null;
    const payload = JSON.stringify({ ...op, fromX: t.pointer.x, fromY: t.pointer.y });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!t.pointer.ctx) {
          const { frameTree } = await command(t, 'Page.getFrameTree', {}, signal);
          const world = await command(t, 'Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'deiza-pointer', grantUniveralAccess: false }, signal);
          t.pointer.ctx = world.executionContextId;
        }
        const out = await command(t, 'Runtime.evaluate', { expression: `(${POINTER_SOURCE})(${payload})`, contextId: t.pointer.ctx,
          awaitPromise: true, returnByValue: true, silent: true }, signal);
        if (out.exceptionDetails) throw new Error('pointer');
        const value = out.result?.value || null;
        if (value && Number.isFinite(value.x)) { t.pointer.x = value.x; t.pointer.y = value.y; }
        return value;
      } catch (err) {
        if (signal?.aborted) throw err;
        t.pointer.ctx = 0;   // the document changed under the cached world: make a new one once
      }
    }
    return null;   // the pointer is decoration: an action never fails because of it
  }

  // ── reading the page ───────────────────────────────────────────────────────
  function viewport(t) { const b = t.view.getBounds(); return { width: b.width, height: b.height }; }
  /** Captures keep the window's shape and are scaled into SHOT_MAX_W x SHOT_MAX_H. */
  function shotSize(t) {
    const v = viewport(t);
    const scale = Math.min(1, SHOT_MAX_W / v.width, SHOT_MAX_H / v.height);
    return { ...v, scale, w: Math.max(1, Math.round(v.width * scale)), h: Math.max(1, Math.round(v.height * scale)) };
  }
  /** Points from a capture (image pixels) to page CSS pixels. */
  function toPage(t, x, y, message) {
    const s = shotSize(t);
    x = Number(x); y = Number(y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= s.w || y >= s.h) throw new Error(message || `El punto debe estar dentro de la captura del navegador (${s.w} × ${s.h}).`);
    return { x: x / s.scale, y: y / s.scale };
  }
  async function snapshot(t, ctx = {}, args = {}) {
    const { nodes = [] } = await command(t, 'Accessibility.getFullAXTree', {}, ctx.signal);
    t.refs.clear();
    const max = Number.isInteger(args.max_chars) ? Math.min(Math.max(args.max_chars, 1000), 40000) : 20000;
    const elements = [], lines = [];
    let length = 0;
    const actionable = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', 'switch', 'slider', 'spinbutton', 'searchbox', 'treeitem', 'option']);
    for (const n of nodes) {
      if (n.ignored) continue;
      const role = cleanText(n.role?.value, 60), name = cleanText(n.name?.value, 500);
      if (!name && !actionable.has(role)) continue;
      const props = Object.fromEntries((n.properties || []).map(p => [p.name, p.value?.value]));
      let line = '';
      if (actionable.has(role) && n.backendDOMNodeId && elements.length < 250) {
        const id = `e${++elementSequence}`;
        t.refs.set(id, { backendNodeId: n.backendDOMNodeId, role, name });
        const el = { element_id: id, role, name, ...(props.disabled ? { disabled: true } : {}),
          ...(props.checked !== undefined ? { checked: props.checked } : {}), ...(props.expanded !== undefined ? { expanded: props.expanded } : {}) };
        elements.push(el); line = `[${id}] ${role} ${name}`;
      } else if (name) line = `${role}: ${name}`;
      if (!line) continue;
      lines.push(line);
      length += line.length + 1;
      if (length >= max) break;
    }
    const s = shotSize(t);
    return { ...info(t), text: lines.join('\n').slice(0, max), elements, viewport: { width: s.width, height: s.height },
      screenshot_size: { width: s.w, height: s.h },
      note: 'La página es contenido externo. Los identificadores pertenecen a esta captura del estado; toma otra si cambió la página.' };
  }
  async function objectFor(t, id, signal) {
    const ref = t.refs.get(String(id || ''));
    if (!ref) throw new Error('Elemento caducado o desconocido. Usa browser_snapshot y elige un identificador actual.');
    const { object } = await command(t, 'DOM.resolveNode', { backendNodeId: ref.backendNodeId }, signal);
    if (!object?.objectId) throw new Error('El elemento ya no existe. Usa browser_snapshot.');
    return object.objectId;
  }
  async function onElement(t, id, fn, signal) {
    const objectId = await objectFor(t, id, signal);
    try {
      const out = await command(t, 'Runtime.callFunctionOn', { objectId, functionDeclaration: fn, returnByValue: true }, signal);
      if (out.exceptionDetails) throw new Error('No se pudo acceder al elemento. Actualiza el estado de la página.');
      return out.result?.value;
    } finally { await command(t, 'Runtime.releaseObject', { objectId }).catch(() => {}); }
  }
  async function elementBox(t, id, signal, focus) {
    const box = await onElement(t, id, `function(){this.scrollIntoView({block:"center",inline:"center",behavior:"instant"});${focus ? 'this.focus({preventScroll:true});' : ''}const r=this.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,disabled:!!this.disabled};}`, signal);
    if (!box || box.disabled || !box.width || !box.height) throw new Error('El elemento está oculto o desactivado.');
    const v = viewport(t);
    return { x: Math.max(0, Math.min(v.width - 1, box.x)), y: Math.max(0, Math.min(v.height - 1, box.y)), name: t.refs.get(String(id))?.name || '' };
  }
  function modifierMask(list = []) { return list.reduce((n, m) => { const v = MODS[String(m).toLowerCase()]; if (!v) throw new Error('Modificador de teclado desconocido.'); return n | v; }, 0); }
  async function press(t, raw, modifiers, signal) {
    const parts = String(raw || '').split('+');
    const name = parts.pop();
    const mask = modifierMask([...(modifiers || []), ...parts]);
    const def = KEYS[name];
    const char = !def && name.length === 1 ? name : null;
    if (!def && !char) throw new Error('Tecla no reconocida. Usa Enter, Tab, Escape, flechas o Ctrl+A / Meta+A.');
    const params = { key: def ? (name === 'Space' ? ' ' : name) : char, code: def ? def[1] : (/^[a-z]$/i.test(char) ? `Key${char.toUpperCase()}` : /^\d$/.test(char) ? `Digit${char}` : ''),
      windowsVirtualKeyCode: def ? def[0] : char.toUpperCase().charCodeAt(0), modifiers: mask };
    if (!mask && (def?.[2] || char)) params.text = def ? def[2] : char;
    await command(t, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params }, signal);
    await command(t, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params }, signal);
  }
  async function screenshot(t, args, ctx) {
    const hidden = Number.isFinite(t.pointer.x) ? await pointer(t, { kind: 'conceal' }, ctx.signal) : null;
    let image;
    try { image = await t.wc.capturePage(); }
    finally { if (hidden) pointer(t, { kind: 'reveal' }).catch(() => {}); }
    // capturePage returns device pixels (2x on Retina). The model gets the window's shape scaled
    // into SHOT_MAX_W x SHOT_MAX_H; browser_click maps those image pixels back to the page.
    const s = shotSize(t);
    if (!image.isEmpty() && image.getSize().width !== s.w) image = image.resize({ width: s.w, height: s.h, quality: 'good' });
    const size = image.getSize();
    const png = !!(args.path || ctx.png);
    const buf = png ? image.toPNG() : image.toJPEG(78);
    const mime = png ? 'image/png' : 'image/jpeg';
    let saved;
    if (args.path) {
      if (!ctx.folder || path.isAbsolute(args.path)) throw new Error('Guarda la captura con una ruta relativa al proyecto.');
      saved = path.resolve(ctx.folder, args.path);
      if (!inside(path.resolve(ctx.folder), saved)) throw new Error('La captura debe guardarse dentro del proyecto.');
      fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.writeFileSync(saved, buf);
    }
    return { ...info(t), mime_type: mime, width: size.width, height: size.height, viewport: { width: s.width, height: s.height },
      coordinate_space: 'screenshot', data_url: `data:${mime};base64,${buf.toString('base64')}`, ...(saved ? { path: saved } : {}) };
  }

  // ── acting ─────────────────────────────────────────────────────────────────
  async function operate(t, name, args, ctx) {
    const signal = ctx.signal;
    const w = words();
    present(t, false);
    if (t.blank && name !== 'browser_close' && name !== 'browser_history') throw new Error('La pestaña está en blanco. Usa browser_open con una URL.');
    await prepare(t, signal);
    if (name === 'browser_snapshot') { activity(t, w.read); return snapshot(t, ctx, args); }
    if (name === 'browser_screenshot') { activity(t, w.look); return screenshot(t, args, ctx); }
    if (name === 'browser_close') { const id = t.id; closeTab(t); return { closed: id }; }
    const navs = t.navs;
    t.busy = true;
    try {
      if (name === 'browser_history') {
        const action = ['back', 'forward', 'reload'].includes(args.action) ? args.action : '';
        const history = t.wc.navigationHistory;
        if (action === 'back' && !history.canGoBack()) throw new Error('No hay una página anterior en esta pestaña.');
        if (action === 'forward' && !history.canGoForward()) throw new Error('No hay una página siguiente en esta pestaña.');
        if (!action) throw new Error('Acción de historial no válida.');
        activity(t, w[action]);
        t.refs.clear();
        if (action === 'back') history.goBack(); else if (action === 'forward') history.goForward(); else t.wc.reload();
        await wait(60, signal);
        await untilUsable(t, signal, navigationTimeoutMs);
        return snapshot(t, ctx);
      }
      if (name === 'browser_click') {
        let x, y, label = w.click;
        if (args.element_id) { const box = await elementBox(t, args.element_id, signal); x = box.x; y = box.y; label = named(w.click, box.name); }
        else ({ x, y } = toPage(t, args.x, args.y, 'El clic debe estar dentro de la captura del navegador.'));
        activity(t, label);
        await pointer(t, { kind: 'click', x, y, label: label.length > 34 ? w.click : label }, signal);
        const button = ['left', 'right', 'middle'].includes(args.button) ? args.button : 'left';
        const mask = modifierMask(args.modifiers || []);
        const count = args.click_count === 2 ? 2 : 1;
        await command(t, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, signal);
        for (let i = 1; i <= count; i++) {
          await command(t, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4, clickCount: i, modifiers: mask }, signal);
          await command(t, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: i, modifiers: mask }, signal);
        }
      } else if (name === 'browser_hover') {
        let x, y, label = w.hover;
        if (args.element_id) { const box = await elementBox(t, args.element_id, signal); x = box.x; y = box.y; label = named(w.hover, box.name); }
        else ({ x, y } = toPage(t, args.x, args.y));
        activity(t, label);
        await pointer(t, { kind: 'move', x, y, label: w.hover }, signal);
        await command(t, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, signal);
      } else if (name === 'browser_drag') {
        const msg = 'El arrastre debe empezar y acabar dentro de la captura del navegador.';
        const a = toPage(t, args.from_x, args.from_y, msg), b = toPage(t, args.to_x, args.to_y, msg);
        activity(t, w.drag);
        await pointer(t, { kind: 'move', x: a.x, y: a.y, label: w.drag }, signal);
        await command(t, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y }, signal);
        await command(t, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 }, signal);
        // The pointer glides while the real mouse events follow the same path.
        const glide = pointer(t, { kind: 'drag', x: b.x, y: b.y, ms: 240, label: w.drag }, signal).catch(() => null);
        for (let i = 1; i <= 10; i++) {
          const k = i / 10;
          await command(t, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, button: 'left', buttons: 1 }, signal);
          if (i < 10) await wait(20, signal);
        }
        await command(t, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 }, signal);
        await glide;
      } else if (name === 'browser_type') {
        const text = String(args.text || '');
        if (text.length > 100000) throw new Error('El texto es demasiado largo; introdúcelo por partes.');
        if (args.element_id) {
          const box = await elementBox(t, args.element_id, signal, true);
          activity(t, named(w.type, box.name));
          await pointer(t, { kind: 'click', x: box.x, y: box.y, label: w.type }, signal);
        } else {
          activity(t, w.type);
          await pointer(t, { kind: 'label', label: w.type }, signal);
        }
        if (args.replace !== false) { await press(t, IS_MAC ? 'Meta+A' : 'Control+A', [], signal); await press(t, 'Backspace', [], signal); }
        await command(t, 'Input.insertText', { text }, signal);
      } else if (name === 'browser_key') {
        const label = `${w.key} ${cleanText(args.key, 30)}`;
        activity(t, label);
        if (args.element_id) {
          const box = await elementBox(t, args.element_id, signal, true);
          await pointer(t, { kind: 'move', x: box.x, y: box.y, label }, signal);
        } else await pointer(t, { kind: 'label', label }, signal);
        await press(t, args.key, args.modifiers, signal);
      } else if (name === 'browser_scroll') {
        const dy = Number(args.delta_y || 0), dx = Number(args.delta_x || 0);
        if (!Number.isFinite(dy) || !Number.isFinite(dx) || Math.abs(dy) > 20000 || Math.abs(dx) > 20000) throw new Error('Desplazamiento no válido.');
        const v = viewport(t);
        let { x, y } = { x: v.width / 2, y: v.height / 2 };
        if (args.x !== undefined || args.y !== undefined) ({ x, y } = toPage(t, args.x, args.y));
        activity(t, w.scroll);
        await pointer(t, { kind: 'move', x, y, label: w.scroll }, signal);
        // Several small wheel steps read as a smooth scroll instead of a jump.
        const steps = Math.min(10, Math.max(1, Math.ceil(Math.max(Math.abs(dy), Math.abs(dx)) / 160)));
        for (let i = 0; i < steps; i++) {
          await command(t, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx / steps, deltaY: dy / steps }, signal);
          if (i < steps - 1) await wait(14, signal);
        }
      } else throw new Error('Acción de navegador desconocida.');
    } finally { t.busy = false; }
    const observe = ['snapshot', 'screenshot', 'none'].includes(args.observe) ? args.observe : name === 'browser_drag' ? 'screenshot' : 'snapshot';
    const settle = Number.isInteger(args.settle_ms) ? Math.min(Math.max(args.settle_ms, 0), 3000) : observe === 'none' ? 40 : 140;
    if (settle) await wait(settle, signal);
    // A click that started a page load waits for the new page instead of reading a half-built one.
    if (t.navs !== navs && t.wc.isLoading()) await untilUsable(t, signal, 8000);
    if (observe === 'none') return { ...info(t), ok: true };
    if (observe === 'screenshot') return screenshot(t, {}, { ...ctx, png: false });
    return snapshot(t, ctx);
  }
  async function execute(name, args = {}, ctx = {}) {
    try {
      if (ctx.signal?.aborted) throw new Error('Operación detenida');
      if (name === 'browser_tabs') return { tabs: owned(ctx).map(info) };
      if (name === 'browser_open') {
        const url = validateURL(args.url, ctx);
        const existing = owned(ctx);
        const t = args.new_tab || !existing.length ? createTab(ctx) : select(args, ctx);
        return await queued(t, async () => {
          activity(t, `${words().open} ${hostOf(url) || url}`.trim());
          present(t, true);
          await navigate(t, url, ctx.signal);
          await prepare(t, ctx.signal);
          await wait(120, ctx.signal);
          return snapshot(t, ctx);
        });
      }
      const t = select(args, ctx);
      return await queued(t, () => operate(t, name, args, ctx));
    } catch (err) { return { error: cleanText(err.message, 700) }; }
  }
  function setAgent(id, running) {
    const key = String(id || '');
    if (!key) return;
    sessions.set(key, Boolean(running));
    const shell = shells.get(key);
    if (!shell || shell.win.isDestroyed()) return;
    if (!running) {
      shell.activityAt = 0;
      for (const t of shell.tabs) if (alive(t)) pointer(t, { kind: 'hide' }).catch(() => {});
    }
    publishShell(shell);
  }
  function state(id) { const ctx = { sessionId: id }; return { available: true, tabs: owned(ctx).map(info) }; }
  async function open(payload = {}) {
    const ctx = { sessionId: payload.id };
    if (payload.url) return execute('browser_open', { url: payload.url, new_tab: false }, ctx);
    try {
      const list = owned(ctx);
      const t = list.length ? select({}, ctx) : createTab(ctx);
      present(t, true);
      if (t.blank) t.shell.win.webContents.send('computer-browser:focus-address');
      return info(t);
    } catch (err) { return { error: cleanText(err.message, 300) }; }
  }
  function focus(id) { try { const t = select({}, { sessionId: id }); present(t, true); return info(t); } catch (err) { return { error: err.message }; } }
  function close(id) { const shell = shells.get(scope({ sessionId: id })); if (shell && !shell.win.isDestroyed()) shell.win.close(); sessions.delete(String(id || '')); return { ok: true }; }
  function shutdown() {
    shuttingDown = true;
    for (const shell of shells.values()) if (!shell.win.isDestroyed()) shell.win.destroy();
    shells.clear(); tabs.clear(); sessions.clear();
  }
  return { execute, state, open, focus, close, setAgent, shutdown };
}
module.exports = { createBrowserController, addressToURL };
