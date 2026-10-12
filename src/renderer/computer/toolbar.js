'use strict';
const api = window.deizaBrowser;
const $ = (id) => document.getElementById(id);
const url = $('url'), dot = $('dot'), err = $('error'), tabsEl = $('tabs');
const WORDS = {
  es: { back: 'Atrás', forward: 'Adelante', reload: 'Recargar', stopLoad: 'Detener carga', address: 'Busca o escribe una dirección',
    idle: 'Deiza Code', working: 'Deiza está trabajando', stop: 'Detener', stopTip: 'Detener a Deiza', fullscreen: 'Pantalla completa',
    exitFullscreen: 'Salir de pantalla completa', newTab: 'Nueva pestaña', closeTab: 'Cerrar pestaña', title: 'El navegador de Deiza',
    text: 'Escribe una dirección arriba o pide en Code que abra una página. Cuando Deiza la use verás su puntero en cada clic.',
    keys: [['L', 'dirección'], ['T', 'pestaña'], ['R', 'recargar']], fsKey: 'pantalla completa', window: 'Navegador · Deiza Code',
    panel: 'Panel de Deiza', panelClose: 'Ocultar panel', send: 'Enviar', write: 'Escribe a Deiza…', writeIdle: 'Pídele algo a Deiza…',
    working: 'trabajando', idle: 'en espera', stopping: 'deteniendo…', emptyFeed: 'Abre tu correo, tus clases o una web y pide a Deiza lo que necesitas.',
    dictate: 'Dictar mensaje', discard: 'Descartar dictado', transcribe: 'Transcribir dictado', listening: 'Escuchando…', transcribing: 'Transcribiendo…',
    workContext: 'Work en esta página', codeContext: 'Code en esta página', options: 'Modelo y esfuerzo', nextTask: 'Modelo para el próximo encargo',
    model: 'Modelo', effort: 'Esfuerzo', efforts: ['Bajo', 'Auto', 'Alto', 'Máximo'], enter: 'Intro para enviar', steerHint: 'Lo leerá en el siguiente paso',
    queued: 'Instrucción enviada. La leerá mientras trabaja; el modelo elegido se usará en el próximo encargo.', sent: 'Mensaje enviado',
    unconfirmed: 'No se pudo confirmar el envío. Comprueba el chat antes de volver a enviarlo.', sendError: 'No se pudo enviar. Tu mensaje sigue en la caja.',
    micDenied: 'Activa el micrófono para Deiza en los ajustes del sistema.', micError: 'No se pudo abrir el micrófono.',
    voiceAuth: 'Inicia sesión en Deiza para dictar.', voiceRate: 'Espera un momento antes de volver a dictar.', voiceOffline: 'Sin conexión con Deiza.',
    voiceEmpty: 'No se oyó nada. Prueba otra vez.', voiceError: 'No se pudo transcribir el audio.' },
  en: { back: 'Back', forward: 'Forward', reload: 'Reload', stopLoad: 'Stop loading', address: 'Search or type an address',
    idle: 'Deiza Code', working: 'Deiza is working', stop: 'Stop', stopTip: 'Stop Deiza', fullscreen: 'Full screen',
    exitFullscreen: 'Exit full screen', newTab: 'New tab', closeTab: 'Close tab', title: "Deiza's browser",
    text: 'Type an address above or ask Code to open a page. When Deiza uses it you will see its pointer on every click.',
    keys: [['L', 'address'], ['T', 'tab'], ['R', 'reload']], fsKey: 'full screen', window: 'Browser · Deiza Code',
    panel: "Deiza's panel", panelClose: 'Hide panel', send: 'Send', write: 'Write to Deiza…', writeIdle: 'Ask Deiza something…',
    working: 'working', idle: 'idle', stopping: 'stopping…', emptyFeed: 'Open your mail, your classes or a website, then ask Deiza for what you need.',
    dictate: 'Dictate a message', discard: 'Discard dictation', transcribe: 'Transcribe dictation', listening: 'Listening…', transcribing: 'Transcribing…',
    workContext: 'Work on this page', codeContext: 'Code on this page', options: 'Model and effort', nextTask: 'Model for the next task',
    model: 'Model', effort: 'Effort', efforts: ['Low', 'Auto', 'High', 'Max'], enter: 'Enter to send', steerHint: 'Read at the next step',
    queued: 'Instruction sent. It will be read while working; the chosen model applies to the next task.', sent: 'Message sent',
    unconfirmed: 'The send could not be confirmed. Check the chat before sending it again.', sendError: 'Could not send. Your message is still in the text box.',
    micDenied: 'Enable the microphone for Deiza in system settings.', micError: 'Could not open the microphone.',
    voiceAuth: 'Sign in to Deiza to dictate.', voiceRate: 'Wait a moment before dictating again.', voiceOffline: 'No connection to Deiza.',
    voiceEmpty: 'No speech was heard. Try again.', voiceError: 'Could not transcribe the audio.' },
};
let editing = false;
let loading = false;
let lang = '';
let platform = '';
let sending = false;
let latestState = null;
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
  $('side-text').placeholder = t.write;
  $('side-text').setAttribute('aria-label', t.write);
  $('side-model').setAttribute('aria-label', t.model);
  $('side-effort').setAttribute('aria-label', t.effort);
  [...$('side-effort').options].forEach((o, i) => { o.textContent = t.efforts[i]; });
  $('voice-label').textContent = t.listening;
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
  latestState = s;
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
  $('agent-text').textContent = agent.stopping ? t.stopping : agent.running ? (agent.label || t.working) : t.idle;
  $('agent-stop').hidden = !agent.running;
  $('agent-stop').disabled = Boolean(agent.stopping);
  renderTabs(s);
  renderSide(s, agent);
  $('start').hidden = !s.blank;
  err.hidden = !s.error;
  err.textContent = s.error || '';
}

