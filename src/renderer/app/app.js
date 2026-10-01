/* Deiza desktop — local UI: titlebar for both modes and the whole Code interface. */
/* global deiza, marked, DOMPurify, hljs, DeizaTranscript, DeizaI18n */
'use strict';

const T = (key, params) => DeizaI18n.T(key, params);

// ── tiny DOM helpers ──────────────────────────────────────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>',
  attach: '<path d="m8 13 7.5-7.5a3.5 3.5 0 0 1 5 5L10 21a5 5 0 0 1-7-7L14 3"/><path d="m6 16 10-10"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  reveal: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v5M9.5 13.5 12 11l2.5 2.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  gear: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.54 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.54V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.54 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"/>',
  spark: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
};
const icon = (name, cls = 'i') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = ICONS[name] || '';
  return s;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
const locale = () => (DeizaI18n.uiLanguage() === 'es' ? 'es-ES' : 'en-US');
const num = (n) => Number(n || 0).toLocaleString(locale());
function ago(ts) {
  const d = Date.now() - ts;
  if (d < 60e3) return T('ahora');
  if (d < 3600e3) return `${Math.floor(d / 60e3)} min`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)} h`;
  if (d < 2 * 86400e3) return T('ayer');
  return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}
function toast(text, ms = 3200) {
  const t = h('div', { class: 'toast', text });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
const tildeHome = (p) => (S.home && p.startsWith(S.home) ? `~${p.slice(S.home.length)}` : p);

// ── state ─────────────────────────────────────────────────────────────────────

const S = {
  mode: 'chat', theme: 'dark', platform: 'darwin', home: '', auth: { signedIn: false, user: null },
  sessions: [], recents: [], cur: null, loading: null,
  pendingFolder: null, defaultMode: localStorage.getItem('deiza:code:mode') || 'build',
  model: 'deiza-solid-5', effort: 'medium', language: 'es',
  drafts: new Map(), images: [], attachments: [], attachmentDrafts: new Map(), attachmentPending: 0,
  status: null, statusTimer: null,
  usage: null,
  panel: { open: localStorage.getItem('deiza:panel') === '1', tab: 'files', file: null, view: 'page', url: '', tree: new Map(), expanded: new Set(), width: Number(localStorage.getItem('deiza:panel:w')) || 0 },
  openTools: new Set(),
  renaming: null,
  afterglow: 0,
};
const itemEls = new Map();

// Code models and effort levels (ids match the engine)
const MODELS = [
  { id: 'deiza-solid-5', name: 'Solid 5', tag: 'El más capaz · 1M de contexto', desc: 'Metódico: planifica, verifica y resuelve lo difícil. Contexto de 1M, ve imágenes.', badge: 'Recomendado' },
  { id: 'deiza-omniscient', name: 'Liquid 5.1', tag: 'Equilibrado y agéntico', desc: 'Rápido y equilibrado, contexto de 256K. Ve imágenes.', badge: null },
  { id: 'deiza-gas-4.5', name: 'Gas 4.5', tag: 'Instantáneo', desc: 'El más rápido, para cambios pequeños.', badge: null },
];
const EFFORTS = [
  { id: 'low',    name: 'Bajo',        desc: 'Rápido y directo: lo justo para resolverlo.' },
  { id: 'medium', name: 'Medio',       desc: 'Equilibrio entre velocidad y cuidado. Recomendado.' },
  { id: 'high',   name: 'Alto',        desc: 'Razona más, lee el código antes de tocarlo y verifica lo que cambia.' },
  { id: 'ultra',  name: 'Ultra',       desc: 'Planifica a fondo, prueba y revisa su propio diff antes de terminar.' },
  { id: 'max',    name: 'Omnisciente', desc: 'Máximo razonamiento autónomo: razona, ejecuta, evalúa en bucle. Más lento y gasta más.' },
];
const MODEL_ALIASES = { 'deiza-solid-4.6': 'deiza-solid-5', 'deiza-solid-4.5': 'deiza-solid-5', 'deiza-gas-4.1': 'deiza-gas-4.5', 'deiza-liquid-5': 'deiza-omniscient', 'deiza-liquid-5.1': 'deiza-omniscient', 'deiza-vainilla': 'deiza-gas-4.5' };
const modelInfo = (id) => MODELS.find(m => m.id === (MODEL_ALIASES[id] || id)) || MODELS[0];
const effortInfo = (id) => EFFORTS.find(e => e.id === id) || EFFORTS[1];
const effortLevel = (id) => Math.max(1, EFFORTS.findIndex(e => e.id === id) + 1);

// ── titlebar & mode ───────────────────────────────────────────────────────────

function applyMode(mode) {
  S.mode = mode;
  document.body.classList.toggle('mode-chat', mode === 'chat');
  document.body.classList.toggle('mode-code', mode === 'code');
  $('#seg-chat').setAttribute('aria-pressed', String(mode === 'chat'));
  $('#seg-code').setAttribute('aria-pressed', String(mode === 'code'));
  $('#tb-nav').classList.toggle('hidden', mode !== 'chat');
  $('#tb-code-left').classList.toggle('hidden', mode !== 'code');
  renderTitle();
  if (mode === 'code') {
    refreshUsage();
    setTimeout(() => $('#composer-wrap textarea, .hero textarea')?.focus(), 30);
  }
}

function applyTheme(theme) {
  S.theme = theme;
  document.documentElement.dataset.theme = theme;
}

function renderTitle() {
  const el = $('#tb-title');
  el.innerHTML = '';
  if (S.mode === 'code' && S.cur) {
    el.append(h('b', { text: S.cur.title }), `  ·  ${basename(S.cur.folder)}`);
  }
}

function initTitlebar() {
  $('#seg-chat').onclick = () => deiza.setMode('chat');
  $('#seg-code').onclick = () => deiza.setMode('code');
  $('#tb-back').onclick = () => deiza.chatGo('back');
  $('#tb-forward').onclick = () => deiza.chatGo('forward');
  $('#tb-reload').onclick = () => deiza.chatGo('reload');
  $('#tb-sidebar').onclick = toggleSidebar;
  deiza.on('chat:nav', (n) => {
    $('#tb-back').disabled = !n.canGoBack;
    $('#tb-forward').disabled = !n.canGoForward;
    // The loader under the web view only exists while a page is loading (an endless animation
    // behind the view kept the window recompositing for nothing).
    document.body.classList.toggle('chat-loading', Boolean(n.loading));
  });
  const downloads = new Map();
  deiza.on('download', (d) => {
    const pill = $('#tb-download');
    downloads.set(d.id, d);
    pill.classList.remove('hidden');
    pill.innerHTML = '';
    if (d.state === 'progressing') {
      const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
      const bar = h('span', { class: 'bar' }, h('i', { style: { width: `${pct}%` } }));
      pill.append(bar, h('span', { text: d.name }));
      pill.onclick = null;
    } else if (d.state === 'completed') {
      pill.append(icon('check'), h('span', { text: d.name }));
      pill.title = 'Mostrar en la carpeta';
      pill.onclick = () => deiza.showItem(d.path);
      clearTimeout(pill._t);
      pill._t = setTimeout(() => pill.classList.add('hidden'), 12000);
    } else {
      pill.append(h('span', { text: `No se pudo descargar ${d.name}` }));
      clearTimeout(pill._t);
      pill._t = setTimeout(() => pill.classList.add('hidden'), 6000);
    }
  });
  deiza.on('app:update-state', applyUpdateState);
  deiza.update.state().then((u) => { if (!(u && u.state && u.state !== 'idle') && S.updatedFrom) showUpdated(); else applyUpdateState(u); });
  deiza.on('app:fullscreen', (fs) => document.body.classList.toggle('fullscreen', fs));
}

// ── updates ───────────────────────────────────────────────────────────────────
// One state from the main process drives the titlebar button, the row next to the profile
// and the "Acerca de" page: available → downloading → ready (restart) → installing.

function updateAction() {
  const u = S.update || {};
  if (u.state === 'available') deiza.update.start();
  else if (u.state === 'ready') deiza.update.restart();
  else if (u.state === 'error') deiza.update.openPage();
}

function updateLabel(u, long) {
  switch (u.state) {
    case 'available': return long ? T('Actualizar a {v}', { v: u.version }) : T('Actualizar');
    case 'downloading': return T('Descargando {p} %', { p: u.pct || 0 });
    case 'ready': return u.method === 'open' ? T('Abrir el instalador') : T('Reiniciar para actualizar');
    case 'installing': return T('Actualizando…');
    case 'error': return T('No se pudo actualizar');
    default: return '';
  }
}

function updateButton(u, cls, long) {
  const b = h('button', { class: `${cls} upd-${u.state}`, title: u.state === 'error' ? `${u.error || ''} · ${T('Abrir la página de descarga')}` : (u.notes || T('Deiza {v}', { v: u.version || '' })) });
  if (u.state === 'downloading') b.append(h('span', { class: 'upd-ring', style: { '--p': `${u.pct || 0}` } }));
  else if (u.state === 'installing') b.append(h('span', { class: 'spin' }));
  else b.append(h('span', { class: 'upd-light' }));
  b.append(h('span', { class: 'upd-txt', text: updateLabel(u, long) }));
  b.disabled = ['downloading', 'installing'].includes(u.state);
  b.onclick = updateAction;
  return b;
}

/** First launch after an update: a quiet confirmation in the titlebar (visible in Chat and Code). */
function showUpdated() {
  const slot = $('#tb-update');
  slot.innerHTML = '';
  slot.append(h('span', { class: 'upd-pill upd-done' }, icon('check'), h('span', { class: 'upd-txt', text: T('Actualizada a la {v}', { v: S.version }) })));
  slot.classList.remove('hidden');
  setTimeout(() => { if (!S.update) slot.classList.add('hidden'); }, 7000);
}

function applyUpdateState(u) {
  S.update = u && u.state && u.state !== 'idle' ? u : null;
  const slot = $('#tb-update');
  slot.innerHTML = '';
  slot.classList.toggle('hidden', !S.update);
  if (S.update) slot.append(updateButton(S.update, 'upd-pill', false));
  renderAccount();
  if (typeof ST !== 'undefined' && ST.open && ST.section === 'about') renderSettings();
}

// ── welcome & sign-in ─────────────────────────────────────────────────────────

function applyAuth() {
  const out = !S.auth.signedIn;
  if (out && typeof closeSettings === 'function') closeSettings();
  document.body.classList.toggle('signed-out', out);
  if (out) renderWelcome();
  else $('#welcome').innerHTML = '';
}

function renderWelcome(step = 'email', email = '') {
  const root = $('#welcome');
  root.innerHTML = '';
  const card = h('div', { class: 'welcome-card' });
  card.append(DeizaRose(76, { className: 'breathe' }), h('div', { class: 'wordmark', text: 'Deiza' }));
  const msg = h('div', { class: 'msg' });
  const setMsg = (text, err) => { msg.textContent = text || ''; msg.classList.toggle('err', Boolean(err)); };
  const errText = (r) => {
    if (!r || r.status === 0) return 'Sin conexión con deiza.org. Revisa tu red.';
    if (r.status === 429) return r.error === 'otp_locked' ? 'Demasiados códigos incorrectos. Pide uno nuevo en unos minutos.' : 'Demasiados intentos. Espera un minuto.';
    if (r.status === 400 && /email/i.test(r.error || '')) return 'Escribe un email válido.';
    if (r.status === 401) return r.error || 'Código incorrecto.';
    if (r.error && !/^[A-Z][a-z]+ [a-z]/.test(r.error)) return r.error;   // Spanish server messages pass through
    return `No se pudo completar (error ${r.status || 'de red'}). Inténtalo de nuevo.`;
  };

  if (step === 'email') {
    card.append(h('div', { class: 'sub', text: 'El workspace y Deiza Code, en tu escritorio.' }));
    const input = h('input', { class: 'field', type: 'email', placeholder: 'tu@email.com', autocomplete: 'email', value: email, spellcheck: 'false' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Continuar');
    const form = h('form', { novalidate: true }, input, btn, msg);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(value)) { setMsg('Escribe un email válido.', true); return; }
      btn.disabled = true;
      setMsg('Enviando el código…');
      const r = await deiza.auth.requestCode(value);
      btn.disabled = false;
      if (r && r.ok && r.done) return;              // accounts without code: already signed in
      if (r && r.ok) return renderWelcome('code', value);
      setMsg(errText(r), true);
    };
    card.append(form, h('div', { class: 'legal' }, 'Sin contraseña: te enviamos un código de 6 cifras. Si es tu primera vez, la cuenta se crea al entrar. Al continuar aceptas las ',
      h('button', { onclick: () => deiza.openExternal('https://deiza.org/legal/terminos') }, 'condiciones'), ' y la ',
      h('button', { onclick: () => deiza.openExternal('https://deiza.org/legal/privacidad') }, 'privacidad'), '.'));
    root.append(card);
    setTimeout(() => input.focus(), 60);
    return;
  }

  card.append(h('div', { class: 'sub' }, 'Código enviado a ', h('b', { text: email })));
  const boxes = Array.from({ length: 6 }, () => h('input', { inputmode: 'numeric', maxlength: '1', autocomplete: 'one-time-code' }));
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Entrar');
  const form = h('form', null, h('div', { class: 'otp' }, boxes), btn, msg);
  const code = () => boxes.map(b => b.value).join('');
  const submit = async () => {
    if (code().length !== 6) { setMsg('Faltan cifras.', true); return; }
    btn.disabled = true;
    setMsg('Comprobando…');
    const r = await deiza.auth.verify(email, code());
    btn.disabled = false;
    if (r && r.ok) { setMsg(''); return; }
    setMsg(errText(r), true);
    for (const b of boxes) b.value = '';
    boxes[0].focus();
  };
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      const digits = b.value.replace(/\D/g, '');
      if (digits.length > 1) {                     // pasted the whole code
        digits.slice(0, 6).split('').forEach((d, j) => { if (boxes[j]) boxes[j].value = d; });
        boxes[Math.min(5, digits.length - 1)].focus();
      } else {
        b.value = digits;
        if (digits && boxes[i + 1]) boxes[i + 1].focus();
      }
      if (code().length === 6) submit();
    });
    b.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !b.value && boxes[i - 1]) boxes[i - 1].focus(); });
  });
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  card.append(form, h('div', { class: 'alt' },
    h('button', { class: 'link-btn', onclick: () => renderWelcome('email', email) }, 'Usar otro email'),
    h('button', { class: 'link-btn', onclick: async () => { const r = await deiza.auth.requestCode(email); setMsg(r && r.ok ? 'Código reenviado.' : errText(r), !(r && r.ok)); } }, 'Reenviar código')));
  root.append(card);
  setTimeout(() => boxes[0].focus(), 60);
}

// ── sidebar ───────────────────────────────────────────────────────────────────

function toggleSidebar() {
  document.body.classList.toggle('sidebar-closed');
  localStorage.setItem('deiza:sidebar', document.body.classList.contains('sidebar-closed') ? '0' : '1');
}

function renderSidebar() {
  const list = $('#sb-list');
  list.innerHTML = '';
  if (!S.sessions.length) {
    list.append(h('div', { class: 'sb-kicker', text: 'Sesiones' }),
      h('div', { class: 'pn-empty', style: { padding: '8px 10px', textAlign: 'left', color: 'hsl(var(--muted-fg))' }, text: 'Aún no hay sesiones. Elige una carpeta y pide lo que necesites.' }));
  } else {
    list.append(h('div', { class: 'sb-kicker', text: 'Proyectos' }));
    const groups = new Map();
    for (const s of S.sessions) {
      if (!groups.has(s.folder)) groups.set(s.folder, []);
      groups.get(s.folder).push(s);
    }
    for (const [folder, sessions] of groups) {
      const add = h('span', { class: 'add', title: 'Nueva sesión en esta carpeta', role: 'button' }, icon('plus'));
      add.addEventListener('click', (e) => { e.stopPropagation(); startNew(folder); });
      const head = h('button', { class: 'sb-folder-head', title: tildeHome(folder) }, icon('folder'), h('span', { text: basename(folder) }), add);
      head.onclick = () => startNew(folder);
      const box = h('div', { class: 'sb-folder' }, head);
      for (const s of sessions.slice(0, 30)) box.append(sessionRow(s));
      list.append(box);
    }
  }
  renderAccount();
}

function sessionRow(s) {
  if (S.renaming === s.id) {
    const input = h('input', { class: 'sb-rename', value: s.title });
    const done = async (save) => {
      if (S.renaming !== s.id) return;
      S.renaming = null;
      if (save && input.value.trim() && input.value.trim() !== s.title) await deiza.code.rename({ id: s.id, title: input.value.trim() });
      renderSidebar();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return h('div', { style: { padding: '3px 8px 3px 24px' } }, input);
  }
  const row = h('button', { class: `sb-item${S.cur && S.cur.id === s.id ? ' active' : ''}`, title: s.title },
    s.running ? h('span', { class: 'dot-run', title: 'Trabajando' }) : null,
    h('span', { class: 't', text: s.title }),
    h('span', { class: 'when', text: ago(s.updatedAt) }));
  row.onclick = () => openSession(s.id);
  row.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const action = await deiza.code.sessionMenu(s.id);
    if (action === 'rename') { S.renaming = s.id; renderSidebar(); }
    if (action === 'delete') {
      const ok = await deiza.code.remove(s.id);
      if (ok && S.cur && S.cur.id === s.id) { S.cur = null; renderThread(); }
    }
  });
  row.addEventListener('dblclick', () => { S.renaming = s.id; renderSidebar(); });
  return row;
}

function renderAccount() {
  const foot = $('#sb-foot');
  foot.innerHTML = '';
  if (!S.auth.signedIn) return;
  const u = S.auth.user || {};
  const plan = (S.usage && S.usage.plan) || u.plan || '';
  const initial = (u.name || u.email || 'D').trim().charAt(0).toUpperCase();
  if (S.update) foot.append(updateButton(S.update, 'upd-row', true));
  foot.append(h('div', { class: 'acct', title: T('Ajustes de la cuenta'), onclick: (e) => { if (!e.target.closest('.icon-btn')) openSettings('account'); } },
    u.avatar ? h('img', { class: 'avatar', src: u.avatar, alt: '' }) : h('div', { class: 'avatar', text: initial }),
    h('div', { class: 'who' }, h('div', { class: 'name', text: u.name || u.email || 'Tu cuenta' }), u.name && u.email ? h('div', { class: 'mail', text: u.email }) : null),
    plan ? h('span', { class: 'plan-tag', text: plan }) : null,
    h('button', { class: 'icon-btn', title: T('Ajustes'), onclick: () => openSettings() }, icon('gear'))));

  const us = S.usage;
  if (us && !us.error && us.token_limit) {
    const pct = Math.min(100, Math.round(us.pct != null ? us.pct : (us.tokens_used / us.token_limit) * 100));
    const wk = Math.round(us.weekly_pct || 0);
    const reset = us.reset_in_seconds ? T('se renueva en {t}', { t: fmtDuration(us.reset_in_seconds * 1000) }) : '';
    const state = us.state || (pct >= 100 ? 'exhausted' : pct >= 85 ? 'warning' : 'ok');
    const label = state === 'grace' ? T('Cortesía') : state === 'exhausted' ? T('Agotado') : `${pct} %`;
    foot.append(h('div', { class: `meter ${state}`, title: T('Ventana de 5 horas: {p} %. Semana: {w} %. El uso cuenta lo que lees y escribes, incluido el contexto y el razonamiento.', { p: pct, w: wk }) },
      h('div', { class: 'row' }, h('span', { text: us.limit_scope === 'weekly' ? T('Uso · semana') : T('Uso · ventana de 5 h') }), h('span', { text: label })),
      h('div', { class: 'track' }, h('div', { class: `fill${pct >= 85 ? ' hot' : ''}`, style: { width: `${pct}%` } })),
      h('div', { class: 'row' }, h('span', { text: reset }), wk ? h('span', { text: T('semana {w} %', { w: wk }) }) : null)));
  } else if (us && us.error === 'plan') {
    foot.append(h('button', { class: 'btn ghost small', onclick: () => deiza.chatGo('plans') }, 'Deiza Code: ver planes'));
  }
}

async function refreshUsage() {
  if (!S.auth.signedIn) { S.usage = null; renderAccount(); return; }
  try { S.usage = await deiza.code.usage(); } catch { S.usage = null; }
  if (S.usage && S.usage.error === 'auth') S.usage = null;
  renderAccount();
  if (!S.cur) renderThread();
}

async function refreshSessions() {
  const r = await deiza.code.list();
  S.sessions = r.sessions || [];
  S.recents = r.recents || [];
  if (S.cur) {
    const m = S.sessions.find(s => s.id === S.cur.id);
    if (m) { S.cur.title = m.title; S.cur.running = m.running; }
  }
  renderSidebar();
  return r;
}

// ── sessions ──────────────────────────────────────────────────────────────────

async function openSession(id) {
  if (S.cur && S.cur.id === id) return;
  saveDraft();
  S.images = [];
  const oldAtts = $('#composer-wrap .atts, .start .atts');
  if (oldAtts) { oldAtts.innerHTML = ''; oldAtts.classList.add('hidden'); }
  S.loading = id;
  const doc = await deiza.code.get(id);
  if (S.loading !== id) return;
  S.loading = null;
  if (!doc) { toast('No se encontró la sesión'); return; }
  S.cur = { ...doc, running: doc.running };
  S.pendingFolder = null;
  S.attachments = (S.attachmentDrafts.get(id) || []).slice();
  S.status = null;
  S.openTools.clear();
  S.panel.tree.clear();
  S.panel.expanded.clear();
  S.panel.file = null;
  renderSidebar();
  renderThread();
  renderPanel();
  scrollToBottom(true);
}

function startNew(folder) {
  saveDraft();
  const liveDraft = S.drafts.get('_active_input') || (S.cur ? S.drafts.get(S.cur.id) : '') || '';
  S.cur = null;
  S.pendingFolder = folder || null;
  S.attachments = (S.attachmentDrafts.get(attachmentDraftKey()) || []).slice();
  S.images = [];
  const oldAtts = $('#composer-wrap .atts, .start .atts');
  if (oldAtts) { oldAtts.innerHTML = ''; oldAtts.classList.add('hidden'); }
  if (liveDraft) {
    S.drafts.set('_new', liveDraft);
    if (folder) S.drafts.set(`_pending:${folder}`, liveDraft);
  }
  S.status = null;
  renderSidebar();
  renderThread();
  renderPanel();
  setTimeout(() => $('.start textarea, #composer-wrap textarea')?.focus(), 20);
}

async function pickFolder() {
  saveDraft();
  const liveDraft = S.drafts.get('_active_input') || '';
  const folder = await deiza.code.pickFolder();
  if (folder) {
    saveDraft();
    S.pendingFolder = folder;
    if (liveDraft) {
      S.drafts.set(`_pending:${folder}`, liveDraft);
      S.drafts.set('_new', liveDraft);
    }
    if (!S.cur) renderThread(); else startNew(folder);
  }
  return folder;
}

function saveDraft() {
  S.attachmentDrafts.set(attachmentDraftKey(), S.attachments.slice());
  const ta = $('#composer-wrap textarea') || $('.start textarea') || $('textarea');
  if (ta && typeof ta.value === 'string') {
    const val = ta.value;
    const k = S.cur ? S.cur.id : (S.pendingFolder ? `_pending:${S.pendingFolder}` : '_new');
    S.drafts.set(k, val);
    if (val.trim()) {
      S.drafts.set('_active_input', val);
      try { localStorage.setItem('deiza:code:draft', val); } catch {}
    }
  }
}

function attachmentDraftKey() {
  return S.cur ? S.cur.id : (S.pendingFolder ? `_pending:${S.pendingFolder}` : '_new');
}

function refreshAttachments() {
  const box = $('#composer-wrap .composer, .start .composer');
  if (box && box._attachments) box._attachments();
  if (box && box._refresh) box._refresh();
}

/** Add every dropped/selected file to this draft; dropping inside the composer never changes project. */
async function addAttachments(files) {
  const selected = typeof files === 'string' ? [files] : Array.from(files || []);
  if (!selected.length) return { attachments: [], errors: [] };
  const key = attachmentDraftKey();
  const sessionId = S.cur && S.cur.id;
  const paths = [];
  const uploads = [];
  S.attachmentPending++;
  refreshAttachments();
  try {
    for (const file of selected) {
      const filePath = typeof file === 'string' ? file : (file.path || deiza.pathForFile(file));
      if (filePath) paths.push(filePath);
      else {
        try {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(T('No se pudo leer el archivo')));
            reader.readAsDataURL(file);
          });
          uploads.push({ name: file.name, data_url: data });
        } catch {
          toast(T('No se pudo adjuntar {f}', { f: file.name || T('archivo') }));
        }
      }
    }
    const result = await deiza.code.attach({ id: sessionId || undefined, paths, files: uploads });
    const current = attachmentDraftKey() === key;
    const draft = current ? S.attachments : (S.attachmentDrafts.get(key) || []);
    const added = result && Array.isArray(result.attachments) ? result.attachments : [];
    for (const item of added) if (!draft.some(existing => existing.id === item.id)) draft.push(item);
    S.attachmentDrafts.set(key, draft.slice());
    if (current) S.attachments = draft;
    if (added.some(item => item.kind === 'image')) capuReact('photo');
    for (const error of (result && result.errors) || []) {
      toast(typeof error === 'string' ? error : (error.message || T('No se pudo adjuntar {f}', { f: error.name || T('archivo') })), 4500);
    }
    if (result && result.error) toast(T('No se pudieron adjuntar los archivos'));
    return result;
  } catch {
    toast(T('No se pudieron adjuntar los archivos'));
    return { attachments: [], errors: [T('No se pudieron adjuntar los archivos')] };
  } finally {
    S.attachmentPending--;
    refreshAttachments();
  }
}

async function openComputerBrowser() {
  try {
    const result = await deiza.computer.open({ id: S.cur && S.cur.id });
    if (result && (result.error || result.ok === false)) { toast(T('No se pudo abrir el navegador')); return false; }
    capuReact('web');
    return true;
  } catch {
    toast(T('No se pudo abrir el navegador'));
    return false;
  }
}

// ── thread ────────────────────────────────────────────────────────────────────

function renderThread() {
  closeModelMenu();
  const head = $('#thread-head');
  const tr = $('#transcript');
  const wrap = $('#composer-wrap');
  itemEls.clear();
  tr.innerHTML = '';
  wrap.innerHTML = '';
  renderTitle();
  if (!S.cur) {
    head.classList.add('hidden');
    wrap.classList.add('hidden');
    tr.append(renderHero());
    renderStatus();
    return;
  }
  if (S.heroDirector) { S.heroDirector.stop(); S.heroDirector = null; }
  head.classList.remove('hidden');
  wrap.classList.remove('hidden');
  head.innerHTML = '';
  const chip = h('button', { class: 'folder-chip', title: `${tildeHome(S.cur.folder)} · Mostrar en la carpeta`, onclick: () => deiza.openPath(S.cur.folder) }, icon('folder'), h('span', { text: tildeHome(S.cur.folder) }));
  const branch = S.cur.branch ? h('span', { class: 'branch-chip', title: 'Rama de git' },
    (() => { const i = icon('file'); i.innerHTML = '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 8.2v7.6M18 10.2c0 4-6 3-10.6 6.6"/>'; return i; })(), S.cur.branch) : null;
  const panelBtn = h('button', { class: 'icon-btn panel-toggle', 'aria-pressed': String(S.panel.open), title: 'Archivos, cambios y vista previa (⌘\\ / Ctrl+\\)', onclick: () => togglePanel(S.panel.tab || 'files') }, icon('panel'));
  head.append(...[chip, branch, h('div', { class: 'head-spacer' }), panelBtn].filter(Boolean));
  if (S.cur.folderMissing) tr.append(h('div', { class: 'errcard' }, h('div', { class: 'h', text: 'La carpeta ya no existe' }), h('p', { text: `${S.cur.folder} se movió o se borró. Puedes leer el historial, pero no continuar esta sesión.` })));
  for (const it of S.cur.items) tr.append(renderItemEl(it));
  const banner = renderQuotaBanner();
  if (banner) wrap.append(banner);
  wrap.append(renderComposer(false));
  renderStatus();
}

function renderHero() {
  const box = h('div', { class: 'start' });
  const stage = capuEnabled() ? h('div', { class: 'capu capu-hero', title: 'Capu' }) : null;
  if (S.heroDirector) { S.heroDirector.stop(); S.heroDirector = null; }
  if (stage) {
    const heroPlayer = new Capu.Player(stage, { px: CAPU_PX * 2, crop: Capu.centeredBox(Object.keys(Capu.SCENES), 1), scene: 'hello', motion: capuMotion() });
    S.heroDirector = new Capu.Director(heroPlayer, { sleepAfter: 90000 });
    if (!S.heroHello) S.heroDirector.set('hello');
    S.heroHello = true;
  }
  const greet = h('div', { class: 'greet' }, stage || DeizaRose(52, { className: 'breathe' }), h('h1', { text: S.pendingFolder ? `¿Qué hacemos en ${basename(S.pendingFolder)}?` : '¿Qué construimos hoy?' }));
  box.append(greet);
  box.append(h('p', { class: 'sub', text: S.pendingFolder ? tildeHome(S.pendingFolder) : 'Elige una carpeta y pide un cambio, un arreglo o una app entera.' }));
  if (S.usage && S.usage.error === 'plan') {
    box.append(h('div', { class: 'gate' }, h('h3', { text: 'Deiza Code está incluido en Friend y Signet' }),
      h('p', { text: 'Tu cuenta tiene el plan gratuito. Con un plan de pago tienes el agente de Deiza Code y la ventana de uso de 5 horas.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary small', onclick: () => deiza.chatGo('plans') }, 'Ver planes'))));
    return box;
  }
  box.append(renderComposer(true));
  const rec = h('div', { class: 'recents' });
  if (S.recents.length) {
    rec.append(h('div', { class: 'lbl', text: 'Recientes' }));
    for (const f of S.recents.slice(0, 7)) {
      rec.append(h('button', { class: 'recent', onclick: () => {
        saveDraft();
        const liveDraft = S.drafts.get('_active_input') || '';
        S.pendingFolder = f;
        if (liveDraft) {
          S.drafts.set(`_pending:${f}`, liveDraft);
          S.drafts.set('_new', liveDraft);
        }
        renderThread();
        setTimeout(() => $('.start textarea, #composer-wrap textarea')?.focus(), 10);
      } },
        icon('folder'), h('span', { text: basename(f) }), h('small', { text: tildeHome(f) })));
    }
  } else {
    rec.append(h('div', { class: 'lbl', text: 'Para empezar' }),
      h('button', { class: 'recent', onclick: () => pickFolder() }, icon('folder'), h('span', { text: 'Abrir una carpeta de proyecto…' }), h('small', { text: '⌘O / Ctrl+O' })));
  }
  box.append(rec);
  return box;
}

function features() {
  return h('div', { class: 'features' },
    h('div', null, h('b', { text: 'Build' }), h('span', { text: 'Autónomo: escribe, ejecuta y verifica hasta terminar.' })),
    h('div', null, h('b', { text: 'Copilot' }), h('span', { text: 'Te enseña cada cambio y comando antes de aplicarlo.' })),
    h('div', null, h('b', { text: 'Plan' }), h('span', { text: 'Solo lectura: estudia el proyecto y te propone el plan.' })));
}

// ── transcript items ──────────────────────────────────────────────────────────

const VERBS = {
  read_file: 'Leer', write_file: 'Escribir', append_file: 'Añadir', edit_file: 'Editar', run_command: 'Terminal',
  list_dir: 'Explorar', search_files: 'Buscar', fetch_url: 'Web', delete_path: 'Borrar', move_path: 'Mover',
  invoke_subagent: 'Subagente', view_image: 'Imagen', update_plan: 'Plan',
  browser_open: 'Abrir navegador', browser_tabs: 'Ver pestañas', browser_snapshot: 'Leer página',
  browser_screenshot: 'Capturar página', browser_click: 'Clicar', browser_type: 'Escribir',
  browser_key: 'Pulsar tecla', browser_scroll: 'Desplazar página', browser_close: 'Cerrar pestaña',
  desktop_screenshot: 'Capturar pantalla', desktop_apps: 'Ver aplicaciones', desktop_focus: 'Abrir aplicación',
  desktop_click: 'Clicar', desktop_type: 'Escribir', desktop_key: 'Pulsar tecla', desktop_scroll: 'Desplazar',
};

function renderItemEl(it) {
  const el = renderItem(it);
  el.dataset.id = it.id;
  itemEls.set(it.id, el);
  return el;
}

function upsert(it) {
  if (!it) return;
  const old = itemEls.get(it.id);
  if (it.k === 'text' && old) { updateProse(old, it); return; }
  if (it.k === 'think' && old) { updateThink(old, it); return; }
  const el = renderItemEl(it);
  if (old) old.replaceWith(el);
  else $('#transcript').append(el);
}

function renderItem(it) {
  switch (it.k) {
    case 'user': {
      const box = h('div', { class: 'msg-user sel' });
      if (it.images && it.images.length) box.append(h('div', { class: 'imgs' }, it.images.map(p => h('img', { src: fileUrl(p), alt: '' }))));
      if (it.attachments && it.attachments.length) box.append(h('div', { class: 'msg-atts' }, it.attachments.map(a =>
        h('span', { class: 'file-att', title: a.name }, icon(a.kind === 'folder' ? 'folder' : a.kind === 'image' ? 'image' : 'file'), h('span', { text: a.name })))));
      if (it.text) box.append(h('div', { class: 'bubble', text: it.text }));
      return box;
    }
    case 'text': {
      const el = h('div', { class: 'prose sel' });
      updateProse(el, it, true);
      return el;
    }
    case 'think': return renderThink(it);
    case 'tool': return renderTool(it);
    case 'plan': return renderPlan(it);
    case 'approval': return renderApproval(it);
    case 'notice': return h('div', { class: `notice${it.kind ? ` ${it.kind}` : ''}`, text: it.text });
    case 'handoff': return renderHandoff(it);
    case 'error': return renderError(it);
    case 'turn': return renderTurn(it);
    default: return h('div');
  }
}

// reasoning ("Razonando…" while it streams, then a collapsed "Razonó durante 12 s")
function renderThink(it) {
  const el = h('div', { class: 'think' });
  const head = h('button', { class: 'think-head' }, icon('spark', 'i think-ico'), h('span', { class: 'think-lbl' }), h('span', { class: 'think-peek' }), icon('chev', 'i chev'));
  const body = h('div', { class: 'think-body sel' });
  head.onclick = () => {
    const open = !el.classList.contains('open');
    el.classList.toggle('open', open);
    if (open) { S.openTools.add(it.id); body.textContent = el._it.text.trim(); } else S.openTools.delete(it.id);
  };
  el.append(head, body);
  el._it = it;
  updateThink(el, it, true);
  return el;
}

function updateThink(el, it) {
  el._it = it;
  const open = S.openTools.has(it.id);
  el.classList.toggle('live', Boolean(it.open));
  el.classList.toggle('open', open);
  el.querySelector('.think-lbl').textContent = it.open ? T('Razonando') : T('Razonó durante {d}', { d: fmtDuration(Math.max(1000, it.ms || 0)) });
  const lines = String(it.text || '').trim().split('\n').map(l => l.trim()).filter(Boolean);
  el.querySelector('.think-peek').textContent = it.open && !open ? (lines[lines.length - 1] || '') : '';
  if (open) {
    const body = el.querySelector('.think-body');
    const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    body.textContent = String(it.text || '').trim();
    if (atEnd) body.scrollTop = body.scrollHeight;
  }
  stickToBottom();
}

function fileUrl(p) {
  const norm = String(p).replace(/\\/g, '/');
  return `file://${norm.startsWith('/') ? '' : '/'}${norm.split('/').map(encodeURIComponent).join('/')}`;
}

