'use strict';
const api = window.deizaBrowser;
const $ = (id) => document.getElementById(id);
const url = $('url'), dot = $('dot'), err = $('error');
let editing = false;

function render(s) {
  if (!s || s.error === 'Acceso al navegador no permitido.') return;
  $('back').disabled = !s.canGoBack;
  $('forward').disabled = !s.canGoForward;
  $('reload').title = s.loading ? 'Detener' : 'Recargar';
  $('reload-icon').innerHTML = s.loading ? '<path d="M4 4l8 8M12 4l-8 8"/>' : '<path d="M13 8a5 5 0 1 1-1.5-3.55M13 3v3h-3"/>';
  dot.className = `dot${s.loading ? ' loading' : /^https:/.test(s.url || '') ? ' secure' : ''}`;
  if (!editing) url.value = s.url && s.url !== 'about:blank' ? s.url : '';
  document.title = s.title ? `${s.title} · Deiza Code` : 'Navegador · Deiza Code';
  err.hidden = !s.error;
  err.textContent = s.error || '';
}

let loading = false;
api.onState((s) => { loading = !!s.loading; render(s); });
$('back').onclick = () => api.back().then(render);
$('forward').onclick = () => api.forward().then(render);
$('reload').onclick = () => (loading ? api.stop() : api.reload()).then(render);
url.addEventListener('focus', () => { editing = true; url.select(); });
url.addEventListener('blur', () => { editing = false; });
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  editing = false;
  url.blur();
  if (url.value.trim()) api.navigate(url.value.trim()).then(render);
});
api.state().then(render);
