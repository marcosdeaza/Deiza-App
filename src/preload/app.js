/** Preload for the local UI (titlebar + Code). Exposes a narrow, typed API as window.deiza. */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set([
  'app:mode', 'app:theme', 'app:update-state', 'app:fullscreen', 'app:focus', 'chat:nav', 'auth:changed',
  'download', 'code:event', 'code:sessions', 'code:command', 'app:language', 'app:open-settings',
]);
const inv = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('deiza', {
  init: inv('app:init'),
  setMode: (m) => ipcRenderer.send('app:set-mode', m),
  chatGo: (action) => ipcRenderer.send('chat:go', action),
  openExternal: (url) => ipcRenderer.send('shell:open-external', String(url)),
  showItem: (p) => ipcRenderer.send('shell:show-item', String(p)),
  openPath: (p) => ipcRenderer.send('shell:open-path', String(p)),
  update: {
    state: inv('app:update-state'),
    start: () => ipcRenderer.send('app:update-start'),
    restart: () => ipcRenderer.send('app:update-restart'),
    openPage: () => ipcRenderer.send('app:update-download'),
  },
  micAccess: inv('app:mic-access'),
  overlay: (open) => ipcRenderer.send('app:overlay', Boolean(open)),
  settings: {
    get: inv('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', { key: String(key), value }),
    checkUpdates: inv('settings:check-updates'),
  },
  account: {
    get: inv('account:get'),
    setName: (name) => ipcRenderer.invoke('account:set-name', String(name || '')),
    setAvatar: (dataUrl) => ipcRenderer.invoke('account:set-avatar', String(dataUrl || '')),
    skills: inv('account:skills'),
    saveSkills: (custom) => ipcRenderer.invoke('account:save-skills', custom),
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  on(channel, cb) {
    if (!EVENTS.has(channel)) throw new Error(`channel not allowed: ${channel}`);
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
  auth: {
    requestCode: (email) => ipcRenderer.invoke('auth:request-code', String(email || '')),
    verify: (email, code) => ipcRenderer.invoke('auth:verify', { email: String(email || ''), code: String(code || '') }),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  code: {
    list: inv('code:list'),
    get: inv('code:get'),
    create: inv('code:create'),
    pickFolder: inv('code:pick-folder'),
    send: inv('code:send'),
    abort: inv('code:abort'),
    approve: inv('code:approve'),
    setMode: inv('code:set-mode'),
    setModel: inv('code:set-model'),
    prefs: inv('code:prefs'),
    transcribe: inv('code:transcribe'),
    rename: inv('code:rename'),
    remove: inv('code:delete'),
    sessionMenu: inv('code:session-menu'),
    revert: inv('code:revert'),
    fsList: inv('code:fs-list'),
    fsRead: inv('code:fs-read'),
    fsReveal: inv('code:fs-reveal'),
    fsOpen: inv('code:fs-open'),
    usage: inv('code:usage'),
    openPreviewWindow: inv('code:open-preview-window'),
  },
});
