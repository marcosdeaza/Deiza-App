/**
 * Deiza for desktop — main process.
 *
 * One window, two modes:
 *   Chat  the real deiza.org workspace in a sandboxed WebContentsView (always up to date,
 *         every feature of the web: artifacts, previews, documents, search, voice...)
 *   Code  a local interface for Deiza Code; the agent runs in a utility process per session
 *         with the chosen project folder as its working directory.
 *
 * The local renderer (titlebar + Code UI) is trusted and bundled; the remote Chat view gets a
 * minimal bridge (window.deizaDesktop) and no Node access.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  app, BrowserWindow, WebContentsView, ipcMain, shell, nativeTheme, Menu, dialog, session,
  Notification, systemPreferences, screen, globalShortcut, protocol, clipboard, net,
} = require('electron');

const { createStore } = require('./store');
const auth = require('./auth');
const codeHost = require('./code-host');
const computerHost = require('./computer-host');
const preview = require('./preview');
const updates = require('./updates');
const I18n = require('../shared/i18n');

const { T } = I18n;

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const DEIZA_ORIGIN = (process.env.DEIZA_URL || 'https://deiza.org').replace(/\/+$/, '');
const PARTITION = 'persist:deiza';
const TITLEBAR_H = IS_MAC ? 44 : 40;
// Translucent materials (macOS vibrancy / Windows 11 Mica) are off: with the Chat web view on
// top, a frame the compositor misses showed the material behind it as a brief flash. An opaque
// window in the web's own background colour makes any such frame invisible. DEIZA_MATERIAL=1
// turns them back on for experiments.
const WIN_MICA = IS_WIN && process.env.DEIZA_MATERIAL === '1' && Number(os.release().split('.')[2] || 0) >= 22621;
const MATERIAL = (IS_MAC && process.env.DEIZA_MATERIAL === '1') || WIN_MICA;
const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');

// Hosts that may open inside the app as child windows (payments, identity providers).
// Everything else outside deiza.org goes to the default browser.
const INAPP_POPUP_HOSTS = new Set(['checkout.stripe.com', 'billing.stripe.com', 'appleid.apple.com', 'accounts.google.com']);

const THEMES = {
  dark: { bg: '#1c1917', fg: '#ebe6e0', symbol: '#a8998a' },
  light: { bg: '#ede9e4', fg: '#292523', symbol: '#5a4e49' },
};

app.setName('Deiza');

// macOS keychain. Chromium keeps its encryption key (cookies, safeStorage) in the login keychain,
// and the keychain only trusts the exact code signature that created the item. Ad hoc builds get a
// new signature with every release, so each update made macOS ask for the password again, once per
// process that reads the key. Until releases carry a stable Developer ID signature, the key stays out
// of the keychain. The session token also lives in the web view's storage in this same profile, so
// the keychain added little protection here. Linux: same idea with the desktop keyring.
const BUILD_INFO = (() => { try { return require('./build-info.json'); } catch { return {}; } })();
if (process.platform === 'darwin' && !BUILD_INFO.stableSignature) app.commandLine.appendSwitch('use-mock-keychain');
if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'basic');
// Separate profile for tests and side-by-side runs.
if (process.env.DEIZA_USER_DATA) app.setPath('userData', process.env.DEIZA_USER_DATA);
if (IS_WIN) app.setAppUserModelId('org.deiza.desktop');

protocol.registerSchemesAsPrivileged([
  { scheme: preview.SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let state;           // persisted UI state
let settings;        // user preferences (Ajustes)
let overlayOpen = false;
let updatedFrom = '';   // previous version when this launch is the first after an update
let win = null;
let chatView = null;
let mode = 'chat';
let theme = 'dark';
let chatReady = false;
let quitting = false;

// ── helpers ────────────────────────────────────────────────────────────────────

function isDeizaUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === DEIZA_ORIGIN || u.origin === DEIZA_ORIGIN.replace('://', '://www.');
  } catch {
    return false;
  }
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) shell.openExternal(u.toString());
  } catch { /* ignore malformed */ }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function userAgent() {
  // A plain Chrome UA (no "Electron/x" or app token) keeps third-party sign-in and payment
  // pages happy; the DeizaDesktop suffix lets deiza.org tell the app apart.
  const chrome = process.versions.chrome;
  const platform = IS_MAC ? 'Macintosh; Intel Mac OS X 10_15_7' : IS_WIN ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36 DeizaDesktop/${app.getVersion()}`;
}

function uniquePath(dir, filename) {
  const clean = (filename || 'descarga').replace(/[\\/:*?"<>|]+/g, '_');
  const ext = path.extname(clean);
  const base = clean.slice(0, clean.length - ext.length) || 'descarga';
  let candidate = path.join(dir, clean);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

// ── window & layout ────────────────────────────────────────────────────────────

function restoreBounds() {
  const saved = state.get('bounds');
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1440, Math.round(area.width * 0.86));
  const height = Math.min(940, Math.round(area.height * 0.88));
  if (!saved) return { width, height };
  const visible = screen.getAllDisplays().some(d => {
    const b = d.workArea;
    return saved.x < b.x + b.width - 80 && saved.x + saved.width > b.x + 80 && saved.y < b.y + b.height - 40 && saved.y + saved.height > b.y;
  });
  return visible ? saved : { width: saved.width || width, height: saved.height || height };
}

function layout() {
  if (!win || !chatView) return;
  const [w, h] = win.getContentSize();
  chatView.setBounds({ x: 0, y: TITLEBAR_H, width: w, height: Math.max(0, h - TITLEBAR_H) });
}

const titleBarOverlay = (t) => ({ color: WIN_MICA ? '#00000000' : t.bg, symbolColor: t.symbol, height: TITLEBAR_H });

function applyTheme(next) {
  theme = next === 'light' ? 'light' : 'dark';
  const t = THEMES[theme];
  nativeTheme.themeSource = theme;
  if (win && !win.isDestroyed()) {
    if (!MATERIAL) win.setBackgroundColor(t.bg);
    if (!IS_MAC) {
      try { win.setTitleBarOverlay(titleBarOverlay(t)); } catch { /* older Windows */ }
    }
  }
  state.set('theme', theme);
  send('app:theme', theme);
}

function chatVisible() {
  // The settings sheet is drawn by the local UI, which sits under the Chat view.
  return mode === 'chat' && auth.state().signedIn && !overlayOpen;
}

// ── language & preferences ─────────────────────────────────────────────────────

function appLanguage() {
  const saved = settings && settings.get('language');
  return I18n.isLanguage(saved) ? saved : I18n.fromLocale(app.getPreferredSystemLanguages?.()[0] || app.getLocale());
}

function applyLanguage(lang, { fromChat = false } = {}) {
  if (!I18n.isLanguage(lang)) return;
  const changed = lang !== appLanguage() || !settings.get('language');
  settings.set('language', lang);
  I18n.setLanguage(lang);
  if (!changed) return;
  send('app:language', lang);
  buildMenu();
  // The web keeps its own copy (localStorage `deiza-language`); a reload applies it everywhere.
  if (!fromChat && chatView && isDeizaUrl(chatView.webContents.getURL())) {
    chatView.webContents.executeJavaScript(`try{localStorage.setItem('deiza-language',${JSON.stringify(lang)})}catch(e){}`)
      .then(() => chatView && chatView.webContents.reload())
      .catch(() => {});
  }
}

const SUMMON = IS_MAC ? 'Alt+Cmd+Space' : 'Alt+Ctrl+Space';
function applyShortcut() {
  try { globalShortcut.unregister(SUMMON); } catch { /* not registered */ }
  if (settings.get('shortcut') === false) return true;
  try {
    return globalShortcut.register(SUMMON, () => {
      if (win && win.isVisible() && win.isFocused()) win.hide();
      else showWindow();
    });
  } catch {
    return false;
  }
}

function loginItem() {
  try { return Boolean(app.getLoginItemSettings().openAtLogin); } catch { return false; }
}

function setMode(next) {
  mode = next === 'code' ? 'code' : 'chat';
  state.set('mode', mode);
  if (chatView) chatView.setVisible(chatVisible());
  send('app:mode', mode);
  if (win && !win.isDestroyed()) {
    if (chatVisible() && chatView) chatView.webContents.focus();
    else win.webContents.focus();
  }
  buildMenu();
}

function navState() {
  if (!chatView) return;
  const nav = chatView.webContents.navigationHistory;
  send('chat:nav', {
    canGoBack: nav.canGoBack(),
    canGoForward: nav.canGoForward(),
    url: chatView.webContents.getURL(),
    title: chatView.webContents.getTitle(),
    loading: chatView.webContents.isLoading(),
  });
}

function createWindow() {
  const t = THEMES[theme];
  const bounds = restoreBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Deiza',
    // Native materials: translucent sidebar/titlebar (macOS vibrancy, Windows 11 Mica).
    backgroundColor: MATERIAL ? '#00000000' : t.bg,
    vibrancy: IS_MAC && MATERIAL ? 'sidebar' : undefined,
    visualEffectState: IS_MAC && MATERIAL ? 'followWindow' : undefined,
    backgroundMaterial: WIN_MICA ? 'mica' : undefined,
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
    trafficLightPosition: IS_MAC ? { x: 16, y: 15 } : undefined,
    // Windows and Linux draw their own minimise/maximise/close buttons over the hidden titlebar.
    // Without the overlay a Linux window (Chromebooks included) had no way to be closed by mouse.
    titleBarOverlay: IS_MAC ? undefined : titleBarOverlay(t),
    icon: IS_MAC ? undefined : path.join(RENDERER, 'icon.png'),
    webPreferences: {
      preload: path.join(ROOT, 'preload/app.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (state.get('maximized')) win.maximize();

  win.loadFile(path.join(RENDERER, 'app/index.html'), { query: { platform: process.platform } });
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openExternal(url); } });
  attachContextMenu(win.webContents);
  if (!app.isPackaged) {
    win.webContents.on('console-message', (e, level, message, line, sourceId) => {
      const m = typeof e.message === 'string' ? e : { level, message, lineNumber: line, sourceId };
      console.log(`[ui:${m.level}] ${m.message} (${String(m.sourceId || '').split('/').pop()}:${m.lineNumber})`);
    });
    win.webContents.on('preload-error', (_e, p, err) => console.error('[ui preload]', p, err));
  }

  createChatView();

  win.once('ready-to-show', () => {
    win.show();
    if (chatVisible()) chatView.webContents.focus();
  });
  // Safety net: never leave an invisible window if the renderer is slow.
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); }, 4000);

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    state.set('maximized', win.isMaximized());
    if (!win.isMaximized()) state.set('bounds', win.getBounds());
  };
  win.on('resize', () => { layout(); saveBounds(); });
  win.on('move', saveBounds);
  win.on('enter-full-screen', () => send('app:fullscreen', true));
  win.on('leave-full-screen', () => send('app:fullscreen', false));
  win.on('focus', () => { send('app:focus', true); updates.onFocus(); });
  win.on('blur', () => send('app:focus', false));

  win.on('close', (e) => {
    // macOS convention: closing the window keeps the app (and running Code sessions) alive.
    if (IS_MAC && !quitting) {
      e.preventDefault();
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide());
        win.setFullScreen(false);
      } else {
        win.hide();
      }
    }
  });
  win.on('closed', () => { win = null; chatView = null; });
}

function createChatView() {
  chatView = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: path.join(ROOT, 'preload/chat.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  chatView.setBackgroundColor(THEMES[theme].bg);
  win.contentView.addChildView(chatView);
  layout();
  chatView.setVisible(chatVisible());

  const wc = chatView.webContents;
  wc.setUserAgent(userAgent());
  const start = auth.state().signedIn ? (state.get('lastChatPath') || '/workspace') : '/login';
  wc.loadURL(`${DEIZA_ORIGIN}${start}`);

  wc.on('will-navigate', (e, url) => {
    if (isDeizaUrl(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* noop */ }
    if (isDeizaUrl(url) || INAPP_POPUP_HOSTS.has(host)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1100, height: 820, parent: win, autoHideMenuBar: true, backgroundColor: THEMES[theme].bg,
          webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    child.webContents.setUserAgent(userAgent());
    attachContextMenu(child.webContents);
    child.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  });

  wc.on('did-start-loading', navState);
  wc.on('did-stop-loading', navState);
  wc.on('did-navigate', (_e, url) => { rememberChatPath(url); navState(); });
  wc.on('did-navigate-in-page', (_e, url) => { rememberChatPath(url); navState(); });
  wc.on('page-title-updated', navState);
  wc.on('did-finish-load', () => { chatReady = true; });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted by a new navigation
    wc.loadFile(path.join(RENDERER, 'offline/index.html'), { query: { url, reason: desc || String(code) } });
  });
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    wc.loadFile(path.join(RENDERER, 'offline/index.html'), { query: { url: `${DEIZA_ORIGIN}/workspace`, reason: 'crash' } });
  });
  attachContextMenu(wc);
}

function rememberChatPath(url) {
  if (!isDeizaUrl(url)) return;
  const u = new URL(url);
  // Reopen where the user was, but never on a one-off page (login callbacks, auth handoffs).
  if (/^\/(workspace|search|docs|settings|plans|noticias|news)/.test(u.pathname)) state.set('lastChatPath', u.pathname + u.search);
}

// ── session: permissions, downloads ────────────────────────────────────────────

function setupChatSession() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(userAgent());

  const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'window-management']);
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const origin = details.requestingUrl || wc.getURL();
    if (!isDeizaUrl(origin) || !allowed.has(permission)) return callback(false);
    if (permission === 'media') {
      const types = details.mediaTypes || [];
      if (types.includes('video')) return callback(false);
      if (IS_MAC && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
        const ok = await systemPreferences.askForMediaAccess('microphone');
        return callback(ok);
      }
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => isDeizaUrl(origin) && allowed.has(permission));

  ses.on('will-download', (_e, item) => {
    const target = uniquePath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(target);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const name = path.basename(target);
    send('download', { id, name, state: 'progressing', received: 0, total: item.getTotalBytes() });
    item.on('updated', () => send('download', { id, name, state: 'progressing', received: item.getReceivedBytes(), total: item.getTotalBytes() }));
    item.once('done', (_ev, st) => {
      send('download', { id, name, state: st, path: target });
      if (st === 'completed') {
        if (IS_MAC) app.dock?.downloadFinished(target);
        if (!win?.isFocused() && Notification.isSupported()) {
          const n = new Notification({ title: T('Descarga completada'), body: name, silent: true });
          n.on('click', () => shell.showItemInFolder(target));
          n.show();
        }
      }
    });
  });
}

function offerMoveToApplications() {
  if (!IS_MAC || !app.isPackaged || process.env.DEIZA_UPDATE_URL) return false;
  try { if (app.isInApplicationsFolder()) return false; } catch { return false; }
  if (Date.now() < Number(settings.get('moveToAppsSnoozedUntil') || 0)) return false;
  const r = dialog.showMessageBoxSync({
    type: 'question',
    buttons: [T('Mover a Aplicaciones'), T('Ahora no')],
    defaultId: 0,
    cancelId: 1,
    message: T('¿Mover Deiza a Aplicaciones?'),
    detail: T('Ahora se está abriendo desde el instalador o desde Descargas. En Aplicaciones se queda instalada y se actualiza sola.'),
  });
  if (r === 1) {
    settings.set('moveToAppsSnoozedUntil', Date.now() + 7 * 24 * 60 * 60 * 1000);
    return false;
  }
  try {
    // Replaces an older copy in Applications; Electron relaunches from the new location.
    return app.moveToApplicationsFolder({ conflictHandler: (type) => type === 'exists' });
  } catch (err) {
    dialog.showMessageBoxSync({ type: 'warning', message: T('No se pudo mover Deiza a Aplicaciones'), detail: T('Arrástrala tú a la carpeta Aplicaciones desde el Finder.') });
    return false;
  }
}

/** The local UI (titlebar + Code) only ever needs the microphone, for dictation. */
function setupAppSession() {
  const ses = session.defaultSession;
  const local = (wc) => Boolean(win && wc === win.webContents);
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (!local(wc)) return callback(false);
    if (permission === 'clipboard-sanitized-write') return callback(true);
    if (permission !== 'media' || (details.mediaTypes || []).includes('video')) return callback(false);
    if (IS_MAC && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
      return callback(await systemPreferences.askForMediaAccess('microphone'));
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((wc, permission) => local(wc) && ['media', 'clipboard-sanitized-write'].includes(permission));
}

// ── context menu (Electron has none by default) ───────────────────────────────

function attachContextMenu(wc) {
  wc.on('context-menu', (_e, p) => {
    const t = [];
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) t.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (p.dictionarySuggestions.length) t.push({ type: 'separator' });
      t.push({ label: T('Añadir al diccionario'), click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      t.push({ type: 'separator' });
    }
    if (p.linkURL) {
      t.push({ label: T('Abrir enlace en el navegador'), click: () => openExternal(p.linkURL) });
      t.push({ label: T('Copiar enlace'), click: () => clipboard.writeText(p.linkURL) });
      t.push({ type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      t.push({ label: T('Guardar imagen…'), click: () => wc.downloadURL(p.srcURL) });
      t.push({ label: T('Copiar imagen'), click: () => wc.copyImageAt(p.x, p.y) });
      t.push({ type: 'separator' });
    }
    if (p.isEditable) {
      t.push({ role: 'undo', label: T('Deshacer'), enabled: p.editFlags.canUndo });
      t.push({ role: 'redo', label: T('Rehacer'), enabled: p.editFlags.canRedo });
      t.push({ type: 'separator' });
      t.push({ role: 'cut', label: T('Cortar'), enabled: p.editFlags.canCut });
    }
    if (p.isEditable || p.selectionText) t.push({ role: 'copy', label: T('Copiar'), enabled: p.editFlags.canCopy });
    if (p.isEditable) t.push({ role: 'paste', label: T('Pegar'), enabled: p.editFlags.canPaste });
    if (p.isEditable || !p.selectionText) t.push({ role: 'selectAll', label: T('Seleccionar todo') });
    if (!app.isPackaged || process.env.DEIZA_DEVTOOLS) {
      t.push({ type: 'separator' }, { label: T('Inspeccionar'), click: () => wc.inspectElement(p.x, p.y) });
    }
    while (t.length && t[t.length - 1].type === 'separator') t.pop();
    if (t.length) Menu.buildFromTemplate(t).popup({ window: win || undefined });
  });
}

// ── menu ───────────────────────────────────────────────────────────────────────

function focusedContents() {
  if (mode === 'chat' && chatView) return chatView.webContents;
  return win?.webContents;
}

function openSettings(section) {
  showWindow();
  send('app:open-settings', section || '');
}

function buildMenu() {
  const chatOnly = mode === 'chat' && !overlayOpen;
  const signedIn = auth.state().signedIn;
  const template = [
    ...(IS_MAC ? [{
      label: 'Deiza',
      submenu: [
        { label: T('Acerca de Deiza'), click: () => openSettings('about') },
        { label: T('Buscar actualizaciones…'), click: () => updates.check({ manual: true }) },
        { type: 'separator' },
        { label: T('Ajustes…'), accelerator: 'Cmd+,', enabled: signedIn, click: () => openSettings() },
        { label: T('Cerrar sesión'), enabled: signedIn, click: () => logout() },
        { type: 'separator' },
        { role: 'services', label: T('Servicios') },
        { type: 'separator' },
        { role: 'hide', label: T('Ocultar Deiza') },
        { role: 'hideOthers', label: T('Ocultar otros') },
        { role: 'unhide', label: T('Mostrar todo') },
        { type: 'separator' },
        { role: 'quit', label: T('Salir de Deiza') },
      ],
    }] : []),
    {
      label: T('Archivo'),
      submenu: [
        { label: T('Nuevo chat'), accelerator: 'CmdOrCtrl+N', click: () => { setMode('chat'); chatView?.webContents.loadURL(`${DEIZA_ORIGIN}/workspace?new=1`); } },
        { label: T('Nueva sesión de Code'), accelerator: 'CmdOrCtrl+Shift+N', click: () => { setMode('code'); send('code:command', 'new-session'); } },
        { label: T('Abrir carpeta en Code…'), accelerator: 'CmdOrCtrl+O', click: () => { setMode('code'); send('code:command', 'open-folder'); } },
        { type: 'separator' },
        ...(IS_MAC ? [] : [
          { label: T('Ajustes…'), accelerator: 'Ctrl+,', enabled: signedIn, click: () => openSettings() },
          { label: T('Cerrar sesión'), enabled: signedIn, click: () => logout() },
          { type: 'separator' },
        ]),
        IS_MAC ? { role: 'close', label: T('Cerrar ventana') } : { role: 'quit', label: T('Salir') },
      ],
    },
    {
      label: T('Edición'),
      submenu: [
        { role: 'undo', label: T('Deshacer') },
        { role: 'redo', label: T('Rehacer') },
        { type: 'separator' },
        { role: 'cut', label: T('Cortar') },
        { role: 'copy', label: T('Copiar') },
        { role: 'paste', label: T('Pegar') },
        { role: 'pasteAndMatchStyle', label: T('Pegar sin formato') },
        { role: 'selectAll', label: T('Seleccionar todo') },
      ],
    },
    {
      label: T('Ver'),
      submenu: [
        { label: 'Chat', type: 'radio', checked: mode === 'chat', accelerator: 'CmdOrCtrl+1', click: () => setMode('chat') },
        { label: 'Code', type: 'radio', checked: mode === 'code', accelerator: 'CmdOrCtrl+2', click: () => setMode('code') },
        { type: 'separator' },
        { label: T('Atrás'), accelerator: IS_MAC ? 'Cmd+[' : 'Alt+Left', enabled: chatOnly, click: () => chatView?.webContents.navigationHistory.goBack() },
        { label: T('Adelante'), accelerator: IS_MAC ? 'Cmd+]' : 'Alt+Right', enabled: chatOnly, click: () => chatView?.webContents.navigationHistory.goForward() },
        { label: T('Recargar'), accelerator: 'CmdOrCtrl+R', click: () => (chatOnly ? chatView?.webContents.reload() : win?.webContents.reload()) },
        { type: 'separator' },
        { label: T('Aumentar'), accelerator: 'CmdOrCtrl+Plus', click: () => zoom(0.5) },
        { label: T('Reducir'), accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
        { label: T('Tamaño real'), accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: T('Pantalla completa') },
        ...(!app.isPackaged || process.env.DEIZA_DEVTOOLS ? [{ label: T('Herramientas de desarrollo'), accelerator: IS_MAC ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => focusedContents()?.toggleDevTools() }] : []),
      ],
    },
    {
      label: T('Ventana'),
      submenu: [
        { role: 'minimize', label: T('Minimizar') },
        { role: 'zoom', label: T('Zoom') },
        ...(IS_MAC ? [{ type: 'separator' }, { role: 'front', label: T('Traer todo al frente') }] : []),
      ],
    },
    {
      role: 'help',
      label: T('Ayuda'),
      submenu: [
        { label: T('Documentación de Deiza'), click: () => openExternal(`${DEIZA_ORIGIN}/docs`) },
        { label: T('Novedades'), click: () => { setMode('chat'); chatView?.webContents.loadURL(`${DEIZA_ORIGIN}/noticias`); } },
        { label: T('Deiza para escritorio'), click: () => openExternal(`${DEIZA_ORIGIN}/desktop`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function zoom(delta) {
  const wc = focusedContents();
  if (!wc) return;
  wc.setZoomLevel(delta === 0 ? 0 : Math.max(-3, Math.min(4, wc.getZoomLevel() + delta)));
}

// ── IPC ────────────────────────────────────────────────────────────────────────

function fromApp(e) {
  return win && e.sender === win.webContents;
}
function fromChat(e) {
  return chatView && e.sender === chatView.webContents && isDeizaUrl(e.senderFrame?.url || chatView.webContents.getURL());
}

function setupIpc() {
  ipcMain.handle('computer:state', (e, payload = {}) => fromApp(e) ? computerHost.state(payload.id) : null);
  ipcMain.handle('computer:open', (e, payload = {}) => fromApp(e) ? computerHost.open(payload) : null);
  ipcMain.handle('computer:focus', (e, payload = {}) => fromApp(e) ? computerHost.focus(payload.id) : null);
  ipcMain.handle('computer:close', (e, payload = {}) => fromApp(e) ? computerHost.close(payload.id) : null);
  // Local UI
  ipcMain.handle('app:init', (e) => {
    if (!fromApp(e)) return null;
    return {
      mode, theme, platform: process.platform, version: app.getVersion(), origin: DEIZA_ORIGIN,
      auth: auth.state(), titlebarHeight: TITLEBAR_H, home: os.homedir(), material: MATERIAL,
      language: appLanguage(), updatedFrom,
    };
  });
  ipcMain.on('app:overlay', (e, open) => {
    if (!fromApp(e)) return;
    overlayOpen = Boolean(open);
    if (chatView) chatView.setVisible(chatVisible());
    if (!overlayOpen && chatVisible() && chatView) chatView.webContents.focus();
    buildMenu();
  });
  ipcMain.handle('app:mic-access', async (e) => {
    if (!fromApp(e)) return false;
    if (!IS_MAC) return true;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    if (status === 'denied' || status === 'restricted') return false;
    return systemPreferences.askForMediaAccess('microphone');
  });

  // Settings (Ajustes)
  ipcMain.handle('settings:get', (e) => {
    if (!fromApp(e)) return null;
    return {
      language: appLanguage(),
      shortcut: settings.get('shortcut') !== false,
      shortcutLabel: IS_MAC ? '⌥⌘Espacio' : 'Ctrl+Alt+Espacio',
      openAtLogin: loginItem(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    };
  });
  ipcMain.handle('settings:set', (e, { key, value } = {}) => {
    if (!fromApp(e)) return null;
    if (key === 'language') applyLanguage(String(value));
    else if (key === 'shortcut') { settings.set('shortcut', Boolean(value)); return { ok: applyShortcut() }; }
    else if (key === 'openAtLogin') { try { app.setLoginItemSettings({ openAtLogin: Boolean(value) }); } catch { /* unsupported */ } return { ok: true, value: loginItem() }; }
    else codeHost.setPref(key, value);
    return { ok: true };
  });
  ipcMain.handle('settings:check-updates', async (e) => (fromApp(e) ? updates.check({ quiet: true }) : null));

  // Account: the same endpoints the web's Settings page uses, with the app's session token.
  ipcMain.handle('account:get', async (e) => {
    if (!fromApp(e)) return null;
    const res = await api('GET', '/auth/me');
    if (!res.ok) return { error: res.status === 401 ? 'auth' : res.status ? 'server' : 'offline' };
    const u = res.body || {};
    const avatar = absUrl(u.avatar_url || u.picture || '');
    auth.set(auth.getToken(), { name: u.name || '', email: u.email || '', plan: u.plan || '', avatar });
    return { name: u.name || '', email: u.email || '', plan: u.plan || '', avatar, createdAt: u.created_at || '', chats: u.total_chats || 0 };
  });
  ipcMain.handle('account:set-name', async (e, name) => {
    if (!fromApp(e)) return null;
    const res = await api('PATCH', '/auth/me', { name: String(name || '').trim().slice(0, 100) });
    if (!res.ok) return { error: res.body.error || 'server' };
    const cur = auth.state().user || {};
    auth.set(auth.getToken(), { ...cur, name: res.body.name });
    refreshChatUser();
    return { ok: true, name: res.body.name };
  });
  ipcMain.handle('account:set-avatar', async (e, dataUrl) => {
    if (!fromApp(e)) return null;
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(String(dataUrl)) || String(dataUrl).length > 6 * 1024 * 1024) return { error: 'invalid' };
    const res = await api('PUT', '/api/profile', { avatar_base64: dataUrl });
    if (!res.ok) return { error: res.body.error || 'server' };
    const avatar = absUrl(res.body.avatar_url || '');
    const cur = auth.state().user || {};
    auth.set(auth.getToken(), { ...cur, avatar: avatar ? `${avatar}?v=${Date.now()}` : '' });
    refreshChatUser();
    return { ok: true, avatar: auth.state().user.avatar };
  });
  ipcMain.handle('account:skills', async (e) => {
    if (!fromApp(e)) return null;
    const res = await api('GET', '/api/skills');
    if (!res.ok) return { error: res.status === 401 ? 'auth' : 'server' };
    return res.body;
  });
  ipcMain.handle('account:save-skills', async (e, custom) => {
    if (!fromApp(e) || !Array.isArray(custom)) return null;
    const res = await api('POST', '/api/skills', { custom });
    codeHost.invalidateSkills();
    if (!res.ok) return { error: res.body.error || 'server' };
    return res.body;
  });
  ipcMain.on('app:set-mode', (e, next) => { if (fromApp(e) || fromChat(e)) setMode(next); });
  ipcMain.on('chat:go', (e, action) => {
    if (!fromApp(e) || !chatView) return;
    const wc = chatView.webContents;
    if (action === 'back') wc.navigationHistory.goBack();
    else if (action === 'forward') wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'home') wc.loadURL(`${DEIZA_ORIGIN}/workspace`);
    else if (action === 'login') { setMode('chat'); wc.loadURL(`${DEIZA_ORIGIN}/login`); }
    else if (action === 'plans') { setMode('chat'); wc.loadURL(`${DEIZA_ORIGIN}/plans`); }
    else if (action === 'settings') { setMode('chat'); wc.loadURL(`${DEIZA_ORIGIN}/settings`); }
  });
  ipcMain.on('shell:open-external', (e, url) => { if (fromApp(e)) openExternal(url); });
  ipcMain.on('shell:show-item', (e, p) => { if (fromApp(e) && typeof p === 'string') shell.showItemInFolder(p); });
  ipcMain.on('shell:open-path', (e, p) => { if (fromApp(e) && typeof p === 'string') shell.openPath(p); });
  ipcMain.on('app:update-download', (e) => { if (fromApp(e)) updates.openDownload(); });
  ipcMain.on('app:update-start', (e) => { if (fromApp(e)) updates.start(); });
  ipcMain.on('app:update-restart', (e) => { if (fromApp(e)) updates.restart(); });
  ipcMain.handle('app:update-state', (e) => (fromApp(e) ? updates.state() : null));

  // Chat view bridge
  ipcMain.on('chat:auth', (e, payload) => {
    if (!fromChat(e)) return;
    const token = payload && typeof payload.token === 'string' ? payload.token : '';
    auth.set(token, payload && payload.user);
  });
  ipcMain.on('chat:theme', (e, next) => { if (fromChat(e)) applyTheme(next); });
  ipcMain.handle('chat:update-state', (e) => (fromChat(e) ? updates.state() : null));
  ipcMain.on('chat:update-action', (e, action) => {
    if (!fromChat(e)) return;
    if (action === 'start') updates.start();
    else if (action === 'restart') updates.restart();
    else if (action === 'page') updates.openDownload();
  });
  ipcMain.on('chat:language', (e, lang) => { if (fromChat(e) && I18n.isLanguage(lang)) applyLanguage(lang, { fromChat: true }); });
  ipcMain.on('chat:retry', (e, url) => {
    if (!chatView || e.sender !== chatView.webContents) return;
    chatView.webContents.loadURL(isDeizaUrl(url) ? url : `${DEIZA_ORIGIN}/workspace`);
  });
  ipcMain.on('chat:notify', (e, payload) => {
    if (!fromChat(e) || !payload || win?.isFocused() || !Notification.isSupported()) return;
    const n = new Notification({ title: String(payload.title || 'Deiza').slice(0, 80), body: String(payload.body || '').slice(0, 200) });
    n.on('click', () => { showWindow(); setMode('chat'); });
    n.show();
  });

  // Native sign-in (same endpoints as deiza.org/login): email -> 6-digit code -> session token.
  ipcMain.handle('auth:request-code', async (e, email) => {
    if (!fromApp(e)) return null;
    const res = await postJson('/auth/magic-link', { email: String(email || '').trim().toLowerCase() });
    if (res.ok && res.body.token) { completeLogin(res.body.token, res.body.user); return { ok: true, done: true }; }
    if (res.ok) return { ok: true, devCode: res.body.dev_otp || '' };
    return { ok: false, status: res.status, error: res.body.error || '' };
  });
  ipcMain.handle('auth:verify', async (e, { email, code } = {}) => {
    if (!fromApp(e)) return null;
    const res = await postJson('/auth/magic-link/verify', { email: String(email || '').trim().toLowerCase(), token: String(code || '').trim() });
    if (res.ok && res.body.token) { completeLogin(res.body.token, res.body.user); return { ok: true }; }
    return { ok: false, status: res.status, error: res.body.error || '' };
  });
  ipcMain.handle('auth:logout', (e) => { if (fromApp(e)) logout(); return true; });
  // The chat preload runs before the page scripts: it copies the app session into the web's
  // storage so the workspace opens already signed in.
  ipcMain.on('chat:bootstrap', (e) => {
    e.returnValue = fromChat(e) ? { token: auth.getToken(), language: settings.get('language') || '' } : { token: '' };
  });

  auth.onChange((s) => {
    send('auth:changed', s);
    if (chatView) chatView.setVisible(chatVisible());
    buildMenu();
  });
  codeHost.setupIpc({ isTrusted: fromApp, getWindow: () => win, send, setMode });
}

function absUrl(u) {
  if (!u) return '';
  try { return new URL(u, DEIZA_ORIGIN).toString(); } catch { return ''; }
}

async function api(method, pathname, body) {
  const token = auth.getToken();
  if (!token) return { ok: false, status: 401, body: {} };
  try {
    const res = await net.fetch(`${DEIZA_ORIGIN}${pathname}`, {
      method,
      headers: { 'X-Auth-Token': token, 'X-Deiza-Client': 'desktop', 'User-Agent': userAgent(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: json || {} };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

/** After a profile change the web's cached user is stale: refresh it while the settings sheet covers it. */
function refreshChatUser() {
  if (!chatView || !isDeizaUrl(chatView.webContents.getURL())) return;
  chatView.webContents.executeJavaScript("try{localStorage.removeItem('deiza:user_cache')}catch(e){}")
    .then(() => chatView && chatView.webContents.reload())
    .catch(() => {});
}

async function postJson(pathname, body) {
  try {
    const res = await net.fetch(`${DEIZA_ORIGIN}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Deiza-Client': 'desktop', 'User-Agent': userAgent() },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: json };
  } catch {
    return { ok: false, status: 0, body: { error: 'offline' } };
  }
}

