/** Browser controlled by Code. Remote pages have no preload, Node or app IPC bridge. */
'use strict';
const { BrowserWindow, WebContentsView, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const preview = require('./preview');
const I18n = require('../shared/i18n');

const TOOLBAR_HEIGHT = 52;
const TOOLBAR_FILE = path.join(__dirname, '../renderer/computer/index.html');
const TOOLBAR_URL = pathToFileURL(TOOLBAR_FILE).href;
const toolbarRoutes = new Map();
let toolbarIPCInstalled = false;
function installToolbarIPC() {
  if (toolbarIPCInstalled) return;
  toolbarIPCInstalled = true;
  for (const action of ['state', 'navigate', 'back', 'forward', 'reload', 'stop']) {
    ipcMain.handle(`computer-browser:${action}`, async (event, payload) => {
      const route = toolbarRoutes.get(event.sender.id);
      if (!route || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== TOOLBAR_URL) return { error: 'Acceso al navegador no permitido.' };
      return route(action, payload);
    });
  }
}

const MODS = { alt: 1, control: 2, ctrl: 2, meta: 4, command: 4, cmd: 4, shift: 8 };
const KEYS = { Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'],
  Delete: [46, 'Delete'], ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'],
  ArrowDown: [40, 'ArrowDown'], Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'], Space: [32, 'Space', ' '] };
const inside = (root, file) => { const rel = path.relative(root, file); return !rel.startsWith('..') && !path.isAbsolute(rel); };
const cleanText = (v, max = 300) => String(v || '').replace(/[\x00-\x08\x0b-\x1f]/g, '').slice(0, max);
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('Operación detenida'));
  const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Operación detenida')); };
  signal?.addEventListener('abort', abort, { once: true });
});