// markdown
marked.setOptions({ gfm: true, breaks: false });
const mdTimers = new WeakMap();
function updateProse(el, it, immediate) {
  const draw = () => {
    mdTimers.delete(el);
    el.innerHTML = DOMPurify.sanitize(marked.parse(it.text || ''), { ADD_ATTR: ['target'] });
    enhanceProse(el);
    el.classList.toggle('caret', Boolean(it.open));
    stickToBottom();
  };
  if (immediate) return draw();
  if (!mdTimers.has(el)) mdTimers.set(el, setTimeout(draw, 45));
}

function enhanceProse(el) {
  for (const pre of el.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    const lang = ((code && code.className.match(/language-([\w+-]+)/)) || [])[1] || '';
    if (code) {
      try {
        if (lang && hljs.getLanguage(lang)) code.innerHTML = hljs.highlight(code.textContent, { language: lang }).value;
        else hljs.highlightElement(code);
      } catch { /* plain */ }
    }
    const copy = h('button', { class: 'copy-btn', text: 'Copiar' });
    copy.onclick = () => { navigator.clipboard.writeText(code ? code.textContent : pre.textContent); copy.textContent = 'Copiado'; setTimeout(() => { copy.textContent = 'Copiar'; }, 1400); };
    const block = h('div', { class: 'codeblock' }, h('div', { class: 'cb-head' }, h('span', { text: lang || 'código' }), copy));
    pre.replaceWith(block);
    block.append(pre);
  }
  for (const a of el.querySelectorAll('a[href]')) {
    a.addEventListener('click', (e) => { e.preventDefault(); const href = a.getAttribute('href'); if (/^https?:|^mailto:/.test(href)) deiza.openExternal(href); else openFile(href); });
  }
  for (const c of el.querySelectorAll(':not(pre) > code')) {
    const t = c.textContent.trim();
    if (S.cur && /^[\w@.\-/\\]+\.[A-Za-z0-9]{1,8}$/.test(t) && !/^\d/.test(t) && !t.includes('://')) {
      c.classList.add('path-link');
      c.title = 'Abrir en la vista previa';
      c.onclick = () => openFile(t.replace(/^\.\//, ''));
    }
  }
}

function renderTool(it) {
  const open = S.openTools.has(it.id) || (it.status === 'running' && it.name === 'run_command') ||
    (!S.openTools.has(`closed:${it.id}`) && autoOpen(it));
  const wrap = h('div', { class: `tool${open ? ' open' : ''}`, 'data-status': it.status });
  const meta = h('span', { class: 'tool-meta' });
  const diff = it.detail && it.detail.diff;
  if (diff && !diff.isNew) meta.append(h('span', { class: 'add', text: `+${diff.added}` }), h('span', { class: 'del', text: `−${diff.removed}` }));
  else if (it.summary && it.status !== 'running') meta.append(h('span', { class: ['error', 'timeout', 'blocked'].includes(it.status) ? 'err' : '', text: it.summary.length > 60 ? `${it.summary.slice(0, 57)}…` : it.summary }));
  if (it.status === 'running') meta.append(h('span', { class: 'spin' }));
  else if (it.ms > 1500) meta.append(h('span', { text: fmtDuration(it.ms) }));
  const hasBody = toolHasBody(it);
  if (hasBody) meta.append(icon('chev', 'i chev'));
  const verb = T(it.name === 'write_file' && diff && diff.isNew ? 'Crear' : (VERBS[it.name] || it.name));
  const head = h('button', { class: 'tool-head' }, h('span', { class: 'knot' }, h('i')), h('span', { class: 'verb', text: verb }),
    h('span', { class: 'target', text: it.target || it.path || '', title: it.target || '' }), meta);
  if (hasBody) {
    head.onclick = () => {
      const isOpen = wrap.classList.toggle('open');
      if (isOpen) { S.openTools.add(it.id); S.openTools.delete(`closed:${it.id}`); } else { S.openTools.delete(it.id); S.openTools.add(`closed:${it.id}`); }
      body.classList.toggle('hidden', !isOpen);
      if (isOpen && !body.childNodes.length) fillToolBody(body, it);
    };
  } else if (it.path && it.name !== 'delete_path') {
    head.onclick = () => openFile(it.path);
  }
  const body = h('div', { class: `tool-body${open ? '' : ' hidden'}` });
  if (open && hasBody) fillToolBody(body, it);
  wrap.append(head, body);
  return wrap;
}

function autoOpen(it) {
  if (it.name === 'run_command') return ['error', 'timeout'].includes(it.status);
  const diff = it.detail && it.detail.diff;
  if (diff && ['edit_file', 'write_file', 'append_file'].includes(it.name)) {
    const lines = diff.hunks.reduce((n, hk) => n + hk.lines.length, 0);
    return lines <= 24;
  }
  return false;
}

function toolHasBody(it) {
  if (it.name === 'run_command') return true;
  const d = it.detail;
  if (!d) return it.status === 'error' && Boolean(it.summary);
  return Boolean(d.diff || d.report || (d.matches && d.matches.length) || (d.items && d.items.length) || (it.status === 'error' && it.summary));
}

function fillToolBody(body, it) {
  const d = it.detail || {};
  if (it.name === 'run_command') {
    const out = h('pre', { class: 'sel' });
    if (it.status === 'running') out.textContent = (it.output || '').split('\n').slice(-40).join('\n') || '…';
    else {
      if (d.stdout) out.append(d.stdout);
      if (d.stderr) out.append(d.stdout ? '\n' : '', h('span', { class: 'stderr', text: d.stderr }));
      if (!d.stdout && !d.stderr) out.textContent = it.summary || 'Sin salida';
    }
    body.append(h('div', { class: 'term' }, h('div', { class: 'term-cmd sel', text: d.command || it.target }), out));
    setTimeout(() => { out.scrollTop = out.scrollHeight; }, 0);
    return;
  }
  if (it.status === 'error' && it.summary) body.append(h('div', { class: 'list-mini sel', text: it.summary }));
  if (d.diff) {
    body.append(renderDiff(d.diff));
    const acts = h('div', { class: 'tool-actions' });
    acts.append(h('button', { class: 'btn quiet small', onclick: () => openFile(d.path) }, icon('eye'), 'Abrir'));
    if (/\.html?$/i.test(d.path || '')) acts.append(h('button', { class: 'btn quiet small', onclick: () => openFile(d.path, 'page') }, icon('globe'), 'Ver página'));
    body.append(acts);
  }
  if (d.report) {
    const pr = h('div', { class: 'prose sel', style: { fontSize: '13.5px', padding: '4px 0' } });
    updateProse(pr, { text: d.report }, true);
    body.append(pr);
  }
  if (d.matches && d.matches.length) {
    body.append(h('div', { class: 'list-mini sel' }, d.matches.map(m => h('div', null, h('b', { text: `${m.file}:${m.line}` }), `  ${m.text}`))));
  }
  if (d.items && d.items.length) {
    body.append(h('div', { class: 'list-mini sel' }, d.items.map(i => h('div', { text: i.dir ? `${i.name}/` : i.name }))));
  }
}

function renderDiff(diff) {
  const box = h('div', { class: 'diff sel' });
  const scroll = h('div', { class: 'diff-scroll' });
  const table = h('table');
  diff.hunks.forEach((hk, idx) => {
    if (idx > 0 || hk.oldStart > 1) table.append(h('tr', { class: 'sep' }, h('td', { colspan: '3', text: `línea ${hk.newStart}` })));
    let o = hk.oldStart;
    let n = hk.newStart;
    for (const [t, text] of hk.lines) {
      const cls = t === '+' ? 'add' : t === '-' ? 'del' : '';
      const oldNo = t === '+' ? '' : o++;
      const newNo = t === '-' ? '' : n++;
      table.append(h('tr', { class: cls }, h('td', { class: 'ln', text: oldNo }), h('td', { class: 'ln', text: newNo }), h('td', { class: 'code', text: `${t === ' ' ? ' ' : t} ${text}` })));
    }
  });
  scroll.append(table);
  box.append(scroll);
  if (diff.truncated) box.append(h('div', { class: 'more', text: `Diff recortado · +${diff.added} −${diff.removed} en total` }));
  return box;
}

function renderPlan(it) {
  const steps = it.steps || [];
  const done = steps.filter(s => s.status === 'done').length;
  return h('div', { class: 'plan' }, h('h4', null, h('span', { text: 'Plan' }), h('span', { text: `${done}/${steps.length}` })),
    h('ol', null, steps.map(s => h('li', { class: s.status }, h('span', { class: 'st' }), h('span', { class: 'tx', text: s.title })))));
}

function renderApproval(it) {
  const pending = it.state === 'pending';
  const what = it.name === 'run_command' ? 'ejecutar este comando' : it.name === 'delete_path' ? 'borrar' : it.name === 'move_path' ? 'mover' : 'aplicar este cambio';
  const box = h('div', { class: `approval${pending ? '' : ' done'}` },
    h('div', { class: 'q' }, `¿${what.charAt(0).toUpperCase()}${what.slice(1)}?`, it.path || (it.name !== 'run_command' && it.target) ? h('small', { text: it.path || it.target }) : null));
  if (it.outside) box.append(h('div', { class: 'risk', text: 'Está fuera de la carpeta del proyecto.' }));
  if (it.risky) box.append(h('div', { class: 'risk', text: 'Acción destructiva: revísala con calma.' }));
  if (it.command) box.append(h('div', { class: 'term' }, h('div', { class: 'term-cmd sel', text: it.command })));
  if (it.diff) box.append(renderDiff(it.diff));
  if (pending) {
    const answer = (approved, always) => deiza.code.approve({ id: S.cur.id, approvalId: it.id, approved, always });
    box.append(h('div', { class: 'row' },
      h('button', { class: 'btn primary small', onclick: () => answer(true, false) }, icon('check'), 'Aplicar'),
      h('button', { class: 'btn ghost small', onclick: () => answer(false, false) }, 'Rechazar'),
      it.outside ? null : h('button', { class: 'btn quiet small', title: 'Aplica este y los siguientes cambios de esta petición sin preguntar', onclick: () => answer(true, true) }, 'Aplicar todo')));
  } else {
    box.append(h('div', { class: 'state', text: it.state === 'approved' ? 'Aplicado' : 'Rechazado' }));
  }
  return box;
}

function renderError(it) {
  const box = h('div', { class: 'errcard' });
  if (it.code === 'auth') {
    box.append(h('div', { class: 'h', text: 'Tu sesión de Deiza ha caducado' }), h('p', { text: 'Vuelve a iniciar sesión en la pestaña Chat y reintenta.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary small', onclick: () => deiza.chatGo('login') }, 'Iniciar sesión')));
  } else if (it.code === 'plan') {
    box.append(h('div', { class: 'h', text: 'Deiza Code está incluido en Friend y Signet' }), h('p', { text: 'Tu plan actual no incluye el agente.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary small', onclick: () => deiza.chatGo('plans') }, 'Ver planes')));
  } else if (it.code === 'model_limit') {
    const name = modelInfo(it.message).name;
    const other = MODELS.find(m => m.id !== it.message) || MODELS[0];
    box.append(h('div', { class: 'h', text: T('Has agotado el cupo de {m} en esta ventana', { m: name }) }),
      h('p', { text: T('Los demás modelos siguen disponibles. Cambia de modelo y escribe «continúa».') }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary small', onclick: () => chooseModel({ model: other.id }) }, T('Usar {m}', { m: other.name }))));
  } else if (it.code === 'usage') {
    const us = S.usage;
    box.append(h('div', { class: 'h', text: T('Sin uso disponible por ahora') }),
      h('p', { text: it.message || (us && us.reset_in_seconds ? T('Se renueva en {t}.', { t: fmtDuration(us.reset_in_seconds * 1000) }) : T('Se renueva cada 5 horas.')) }));
  } else {
    box.append(h('div', { class: 'h', text: it.code === 'crash' ? 'El agente se detuvo' : 'Algo falló' }), h('p', { class: 'sel', text: it.message || 'Error desconocido.' }));
  }
  return box;
}

function renderHandoff(it) {
  const box = h('div', { class: 'handoff' });
  const mini = h('div', { class: 'capu capu-mini' });
  mini.innerHTML = Capu.toSVG(Capu.frameAt('wilt', 0), { px: 1, crop: Capu.sceneBox(['wilt'], 1) });
  const txt = h('div', { class: 'hb' },
    h('div', { class: 'h', text: T('Traspaso guardado') }),
    h('p', { text: it.path
      ? (it.by === 'app' ? T('El agente no llegó a escribirlo: la app lo ha generado con lo hecho en la sesión.') : T('Contexto, cambios y lo que queda por hacer, listo para la siguiente sesión o para otra IA.'))
      : T('Modo Plan: el traspaso no se guarda como archivo. Cópialo desde aquí.') }));
  const row = h('div', { class: 'row' });
  if (it.path) {
    row.append(h('button', { class: 'btn primary small', onclick: () => openFile(it.path, 'rendered') }, T('Abrir {f}', { f: it.path })));
    row.append(h('button', { class: 'btn ghost small', onclick: async () => {
      const d = await deiza.code.fsRead({ id: S.cur.id, rel: it.path });
      if (d && typeof d.content === 'string') { navigator.clipboard.writeText(d.content); toast(T('Traspaso copiado')); } else toast(T('No se pudo leer el traspaso'));
    } }, T('Copiar')));
  } else if (it.content) {
    row.append(h('button', { class: 'btn primary small', onclick: () => { navigator.clipboard.writeText(it.content); toast(T('Traspaso copiado')); } }, T('Copiar traspaso')));
  }
  txt.append(row);
  box.append(mini, txt);
  return box;
}

function renderTurn(it) {
  const st = it.stats || {};
  const parts = [];
  if (it.stopReason === 'done') parts.push(h('span', { class: 'ok', text: `Hecho en ${fmtDuration(it.elapsedMs)}` }));
  else if (it.stopReason === 'aborted') parts.push(h('span', { class: 'warn', text: 'Detenido' }));
  else if (it.stopReason === 'max_turns') parts.push(h('span', { class: 'warn', text: 'Pausa: escribe «continúa» para seguir' }));
  else if (it.stopReason === 'stuck') parts.push(h('span', { class: 'warn', text: 'El agente se atascó: prueba a dividir la petición' }));
  else parts.push(h('span', { class: 'warn', text: 'Interrumpido' }));
  if (st.tools) parts.push(h('span', { text: `${st.tools} herramienta${st.tools === 1 ? '' : 's'}` }));
  if (st.files && st.files.length) parts.push(h('span', { text: `${st.files.length} archivo${st.files.length === 1 ? '' : 's'}` }));
  if (st.tokens) parts.push(h('span', { text: `${Number(st.tokens).toLocaleString('es')} tokens` }));
  if (it.reverted) parts.push(h('span', { text: 'Cambios revertidos' }));
  else if (it.revertible && !(S.cur && S.cur.running)) {
    parts.push(h('button', {
      class: 'link-btn', title: 'Devuelve los archivos que tocó esta respuesta a su estado anterior (no deshace comandos)',
      onclick: async () => {
        const r = await deiza.code.revert({ id: S.cur.id, turnId: it.id });
        if (r && r.error) toast(r.error === 'busy' ? 'Espera a que termine la petición' : 'No hay nada que revertir');
        else { S.panel.tree.clear(); renderPanel(); }
      },
    }, 'Revertir cambios'));
  }
  return h('div', { class: 'turn' }, h('div', { class: 't-in' }, parts));
}

// scrolling
let stick = true;
function scrollToBottom(force) {
  const sc = $('#scroller');
  if (force || stick) sc.scrollTop = sc.scrollHeight;
}
function stickToBottom() { if (stick) requestAnimationFrame(() => scrollToBottom()); }

// ── Capu (la mascota) ─────────────────────────────────────────────────────────
// One stage for the status line, kept alive across redraws so the animation never restarts;
// the Director turns what the agent is doing into scenes and slips in a gag now and then.

// Capu stands on the top edge of the input bar: the stage ends at its feet (row 28 of the scene).
const CAPU_STAND = (() => { const b = Capu.centeredBox(Object.keys(Capu.SCENES), 0); return { x: b.x, y: b.y, w: b.w, h: 28 - b.y }; })();
const capuEnabled = () => localStorage.getItem('deiza:capu') !== '0';
// Capu has its own motion preference: full effects by default, with system/reduced options in Code settings.
const capuMotion = () => { const m = localStorage.getItem('deiza:capu:motion'); return ['full', 'system', 'reduced'].includes(m) ? m : 'full'; };
const systemReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const capuReduced = () => capuMotion() === 'reduced' || (capuMotion() === 'system' && systemReducedMotion());
const capu = { el: null, player: null, director: null, fails: 0, grace: false, x: null, frac: 1, walking: false, moveKind: '', moveFrame: null, walkTimer: null, cmdKind: '', ro: null };
function capuApplyMotion(value) {
  localStorage.setItem('deiza:capu:motion', ['full', 'system', 'reduced'].includes(value) ? value : 'full');
  document.body.classList.toggle('full-motion', !capuReduced());
  document.body.classList.toggle('reduced-motion', capuReduced());
  if (capu.player) capu.player.setMotion(capuMotion());
  if (S.heroDirector) S.heroDirector.p.setMotion(capuMotion());
  if (capuReduced()) capuReturnHome();
}
// 2 CSS px per sprite pixel, rounded to whole device pixels: at 125 % or 150 % (common on Windows)
// a fractional size makes crispEdges draw uneven pixels and the sprite shimmers.
const CAPU_PX = (() => { const r = window.devicePixelRatio || 1; return Math.max(1, Math.round(2 * r)) / r; })();
function capuInit() {
  if (capu.el) return;
  capu.el = h('div', { class: 'capu capu-stand', title: 'Capu', role: 'button', 'aria-label': 'Capu' });
  capu.player = new Capu.Player(capu.el, { px: CAPU_PX, crop: CAPU_STAND, motion: capuMotion() });
  capu.director = new Capu.Director(capu.player, { sleepAfter: 120000 });
  // a click on Capu: an instant trick
  capu.el.addEventListener('click', () => { capuStopWalk(); capu.director.poke(); });
  capuWanderLater();
}
/** Put Capu on the composer of the open session (the element is kept, so its animation never restarts). */
function capuMount(box) {
  if (!capuEnabled() || !S.cur || !box) { if (capu.el) capu.el.remove(); return; }
  capuInit();
  box.append(capu.el);
  // the bar changes width with the window (maximise, snap) and the side panels: keep Capu on it
  if (capu.ro) capu.ro.disconnect();
  capu.ro = new ResizeObserver(() => {
    const returning = capu.moveKind === 'home';
    if (capu.walking) capuStopWalk();
    if (returning) capu.frac = 1;
    capuPlace();
  });
  capu.ro.observe(box);
  requestAnimationFrame(() => capuPlace());
}
function capuRange() {
  const box = capu.el && capu.el.parentElement;
  const W = box ? box.clientWidth : 700;
  const stage = Math.ceil(CAPU_STAND.w * CAPU_PX);
  return [Math.round(W * 0.42), Math.max(Math.round(W * 0.42), W - stage + 10)];
}
/** Where Capu stands, as a share of the stretch of bar it may walk (so it looks the same at any width). */
function capuFrac(x) {
  const [a, b] = capuRange();
  return b > a ? Math.min(1, Math.max(0, (x - a) / (b - a))) : 1;
}
function capuPlace() {
  if (!capu.el || capu.walking) return;
  const [a, b] = capuRange();
  const r = window.devicePixelRatio || 1;
  capu.x = Math.round((a + capu.frac * (b - a)) * r) / r;
  capu.el.style.left = `${capu.x}px`;
  capuFitStatus();
}

/** Keep the task label to the left of Capu, including during the short trip home. */
function capuFitStatus(targetLabel) {
  const label = targetLabel || $('#statusline .status-label');
  if (!label) return;
  if (!capuEnabled() || !capu.el || !capu.el.isConnected) { label.style.maxWidth = ''; return; }
  const capuRect = capu.el.getBoundingClientRect();
  const labelRect = label.getBoundingClientRect();
  if (!capuRect.left || !labelRect.left) return;
  const avail = Math.floor(capuRect.left - labelRect.left - 16);
  label.style.maxWidth = `${Math.max(60, avail)}px`;
}
/** Move on animation frames, independent of global CSS transition settings (including Windows). */
function capuMove(target, ms, kind) {
  const from = capu.x;
  const start = performance.now();
  capu.walking = true;
  capu.moveKind = kind;
  capu.director.pause();
  capu.el.classList.toggle('flip', target < from);
  if (kind === 'wander') capu.player.play('walk');
  const tick = (now) => {
    if (!capu.el.isConnected) { capuStopWalk(); return; }
    if (capuReduced()) {
      capu.x = kind === 'home' ? capuRange()[1] : capu.x;
      capu.el.style.left = `${capu.x}px`;
      capuFitStatus();
      capuStopWalk(true);
      return;
    }
    const t = Math.min(1, (now - start) / ms);
    const progress = kind === 'home' ? 1 - Math.pow(1 - t, 3) : t;
    const r = window.devicePixelRatio || 1;
    capu.x = Math.round((from + (target - from) * progress) * r) / r;
    capu.el.style.left = `${capu.x}px`;
    capuFitStatus();
    if (t < 1) capu.moveFrame = requestAnimationFrame(tick);
    else capuStopWalk(true);
  };
  capu.moveFrame = requestAnimationFrame(tick);
}
/** Return to the right-hand end before responding; repeated status events keep the same trip. */
function capuReturnHome() {
  if (!capu.el || !capu.el.isConnected) return;
  if (capu.moveKind === 'home' && !capuReduced()) return;
  capuStopWalk();
  if (capu.x == null) capuPlace();
  const target = capuRange()[1];
  const distance = Math.abs(target - capu.x);
  capu.frac = 1;
  if (capuReduced() || distance < 1) { capuPlace(); return; }
  capuMove(target, Math.min(320, Math.max(140, distance / 1.8)), 'home');
}
function capuWanderLater() { clearTimeout(capu.walkTimer); capu.walkTimer = setTimeout(capuWander, 18000 + Math.random() * 24000); }
/** Now and then, while resting, Capu walks a little along the input bar. */
function capuWander() {
  const d = capu.director;
  if (!capu.el || !capu.el.isConnected || capu.walking || (S.cur && S.cur.running) || !d || d.state !== 'idle' || d.reacting || document.hidden || capuReduced()) return capuWanderLater();
  const [a, b] = capuRange();
  const target = Math.round(a + Math.random() * (b - a));
  if (capu.x == null) capuPlace();
  const dist = Math.abs(target - capu.x);
  if (dist < 30) return capuWanderLater();
  capuMove(target, dist / 20 * 1000, 'wander');
}
function capuStopWalk(arrived) {
  if (!capu.walking) return;
  cancelAnimationFrame(capu.moveFrame);
  capu.moveFrame = null;
  const returning = capu.moveKind === 'home';
  capu.walking = false;
  capu.moveKind = '';
  capu.frac = arrived && returning ? 1 : capuFrac(capu.x);
  if (capu.el) capu.el.classList.remove('flip');
  capu.director.resume(returning);
  capuWanderLater();
}
/** Whichever Capu is on screen: the one on the input bar, or the big one on the start page. */
function capuDirector() { return S.cur ? (capu.director || null) : (S.heroDirector || null); }
function capuSet(state) {
  if (!capuEnabled()) return;
  capuInit();
  if (capu.grace && state !== 'done' && state !== 'idle') state = 'grace';
  if (state !== 'idle') capuReturnHome();
  capu.director.set(state);
}
function capuReact(scene, after) {
  if (!capuEnabled()) return;
  if (S.cur) { capuInit(); capuReturnHome(); }
  const d = capuDirector();
  if (d) d.react(scene, after);
}
const CAPU_EFFORT = { low: 'low', medium: 'mid', high: 'high', ultra: 'ultra' };
function capuEffort(prev, next) {
  // Omnisciente: a Super Saiyan transformation for a few seconds, then back to normal
  if (next === 'max') { if (prev !== 'max') capuReact('saiyan'); return; }
  if (CAPU_EFFORT[next]) capuReact(CAPU_EFFORT[next]);
}
const CAPU_MODEL = { 'deiza-solid-5': 'solid', 'deiza-omniscient': 'liquid', 'deiza-gas-4.5': 'gas' };
function capuCommandKind(cmd) {
  const c = String(cmd || '');
  if (/\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip3?\s+install\b|\bcargo\s+add\b/.test(c)) return 'npm';
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(jest|vitest|pytest|mocha)\b|\bgo\s+test\b|\bcargo\s+test\b|node\s+--test|\.test\.[jt]s\b/.test(c)) return 'tests';
  if (/\bgit\s+(commit|push|merge|pull|rebase|tag)\b/.test(c)) return 'git';
  return '';
}
function capuFromStatus(st) {
  if (!st || st.kind === 'thinking') return 'thinking';
  if (st.kind === 'approval') return 'approval';
  const n = String(st.name || '');
  if (n === 'run_command') {
    const kind = capuCommandKind(st.text);
    if (st.kind === 'running') capu.cmdKind = kind;
    return kind || 'running';
  }
  if (n === 'fetch_url' || n.startsWith('browser_')) return 'web';
  if (/^desktop_(screenshot|apps)$/.test(n)) return 'reading';
  if (n.startsWith('desktop_')) return 'writing';
  if (/write|append|edit|move|delete/.test(n)) return 'writing';
  if (/read|list|search|view|image/.test(n)) return 'reading';
  return 'thinking';
}

// ── status line ───────────────────────────────────────────────────────────────

function renderStatus() {
  const line = $('#statusline');
  line.innerHTML = '';
  clearInterval(S.statusTimer);
  const glow = !(S.cur && S.cur.running) && S.afterglow > Date.now();
  const withCapu = capuEnabled();
  // Capu stands on the input bar for the whole session: leave room above it
  $('#thread').classList.toggle('has-status', Boolean(S.cur && (S.cur.running || glow || withCapu)));
  if (!S.cur || (!S.cur.running && !glow)) {
    if (S.cur && withCapu && capu.director && !capu.grace && ['thinking', 'writing', 'reading', 'running', 'debugging', 'error', 'web', 'npm', 'git', 'tests', 'approval'].includes(capu.director.state)) capuSet('idle');
    return;
  }
  if (glow) {
    const label = h('span', { class: 'status-label', text: S.afterglowText || T('Hecho') });
    const inner = h('div', { class: 'inner done' }, label);
    line.append(inner);
    capuFitStatus(label);
    requestAnimationFrame(() => capuFitStatus(label));
    return;
  }
  const st = S.status || { kind: 'thinking', text: 'Pensando', since: Date.now() };
  if (withCapu && !capu.grace) capuSet(capuFromStatus(st));
  const inner = h('div', { class: `inner${withCapu ? '' : ' plain'}` }, withCapu ? null : DeizaRose(16, { loop: true }));
  const label = h('span', { class: 'status-label' });
  inner.append(label);
  line.append(inner);
  const tick = () => {
    label.innerHTML = '';
    if (st.kind === 'tool') {
      label.append(`${T(VERBS[st.name] || 'Preparando')} `, st.text ? h('em', { text: st.text }) : '', st.bytes > 400 ? ` · ${fmtBytes(st.bytes)}` : '');
    } else if (st.kind === 'running') {
      label.append(st.name === 'run_command' ? `${T('Ejecutando')} ` : `${T(VERBS[st.name] || 'Trabajando')} `, st.text ? h('em', { text: st.text }) : '', ` · ${fmtDuration(Date.now() - st.since)}`);
    } else {
      label.append(`${T(st.text || 'Pensando')}…`);
    }
    label.title = label.textContent;
    capuFitStatus(label);
  };
  tick();
  if (st.kind === 'running') S.statusTimer = setInterval(tick, 1000);
  capuFitStatus(label);
  requestAnimationFrame(() => capuFitStatus(label));
}

// ── composer ──────────────────────────────────────────────────────────────────

function renderComposer(hero) {
  const running = Boolean(S.cur && S.cur.running);
  const mode = S.cur ? S.cur.mode : S.defaultMode;
  const ta = h('textarea', {
    rows: '1', spellcheck: 'true',
    placeholder: hero ? T('Describe lo que quieres construir o arreglar…') : (running ? T('Escribe el siguiente paso; se enviará cuando termine…') : T('Pide un cambio, un arreglo o una app entera…')),
  });
  const draftKey = S.cur ? S.cur.id : (S.pendingFolder ? `_pending:${S.pendingFolder}` : '_new');
  let initDraft = S.drafts.get(draftKey);
  if (initDraft === undefined || initDraft === null) {
    initDraft = S.drafts.get('_active_input');
  }
  if (!initDraft) {
    try { initDraft = localStorage.getItem('deiza:code:draft') || ''; } catch {}
  }
  ta.value = initDraft || '';
  const atts = h('div', { class: 'atts' });
  const box = h('div', { class: 'composer' }, atts, ta);

  const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(280, ta.scrollHeight)}px`; };
  ta.addEventListener('input', () => {
    fit();
    sendBtn.disabled = sending || S.attachmentPending > 0 || !canSend();
    const k = S.cur ? S.cur.id : (S.pendingFolder ? `_pending:${S.pendingFolder}` : '_new');
    S.drafts.set(k, ta.value);
    S.drafts.set('_active_input', ta.value);
    try {
      if (ta.value.trim()) localStorage.setItem('deiza:code:draft', ta.value);
      else localStorage.removeItem('deiza:code:draft');
    } catch {}
  });
  setTimeout(fit, 0);

  const renderAtts = () => {
    atts.innerHTML = '';
    atts.classList.toggle('hidden', !S.images.length && !S.attachments.length && !S.attachmentPending);
    S.images.forEach((src, i) => {
      atts.append(h('div', { class: 'att' }, h('img', { src }), h('button', { title: T('Quitar'), onclick: () => { S.images.splice(i, 1); refreshAttachments(); } }, '×')));
    });
    for (const item of S.attachments) {
      const remove = h('button', { type: 'button', title: T('Quitar {f}', { f: item.name }), 'aria-label': T('Quitar {f}', { f: item.name }), onclick: () => {
        S.attachments = S.attachments.filter(a => a.id !== item.id);
        S.attachmentDrafts.set(attachmentDraftKey(), S.attachments.slice());
        refreshAttachments();
      } }, icon('x'));
      atts.append(h('div', { class: 'file-att', title: item.name }, icon(item.kind === 'folder' ? 'folder' : item.kind === 'image' ? 'image' : 'file'),
        h('span', { text: item.name }), item.size ? h('small', { text: fmtBytes(item.size) }) : null, remove));
    }
    if (S.attachmentPending) atts.append(h('span', { class: 'att-pending' }, h('span', { class: 'spin' }), T('Adjuntando…')));
  };
  renderAtts();

  ta.addEventListener('paste', (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) { e.preventDefault(); addAttachments(files); }
  });
  box.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove('drop');
    addAttachments(Array.from(e.dataTransfer?.files || []));
  });

  const picker = h('input', { type: 'file', multiple: true, class: 'hidden' });
  picker.onchange = () => { addAttachments(Array.from(picker.files)); picker.value = ''; };
  const imgBtn = h('button', { class: 'icon-btn', title: T('Adjuntar archivos e imágenes'), 'aria-label': T('Adjuntar archivos e imágenes'), onclick: () => picker.click() }, icon('attach'));
  const micBtn = h('button', { class: 'icon-btn mic-btn', title: T('Dictar: habla y Deiza lo escribe') }, icon('mic'));
  micBtn.onclick = () => startDictation();
  const browserBtn = h('button', { class: 'icon-btn', title: T('Navegador: inicia sesión en correo o Teams y pide la tarea desde Code.'), 'aria-label': T('Navegador'), onclick: openComputerBrowser }, icon('browser'));

  const modes = h('div', { class: 'modes', role: 'group', 'aria-label': T('Modo del agente') });
  const MODE_TIPS = { build: T('Build: autónomo, hace todo el trabajo'), copilot: T('Copilot: aprueba cada cambio y comando'), plan: T('Plan: solo lee y propone') };
  for (const m of ['build', 'copilot', 'plan']) {
    modes.append(h('button', {
      'data-mode': m, 'aria-pressed': String(mode === m), title: MODE_TIPS[m],
      onclick: async () => {
        S.defaultMode = m;
        localStorage.setItem('deiza:code:mode', m);
        if (S.cur) { S.cur.mode = m; await deiza.code.setMode({ id: S.cur.id, mode: m }); }
        for (const b of modes.children) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
        capuReact(m);
      },
    }, m === 'build' ? 'Build' : m === 'copilot' ? 'Copilot' : 'Plan'));
  }

  const folder = S.cur ? S.cur.folder : S.pendingFolder;
  const folderBtn = hero
    ? h('button', { class: 'folder-chip', title: folder ? tildeHome(folder) : T('Elegir carpeta del proyecto'), onclick: () => pickFolder() }, icon('folder'), h('span', { text: folder ? basename(folder) : T('Elegir carpeta…') }))
    : null;

  let sending = false;
  const canSend = () => Boolean(ta.value.trim() || S.images.length || S.attachments.length);
  const sendBtn = h('button', { class: `send${running ? ' stop' : ''}`, title: running ? T('Detener (Esc)') : T('Enviar (Intro)') }, icon(running ? 'stop' : 'send'));
  sendBtn.disabled = !running && (S.attachmentPending > 0 || !canSend());
  sendBtn.onclick = () => (S.cur && S.cur.running ? stopRun() : submit());

  const submit = async () => {
    const text = ta.value.trim();
    if (sending || S.attachmentPending || (!text && !S.images.length && !S.attachments.length)) return;
    if (S.cur && S.cur.running) {
      toast(T('Espera a que termine o detén la petición actual'));
      return;
    }
    const images = S.images.slice();
    const attachments = S.attachments.slice();
    sending = true;
    refreshAttachments();
    try {
      let id = S.cur && S.cur.id;
      if (!id) {
        let folder = S.pendingFolder;
        if (!folder) folder = await pickFolder();
        if (!folder) return;
        const meta = await deiza.code.create({ folder, mode: S.defaultMode, model: S.model, effort: S.effort });
        if (!meta || meta.error) { toast(T('No se pudo abrir esa carpeta')); return; }
        S.attachmentDrafts.set(meta.id, attachments.slice());
        S.drafts.set(meta.id, text);
        await openSession(meta.id);
        id = meta.id;
      }
      if (!S.cur || S.cur.id !== id) return;
      const imageCount = images.length + attachments.filter(a => a.kind === 'image').length;
      if (imageCount && modelInfo(S.cur.model).id === 'deiza-gas-4.5') toast(T('Gas no ve imágenes: cambia a Liquid 5.1 o Solid 5 si importan.'), 4200);
      capuReturnHome();
      const result = await deiza.code.send({ id, text, images, attachments: attachments.map(a => ({ id: a.id })), mode: S.cur.mode, model: S.cur.model, effort: S.cur.effort });
      if (result && (result.error || result.ok === false)) {
        const msg = (result.error === 'attachments' && result.message) || { auth: T('Inicia sesión en Deiza para usar Code'), busy: T('Ya hay una petición en curso'), folder: T('La carpeta del proyecto ya no existe'), empty: T('Escribe algo primero') }[result.error] || T('No se pudo enviar');
        toast(msg);
        return;
      }
      const ids = new Set(attachments.map(a => a.id));
      const remaining = (S.cur && S.cur.id === id ? S.attachments : (S.attachmentDrafts.get(id) || [])).filter(a => !ids.has(a.id));
      S.attachmentDrafts.set(id, remaining.slice());
      // A draft can move from the start page to a chosen project before it gets its session id.
      for (const [key, draft] of S.attachmentDrafts) S.attachmentDrafts.set(key, draft.filter(a => !ids.has(a.id)));
      if (S.cur && S.cur.id === id) {
        S.attachments = remaining;
        S.images = S.images.filter(src => !images.includes(src));
        const input = $('#composer-wrap textarea, .start textarea');
        if (input && input.value.trim() === text) {
          input.value = '';
          input.style.height = 'auto';
          S.drafts.delete(id);
          S.drafts.delete('_active_input');
          S.drafts.delete('_new');
          if (S.pendingFolder) S.drafts.delete(`_pending:${S.pendingFolder}`);
          try { localStorage.removeItem('deiza:code:draft'); } catch {}
        }
        if (picker) picker.value = '';
        S.cur.running = true;
        S.status = { kind: 'thinking', text: 'Pensando', since: Date.now() };
        stick = true;
        renderStatus();
        scrollToBottom(true);
      }
    } catch {
      toast(T('No se pudo enviar'));
    } finally {
      sending = false;
      refreshAttachments();
    }
  };

  ta.addEventListener('input', () => {
    if (hero || !capuEnabled() || !capu.director || (S.cur && S.cur.running) || capu.grace || dict) return;
    capuReturnHome();
    if (capu.director.state !== 'watch') capu.director.set('watch');
    clearTimeout(capu.watchTimer);
    capu.watchTimer = setTimeout(() => { if (capu.director.state === 'watch') capu.director.set('idle'); }, 4000);
  });
  ta.addEventListener('keydown', (e) => {
    if (dict && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); dict.finish(true); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!(S.cur && S.cur.running)) submit();
    }
  });

  box.append(h('div', { class: 'bar' }, imgBtn, micBtn, browserBtn, picker, modes, h('div', { class: 'grow' }), renderModelPill(), folderBtn, sendBtn));
  const hint = h('div', { class: 'hint' },
    h('span', { html: T('<kbd>Intro</kbd> enviar · <kbd>Mayús</kbd>+<kbd>Intro</kbd> salto de línea · <kbd>Esc</kbd> detener') }),
    h('div', { class: 'grow' }), ctxMeter());
  const frag = h('div', null, box, hero ? null : hint);
  box._ta = ta;
  box._attachments = renderAtts;
  box._refresh = () => {
    const run = Boolean(S.cur && S.cur.running);
    sendBtn.className = `send${run ? ' stop' : ''}`;
    sendBtn.innerHTML = '';
    sendBtn.append(icon(run ? 'stop' : 'send'));
    sendBtn.title = run ? T('Detener (Esc)') : T('Enviar (Intro)');
    sendBtn.disabled = !run && (sending || S.attachmentPending > 0 || !canSend());
  };
  box._changed = () => { fit(); box._refresh(); };
  if (dict) dict.attach(box);
  if (!hero) capuMount(box);
  return frag;
}

// ── context & quota ───────────────────────────────────────────────────────────

const kTok = (n) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
function ctxMeter() {
  const c = S.cur && S.cur.context;
  const el = h('button', { class: 'ctx', type: 'button', onclick: (e) => ctxPopover(e.currentTarget) });
  if (!c || !c.limit) {
    el.title = T('Contexto de la sesión: se mide en la primera respuesta.');
    el.append(ctxRing(0), h('span', { text: T('Contexto') }));
    return el;
  }
  const pct = Math.min(100, Math.round((c.used / c.limit) * 100));
  el.classList.toggle('warm', pct >= 50);
  el.classList.toggle('hot', pct >= 65);
  el.title = T('Contexto: {u} de {l} tokens ({p} %). Deiza compacta la conversación sola al 70 %.', { u: num(c.used), l: num(c.limit), p: pct });
  el.append(ctxRing(pct), h('span', { text: `${pct} % · ${kTok(c.used)} / ${kTok(c.limit)}` }));
  return el;
}
function ctxPopover(anchor) {
  const old = document.querySelector('.ctx-pop');
  if (old) { old.remove(); return; }
  const c = (S.cur && S.cur.context) || {};
  const pct = c.limit ? Math.min(100, Math.round((c.used / c.limit) * 100)) : 0;
  const running = Boolean(S.cur && S.cur.running);
  const pop = h('div', { class: 'ctx-pop', role: 'dialog' },
    h('div', { class: 'h', text: T('Contexto de la sesión') }),
    h('div', { class: 'big', text: c.limit ? `${num(c.used)} / ${num(c.limit)}` : '—' }),
    h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })),
    h('p', { text: T('Es lo que el modelo relee en cada paso: tus mensajes, el código que ha leído y la salida de los comandos. Al llegar al 70 % Deiza resume lo antiguo sola; compactar ahora libera espacio y abarata cada paso.') }),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary small', disabled: running || !c.used ? 'disabled' : null, onclick: async () => {
        const r = await deiza.code.compact({ id: S.cur.id });
        pop.remove();
        if (r && r.compacted) toast(T('Contexto compactado'));
        else toast(r && r.error === 'busy' ? T('Espera a que termine la petición') : T('Todavía no hay nada que compactar'));
      } }, T('Compactar ahora')),
      h('button', { class: 'btn ghost small', onclick: () => pop.remove() }, T('Cerrar'))));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
  const off = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
}
function ctxRing(pct) {
  const r = 6, c = 2 * Math.PI * r;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'ring');
  svg.innerHTML = `<circle cx="8" cy="8" r="${r}" class="bg"/><circle cx="8" cy="8" r="${r}" class="fg" stroke-dasharray="${(c * pct / 100).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 8 8)"/>`;
  return svg;
}
function updateCtxMeter() {
  const old = $('#composer-wrap .ctx');
  if (old) old.replaceWith(ctxMeter());
}

/** Banner above the composer while the courtesy margin is in use, or once everything ran out. */
function renderQuotaBanner() {
  const us = S.usage;
  if (!us || (us.state !== 'grace' && us.state !== 'exhausted')) return null;
  const grace = us.state === 'grace';
  const stage = h('div', { class: 'capu capu-mini' });
  stage.innerHTML = Capu.toSVG(Capu.frameAt(grace ? 'wilt' : 'sleep', 0), { px: 1, crop: Capu.sceneBox([grace ? 'wilt' : 'sleep'], 1) });
  const when = us.reset_in_seconds ? fmtDuration(us.reset_in_seconds * 1000) : '';
  const left = grace && us.grace_limit ? Math.max(0, Math.round((us.grace_remaining / us.grace_limit) * 100)) : 0;
  return h('div', { class: `quota-banner ${us.state}` }, stage,
    h('div', { class: 'qb' },
      h('div', { class: 'h', text: grace ? T('Límite alcanzado · margen de cortesía') : T('Sin uso hasta dentro de {t}', { t: when || T('unas horas') }) }),
      h('p', { text: grace
        ? T('Deiza termina lo que está haciendo, lo deja estable y escribe el traspaso en DEIZA_HANDOFF.md. Queda un {p} % del margen.', { p: left })
        : T('Lo que quedó a medias está en DEIZA_HANDOFF.md: ábrelo aquí o pégaselo a la siguiente sesión.') })),
    !grace && S.cur ? h('button', { class: 'btn ghost small', onclick: () => openFile('DEIZA_HANDOFF.md', 'rendered') }, T('Abrir traspaso')) : null);
}
function applyQuota(q) {
  const prev = S.usage && S.usage.state;
  S.usage = { ...(S.usage || {}), ...q };
  if (q.state === 'grace') { capu.grace = true; if (capuEnabled()) capuSet('grace'); }
  renderAccount();
  if ((S.usage.state || '') !== (prev || '') && S.cur) {
    const wrap = $('#composer-wrap');
    const old = wrap && wrap.querySelector('.quota-banner');
    const b = renderQuotaBanner();
    if (old) old.remove();
    if (b && wrap) wrap.prepend(b);
  }
}

// ── model & effort picker ─────────────────────────────────────────────────────

function currentChoice() {
  return {
    model: modelInfo((S.cur && S.cur.model) || S.model).id,
    effort: (S.cur && S.cur.effort) || S.effort,
  };
}

function effortBars(effort) {
  const lvl = effortLevel(effort);
  const wrap = h('span', { class: `bars lvl-${lvl}`, 'aria-hidden': 'true' });
  for (let i = 1; i <= 5; i++) wrap.append(h('i', { class: i <= lvl ? 'on' : '' }));
  return wrap;
}

function renderModelPill() {
  const btn = h('button', { class: 'model-pill', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
  btn._paint = () => {
    const c = currentChoice();
    btn.innerHTML = '';
    btn.append(h('span', { class: 'mp-name', text: modelInfo(c.model).name }),
      h('span', { class: `mp-eff${c.effort === 'max' ? ' omni' : ''}`, text: T(effortInfo(c.effort).name) }), icon('down', 'i mp-chev'));
    btn.title = `${T('Modelo')}: ${modelInfo(c.model).name} · ${T('Esfuerzo')}: ${T(effortInfo(c.effort).name)}`;
  };
  btn._paint();
  btn.onclick = (e) => { e.stopPropagation(); toggleModelMenu(btn); };
  return btn;
}

function repaintModelPills() {
  for (const b of document.querySelectorAll('.model-pill')) if (b._paint) b._paint();
}

async function chooseModel(patch) {
  const before = currentChoice();
  const c = { ...before, ...patch };
  if (patch.model && modelInfo(patch.model).id !== modelInfo(before.model).id) capuReact(CAPU_MODEL[modelInfo(patch.model).id] || 'mid');
  else if (patch.effort && patch.effort !== before.effort) capuEffort(before.effort, patch.effort);
  S.model = c.model;
  S.effort = c.effort;
  if (S.cur) { S.cur.model = c.model; S.cur.effort = c.effort; }
  repaintModelPills();
  await deiza.code.setModel({ id: S.cur ? S.cur.id : null, ...patch });
}

// ── effort slider ─────────────────────────────────────────────────────────────
// A thick track of small cells that light up towards the handle, with a soft aura around it.
// Drag, click or use the arrow keys; it settles on one of the five levels.

const reduceMotion = () => capuReduced();

function effortSlider(value, onPick) {
  const idxOf = (id) => Math.max(0, EFFORTS.findIndex(e => e.id === id));
  let pos = idxOf(value);          // 0..4, fractional while dragging or animating
  let level = pos;
  const label = h('span', { class: 'eff-level' });
  const help = h('span', { class: 'eff-help', tabindex: '0', 'aria-label': T('Qué cambia el esfuerzo') }, '?');
  const tip = h('span', { class: 'eff-tip', role: 'tooltip' });
  help.append(tip);
  const canvas = h('canvas', { class: 'eff-canvas', 'aria-hidden': 'true' });
  const knob = h('span', { class: 'eff-knob' });
  const track = h('div', { class: 'eff-track', role: 'slider', tabindex: '0', 'aria-label': T('Esfuerzo'), 'aria-valuemin': '1', 'aria-valuemax': '5' }, canvas, knob);
  const root = h('div', { class: 'eff' },
    h('div', { class: 'eff-head' }, h('span', { class: 'eff-title', text: T('Esfuerzo') }), label, h('span', { class: 'grow' }), help),
    h('div', { class: 'eff-ends' }, h('span', { text: T('Más rápido') }), h('span', { text: T('Más inteligente') })),
    track);

  const rose = (() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--rose').trim().split(/\s+/);
    return { h: parseFloat(v[0]) || 354, s: parseFloat(v[1]) || 48 };
  })();
  const noise = (x, y) => { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); };
  const KNOB_W = 26;

  const paintLabels = () => {
    const i = Math.round(level);
    const e = EFFORTS[i];
    label.textContent = T(e.name);
    label.classList.toggle('omni', e.id === 'max');
    tip.textContent = T(e.desc);
    track.setAttribute('aria-valuenow', String(i + 1));
    track.setAttribute('aria-valuetext', T(e.name));
  };

  let raf = 0;
  let dragging = false;
  let burstAt = -1e9;              // when Omnisciente was reached (drives the shockwave)
  let committed = EFFORTS[Math.round(pos)].id;
  const draw = (now = performance.now()) => {
    const dpr = window.devicePixelRatio || 1;
    const W = track.clientWidth;
    const H = track.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const pad = KNOB_W / 2 + 4;
    const kx = pad + (pos / 4) * (W - pad * 2);
    const strength = 0.35 + (pos / 4) * 0.65;
    const motion = !reduceMotion();
    const omni = pos > 3.98;
    const live = omni && motion;
    const burst = motion ? Math.max(0, 1 - (now - burstAt) / 950) : 0;     // 1 → 0 over the shockwave
    const waveR = (1 - burst) * (W + 60);
    // aura behind the handle; at Omnisciente it breathes and swells with the burst
    const auraR = 40 + pos * 18 + (live ? 10 * Math.sin(now / 480) : 0) + burst * 60;
    const auraA = 0.30 * strength + (omni ? 0.12 : 0) + burst * 0.35;
    const aura = g.createRadialGradient(kx, H / 2, 2, kx, H / 2, auraR);
    aura.addColorStop(0, `hsla(${rose.h}, ${rose.s + 24}%, 72%, ${Math.min(0.85, auraA)})`);
    aura.addColorStop(0.55, `hsla(${rose.h}, ${rose.s + 10}%, 62%, ${Math.min(0.5, auraA * 0.35)})`);
    aura.addColorStop(1, `hsla(${rose.h}, ${rose.s}%, 60%, 0)`);
    g.fillStyle = aura;
    g.fillRect(0, 0, W, H);
    // cells
    const cell = 3.6;
    const gap = 2.4;
    const step = cell + gap;
    const rows = Math.max(3, Math.floor((H - 6) / step));
    const cols = Math.floor((W - 6) / step);
    const oy = (H - rows * step + gap) / 2;
    const ox = (W - cols * step + gap) / 2;
    const sparkTick = Math.floor(now / 110);
    for (let c = 0; c < cols; c++) {
      const x = ox + c * step;
      const lit = x < kx - KNOB_W / 2 - 1;
      for (let r = 0; r < rows; r++) {
        const y = oy + r * step;
        const n = noise(c, r);
        let a;
        let l;
        let sat = lit ? rose.s + 8 : 8;
        if (lit) {
          const t = Math.min(1, x / Math.max(1, kx - KNOB_W / 2));
          const edge = 1 - Math.abs((r + 0.5) / rows - 0.5) * 0.9;           // brighter towards the middle rows
          a = (0.12 + Math.pow(t, 1.5) * 0.95 * strength) * (0.5 + 0.5 * n) * edge;
          l = 58 + t * 22;
          if (live) {
            // energy flowing into the handle
            const flow = Math.pow(Math.max(0, Math.sin((x / W) * 9 - now / 260 + r * 0.35)), 10);
            a += flow * 0.55;
            l += flow * 14;
            // sparks
            if (noise(c * 7 + sparkTick, r * 13 + sparkTick * 3) > 0.988) { a = 1; l = 94; sat = 60; }
          }
        } else {
          a = 0.06 + 0.06 * n;
          l = 80;
        }
        if (burst > 0) {
          // shockwave from the handle across the whole track
          const d = Math.hypot(x - kx, (y - H / 2) * 1.6);
          const ring = Math.exp(-Math.pow((d - waveR) / 16, 2)) * burst;
          a += ring * 0.9;
          l += ring * 18;
          sat = Math.max(sat, rose.s + 10);
        }
        g.fillStyle = `hsla(${rose.h}, ${sat}%, ${Math.min(96, l)}%, ${Math.min(1, a).toFixed(3)})`;
        g.fillRect(x, y, cell, cell);
      }
    }
    // level marks
    for (let i = 0; i < 5; i++) {
      const mx = pad + (i / 4) * (W - pad * 2);
      if (Math.abs(mx - kx) < KNOB_W / 2 + 2) continue;
      g.fillStyle = mx < kx ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.28)';
      g.beginPath();
      g.arc(mx, H / 2, 1.9, 0, Math.PI * 2);
      g.fill();
    }
    knob.style.transform = `translateX(${kx - KNOB_W / 2}px)`;
    knob.style.setProperty('--glow', String(Math.min(1, 0.25 + (pos / 4) * 0.55 + burst * 0.4)));
    root.classList.toggle('omni', omni);
    if ((live || burst > 0) && root.isConnected && !dragging) raf = requestAnimationFrame(draw);
  };

  const ignite = () => {
    if (reduceMotion()) return;
    burstAt = performance.now();
    root.classList.remove('burst');
    void root.offsetWidth;                                                    // restart the CSS pop
    root.classList.add('burst');
    setTimeout(() => root.classList.remove('burst'), 900);
  };

  const animateTo = (target) => {
    cancelAnimationFrame(raf);
    const from = pos;
    const t0 = performance.now();
    const dur = reduceMotion() ? 0 : 220;
    const frame = (now) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      pos = from + (target - from) * (1 - Math.pow(1 - k, 3));
      if (k < 1 && root.isConnected) { draw(now); raf = requestAnimationFrame(frame); return; }
      pos = target;
      if (target === 4 && from < 3.98) ignite();
      draw(now);
    };
    raf = requestAnimationFrame(frame);
  };

  const commit = (i) => {
    i = Math.max(0, Math.min(4, Math.round(i)));
    level = i;
    paintLabels();
    // A drag that ends exactly on a level (e.g. pulled past the end) still counts as a change:
    // compare with what was last saved, not with where the handle was a moment ago.
    if (i === 4 && pos >= 3.98 && committed !== 'max') { pos = 3.97; }
    animateTo(i);
    if (EFFORTS[i].id !== committed) { committed = EFFORTS[i].id; onPick(committed); }
  };

  const fromX = (clientX) => {
    const r = track.getBoundingClientRect();
    const pad = KNOB_W / 2 + 4;
    return Math.max(0, Math.min(4, ((clientX - r.left - pad) / (r.width - pad * 2)) * 4));
  };
  // A drag follows the pointer anywhere in the window and always ends in a commit, even when the
  // button is released outside the track or the window: a missed pointerup used to leave the
  // label on a level that was never saved.
  let dragId = null;
  const move = (e) => {
    if (!dragging || (dragId !== null && e.pointerId !== dragId)) return;
    pos = fromX(e.clientX);
    level = pos;
    paintLabels();
    draw();
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    dragId = null;
    track.classList.remove('drag');
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('pointercancel', end, true);
    window.removeEventListener('blur', end);
    commit(pos);
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    dragId = e.pointerId;
    try { track.setPointerCapture(e.pointerId); } catch { /* the window-level listeners cover it */ }
    track.classList.add('drag');
    cancelAnimationFrame(raf);
    pos = fromX(e.clientX);
    level = pos;
    paintLabels();
    draw();
    track.focus();
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', end);
  });
  track.addEventListener('lostpointercapture', end);
  track.addEventListener('keydown', (e) => {
    const i = Math.round(level);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); commit(i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); commit(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); commit(0); }
    else if (e.key === 'End') { e.preventDefault(); commit(4); }
  });

  paintLabels();
  requestAnimationFrame(() => draw());
  root._set = (id) => { committed = id; level = idxOf(id); paintLabels(); animateTo(level); };
  if (committed === 'max') setTimeout(ignite, 90);
  return root;
}

// ── model menu ────────────────────────────────────────────────────────────────

let modelMenu = null;
function closeModelMenu() {
  if (!modelMenu) return;
  const m = modelMenu;
  modelMenu = null;
  m.el.remove();
  m.btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('mousedown', m.onDown, true);
  document.removeEventListener('keydown', m.onKey, true);
  window.removeEventListener('resize', closeModelMenu);
}

function toggleModelMenu(btn) {
  if (modelMenu) {
    const same = modelMenu.btn === btn;
    closeModelMenu();
    if (same) return;
  }
  const c = currentChoice();
  const el = h('div', { class: 'model-menu', role: 'dialog', 'aria-label': T('Modelo y esfuerzo') });
  const list = h('div', { class: 'mm-list', role: 'menu' });
  for (const m of MODELS) {
    const on = m.id === c.model;
    list.append(h('button', { class: `mm-row${on ? ' on' : ''}`, role: 'menuitemradio', 'aria-checked': String(on), onclick: () => { chooseModel({ model: m.id }); closeModelMenu(); } },
      h('span', { class: 'mm-main' }, h('span', { class: 'mm-title', text: m.name }), h('span', { class: 'mm-sub', text: T(m.desc) })),
      h('span', { class: 'mm-check' }, on ? icon('check') : null)));
  }
  const slider = effortSlider(c.effort, (effort) => chooseModel({ effort }));
  el.append(list, h('div', { class: 'mm-sep' }), slider);
  if (c.model === 'deiza-gas-4.5') el.append(h('p', { class: 'mm-note', text: T('Gas no razona: el esfuerzo solo cambia cuánto explora y verifica antes de terminar.') }));
  el.style.visibility = 'hidden';
  document.body.append(el);
  const r = btn.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  el.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w))}px`;
  el.style.top = `${r.top > hgt + 24 ? r.top - hgt - 8 : r.bottom + 8}px`;
  el.style.visibility = '';
  btn.setAttribute('aria-expanded', 'true');
  const onDown = (e) => { if (!el.contains(e.target) && !btn.contains(e.target)) closeModelMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeModelMenu(); btn.focus(); } };
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeModelMenu);
  modelMenu = { el, btn, onDown, onKey };
  el.querySelector('.mm-row.on')?.focus();
}