function completeLogin(token, user) {
  auth.set(token, user ? { name: user.name, email: user.email, plan: user.plan, avatar: absUrl(user.avatar_url || user.picture || '') } : null);
  state.set('lastChatPath', '');
  if (chatView) chatView.webContents.loadURL(`${DEIZA_ORIGIN}/workspace`);
  setMode(state.get('mode') === 'code' ? 'code' : 'chat');
}

async function logout() {
  const token = auth.getToken();
  if (token) {
    net.fetch(`${DEIZA_ORIGIN}/auth/logout`, { method: 'POST', headers: { 'X-Auth-Token': token } }).catch(() => {});
  }
  auth.set('', null);
  if (chatView && isDeizaUrl(chatView.webContents.getURL())) {
    try { await chatView.webContents.executeJavaScript("try{localStorage.removeItem('deiza:auth_token');localStorage.removeItem('deiza:user_cache')}catch(e){}"); } catch { /* page gone */ }
  }
  await session.fromPartition(PARTITION).clearStorageData({ storages: ['cookies'] }).catch(() => {});
  if (chatView) chatView.webContents.loadURL(`${DEIZA_ORIGIN}/login`);
}

function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ── lifecycle ──────────────────────────────────────────────────────────────────

app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  state = createStore('state', { mode: 'chat', theme: 'dark' });
  settings = createStore('settings', { language: '', shortcut: true });
  const prevVersion = state.get('lastVersion');
  if (prevVersion && prevVersion !== app.getVersion()) updatedFrom = prevVersion;
  state.set('lastVersion', app.getVersion());
  I18n.setLanguage(appLanguage());
  mode = state.get('mode') === 'code' ? 'code' : 'chat';
  theme = state.get('theme') === 'light' ? 'light' : 'dark';
  nativeTheme.themeSource = theme;
  auth.load();
  // Development/test only: start signed in with a given session token (ignored in packaged builds).
  if (!app.isPackaged && process.env.DEIZA_TEST_TOKEN) auth.set(process.env.DEIZA_TEST_TOKEN, { name: 'Prueba', email: 'test', plan: '' });

  // Opened from the disk image, Downloads or a translocated copy: offer to move to Applications,
  // otherwise it can't update itself and every launch starts from a read-only copy.
  if (offerMoveToApplications()) return;

  setupChatSession();
  setupAppSession();
  preview.register();
  codeHost.init({ origin: DEIZA_ORIGIN, auth, getLanguage: appLanguage });
  computerHost.init({ getOwner: () => win });
  setupIpc();
  buildMenu();
  createWindow();
  // The update state goes to both UIs: the local one (titlebar, Code) and the Chat web view, which
  // shows the same button next to the profile in the workspace sidebar.
  const sendUpdate = (channel, payload) => {
    send(channel, payload);
    if (channel === 'app:update-state' && chatView && !chatView.webContents.isDestroyed() && isDeizaUrl(chatView.webContents.getURL())) {
      chatView.webContents.send('desktop:update-state', payload);
    }
  };
  updates.init({ origin: DEIZA_ORIGIN, send: sendUpdate, getWindow: () => win, isBusy: () => codeHost.isBusy() });

  // Summon Deiza from anywhere (can be turned off in Ajustes).
  applyShortcut();

  app.on('activate', () => showWindow());
});

app.on('before-quit', () => {
  quitting = true;
  state?.flush();
  codeHost.shutdown();
  computerHost.shutdown();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });

// Deep links: deiza://open?path=/workspace  (registered on first run)
if (!app.isDefaultProtocolClient('deiza')) {
  try { app.setAsDefaultProtocolClient('deiza'); } catch { /* not critical */ }
}
app.on('open-url', (e, url) => {
  e.preventDefault();
  try {
    const u = new URL(url);
    const p = u.searchParams.get('path');
    showWindow();
    if (u.hostname === 'code') setMode('code');
    else if (p && p.startsWith('/') && chatView) { setMode('chat'); chatView.webContents.loadURL(`${DEIZA_ORIGIN}${p}`); }
  } catch { showWindow(); }
});

module.exports = { isDeizaUrl };