function createBrowserController({ getOwner = () => null, navigationTimeoutMs = 15000, commandTimeoutMs = 10000 } = {}) {
  installToolbarIPC();
  const tabs = new Map();
  const active = new Map();
  let sequence = 0;
  let elementSequence = 0;
  let shuttingDown = false;
  function scope(ctx = {}) { return String(ctx.sessionId || 'manual'); }
  function owned(ctx) {
    const key = scope(ctx);
    if (key !== 'manual' && ![...tabs.values()].some(t => t.owner === key)) {
      for (const t of tabs.values()) if (t.owner === 'manual') { t.owner = key; t.context = { sessionId: key, folder: ctx.folder }; active.set(key, t.id); }
    }
    return [...tabs.values()].filter(t => t.owner === key && !t.win.isDestroyed());
  }
  function select(args = {}, ctx = {}) {
    const list = owned(ctx);
    const id = args.tab_id || active.get(scope(ctx)) || list[list.length - 1]?.id;
    const tab = list.find(t => t.id === id);
    if (!tab) throw new Error('No hay una página abierta en esta sesión. Usa browser_open primero.');
    if (ctx.folder) tab.context.folder = ctx.folder;
    active.set(scope(ctx), tab.id);
    return tab;
  }
  function info(t) { return { tab_id: t.id, title: cleanText(t.wc.getTitle()), url: t.wc.getURL(), active: active.get(t.owner) === t.id }; }
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
  function toolbarState(t) {
    return { ...info(t), language: I18n.getLanguage(), loading: t.wc.isLoading(),
      canGoBack: t.wc.navigationHistory.canGoBack(), canGoForward: t.wc.navigationHistory.canGoForward(), error: t.error || '' };
  }
  function publish(t) {
    if (t.win.isDestroyed() || t.wc.isDestroyed() || t.win.webContents.isDestroyed()) return;
    t.win.webContents.send('computer-browser:state', toolbarState(t));
  }
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
        if (t.win.isDestroyed() || t.wc.isDestroyed()) throw new Error('El navegador se ha cerrado.');
        return task();
      }).then(result => finish(null, result), error => finish(error));
    });
  }
  function enqueue(t, task, signal) {
    const run = () => { if (signal?.aborted) throw new Error('Operación detenida'); return task(); };
    const result = t.queue.then(run, run);
    t.queue = result.catch(() => {});
    if (!signal) return result;
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Operación detenida')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      result.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  async function navigate(t, url, signal) {
    t.refs.clear(); t.error = '';
    try {
      await bound(t, () => t.wc.loadURL(url), signal, navigationTimeoutMs, () => t.wc.stop(), 'La página tardó demasiado en cargar. Vuelve a intentarlo.');
      if (signal?.aborted) throw new Error('Operación detenida');
    } catch (error) { t.error = cleanText(error.message, 250); throw error; }
    finally { publish(t); }
  }
  async function manual(t, action, value) {
    try {
      if (action === 'state') return toolbarState(t);
      if (action === 'stop') { t.wc.stop(); publish(t); return toolbarState(t); }
      return await enqueue(t, async () => {
        if (action === 'navigate') {
          const text = String(value || '').trim();
          const raw = /^[a-z][a-z0-9+.-]*:/i.test(text) || text === 'about:blank' ? text : `https://${text}`;
          await navigate(t, validateURL(raw, t.context));
        } else {
          const history = t.wc.navigationHistory;
          if (action === 'back' && history.canGoBack()) history.goBack();
          else if (action === 'forward' && history.canGoForward()) history.goForward();
          else if (action === 'reload') t.wc.reload();
          else return toolbarState(t);
          await bound(t, () => new Promise(resolve => {
            if (!t.wc.isLoading()) return resolve();
            t.wc.once('did-stop-loading', resolve);
          }), undefined, navigationTimeoutMs, () => t.wc.stop());
        }
        t.wc.focus(); publish(t); return toolbarState(t);
      });
    } catch (error) { t.error = cleanText(error.message, 250); publish(t); return { ...toolbarState(t), error: t.error }; }
  }
  function create(ctx = {}, inherited) {
    if (shuttingDown) throw new Error('Deiza se está cerrando.');
    const owner = inherited || scope(ctx);
    const parent = getOwner();
    const win = new BrowserWindow({ width: 1280, height: 860, title: 'Navegador · Deiza Code', show: true,
      autoHideMenuBar: true, backgroundColor: '#1c1917', ...(parent && !parent.isDestroyed() ? { parent } : {}),
      webPreferences: { preload: path.join(__dirname, '../preload/computer.js'), sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true },
    });
    const view = new WebContentsView({ webPreferences: { partition: 'persist:deiza-computer', sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true } });
    const wc = view.webContents;
    const t = { id: `tab_${++sequence}`, owner, win, view, wc, context: { sessionId: owner, folder: ctx.folder }, refs: new Map(), queue: Promise.resolve(), error: '' };
    win.contentView.addChildView(view);
    const layout = () => { const b = win.getContentBounds(); view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: b.width, height: Math.max(1, b.height - TOOLBAR_HEIGHT) }); };
    layout(); win.on('resize', layout);
    tabs.set(t.id, t); active.set(owner, t.id);
    toolbarRoutes.set(win.webContents.id, (action, value) => manual(t, action, value));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== TOOLBAR_URL) event.preventDefault(); });
    win.webContents.on('will-redirect', event => event.preventDefault());
    win.webContents.on('did-finish-load', () => publish(t));
    win.loadFile(TOOLBAR_FILE).catch(() => {});
    wc.loadURL('about:blank').catch(() => {});
    preview.register(wc.session);
    // No mic, camera, screen sharing or notifications are granted by an agent navigation.
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    wc.session.setPermissionCheckHandler(() => false);
    wc.on('will-navigate', (event, url) => {
      try { validateURL(url, t.context); } catch { event.preventDefault(); }
    });
    wc.on('will-redirect', (event, url) => {
      try { validateURL(url, t.context); } catch { event.preventDefault(); }
    });
    for (const event of ['did-navigate', 'did-navigate-in-page']) wc.on(event, () => { t.refs.clear(); t.error = ''; publish(t); });
    for (const event of ['did-start-loading', 'did-stop-loading', 'page-title-updated']) wc.on(event, () => publish(t));
    wc.setWindowOpenHandler(({ url }) => {
      try {
        const safe = validateURL(url, t.context);
        const child = create(t.context, t.owner);
        navigate(child, safe).catch(() => {});
      } catch { /* reject unknown protocols */ }
      return { action: 'deny' };
    });
    const toolbarId = win.webContents.id;
    win.on('closed', () => { toolbarRoutes.delete(toolbarId); if (!wc.isDestroyed()) wc.close(); tabs.delete(t.id); if (active.get(t.owner) === t.id) active.delete(t.owner); });
    win.on('focus', () => active.set(t.owner, t.id));
    return t;
  }
  async function command(t, name, params = {}, signal) {
    if (signal?.aborted) throw new Error('Operación detenida');
    if (t.win.isDestroyed()) throw new Error('El navegador se ha cerrado.');
    const debug = t.wc.debugger;
    if (!debug.isAttached()) debug.attach('1.3');
    const result = await bound(t, () => debug.sendCommand(name, params), signal, commandTimeoutMs, () => { t.refs.clear(); if (debug.isAttached()) debug.detach(); }, 'La página tardó demasiado en responder. Actualiza su estado.');
    if (signal?.aborted) throw new Error('Operación detenida');
    return result;
  }
  async function snapshot(t, ctx = {}) {
    const { nodes = [] } = await command(t, 'Accessibility.getFullAXTree', {}, ctx.signal);
    t.refs.clear();
    const elements = [], lines = [];
    const actionable = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', 'switch', 'slider', 'spinbutton', 'searchbox', 'treeitem', 'option']);
    for (const n of nodes) {
      if (n.ignored) continue;
      const role = cleanText(n.role?.value, 60), name = cleanText(n.name?.value, 500);
      if (!name && !actionable.has(role)) continue;
      const props = Object.fromEntries((n.properties || []).map(p => [p.name, p.value?.value]));
      if (actionable.has(role) && n.backendDOMNodeId && elements.length < 250) {
        const id = `e${++elementSequence}`;
        t.refs.set(id, { backendNodeId: n.backendDOMNodeId, role, name });
        const el = { element_id: id, role, name, ...(props.disabled ? { disabled: true } : {}),
          ...(props.checked !== undefined ? { checked: props.checked } : {}), ...(props.expanded !== undefined ? { expanded: props.expanded } : {}) };
        elements.push(el); lines.push(`[${id}] ${role} ${name}`);
      } else if (name) lines.push(`${role}: ${name}`);
      if (lines.join('\n').length >= 18000) break;
    }
    const size = t.win.webContents.getViewBounds?.() || t.win.getContentBounds();
    return { ...info(t), text: lines.join('\n').slice(0, 20000), elements, viewport: { width: size.width, height: size.height },
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
    const wc = t.win.webContents;
    const bounds = t.win.getContentBounds();
    const image = (await wc.capturePage()).resize({ width: bounds.width, height: bounds.height });
    const buf = image.toPNG();
    let saved;
    if (args.path) {
      if (!ctx.folder || path.isAbsolute(args.path)) throw new Error('Guarda la captura con una ruta relativa al proyecto.');
      saved = path.resolve(ctx.folder, args.path);
      if (!inside(path.resolve(ctx.folder), saved)) throw new Error('La captura debe guardarse dentro del proyecto.');
      fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.writeFileSync(saved, buf);
    }
    return { ...info(t), mime_type: 'image/png', width: image.getSize().width, height: image.getSize().height,
      coordinate_space: 'viewport', data_url: `data:image/png;base64,${buf.toString('base64')}`, ...(saved ? { path: saved } : {}) };
  }
  async function operate(t, name, args, ctx) {
    const signal = ctx.signal;
    t.win.show();
    if (name === 'browser_snapshot') return snapshot(t, ctx);
    if (name === 'browser_screenshot') return screenshot(t, args, ctx);
    if (name === 'browser_close') { t.win.close(); return { closed: t.id }; }
    t.win.focus();
    if (name === 'browser_click') {
      let x = Number(args.x), y = Number(args.y);
      if (args.element_id) {
        const box = await onElement(t, args.element_id, 'function(){this.scrollIntoView({block:"center",inline:"center",behavior:"instant"}); const r=this.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,disabled:this.disabled};}', signal);
        if (!box || box.disabled || !box.width || !box.height) throw new Error('El elemento está oculto o desactivado.');
        x = box.x; y = box.y;
      }
      const b = t.win.getContentBounds();
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= b.width || y >= b.height) throw new Error('El clic debe estar dentro de la captura del navegador.');
      const button = ['left', 'right', 'middle'].includes(args.button) ? args.button : 'left';
      const mask = modifierMask(args.modifiers || []);
      const count = args.click_count === 2 ? 2 : 1;
      await command(t, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, signal);
      for (let i = 1; i <= count; i++) {
        await command(t, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: i, modifiers: mask }, signal);
        await command(t, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: i, modifiers: mask }, signal);
      }
    } else if (name === 'browser_type') {
      const text = String(args.text || '');
      if (text.length > 100000) throw new Error('El texto es demasiado largo; introdúcelo por partes.');
      if (args.element_id) await onElement(t, args.element_id, 'function(){this.scrollIntoView({block:"center",behavior:"instant"}); this.focus(); return document.activeElement===this || this.contains(document.activeElement);}', signal);
      if (args.replace !== false) { await press(t, process.platform === 'darwin' ? 'Meta+A' : 'Control+A', [], signal); await press(t, 'Backspace', [], signal); }
      await command(t, 'Input.insertText', { text }, signal);
    } else if (name === 'browser_key') {
      await press(t, args.key, args.modifiers, signal);
    } else if (name === 'browser_scroll') {
      const dy = Number(args.delta_y || 0), dx = Number(args.delta_x || 0);
      if (!Number.isFinite(dy) || !Number.isFinite(dx) || Math.abs(dy) > 20000 || Math.abs(dx) > 20000) throw new Error('Desplazamiento no válido.');
      const b = t.win.getContentBounds();
      await command(t, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.width / 2, y: b.height / 2, deltaX: dx, deltaY: dy }, signal);
    } else throw new Error('Acción de navegador desconocida.');
    await wait(180, signal);
    return snapshot(t, ctx);
  }
  async function execute(name, args = {}, ctx = {}) {
    try {
      if (ctx.signal?.aborted) throw new Error('Operación detenida');
      if (name === 'browser_tabs') return { tabs: owned(ctx).map(info) };
      if (name === 'browser_open') {
        const url = validateURL(args.url, ctx);
        const existing = owned(ctx);
        const t = args.new_tab || !existing.length ? create(ctx) : select(args, ctx);
        const run = async () => {
          t.win.show(); t.win.focus();
          await t.win.loadURL(url);
          await wait(150, ctx.signal);
          return snapshot(t, ctx);
        };
        const p = t.queue.then(run, run); t.queue = p.catch(() => {}); return await p;
      }
      const t = select(args, ctx);
      const run = () => operate(t, name, args, ctx);
      const p = t.queue.then(run, run); t.queue = p.catch(() => {}); return await p;
    } catch (err) { return { error: cleanText(err.message, 700) }; }
  }
  function state(id) { const ctx = { sessionId: id }; return { available: true, tabs: owned(ctx).map(info) }; }
  async function open(payload = {}) { return execute('browser_open', { url: payload.url || 'about:blank', new_tab: false }, { sessionId: payload.id }); }
  function focus(id) { try { const t = select({}, { sessionId: id }); t.win.show(); t.win.focus(); return info(t); } catch (err) { return { error: err.message }; } }
  function close(id) { for (const t of owned({ sessionId: id })) t.win.close(); return { ok: true }; }
  function shutdown() { shuttingDown = true; for (const t of tabs.values()) if (!t.win.isDestroyed()) t.win.destroy(); tabs.clear(); }
  return { execute, state, open, focus, close, shutdown };
}
module.exports = { createBrowserController };