// ── dictation ─────────────────────────────────────────────────────────────────

const DICTATION_MAX_MS = 5 * 60 * 1000;
let dict = null;

function composerBox() {
  return $('#composer-wrap .composer') || $('.start .composer');
}

async function startDictation() {
  if (dict) return;
  capuReturnHome();
  const allowed = await deiza.micAccess();
  if (!allowed) { toast(T('Deiza no tiene permiso para usar el micrófono. Actívalo en los ajustes del sistema.'), 5200); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    toast(T('No se pudo abrir el micrófono'));
    return;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  let rec;
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined); } catch {
    stream.getTracks().forEach(t => t.stop());
    toast(T('No se pudo abrir el micrófono'));
    return;
  }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  const clock = h('span', { class: 'rec-time', text: '0:00' });
  const canvas = h('canvas', { class: 'rec-wave' });
  const cancelBtn = h('button', { class: 'icon-btn', title: T('Descartar (Esc)') }, icon('x'));
  const doneBtn = h('button', { class: 'send', title: T('Transcribir (Intro)') }, icon('check'));
  const strip = h('div', { class: 'dictation' }, h('span', { class: 'rec-dot' }), clock, canvas, cancelBtn, doneBtn);

  const ac = new AudioContext();
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  ac.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const levels = [];
  const started = Date.now();
  let raf = 0;
  let lastPush = 0;
  const draw = (t) => {
    raf = requestAnimationFrame(draw);
    const elapsed = Date.now() - started;
    const secs = Math.floor(elapsed / 1000);
    clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (elapsed > DICTATION_MAX_MS) { finish(true); return; }
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; sum += v * v; }
    const level = Math.min(1, Math.sqrt(sum / samples.length) * 4.2);
    if (t - lastPush > 55) { levels.push(level); lastPush = t; }
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const step = 5;
    const count = Math.floor(cw / step);
    while (levels.length > count) levels.shift();
    g.fillStyle = getComputedStyle(canvas).color;
    for (let i = 0; i < levels.length; i++) {
      const x = cw - (levels.length - i) * step;
      const bh = Math.max(2, levels[i] * (ch - 4));
      g.globalAlpha = 0.35 + 0.65 * (i / levels.length);
      g.fillRect(x, (ch - bh) / 2, 3, bh);
    }
    g.globalAlpha = 1;
  };
  raf = requestAnimationFrame(draw);

  let box = null;
  const attach = (b) => {
    box = b;
    if (!b) return;
    b.classList.add('dictating');
    b.append(strip);
  };
  let done = false;
  const finish = async (keep) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    const stopped = rec.state === 'inactive' ? Promise.resolve() : new Promise((res) => { rec.onstop = res; });
    try { if (rec.state !== 'inactive') rec.stop(); } catch { /* already stopped */ }
    stream.getTracks().forEach(t => t.stop());
    ac.close().catch(() => {});
    const durationMs = Date.now() - started;
    const cleanup = () => {
      strip.remove();
      if (box) box.classList.remove('dictating');
      const d = capuDirector();
      if (d && d.state === 'listening') d.set(dict && dict.capuWas && dict.capuWas !== 'listening' ? dict.capuWas : 'idle');
      if (d && keep) d.react('notes');
      dict = null;
    };
    if (!keep || durationMs < 600) { cleanup(); return; }
    strip.classList.add('busy');
    strip.innerHTML = '';
    strip.append(h('span', { class: 'spin' }), h('span', { class: 'rec-busy', text: T('Transcribiendo…') }));
    await stopped;
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    const r = await deiza.code.transcribe({ audio: await blob.arrayBuffer(), mime: blob.type, durationMs, language: S.language });
    cleanup();
    if (!r || r.error || !r.text) {
      const msg = { auth: T('Inicia sesión en Deiza para dictar'), rate: T('Demasiadas transcripciones seguidas. Espera un momento.'), offline: T('Sin conexión con deiza.org.'), empty: T('No se oyó nada. Prueba otra vez.') }[r && r.error] || (r && !r.error && !r.text ? T('No se oyó nada. Prueba otra vez.') : T('No se pudo transcribir el audio'));
      toast(msg, 4200);
      return;
    }
    const b = composerBox();
    const ta = b && b._ta;
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const glue = before && !/\s$/.test(before) ? ' ' : '';
    ta.value = `${before}${glue}${r.text}${after && !/^\s/.test(after) ? ' ' : ''}${after}`;
    const caret = before.length + glue.length + r.text.length;
    ta.focus();
    ta.setSelectionRange(caret, caret);
    if (b._changed) b._changed();
  };
  cancelBtn.onclick = () => finish(false);
  doneBtn.onclick = () => finish(true);
  rec.start(1000);
  dict = { finish, attach };
  const capuWas = capuDirector() ? capuDirector().state : 'idle';
  if (capuDirector()) { capuReturnHome(); capuDirector().set('listening'); }
  dict.capuWas = capuWas;
  attach(composerBox());
}