let feedKey = null;
function renderSide(s, agent) {
  const t = w();
  const on = Boolean(s.panel);
  $('side').hidden = !on;
  document.body.classList.toggle('side-on', on);
  $('panel-toggle').classList.toggle('on', on);
  document.documentElement.style.setProperty('--side', `${s.panelWidth || 340}px`);
  if (!on) { if (dictation) dictation.finish(false); return; }
  $('side-state').textContent = agent.stopping ? t.stopping : agent.running ? t.working : t.idle;
  $('side-state').className = `side-state${agent.running ? ' on' : ''}`;
  $('side-text').placeholder = agent.running ? t.write : t.writeIdle;
  $('side-context-label').textContent = s.kind === 'work' ? t.workContext : t.codeContext;
  try { $('side-page').textContent = s.url && s.url !== 'about:blank' ? new URL(s.url).hostname : ''; } catch { $('side-page').textContent = ''; }
  $('side-options').hidden = s.kind !== 'work';
  $('options-label').textContent = agent.running ? t.nextTask : t.options;
  if (s.options) { $('side-model').value = s.options.model; $('side-effort').value = s.options.effort; }
  $('compose-hint').textContent = agent.running ? t.steerHint : t.enter;
  composerBusy();
  const items = (s.feed || []).filter(x => x.kind !== 'status');
  const status = agent.running ? [...(s.feed || [])].reverse().find(x => x.kind === 'status') : null;
  $('side-status').hidden = !agent.running;
  $('side-status-text').textContent = agent.stopping ? t.stopping : status?.text || agent.label || t.working;
  const itemKey = x => `${x.at}:${x.kind}:${x.text}`;
  const key = `${lang}|${items.map(itemKey).join('|')}`;
  if (key === feedKey) return;
  feedKey = key;
  const list = $('feed');
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  if (!items.length) {
    list.textContent = '';
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = t.emptyFeed; list.append(li);
  } else {
    // Retain earlier rows: a new browser action should animate and announce only its own row.
    const existing = new Map([...list.children].map(li => [li.dataset.feedKey, li]));
    const wanted = new Set(items.map(itemKey));
    for (const li of [...list.children]) if (!wanted.has(li.dataset.feedKey)) li.remove();
    items.forEach((x, i) => {
      const id = itemKey(x);
      let li = existing.get(id);
      if (!li) { li = document.createElement('li'); li.className = x.kind; li.textContent = x.text; li.dataset.feedKey = id; }
      const before = list.children[i];
      if (before !== li) list.insertBefore(li, before || null);
    });
  }
  if (stick) list.scrollTop = list.scrollHeight;
}
const sideText = $('side-text');
const fitSide = () => { sideText.style.height = 'auto'; sideText.style.height = `${Math.min(120, sideText.scrollHeight)}px`; };
sideText.addEventListener('input', () => { fitSide(); $('side-feedback').hidden = true; });
sideText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('side-form').requestSubmit(); }
});
$('side-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = sideText.value.trim();
  if (!text || sending || dictation) return;
  sending = true; composerBusy();
  let result;
  try { result = await api.send(text); } catch { result = null; }
  sending = false;
  if (result?.sendResult?.ok && !result.sendResult.error) {
    sideText.value = ''; fitSide();
    feedback(result.sendResult.queued ? w().queued : w().sent);
  } else feedback(result?.sendResult?.error === 'unconfirmed' ? w().unconfirmed : w().sendError, true);
  if (result) render(result);
  composerBusy();
});
for (const id of ['side-model', 'side-effort']) $(id).onchange = () => api.options({ model: $('side-model').value, effort: $('side-effort').value }).then(render);
function feedback(text, error = false) {
  $('side-feedback').textContent = text;
  $('side-feedback').classList.toggle('failure', error);
  $('side-feedback').hidden = !text;
}
let dictation = null;
let openingMic = false;
function composerBusy() {
  const busy = sending || latestState?.sending || openingMic || Boolean(dictation);
  sideText.disabled = Boolean(busy);
  $('side-send').disabled = Boolean(busy);
  $('side-mic').disabled = Boolean(sending || latestState?.sending || openingMic || dictation?.done);
  $('side-model').disabled = Boolean(sending || latestState?.sending);
  $('side-effort').disabled = Boolean(sending || latestState?.sending);
}
async function startDictation() {
  if (sending || openingMic || dictation) return;
  openingMic = true; composerBusy();
  let stream;
  try {
    if (!await api.micAccess()) { feedback(w().micDenied, true); return; }
    feedback('');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    // Closing the panel during the permission request never starts a hidden recording.
    if ($('side').hidden) { stream.getTracks().forEach(track => track.stop()); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
    const chunks = [];
    const started = Date.now();
    const job = { done: false, cancelled: false, finish: null };
    dictation = job;
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    $('voice-label').textContent = w().listening;
    $('voice-clock').textContent = '0:00';
    $('voice-strip').classList.remove('busy');
    $('voice-strip').hidden = false;
    $('voice-cancel').disabled = false;
    $('voice-done').disabled = false;
    $('side-form').classList.add('dictating');
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      $('voice-clock').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      if (seconds >= 300) job.finish(true);
    }, 250);
    const cleanup = () => {
      if (dictation !== job) return;
      dictation = null; $('voice-strip').hidden = true; $('side-form').classList.remove('dictating'); composerBusy();
    };
    job.finish = async keep => {
      if (!keep) job.cancelled = true;
      if (job.done) { if (!keep) cleanup(); return; }
      job.done = true;
      clearInterval(timer);
      const stopped = recorder.state === 'inactive' ? Promise.resolve() : new Promise(resolve => { recorder.onstop = resolve; });
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach(track => track.stop());
      const durationMs = Date.now() - started;
      if (!keep || durationMs < 600) { cleanup(); return; }
      $('voice-strip').classList.add('busy');
      $('voice-label').textContent = w().transcribing;
      $('voice-done').disabled = true;
      composerBusy();
      await stopped;
      let result;
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        result = await api.transcribe({ audio: await blob.arrayBuffer(), mime: blob.type, durationMs, language: lang });
      } catch { result = { error: 'offline' }; }
      if (job.cancelled) return;
      cleanup();
      if (!result?.text || result.error) {
        const errors = { auth: w().voiceAuth, rate: w().voiceRate, offline: w().voiceOffline, empty: w().voiceEmpty };
        feedback(errors[result?.error] || (!result?.error ? w().voiceEmpty : w().voiceError), true);
        return;
      }
      const before = sideText.value;
      sideText.value = `${before}${before && !/\s$/.test(before) ? ' ' : ''}${result.text}`;
      fitSide(); sideText.focus();
    };
    recorder.onerror = () => { job.finish(false); feedback(w().micError, true); };
    recorder.start(250);
  } catch {
    stream?.getTracks().forEach(track => track.stop());
    if (dictation) dictation.finish?.(false);
    feedback(w().micError, true);
  } finally { openingMic = false; composerBusy(); }
}
$('side-mic').onclick = startDictation;
$('voice-cancel').onclick = () => dictation?.finish(false);
$('voice-done').onclick = () => dictation?.finish(true);
document.addEventListener('keydown', event => {
  if (!dictation) return;
  if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); dictation.finish(event.key === 'Enter'); }
});
window.addEventListener('beforeunload', () => dictation?.finish(false));
$('panel-toggle').onclick = () => api.panel().then(render);
$('side-close').onclick = () => api.panel().then(render);
$('agent').onclick = (e) => { if (!e.target.closest('#agent-stop')) api.panel().then(render); };

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
