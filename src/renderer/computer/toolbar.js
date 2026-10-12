'use strict';
const api = window.deizaBrowser;
const $ = (id) => document.getElementById(id);
const url = $('url'), dot = $('dot'), err = $('error'), tabsEl = $('tabs');
const WORDS = {
  es: { back: 'Atrás', forward: 'Adelante', reload: 'Recargar', stopLoad: 'Detener carga', address: 'Busca o escribe una dirección',
    idle: 'Deiza Code', working: 'Deiza está trabajando', stop: 'Detener', stopTip: 'Detener a Deiza', fullscreen: 'Pantalla completa',
    exitFullscreen: 'Salir de pantalla completa', newTab: 'Nueva pestaña', closeTab: 'Cerrar pestaña', title: 'El navegador de Deiza',
    text: 'Escribe una dirección arriba o pide en Code que abra una página. Cuando Deiza la use verás su puntero en cada clic.',
    keys: [['L', 'dirección'], ['T', 'pestaña'], ['R', 'recargar']], fsKey: 'pantalla completa', window: 'Navegador · Deiza Code' },
  en: { back: 'Back', forward: 'Forward', reload: 'Reload', stopLoad: 'Stop loading', address: 'Search or type an address',
    idle: 'Deiza Code', working: 'Deiza is working', stop: 'Stop', stopTip: 'Stop Deiza', fullscreen: 'Full screen',
    exitFullscreen: 'Exit full screen', newTab: 'New tab', closeTab: 'Close tab', title: "Deiza's browser",
    text: 'Type an address above or ask Code to open a page. When Deiza uses it you will see its pointer on every click.',
    keys: [['L', 'address'], ['T', 'tab'], ['R', 'reload']], fsKey: 'full screen', window: 'Browser · Deiza Code' },
};
let editing = false;
let loading = false;
let lang = '';
let platform = '';
const w = () => WORDS[lang === 'en' ? 'en' : 'es'];
const svg = (d) => `<svg viewBox="0 0 16 16"><path d="${d}"/></svg>`;

function captionInset() {
  // Windows/Linux draw their caption buttons over the bar: keep the right edge free for them.
  const o = navigator.windowControlsOverlay;
  let inset = 0;
  if (platform !== 'darwin') {
    const r = o && o.visible ? o.getTitlebarAreaRect() : null;
    inset = r && r.width ? Math.max(0, Math.round(window.innerWidth - (r.x + r.width))) : 140;
  }
  document.documentElement.style.setProperty('--caption', `${inset}px`);
}
navigator.windowControlsOverlay?.addEventListener?.('geometrychange', captionInset);
window.addEventListener('resize', captionInset);

function texts() {
  const t = w();
  document.documentElement.lang = lang === 'en' ? 'en' : 'es';
  for (const el of document.querySelectorAll('[data-tip]')) { el.title = t[el.dataset.tip]; el.setAttribute('aria-label', t[el.dataset.tip]); }
  url.placeholder = t.address;
  url.setAttribute('aria-label', t.address);
  $('agent-stop-text').textContent = t.stop;
  $('agent-stop').title = t.stopTip;
  $('start-title').textContent = t.title;
  $('start-text').textContent = t.text;
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl';
  const keys = $('keys');
  keys.textContent = '';
  for (const [k, label] of [...t.keys, [platform === 'darwin' ? '⌃⌘F' : 'F11', t.fsKey]]) {
    const li = document.createElement('li');
    const kbd = document.createElement('kbd');
    kbd.textContent = k.length === 1 ? `${mod} ${k}` : k;
    li.append(kbd, label);
    keys.append(li);
  }
}

function renderTabs(s) {
  const list = Array.isArray(s.tabs) ? s.tabs : [];
  const on = list.length > 1;
  tabsEl.hidden = !on;
  document.body.classList.toggle('tabs-on', on);
  if (!on) { tabsEl.textContent = ''; return; }
  tabsEl.textContent = '';
  for (const tab of list) {
    const b = document.createElement('button');
    b.className = `tab${tab.active ? ' active' : ''}`;
    b.title = tab.title;
    const ld = document.createElement('span');
    ld.className = `ld${tab.loading ? ' loading' : ''}`;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = tab.title;
    const x = document.createElement('span');
    x.className = 'x';
    x.title = w().closeTab;
    x.innerHTML = svg('M4 4l8 8M12 4l-8 8');
    x.onclick = (e) => { e.stopPropagation(); api.closeTab(tab.id); };
    b.append(ld, t, x);
    b.onclick = () => api.tab(tab.id);
    b.onauxclick = (e) => { if (e.button === 1) api.closeTab(tab.id); };
    tabsEl.append(b);
  }
  const plus = document.createElement('button');
  plus.className = 'new-tab';
  plus.title = w().newTab;
  plus.innerHTML = svg('M8 3v10M3 8h10');
  plus.onclick = () => api.newTab();
  tabsEl.append(plus);
}

function render(s) {
  if (!s || s.error === 'Acceso al navegador no permitido.' || !s.platform) return;
  if (s.language !== lang || s.platform !== platform) {
    lang = s.language; platform = s.platform;
    document.body.classList.add(platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux');
    texts();
    captionInset();
  }
  const t = w();
  loading = Boolean(s.loading);
  document.body.classList.toggle('fullscreen', Boolean(s.fullscreen));
  document.documentElement.style.setProperty('--chrome', `${s.chrome || 46}px`);
  $('back').disabled = !s.canGoBack;
  $('forward').disabled = !s.canGoForward;
  $('reload').title = loading ? t.stopLoad : t.reload;
  $('reload-icon').innerHTML = loading ? '<path d="M4 4l8 8M12 4l-8 8"/>' : '<path d="M13 8a5 5 0 1 1-1.5-3.55M13 3v3h-3"/>';
  $('fullscreen').title = s.fullscreen ? t.exitFullscreen : t.fullscreen;
  $('fs-icon').innerHTML = s.fullscreen ? '<path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/>' : '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>';
  dot.className = `dot${loading ? ' loading' : /^https:/.test(s.url || '') ? ' secure' : ''}`;
  if (!editing) url.value = s.url && s.url !== 'about:blank' ? s.url : '';
  document.title = s.title ? `${s.title} · Deiza Code` : t.window;
  const agent = s.agent || {};
  $('agent').classList.toggle('on', Boolean(agent.running));
  $('agent-text').textContent = agent.running ? (agent.label || t.working) : t.idle;
  $('agent-stop').hidden = !agent.running;
  renderTabs(s);
  $('start').hidden = !s.blank;
  err.hidden = !s.error;
  err.textContent = s.error || '';
}

api.onState(render);
api.onFocusAddress(() => { url.focus(); url.select(); });
$('back').onclick = () => api.back().then(render);
$('forward').onclick = () => api.forward().then(render);
$('reload').onclick = () => (loading ? api.stop() : api.reload()).then(render);
$('fullscreen').onclick = () => api.fullscreen().then(render);
$('agent-stop').onclick = () => api.stopAgent().then(render);
url.addEventListener('focus', () => { editing = true; url.select(); });
url.addEventListener('blur', () => { editing = false; });
url.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { editing = false; url.blur(); api.state().then(render); }
});
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  editing = false;
  url.blur();
  if (url.value.trim()) api.navigate(url.value.trim()).then(render);
});
api.state().then(render);