function refreshComposerState() {
  const box = $('#composer-wrap .composer');
  if (box && box._refresh) box._refresh();
}

function stopRun() {
  if (!S.cur || !S.cur.running) return;
  deiza.code.abort(S.cur.id);
  capuReact('halt');
  S.status = { kind: 'thinking', text: 'Deteniendo', since: Date.now() };
  renderStatus();
}

async function handleDroppedPath(p) {
  if (!p) return;
  const r = await deiza.code.create({ folder: p, mode: S.defaultMode });
  if (r && !r.error) { await refreshSessions(); openSession(r.id); }
  else toast('Suelta una carpeta para abrirla en Code');
}

// ── side panel ────────────────────────────────────────────────────────────────

function togglePanel(tab) {
  if (S.panel.open) S.panel.open = false;
  else { S.panel.open = true; S.panel.tab = tab || S.panel.tab || 'files'; }
  localStorage.setItem('deiza:panel', S.panel.open ? '1' : '0');
  renderPanel();
  if (S.cur) renderThreadHeadTabs();
}

function renderThreadHeadTabs() {
  const b = $('#thread-head .panel-toggle');
  if (b) b.setAttribute('aria-pressed', String(S.panel.open));
}

function renderPanel() {
  const panel = $('#panel');
  const show = Boolean(S.cur && S.panel.open);
  document.body.classList.toggle('panel-closed', !show);
  if (S.panel.width) panel.style.width = `${S.panel.width}px`;
  panel.innerHTML = '';
  if (!show) return;
  const changes = collectChanges();
  const tab = (id, label, extra) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(S.panel.tab === id), onclick: () => { S.panel.tab = id; renderPanel(); renderThreadHeadTabs(); } }, label, extra);
  panel.append(h('div', { class: 'pn-tabs', role: 'tablist' },
    tab('files', 'Archivos'),
    tab('changes', 'Cambios', changes.size ? h('span', { class: 'count', text: String(changes.size) }) : null),
    tab('view', S.panel.file ? basename(S.panel.file.rel) : 'Vista previa'),
    h('div', { class: 'head-spacer', style: { flex: '1' } }),
    h('button', { class: 'icon-btn', title: 'Cerrar panel', onclick: () => { S.panel.open = false; localStorage.setItem('deiza:panel', '0'); renderPanel(); renderThreadHeadTabs(); } }, icon('x'))));
  const body = h('div', { class: 'pn-body' });
  panel.append(body);
  if (S.panel.tab === 'files') renderTree(body);
  else if (S.panel.tab === 'changes') renderChanges(body, changes);
  else renderViewer(body);
}

