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
const TOOLBAR_ACTIONS = ['state', 'navigate', 'back', 'forward', 'reload', 'stop', 'tab', 'close-tab', 'new-tab', 'fullscreen', 'stop-agent', 'panel', 'send', 'options', 'mic-access', 'transcribe'];
const PANEL_W = 370;
const WORK_MODELS = new Set(['liquid', 'liquid51', 'solid']);
const WORK_EFFORTS = new Set(['low', 'medium', 'high', 'max']);
const FEED_MAX = 60;
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
  ArrowDown: [40, 'ArrowDown'], Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'], Space: [32, 'Space', ' '],
  Insert: [45, 'Insert'], ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, [112 + i, `F${i + 1}`]])) };
// board v1: the chess board of the page (chess.com, lichess and similar), its box and who plays from below.
const BOARD_FIND = `(() => {
  const pick = () => {
    let best = null, score = 0;
    for (const el of document.querySelectorAll('wc-chess-board, chess-board, cg-board, cg-container, .cg-wrap, #board-layout-chessboard, [class*="board"], [id*="board"], canvas')) {
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height < 160 || Math.abs(r.width - r.height) > Math.max(r.width, r.height) * 0.08) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const v = r.width * r.height * (/^(WC-CHESS-BOARD|CHESS-BOARD|CG-BOARD)$/.test(el.tagName) ? 1.6 : 1);
      if (v > score) { best = el; score = v; }
    }
    return best;
  };
  let el = pick();
  if (!el) return null;
  let r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); r = el.getBoundingClientRect(); }
  const black = el.classList.contains('flipped') || !!el.closest('.flipped, .orientation-black') ||
    !!document.querySelector('wc-chess-board.flipped, chess-board.flipped, .cg-wrap.orientation-black');
  return { x: r.left, y: r.top, w: r.width, h: r.height, orientation: black ? 'black' : 'white', tag: el.tagName.toLowerCase() };
})()`;
const PROMOTION_FIND = (piece, color) => `((p, c) => {
  const names = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
  const el = document.querySelector('.promotion-window .promotion-piece.' + c + p) || document.querySelector('.promotion-piece.' + c + p) ||
    document.querySelector('#promotion-choice piece.' + names[p]) || document.querySelector('[class*="promotion"] [class*="' + names[p] + '"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})(${JSON.stringify(piece)}, ${JSON.stringify(color)})`;
const squareCenter = (b, sq) => {
  const f = 'abcdefgh'.indexOf(sq[0]), r = Number(sq[1]) - 1;
  const col = b.orientation === 'white' ? f : 7 - f, row = b.orientation === 'white' ? 7 - r : r;
  return { x: b.x + (col + 0.5) * b.w / 8, y: b.y + (row + 0.5) * b.h / 8 };
};
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

