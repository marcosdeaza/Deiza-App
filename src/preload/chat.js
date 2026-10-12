/**
 * Preload for the remote Chat view (deiza.org). Deliberately small:
 *   - window.deizaDesktop lets the web adapt (hide the download button, open Code mode)
 *   - reports the signed-in session and the theme to the app, so Code mode shares the login
 *   - the offline page gets a retry hook
 */
const { contextBridge, ipcRenderer } = require('electron');

const onDeiza = () => location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const version = (/DeizaDesktop\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || '';

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('deizaOffline', { retry: (url) => ipcRenderer.send('chat:retry', String(url || '')) });
} else {
  contextBridge.exposeInMainWorld('deizaDesktop', {
    isDesktop: true,
    platform: process.platform,
    version,
    openCode: () => ipcRenderer.send('app:set-mode', 'code'),
    notify: (title, body) => ipcRenderer.send('chat:notify', { title: String(title || ''), body: String(body || '') }),
    // local browser v1: Deiza Work's browser runs on this computer (full screen, Deiza's pointer)
    workBrowser: (payload) => ipcRenderer.invoke('chat:work-browser', payload),
    workBrowserFocus: (chatId, url) => ipcRenderer.invoke('chat:work-browser-focus', Number(chatId) || 0, String(url || '')),
    // work continuity v1: the Work job's activity for the browser's Deiza panel, and what you write there
    workSay: (chatId, item) => ipcRenderer.send('chat:work-say', Number(chatId) || 0, { kind: String(item?.kind || ''), text: String(item?.text || '') }),
    workState: (chatId, state) => ipcRenderer.send('chat:work-state', Number(chatId) || 0, {
      running: Boolean(state?.running), model: String(state?.model || ''), effort: String(state?.effort || ''),
    }),
    workSteerResult: (requestId, result) => ipcRenderer.send('chat:work-steer-result', String(requestId || ''), {
      ok: result?.ok === true, queued: result?.queued === true, idle: result?.idle === true, error: String(result?.error || '').slice(0, 200),
    }),
    onWorkSteer: (cb) => {
      const fn = (_e, id, text, options) => { try { cb(Number(id), String(text || ''), options || {}); } catch { /* page handler */ } };
      ipcRenderer.on('desktop:work-steer', fn);
      return () => ipcRenderer.removeListener('desktop:work-steer', fn);
    },
    onWorkStop: (cb) => {
      const fn = (_e, id) => { try { cb(Number(id)); } catch { /* page handler */ } };
      ipcRenderer.on('desktop:work-stop', fn);
      return () => ipcRenderer.removeListener('desktop:work-stop', fn);
    },
    // App updates, so the workspace can show the same "Actualizar" button as the Code sidebar.
    update: {
      state: () => ipcRenderer.invoke('chat:update-state'),
      start: () => ipcRenderer.send('chat:update-action', 'start'),
      restart: () => ipcRenderer.send('chat:update-action', 'restart'),
      openPage: () => ipcRenderer.send('chat:update-action', 'page'),
      onChange: (cb) => {
        const fn = (_e, s) => { try { cb(s); } catch { /* page handler */ } };
        ipcRenderer.on('desktop:update-state', fn);
        return () => ipcRenderer.removeListener('desktop:update-state', fn);
      },
    },
  });
}

if (onDeiza()) {
  // Runs before the page scripts: an app session (native sign-in) is copied into the web's
  // storage so deiza.org boots signed in with the same account.
  try {
    const boot = ipcRenderer.sendSync('chat:bootstrap') || {};
    if (boot.token && localStorage.getItem('deiza:auth_token') !== boot.token) localStorage.setItem('deiza:auth_token', boot.token);
    if (boot.language && localStorage.getItem('deiza-language') !== boot.language) localStorage.setItem('deiza-language', boot.language);
  } catch { /* storage unavailable */ }

  let lastAuth = null;
  let lastTheme = null;
  let lastLang = null;

  const readUser = () => {
    try {
      const u = JSON.parse(localStorage.getItem('deiza:user_cache') || 'null');
      const avatar = u && (u.avatar_url || u.picture || '');
      return u ? { name: u.name || '', email: u.email || '', plan: u.plan || '', avatar: avatar ? new URL(avatar, location.origin).toString() : '' } : null;
    } catch {
      return null;
    }
  };

  const report = () => {
    let token = '';
    try { token = localStorage.getItem('deiza:auth_token') || ''; } catch { /* storage blocked */ }
    const user = token ? readUser() : null;
    const key = `${token}|${JSON.stringify(user)}`;
    if (key !== lastAuth) {
      lastAuth = key;
      ipcRenderer.send('chat:auth', { token, user });
    }
    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    if (theme !== lastTheme) {
      lastTheme = theme;
      ipcRenderer.send('chat:theme', theme);
    }
    const lang = (document.documentElement.lang || '').slice(0, 2);
    if (lang && lang !== lastLang) {
      if (lastLang !== null) ipcRenderer.send('chat:language', lang);
      lastLang = lang;
    }
  };

  const start = () => {
    report();
    new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'lang'] });
    setInterval(report, 1200);
    document.documentElement.classList.add('deiza-desktop', `deiza-desktop-${process.platform}`);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