function collectChanges() {
  const map = new Map();
  if (!S.cur) return map;
  for (const it of S.cur.items) {
    if (it.k !== 'tool' || it.status !== 'ok') continue;
    const d = it.detail || {};
    if (d.diff && d.path) {
      const c = map.get(d.path) || { path: d.path, added: 0, removed: 0, diffs: [], isNew: false };
      c.added += d.diff.added;
      c.removed += d.diff.removed;
      c.diffs.push(d.diff);
      if (d.diff.isNew && c.diffs.length === 1) c.isNew = true;
      map.set(d.path, c);
    } else if (it.name === 'delete_path' && d.path) {
      map.set(d.path, { path: d.path, deleted: true, added: 0, removed: 0, diffs: [] });
    }
  }
  return map;
}

async function renderTree(body) {
  const root = h('div', { class: 'tree' });
  body.append(h('div', { class: 'viewer-bar' }, h('span', { class: 'path', text: tildeHome(S.cur.folder) }),
    h('button', { class: 'icon-btn', title: 'Actualizar', onclick: () => { S.panel.tree.clear(); renderPanel(); } }, icon('refresh')),
    h('button', { class: 'icon-btn', title: 'Mostrar en la carpeta', onclick: () => deiza.openPath(S.cur.folder) }, icon('reveal'))), root);
  await fillDir(root, '');
}