function createBrowserController({ getOwner = () => null, onStopAgent = () => {}, onUserMessage = () => ({ error: 'unavailable' }), onMicAccess = () => false, onTranscribe = () => ({ error: 'unavailable' }), navigationTimeoutMs = 15000, commandTimeoutMs = 10000 } = {}) {
  installToolbarIPC();
  const tabs = new Map();       // tab_id -> tab
  const shells = new Map();     // owner (Code session) -> its browser window
  const sessions = new Map();   // owner -> whether Code is running a turn there
  const workOptions = new Map(); // latest composer choice, also retained when the browser is reopened
  let sequence = 0;
  let elementSequence = 0;
  let shuttingDown = false;
  let wantFullscreen = null;    // the user's last choice on a browser window, for the next ones

  const scope = (ctx = {}) => String(ctx.sessionId || 'manual');
  const alive = (t) => Boolean(t && !t.wc.isDestroyed() && t.shell && !t.shell.win.isDestroyed());
  const activeTab = (shell) => shell.tabs.find(t => t.id === shell.active) || shell.tabs[shell.tabs.length - 1];
  const chromeHeight = (shell) => BAR_H + (shell.tabs.length > 1 ? TABS_H : 0);
  const panelWidth = (shell) => {
    if (!shell.panel || shell.win.isDestroyed()) return 0;
    const [w] = shell.win.getContentSize();
    return w < 900 ? Math.min(310, Math.round(w * 0.42)) : PANEL_W;
  };
  /** Deiza's feed in the side panel: its actions, what it says, what you wrote to it. */
  function feed(shell, kind, text) {
    const clean = cleanText(text, 600).trim();
    if (!clean) return;
    const last = shell.feed[shell.feed.length - 1];
    if (kind === 'status' && last && last.kind === 'status') { last.text = clean; last.at = Date.now(); }
    else if (!(last && last.kind === kind && last.text === clean)) shell.feed.push({ kind, text: clean, at: Date.now() });
    if (shell.feed.length > FEED_MAX) shell.feed.splice(0, shell.feed.length - FEED_MAX);
    // The panel opens by itself the first time Deiza works here, unless you closed it.
    if (kind !== 'status' && !shell.panel && !shell.panelClosed) { shell.panel = true; layoutShell(shell); }
    publishShell(shell);
  }

  function adopt(key, ctx) {
    // A browser opened by hand before the session existed belongs to the first session that uses it.
    if (key === 'manual' || shells.has(key)) return;
    const manual = shells.get('manual');
    if (!manual || manual.win.isDestroyed()) return;
    shells.delete('manual');
    manual.owner = key;
    manual.options = { ...(workOptions.get(key) || manual.options) };
    manual.optionsDirty = false;
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
    let raw = String(value || '').trim();
    if (!raw) return 'about:blank';
    if (raw === 'about:blank') return raw;
    // A file:// URL or a Windows path (C:\proyecto\index.html) is a project file, not a web address:
    // "C:" used to be read as a URL scheme and the page never opened.
    if (/^file:\/\//i.test(raw)) { try { raw = decodeURIComponent(new URL(raw).pathname).replace(/^\/([a-zA-Z]:)/, '$1'); } catch { /* keep it */ } }
    if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || !/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
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
    return { running: Boolean(running), stopping: Boolean(running && shell.stopping), label: running && recent ? shell.activity || '' : '' };
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
      chrome: chromeHeight(shell), agent: agentState(shell), panel: Boolean(shell.panel), panelWidth: panelWidth(shell),
      feed: shell.feed.slice(-FEED_MAX), kind: /^work_/.test(shell.owner) ? 'work' : /^cli_/.test(shell.owner) ? 'cli' : 'code',
      options: shell.options || workOptions.get(shell.owner) || { model: 'liquid', effort: 'medium' }, sending: Boolean(shell.sending),
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
    feed(shell, 'action', shell.activity);
    clearTimeout(shell.activityTimer);
    shell.activityTimer = setTimeout(() => publishShell(shell), 12500);
    publishShell(shell);
  }

  // ── windows, tabs and layout ───────────────────────────────────────────────
  function layoutShell(shell) {
    if (!shell || shell.win.isDestroyed()) return;
    const [w, h] = shell.win.getContentSize();
    const top = chromeHeight(shell);
    const bounds = { x: 0, y: top, width: Math.max(1, w - panelWidth(shell)), height: Math.max(1, h - top) };
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
    const shell = { owner, win, tabs: [], active: null, toolbarId: win.webContents.id, activity: '', activityAt: 0,
      feed: [], panel: false, panelClosed: false, options: { ...(workOptions.get(owner) || { model: 'liquid', effort: 'medium' }) } };
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
      if (action === 'panel') {
        shell.panel = !shell.panel;
        shell.panelClosed = !shell.panel;
        layoutShell(shell); publishShell(shell);
        return shellState(shell);
      }
      if (action === 'send') {
        if (shell.sending) return { ...shellState(shell), sendResult: { error: 'busy' } };
        const text = cleanText(typeof value === 'object' ? value?.text : value, 8000).trim();
        if (!text) return shellState(shell);
        shell.sending = true; publishShell(shell);
        let res;
        try { res = await Promise.resolve(onUserMessage(shell.owner, text, { ...shell.options })); }
        catch { res = { error: 'offline' }; }
        finally { shell.sending = false; }
        if (res?.ok && !res.error) { feed(shell, 'user', text); shell.optionsDirty = false; }
        publishShell(shell);
        return { ...shellState(shell), sendResult: res || { error: 'unavailable' } };
      }
      if (action === 'options') {
        if (/^work_/.test(shell.owner) && value && typeof value === 'object' && !shell.sending) {
          if (WORK_MODELS.has(value.model)) shell.options.model = value.model;
          if (WORK_EFFORTS.has(value.effort)) shell.options.effort = value.effort;
          shell.optionsDirty = true;
          publishShell(shell);
        }
        return shellState(shell);
      }
      if (action === 'mic-access') return Boolean(await onMicAccess());
      if (action === 'transcribe') return await onTranscribe(value && typeof value === 'object' ? value : {});
      if (action === 'stop-agent') {
        onStopAgent(shell.owner);
        shell.stopping = true;
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
  /** Runs an expression in Deiza's isolated world of the page (page scripts cannot see or change it). */
  async function isolated(t, expression, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!t.pointer.ctx) {
          const { frameTree } = await command(t, 'Page.getFrameTree', {}, signal);
          const world = await command(t, 'Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'deiza-pointer', grantUniveralAccess: false }, signal);
          t.pointer.ctx = world.executionContextId;
        }
        const out = await command(t, 'Runtime.evaluate', { expression, contextId: t.pointer.ctx, awaitPromise: true, returnByValue: true, silent: true }, signal);
        if (out.exceptionDetails) throw new Error('isolated');
        return { value: out.result?.value ?? null };
      } catch (err) {
        if (signal?.aborted) throw err;
        t.pointer.ctx = 0;   // the document changed under the cached world: make a new one once
      }
    }
    return null;
  }
  async function pointer(t, op, signal) {
    if (!alive(t) || t.blank) return null;
    if (op.kind === 'hide' && !Number.isFinite(t.pointer.x)) return null;
    const payload = JSON.stringify({ ...op, fromX: t.pointer.x, fromY: t.pointer.y });
    const out = await isolated(t, `(${POINTER_SOURCE})(${payload})`, signal);
    const value = out?.value || null;
    if (value && Number.isFinite(value.x)) { t.pointer.x = value.x; t.pointer.y = value.y; }
    return value;   // the pointer is decoration: an action never fails because of it
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
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= s.w || y >= s.h) throw new Error(`${message || 'El punto'} (${x}, ${y}) queda fuera de la captura actual del navegador (${s.w} × ${s.h} px). Usa coordenadas de la última captura.`);
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
  async function boardOf(t, signal) {
    const b = (await isolated(t, BOARD_FIND, signal))?.value;
    return b && Number.isFinite(b.x) && b.w > 0 ? b : null;
  }
  /** Board box in capture pixels, for the model (squares need no pixel arithmetic: browser_board_move). */
  function boardInShot(t, b) {
    if (!b) return undefined;
    const k = shotSize(t).scale;
    return { x0: Math.round(b.x * k), y0: Math.round(b.y * k), w: Math.round(b.w * k), h: Math.round(b.h * k), orientation: b.orientation };
  }
  /** Moves a piece from one square to another (e2, e4) by dragging between the exact square centres. */
  async function boardMove(t, args, signal) {
    const from = String(args.from || '').trim().toLowerCase(), to = String(args.to || '').trim().toLowerCase();
    if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to) || from === to) throw new Error('Indica las casillas en notación algebraica, por ejemplo from "e2" y to "e4".');
    let b = await boardOf(t, signal);
    if (!b) throw new Error('No encuentro un tablero de ajedrez en la página. Haz una captura y usa browser_click o browser_drag con sus coordenadas.');
    if (args.orientation === 'white' || args.orientation === 'black') b = { ...b, orientation: args.orientation };
    const a = squareCenter(b, from), z = squareCenter(b, to);
    const label = `${words().drag} ${from}→${to}`;
    activity(t, label);
    await pointer(t, { kind: 'move', x: a.x, y: a.y, label }, signal);
    await command(t, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y }, signal);
    await command(t, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 }, signal);
    const glide = pointer(t, { kind: 'drag', x: z.x, y: z.y, ms: 200, label }, signal).catch(() => null);
    for (let i = 1; i <= 8; i++) {
      const k = i / 8;
      await command(t, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (z.x - a.x) * k, y: a.y + (z.y - a.y) * k, button: 'left', buttons: 1 }, signal);
      if (i < 8) await wait(18, signal);
    }
    await command(t, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: z.x, y: z.y, button: 'left', buttons: 0, clickCount: 1 }, signal);
    await glide;
    const piece = String(args.promotion || '').toLowerCase()[0];
    if ('qrbn'.includes(piece) && piece) {
      await wait(350, signal);
      const p = (await isolated(t, PROMOTION_FIND(piece, b.orientation === 'black' ? 'b' : 'w'), signal))?.value;
      if (p) {
        await pointer(t, { kind: 'click', x: p.x, y: p.y, label }, signal);
        await command(t, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 }, signal);
        await command(t, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }, signal);
      }
    }
    return { board: b, to: z };
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
    if (name === 'browser_screenshot') {
      activity(t, w.look);
      const shot = await screenshot(t, args, ctx);
      const board = boardInShot(t, await boardOf(t, signal).catch(() => null));
      return board ? { ...shot, board } : shot;
    }
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
        else ({ x, y } = toPage(t, args.x, args.y));
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
      } else if (name === 'browser_board_move') {
        await boardMove(t, args, signal);
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
    const observe = ['snapshot', 'screenshot', 'none'].includes(args.observe) ? args.observe : ['browser_drag', 'browser_board_move'].includes(name) ? 'screenshot' : 'snapshot';
    const settle = Number.isInteger(args.settle_ms) ? Math.min(Math.max(args.settle_ms, 0), 3000) : observe === 'none' ? 40 : 140;
    if (settle) await wait(settle, signal);
    // A click that started a page load waits for the new page instead of reading a half-built one.
    if (t.navs !== navs && t.wc.isLoading()) await untilUsable(t, signal, 8000);
    if (observe === 'none') return { ...info(t), ok: true };
    if (observe === 'screenshot') {
      const shot = await screenshot(t, {}, { ...ctx, png: false });
      const board = boardInShot(t, await boardOf(t, signal).catch(() => null));
      return board ? { ...shot, board } : shot;
    }
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
  // ── Work (deiza.org) on this computer ──────────────────────────────────────
  // local browser v1: the Work agent runs on the server and sends its browser actions here; the
  // answer has the shape of the server browser's state (JPEG capture, clickable elements in
  // capture pixels, page text) so the agent works the same with either browser.
  const WORK_ELEMENTS = `(() => {
    const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[onclick]';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') ||
        el.getAttribute('placeholder') || el.getAttribute('alt') || el.name || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
      if (!label && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) continue;
      out.push({ t: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''), l: label,
        x: Math.max(0, r.left) + Math.min(r.width, innerWidth) / 2, y: Math.max(0, r.top) + Math.min(r.height, innerHeight) / 2 });
      if (out.length >= 60) break;
    }
    let areas = 0;
    for (const el of document.querySelectorAll('cg-board, canvas, [class*="board"], [class*="Board"], svg')) {
      const r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 200 || r.bottom < 0 || r.top > innerHeight) continue;
      out.push({ t: 'area', l: (el.tagName.toLowerCase() + ' ' + (el.getAttribute('class') || '')).trim().slice(0, 40), x0: r.left, y0: r.top, w: r.width, h: r.height });
      if (++areas >= 3) break;
    }
    return out;
  })()`;
  const WORK_READ = `(() => {
    const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n');
    const links = [...document.querySelectorAll('a[href]')].slice(0, 400).map(a => ({ t: (a.innerText || a.title || '').trim().slice(0, 80), u: a.href }))
      .filter(l => l.t && /^https?:/.test(l.u)).slice(0, 60);
    const imgs = [...document.images].filter(i => i.naturalWidth >= 300 && i.naturalHeight >= 200).slice(0, 24)
      .map(i => ({ u: i.currentSrc || i.src, alt: (i.alt || '').slice(0, 100), w: i.naturalWidth, h: i.naturalHeight })).filter(i => /^https?:/.test(i.u));
    return { text: text.slice(0, 16000), links, imgs };
  })()`;
  const workFind = (text) => `((want) => {
    want = want.trim().toLowerCase().replace(/\\s+/g, ' ');
    const sel = 'a,button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],summary,label,input[type=submit],input[type=button]';
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const name = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\\s+/g, ' ').toLowerCase();
    const all = [...document.querySelectorAll(sel)].filter(shown);
    let hit = null;
    for (const test of [(n) => n === want, (n) => n.startsWith(want), (n) => n.includes(want)]) { hit = all.find(el => test(name(el))); if (hit) break; }
    if (!hit) {
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeValue && n.nodeValue.trim().toLowerCase() === want && n.parentElement && shown(n.parentElement)) { hit = n.parentElement; break; }
      }
    }
    if (!hit) return null;
    hit.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = hit.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: name(hit).slice(0, 60) };
  })(${JSON.stringify(String(text || ''))})`;

  async function workState(t, ctx, extra = {}) {
    const shot = await screenshot(t, {}, { ...ctx, png: false });
    const s = shotSize(t);
    const els = (await isolated(t, WORK_ELEMENTS, ctx.signal))?.value || [];
    const k = s.scale;
    const elements = (Array.isArray(els) ? els : []).map(e => (e.t === 'area'
      ? { ...e, x0: Math.round(e.x0 * k), y0: Math.round(e.y0 * k), w: Math.round(e.w * k), h: Math.round(e.h * k) }
      : { ...e, x: Math.round(e.x * k), y: Math.round(e.y * k) }));
    const board = boardInShot(t, await boardOf(t, ctx.signal).catch(() => null));
    return { url: t.wc.getURL(), title: cleanText(t.wc.getTitle(), 200), shot: shot.data_url.split(',')[1], w: shot.width, h: shot.height, elements,
      ...(board ? { board } : {}), ...extra };
  }
  async function work(action, args = {}, ctx = {}) {
    const session = { sessionId: ctx.sessionId, signal: ctx.signal };
    try {
      if (ctx.signal?.aborted) throw new Error('Operación detenida');
      if (action === 'open') {
        let url = String(args.url || '').trim();
        if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
        const opened = await execute('browser_open', { url }, session);
        if (opened.error) return { error: opened.error };
        const t = select({}, session);
        return await queued(t, () => workState(t, session));
      }
      if (!owned(session).length) {
        if (action === 'status' || action === 'shot') return { open: false };
        return { error: 'No hay ninguna página abierta en el navegador. Usa browser_open primero.' };
      }
      const t = select({}, session);
      return await queued(t, async () => {
        const run = (name, a) => operate(t, name, { ...a, observe: 'none' }, session);
        const extra = {};
        if (action === 'click') await run('browser_click', { x: Number(args.x), y: Number(args.y), settle_ms: 220 });
        else if (action === 'type') {
          await run('browser_type', { text: String(args.text || ''), replace: Boolean(args.clear), settle_ms: 60 });
          if (args.submit) await run('browser_key', { key: 'Enter', settle_ms: 700 });
        } else if (action === 'key') await run('browser_key', { key: String(args.key || ''), settle_ms: 250 });
        else if (action === 'scroll') await run('browser_scroll', { delta_y: Number(args.dy) || 700, settle_ms: 220 });
        else if (action === 'drag') await run('browser_drag', { from_x: Number(args.x1), from_y: Number(args.y1), to_x: Number(args.x2), to_y: Number(args.y2), settle_ms: 300 });
        else if (['back', 'forward', 'reload'].includes(action)) {
          const history = t.wc.navigationHistory;
          if ((action === 'back' && !history.canGoBack()) || (action === 'forward' && !history.canGoForward())) return { ...(await workState(t, session)), error: 'No hay página a la que ir.' };
          await operate(t, 'browser_history', { action }, session);
        } else if (action === 'click_text') {
          await prepare(t, ctx.signal);
          const hit = (await isolated(t, workFind(args.text), ctx.signal))?.value;
          if (!hit) return { ...(await workState(t, session)), error: `No hay ningún elemento visible con el texto «${cleanText(args.text, 80)}».` };
          const k = shotSize(t).scale;
          await run('browser_click', { x: hit.x * k, y: hit.y * k, settle_ms: 220 });
          extra.clicked = { x: Math.round(hit.x * k), y: Math.round(hit.y * k) };
        } else if (action === 'board_move') {
          await prepare(t, ctx.signal);
          const moved = await boardMove(t, args, ctx.signal);
          await wait(300, ctx.signal);
          const k = shotSize(t).scale;
          extra.clicked = { x: Math.round(moved.to.x * k), y: Math.round(moved.to.y * k) };
        } else if (action === 'read') {
          activity(t, words().read);
          Object.assign(extra, (await isolated(t, WORK_READ, ctx.signal))?.value || {});
        } else if (action !== 'status' && action !== 'shot') throw new Error('Acción de navegador desconocida.');
        return workState(t, session, extra);
      });
    } catch (err) { return { error: cleanText(err.message, 500) }; }
  }

  function setAgent(id, running) {
    const key = String(id || '');
    if (!key) return;
    sessions.set(key, Boolean(running));
    const shell = shells.get(key);
    if (!shell || shell.win.isDestroyed()) return;
    if (!running) {
      shell.stopping = false;
      shell.activityAt = 0;
      for (const t of shell.tabs) if (alive(t)) pointer(t, { kind: 'hide' }).catch(() => {});
    }
    publishShell(shell);
  }
  function setWorkState(id, value = {}) {
    const key = String(id || '');
    if (!/^work_\d+$/.test(key)) return;
    const opts = workOptions.get(key) || { model: 'liquid', effort: 'medium' };
    if (WORK_MODELS.has(value.model)) opts.model = value.model;
    if (WORK_EFFORTS.has(value.effort)) opts.effort = value.effort;
    workOptions.set(key, opts);
    const shell = shells.get(key);
    if (shell && !shell.optionsDirty) shell.options = { ...opts };
    if (typeof value.running === 'boolean') setAgent(key, value.running);
    if (shell) publishShell(shell);
  }
  /** What Code or Work says or does (from outside the browser) for the panel of that session. */
  function say(id, item = {}) {
    const shell = shells.get(String(id || ''));
    if (!shell || shell.win.isDestroyed()) return false;
    const kind = ['say', 'status', 'action', 'user'].includes(item.kind) ? item.kind : 'say';
    feed(shell, kind, item.text);
    return true;
  }
  /** Shows the browser of a session; when it was closed, opens it again on `url` (or empty). */
  async function reveal(id, url) {
    const ctx = { sessionId: id };
    if (owned(ctx).length) { const t = select({}, ctx); present(t, true); return info(t); }
    let target = '';
    try { target = url ? validateURL(url, {}) : ''; } catch { target = ''; }
    if (target && target !== 'about:blank') return execute('browser_open', { url: target }, ctx);
    const t = createTab(ctx);
    present(t, true);
    return info(t);
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
    shells.clear(); tabs.clear(); sessions.clear(); workOptions.clear();
  }
  return { execute, work, say, reveal, state, open, focus, close, setAgent, setWorkState, isToolbar: wc => Boolean(wc && toolbarRoutes.has(wc.id) && wc.getURL() === TOOLBAR_URL), shutdown };
}
module.exports = { createBrowserController, addressToURL };