async function fillDir(container, rel) {
  let entries = S.panel.tree.get(rel);
  if (!entries) {
    const r = await deiza.code.fsList({ id: S.cur.id, rel });
    entries = (r && r.entries) || [];
    S.panel.tree.set(rel, entries);
  }
  container.innerHTML = '';
  if (!entries.length && rel === '') container.append(h('div', { class: 'pn-empty', text: 'Carpeta vacía. Lo que cree Deiza aparecerá aquí.' }));
  for (const e of entries) {
    if (e.dir) {
      const open = S.panel.expanded.has(e.rel);
      const kids = h('div', { class: `children${open ? '' : ' hidden'}` });
      const btn = h('button', { class: 'dir', title: e.rel }, icon(open ? 'folder' : 'folder'), h('span', { text: e.name }));
      btn.onclick = async () => {
        if (S.panel.expanded.has(e.rel)) { S.panel.expanded.delete(e.rel); kids.classList.add('hidden'); }
        else { S.panel.expanded.add(e.rel); kids.classList.remove('hidden'); if (!kids.childNodes.length) await fillDir(kids, e.rel); }
      };
      container.append(btn, kids);
      if (open) fillDir(kids, e.rel);
    } else {
      const cur = S.panel.file && S.panel.file.rel === e.rel;
      container.append(h('button', { class: cur ? 'cur' : '', title: e.rel, onclick: () => openFile(e.rel) }, icon('file'), h('span', { text: e.name })));
    }
  }
}

function renderChanges(body, changes) {
  if (!changes.size) { body.append(h('div', { class: 'pn-empty', text: 'Todavía no hay cambios en esta sesión.' })); return; }
  const list = h('div', { class: 'changes' });
  for (const c of changes.values()) {
    list.append(h('button', { onclick: () => { S.panel.file = { rel: c.path, diffs: c.diffs, mode: 'diff' }; S.panel.tab = 'view'; S.panel.view = 'diff'; renderPanel(); renderThreadHeadTabs(); } },
      icon('file'), h('span', { class: 'p', text: c.path }),
      c.deleted ? h('span', { class: 'tool-meta' }, h('span', { class: 'del', text: 'borrado' }))
        : h('span', { class: 'tool-meta' }, c.isNew ? h('span', { class: 'add', text: 'nuevo' }) : null, h('span', { class: 'add', text: `+${c.added}` }), h('span', { class: 'del', text: `−${c.removed}` }))));
  }
  body.append(list);
}

async function openFile(rel, view) {
  if (!S.cur || !rel) return;
  rel = String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
  const data = await deiza.code.fsRead({ id: S.cur.id, rel });
  if (!data || data.error) { toast(data && data.error === 'missing' ? `No existe ${rel}` : `No se puede abrir ${rel}`); return; }
  if (data.kind === 'dir') { S.panel.tab = 'files'; S.panel.open = true; S.panel.expanded.add(rel); renderPanel(); renderThreadHeadTabs(); return; }
  S.panel.file = data;
  S.panel.view = view || (/\.html?$/i.test(rel) ? 'page' : /\.md$/i.test(rel) ? 'rendered' : 'code');
  S.panel.open = true;
  S.panel.tab = 'view';
  localStorage.setItem('deiza:panel', '1');
  renderPanel();
  renderThreadHeadTabs();
}

function renderViewer(body) {
  const f = S.panel.file;
  const viewer = h('div', { class: 'viewer' });
  body.append(viewer);
  body.style.overflow = 'hidden';
  if (!f) {
    const url = h('input', { class: 'url', placeholder: 'http://localhost:5173', value: S.panel.url || '' });
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter' && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url.value.trim())) { S.panel.url = url.value.trim(); renderPanel(); } });
    viewer.append(h('div', { class: 'viewer-bar' }, icon('globe'), url));
    if (S.panel.url) {
      viewer.append(h('div', { class: 'viewer-body' }, h('iframe', { src: S.panel.url, sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads' })));
    } else {
      viewer.append(h('div', { class: 'pn-empty', html: 'Abre un archivo desde <b>Archivos</b> o desde cualquier tarjeta de la conversación.<br>Las páginas HTML se ven en vivo aquí. Para un servidor local, escribe su dirección arriba.' }));
    }
    return;
  }
  const bar = h('div', { class: 'viewer-bar' });
  viewer.append(bar);
  const content = h('div', { class: 'viewer-body' });
  viewer.append(content);

  if (f.mode === 'diff') {
    bar.append(h('span', { class: 'path', text: f.rel }), h('button', { class: 'btn quiet small', onclick: () => openFile(f.rel) }, icon('eye'), 'Ver archivo'));
    const wrap = h('div', { style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' } });
    for (const d of f.diffs) wrap.append(renderDiff(d));
    content.style.overflow = 'auto';
    content.append(wrap);
    return;
  }

  const isHtml = /\.html?$/i.test(f.rel);
  const isSvg = /\.svg$/i.test(f.rel);
  const isMd = /\.md$/i.test(f.rel);
  bar.append(h('span', { class: 'path', text: f.rel, title: f.full }));
  if (isHtml || isSvg || isMd) {
    const modes = isMd ? [['rendered', 'Lectura'], ['code', 'Código']] : [['page', isSvg ? 'Imagen' : 'Página'], ['code', 'Código']];
    const seg = h('div', { class: 'seg-mini' });
    for (const [m, label] of modes) seg.append(h('button', { 'aria-pressed': String(S.panel.view === m), onclick: () => { S.panel.view = m; renderPanel(); } }, label));
    bar.append(seg);
  }
  bar.append(h('button', { class: 'icon-btn', title: 'Recargar', onclick: () => openFile(f.rel, S.panel.view) }, icon('refresh')));
  if (isHtml) bar.append(h('button', { class: 'icon-btn', title: 'Abrir en una ventana', onclick: () => deiza.code.openPreviewWindow({ url: f.url, title: f.rel }) }, icon('window')));
  bar.append(h('button', { class: 'icon-btn', title: 'Abrir con la app predeterminada', onclick: () => deiza.code.fsOpen({ id: S.cur.id, rel: f.rel }) }, icon('external')));
  bar.append(h('button', { class: 'icon-btn', title: 'Mostrar en la carpeta', onclick: () => deiza.code.fsReveal({ id: S.cur.id, rel: f.rel }) }, icon('reveal')));

  if ((isHtml || isSvg) && S.panel.view === 'page') {
    content.append(h('iframe', { src: `${f.url}?v=${Math.round(f.mtime || Date.now())}`, sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads' }));
    return;
  }
  if (f.kind === 'image') {
    content.style.overflow = 'auto';
    content.append(h('div', { class: 'img-wrap' }, h('img', { src: `${f.url}?v=${Math.round(f.mtime || 0)}`, alt: f.rel })), h('div', { class: 'pn-empty', style: { padding: '8px' }, text: fmtBytes(f.size) }));
    return;
  }
  if (f.kind !== 'text') {
    content.append(h('div', { class: 'pn-empty' }, f.kind === 'large' ? `Archivo grande (${fmtBytes(f.size)}): ábrelo con su aplicación.` : 'Archivo binario: ábrelo con su aplicación.',
      h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn ghost small', onclick: () => deiza.code.fsOpen({ id: S.cur.id, rel: f.rel }) }, 'Abrir'))));
    return;
  }
  content.style.overflow = 'auto';
  if (isMd && S.panel.view === 'rendered') {
    const md = h('div', { class: 'prose md-view sel' });
    updateProse(md, { text: f.content }, true);
    content.append(md);
    return;
  }
  const lines = f.content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const code = h('code');
  try {
    code.innerHTML = f.lang && hljs.getLanguage(f.lang) && f.content.length < 400000 ? hljs.highlight(f.content, { language: f.lang }).value : esc(f.content);
  } catch { code.textContent = f.content; }
  content.append(h('div', { class: 'codeview sel' }, h('div', { class: 'gut', text: lines.map((_, i) => i + 1).join('\n') }), h('pre', null, code)));
}

function initResizer() {
  const rz = $('#resizer');
  rz.addEventListener('mousedown', (e) => {
    e.preventDefault();
    rz.classList.add('drag');
    const startX = e.clientX;
    const startW = $('#panel').getBoundingClientRect().width;
    for (const f of document.querySelectorAll('iframe')) f.style.pointerEvents = 'none';
    const move = (ev) => {
      const w = Math.max(320, Math.min(window.innerWidth * 0.72, startW - (ev.clientX - startX)));
      $('#panel').style.width = `${w}px`;
      S.panel.width = Math.round(w);
    };
    const up = () => {
      rz.classList.remove('drag');
      for (const f of document.querySelectorAll('iframe')) f.style.pointerEvents = '';
      localStorage.setItem('deiza:panel:w', String(S.panel.width));
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

// ── events from the main process ──────────────────────────────────────────────

function onCodeEvent({ id, seq, ev }) {
  if (ev && ev.t === 'quota') { applyQuota(ev); return; }
  if (ev && ev.t === 'context_set') {
    if (S.cur && S.cur.id === id) { S.cur.context = { ...(S.cur.context || {}), used: ev.used, limit: ev.limit, estimated: true }; updateCtxMeter(); }
    return;
  }
  if (!S.cur || S.cur.id !== id) {
    if (ev.t === 'turn_end') refreshSessions();
    return;
  }
  if (S.loading === id || seq <= (S.cur.seq || 0)) return;
  S.cur.seq = seq;
  if (ev.t === 'status') {
    S.status = { ...ev, since: Date.now() };
    if (!S.cur.running) S.cur.running = true;
    renderStatus();
    return;
  }
  if (ev.t === 'context') { S.cur.context = { used: ev.used, limit: ev.limit, model: ev.model, estimated: ev.estimated }; updateCtxMeter(); return; }
  if (capuEnabled()) {
    if (ev.t === 'text') { if (!capu.grace) capuSet('writing'); }
    if (ev.t === 'error') capuSet(ev.code === 'usage' ? 'exhausted' : 'error');
    if (ev.t === 'tool_end') {
      if (ev.status === 'error') { capu.fails++; capuSet(capu.fails >= 3 ? 'debugging' : 'error'); } else if (ev.status === 'ok') capu.fails = 0;
    }
  }
  const changed = DeizaTranscript.apply(S.cur.items, ev);
  if (ev.t === 'user') {
    S.cur.running = true;
    upsert(changed);
    refreshComposerState();
    scrollToBottom(true);
    return;
  }
  if (ev.t === 'turn_end' || ev.t === 'reverted') {
    saveDraft();
    if (ev.t === 'turn_end') {
      S.cur.running = false; S.status = null;
      const ok = ev.stopReason === 'done';
      S.afterglow = Date.now() + (ok ? 2600 : 0);
      S.afterglowText = ok ? T('Hecho') : '';
      capu.fails = 0;
      if (capuEnabled()) { if (ok) capuSet('done'); else capuSet('idle'); }
      capu.grace = false;
      if (ok) setTimeout(() => { if (S.cur && !S.cur.running) renderStatus(); }, 2700);
    }
    const keep = $('#scroller').scrollTop;
    renderThread();
    if (stick) scrollToBottom(true); else $('#scroller').scrollTop = keep;
    refreshSessions();
    if (ev.t === 'turn_end') { refreshUsage(); S.panel.tree.clear(); if (S.panel.open) renderPanel(); }
    return;
  }
  upsert(changed);
  if (ev.t === 'tool_start' && ev.name === 'run_command') { S.openTools.add(ev.id); upsert(changed); }
  if (ev.t === 'tool_end' && changed && changed.name === 'run_command' && changed.status === 'ok') { S.openTools.delete(ev.id); upsert(changed); }
  if (ev.t === 'tool_end' && S.panel.open) {
    const d = changed && changed.detail;
    if (d && d.path && S.panel.file && S.panel.file.rel === d.path && S.panel.tab === 'view' && S.panel.view !== 'diff') openFile(d.path, S.panel.view);
    if (S.panel.tab === 'changes') renderPanel();
  }
  if (ev.t === 'approval') { S.status = { kind: 'approval', text: 'Esperando tu aprobación' }; renderStatus(); }
  if (ev.t === 'approval_resolved' && capuEnabled()) capuSet('thinking');
  if (ev.t === 'tool_start' && ev.name === 'delete_path' && capuEnabled()) capuReact('trash');
  if (ev.t === 'tool_end' && changed && changed.name === 'run_command' && capu.cmdKind === 'tests' && capuEnabled()) {
    capuReact(changed.status === 'ok' ? 'pass' : 'fail');
    capu.cmdKind = '';
  }
  stickToBottom();
}

// ── boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  const info = await deiza.init();
  S.language = info.language || 'es';
  S.version = info.version;
  S.updatedFrom = info.updatedFrom || '';
  DeizaI18n.setLanguage(S.language);
  document.documentElement.lang = DeizaI18n.uiLanguage();
  try { const p = await deiza.code.prefs(); S.model = p.model; S.effort = p.effort; } catch { /* defaults */ }
  S.platform = info.platform;
  S.home = info.home;
  S.auth = info.auth;
  document.body.classList.add(info.platform === 'win32' ? 'win' : info.platform === 'darwin' ? 'mac' : 'linux');
  if (info.material) document.body.classList.add('material');
  capuApplyMotion(capuMotion());
  $('#chat-under').append(DeizaRose(84, { loop: true }));
  document.body.classList.add('chat-loading');
  applyAuth();
  document.documentElement.style.setProperty('--titlebar', `${info.titlebarHeight}px`);
  if (localStorage.getItem('deiza:sidebar') === '0') document.body.classList.add('sidebar-closed');
  applyTheme(info.theme);
  applyMode(info.mode);
  initTitlebar();
  initResizer();

  $('#tb-settings').onclick = () => (ST.open ? closeSettings() : openSettings());
  deiza.on('app:open-settings', (section) => openSettings(section));
  deiza.on('app:language', (lang) => {
    S.language = lang;
    DeizaI18n.setLanguage(lang);
    document.documentElement.lang = DeizaI18n.uiLanguage();
    renderSidebar();
    renderThread();
    if (ST.open) renderSettings();
  });
  $('#new-session').onclick = () => startNew(S.cur ? S.cur.folder : null);
  $('#open-folder').onclick = async () => { const f = await deiza.code.pickFolder(); if (f) startNew(f); };
  $('#scroller').addEventListener('scroll', () => {
    const sc = $('#scroller');
    stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 90;
  }, { passive: true });

  deiza.on('app:mode', applyMode);
  deiza.on('app:theme', applyTheme);
  deiza.on('auth:changed', (a) => {
    const was = S.auth.signedIn;
    S.auth = a;
    if (was !== a.signedIn) applyAuth();
    refreshUsage();
    renderAccount();
    if (!S.cur || was !== a.signedIn) renderThread();
  });
  deiza.on('code:event', onCodeEvent);
  deiza.on('code:sessions', (list) => {
    S.sessions = list;
    if (S.cur) {
      const m = list.find(s => s.id === S.cur.id);
      if (m) { S.cur.title = m.title; renderTitle(); const t = $('#thread-head .title'); if (t) t.textContent = m.title; }
      else { S.cur = null; renderThread(); }
    }
    renderSidebar();
  });
  deiza.on('code:command', (cmd) => {
    if (cmd === 'new-session') startNew(S.cur ? S.cur.folder : null);
    else if (cmd === 'open-folder') deiza.code.pickFolder().then(f => f && startNew(f));
    else if (cmd && cmd.open) openSession(cmd.open);
  });

  document.addEventListener('keydown', (e) => {
    if (S.mode !== 'code' || ST.open) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' && dict) { e.preventDefault(); dict.finish(false); }
    else if (e.key === 'Escape' && S.cur && S.cur.running) { e.preventDefault(); stopRun(); }
    else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
    else if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); ($('#composer-wrap textarea') || $('.start textarea'))?.focus(); }
    else if (mod && e.key === '\\') { e.preventDefault(); if (S.cur) togglePanel(S.panel.tab || 'files'); }
  });
  // Drag and drop: files, folders, zips, scripts or images dropped anywhere in Code.
  const handleDropFiles = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const comp = $('#composer-wrap .composer') || $('.start .composer');
    if (comp) comp.classList.remove('drop');
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    if (S.cur) {
      await addAttachments(files);
      return;
    }
    if (files.length === 1) {
      const p = deiza.pathForFile(files[0]);
      if (p) {
        const r = await deiza.code.create({ folder: p, mode: S.defaultMode });
        if (r && r.id) {
          await refreshSessions();
          await openSession(r.id);
          return;
        }
      }
    }
    await addAttachments(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    const comp = $('#composer-wrap .composer') || $('.start .composer');
    if (comp) comp.classList.add('drop');
  };
  const handleDragLeave = (e) => {
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      const comp = $('#composer-wrap .composer') || $('.start .composer');
      if (comp) comp.classList.remove('drop');
    }
  };

  $('#code').addEventListener('dragover', handleDragOver);
  $('#code').addEventListener('dragleave', handleDragLeave);
  $('#code').addEventListener('drop', handleDropFiles);
  window.addEventListener('resize', () => capuFitStatus());

  const r = await refreshSessions();
  if (r.lastSession && S.sessions.some(s => s.id === r.lastSession)) await openSession(r.lastSession);
  else renderThread();
  refreshUsage();
  setInterval(() => { if (S.mode === 'code') refreshUsage(); }, 5 * 60 * 1000);
}

window.__openForTest = (rel) => openFile(rel);

boot().catch((err) => {
  document.body.append(h('pre', { style: { position: 'fixed', bottom: '10px', left: '10px', color: 'tomato', zIndex: 2000 }, text: String(err && err.stack || err) }));
});
