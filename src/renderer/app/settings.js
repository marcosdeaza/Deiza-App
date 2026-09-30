/* Deiza desktop — Ajustes: cuenta, general, Code, skills y acerca de. Uses the helpers of app.js. */
/* global deiza, h, icon, T, S, toast, MODELS, EFFORTS, effortSlider, DeizaI18n, DeizaRose, fmtDuration, num, renderAccount, repaintModelPills */
'use strict';

const ST = { open: false, section: 'account', data: null, account: null, skills: null, limits: null };

function openSettings(section) {
  if (!S.auth.signedIn) return;
  ST.open = true;
  ST.section = section || ST.section || 'account';
  document.body.classList.add('settings-open');
  $('#settings').classList.remove('hidden');
  deiza.overlay(true);
  renderSettings();
  loadSettings();
}

function closeSettings() {
  if (!ST.open) return;
  ST.open = false;
  document.body.classList.remove('settings-open');
  $('#settings').classList.add('hidden');
  deiza.overlay(false);
}

async function loadSettings() {
  const [data, account, prefs] = await Promise.all([deiza.settings.get(), deiza.account.get(), deiza.code.prefs()]);
  ST.data = { ...data, ...prefs };
  ST.account = account && !account.error ? account : ST.account;
  if (ST.open) renderSettings();
}

function stRow(title, desc, control) {
  return h('div', { class: 'st-row' }, h('div', { class: 'st-row-txt' }, h('b', { text: title }), desc ? h('span', { text: desc }) : null), control);
}

function stToggle(on, onChange) {
  const b = h('button', { class: 'st-switch', role: 'switch', 'aria-checked': String(Boolean(on)) }, h('i'));
  b.onclick = async () => { const next = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(next)); await onChange(next); };
  return b;
}

function stSeg(options, value, onChange) {
  const seg = h('div', { class: 'st-seg' });
  for (const [id, label, extra] of options) {
    const b = h('button', { 'aria-pressed': String(id === value) }, extra || null, label);
    b.onclick = async () => { for (const c of seg.children) c.setAttribute('aria-pressed', String(c === b)); await onChange(id); };
    seg.append(b);
  }
  return seg;
}

function renderSettings() {
  const root = $('#settings');
  root.innerHTML = '';
  const nav = h('nav', { class: 'st-nav' }, h('div', { class: 'st-title', text: T('Ajustes') }));
  for (const [id, label] of [['account', T('Cuenta')], ['general', T('General')], ['code', 'Code'], ['skills', 'Skills'], ['about', T('Acerca de')]]) {
    nav.append(h('button', { class: ST.section === id ? 'on' : '', onclick: () => { ST.section = id; renderSettings(); } }, label));
  }
  const page = h('div', { class: 'st-page' });
  const main = h('div', { class: 'st-main' }, page);
  root.append(nav, main, h('button', { class: 'icon-btn st-close', title: T('Cerrar (Esc)'), onclick: closeSettings }, icon('x')));
  const d = ST.data;
  if (!d) { page.append(h('div', { class: 'pn-empty' }, h('span', { class: 'spin' }))); return; }
  ({ account: stAccount, general: stGeneral, code: stCode, skills: stSkills, about: stAbout }[ST.section] || stAccount)(page, d);
}

function stAccount(page) {
  const a = ST.account || S.auth.user || {};
  page.append(h('h2', { text: T('Cuenta') }));
  const pick = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden' });
  const face = a.avatar ? h('img', { class: 'st-avatar', src: a.avatar, alt: '' }) : h('div', { class: 'st-avatar', text: (a.name || a.email || 'D').charAt(0).toUpperCase() });
  pick.onchange = async () => {
    const f = pick.files[0];
    if (!f) return;
    const img = await createImageBitmap(f);
    const side = Math.min(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
    const r = await deiza.account.setAvatar(c.toDataURL('image/webp', 0.9));
    if (r && r.ok) { ST.account = { ...a, avatar: r.avatar }; renderSettings(); toast(T('Foto actualizada')); } else toast(T('No se pudo cambiar la foto'));
  };
  const name = h('input', { class: 'field', value: a.name || '', maxlength: '100', placeholder: T('Tu nombre') });
  const saveName = async () => {
    const v = name.value.trim();
    if (!v || v === (a.name || '')) return;
    const r = await deiza.account.setName(v);
    if (r && r.ok) { ST.account = { ...a, name: r.name }; toast(T('Nombre guardado')); } else toast(T('No se pudo guardar el nombre'));
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  name.addEventListener('blur', saveName);
  page.append(h('div', { class: 'st-profile' }, h('button', { class: 'st-face', title: T('Cambiar foto'), onclick: () => pick.click() }, face, h('span', { text: T('Cambiar') })), pick,
    h('div', { class: 'st-id' }, name, h('div', { class: 'st-mail', text: a.email || '' }))));
  const us = S.usage;
  const plan = a.plan || (us && us.plan) || 'free';
  const card = h('div', { class: 'st-card' }, h('div', { class: 'st-card-head' }, h('span', { class: 'plan-tag', text: plan }), h('button', { class: 'btn ghost small', onclick: () => { closeSettings(); deiza.chatGo('plans'); } }, T('Ver planes'))));
  if (us && !us.error && us.token_limit) {
    const pct = Math.min(100, Math.round((us.tokens_used / us.token_limit) * 100));
    card.append(h('div', { class: 'meter' }, h('div', { class: 'row' }, h('span', { text: T('Uso de Code · ventana de 5 h') }), h('span', { text: `${pct} %` })),
      h('div', { class: 'track' }, h('div', { class: `fill${pct > 85 ? ' hot' : ''}`, style: { width: `${pct}%` } })),
      us.reset_in_seconds ? h('div', { class: 'row' }, h('span', { text: T('Se renueva en {t}', { t: fmtDuration(us.reset_in_seconds * 1000) }) })) : null));
  }
  page.append(card, h('div', { class: 'st-actions' }, h('button', { class: 'btn ghost danger', onclick: () => { closeSettings(); deiza.auth.logout(); } }, T('Cerrar sesión'))));
}

function stGeneral(page, d) {
  page.append(h('h2', { text: T('General') }));
  const sel = h('select', { class: 'field st-select' });
  for (const [code, label] of DeizaI18n.LANGUAGES) sel.append(h('option', { value: code, selected: code === d.language }, label));
  sel.onchange = async () => { await deiza.settings.set('language', sel.value); d.language = sel.value; };
  page.append(stRow(T('Idioma'), T('El chat y las respuestas de Code usan este idioma. La interfaz de la app está en español e inglés.'), sel));
  page.append(stRow(T('Atajo global'), T('{k} muestra u oculta Deiza desde cualquier app.', { k: d.shortcutLabel }), stToggle(d.shortcut, async (v) => { const r = await deiza.settings.set('shortcut', v); if (v && r && r.ok === false) toast(T('Otra app ya usa ese atajo')); })));
  page.append(stRow(T('Abrir al iniciar sesión'), T('Deiza se abre al encender el equipo.'), stToggle(d.openAtLogin, (v) => deiza.settings.set('openAtLogin', v))));
  page.append(stRow(T('Avisos'), T('Notificación cuando Code termina una tarea con la app en segundo plano.'), stToggle(d.notify, (v) => deiza.settings.set('notify', v))));
  page.append(stRow(T('Más ajustes del chat'), T('Memoria, respaldo por cadena y el resto de opciones de la web.'), h('button', { class: 'btn ghost small', onclick: () => { closeSettings(); deiza.setMode('chat'); deiza.chatGo('settings'); } }, T('Abrir'))));
}

function stCode(page, d) {
  page.append(h('h2', { text: 'Code' }), h('p', { class: 'st-lead', text: T('Valores para las sesiones nuevas. Cada sesión recuerda los suyos y los cambias desde el selector junto al botón de enviar.') }));
  const models = h('div', { class: 'st-list' });
  for (const m of MODELS) {
    const on = m.id === d.model;
    models.append(h('button', { class: `mm-row${on ? ' on' : ''}`, role: 'radio', 'aria-checked': String(on), onclick: async () => { await deiza.settings.set('defaultModel', m.id); d.model = m.id; S.model = m.id; repaintModelPills(); renderSettings(); } },
      h('span', { class: 'mm-main' }, h('span', { class: 'mm-title', text: m.name }), h('span', { class: 'mm-sub', text: T(m.desc) })),
      h('span', { class: 'mm-check' }, on ? icon('check') : null)));
  }
  page.append(h('div', { class: 'st-sub', text: T('Modelo') }), models);
  page.append(h('div', { class: 'st-block' }, effortSlider(d.effort, async (v) => { d.effort = v; S.effort = v; repaintModelPills(); await deiza.settings.set('defaultEffort', v); })));
  page.append(stRow(T('Modo'), T('Build hace todo solo, Copilot te pide permiso en cada cambio y Plan solo lee.'), stSeg([['build', 'Build'], ['copilot', 'Copilot'], ['plan', 'Plan']], d.mode, async (v) => { await deiza.settings.set('defaultMode', v); d.mode = v; S.defaultMode = v; localStorage.setItem('deiza:code:mode', v); })));
  page.append(stRow(T('Capu'), T('La mascota de Deiza Code te acompaña mientras trabaja: teclea, se toma un café, le cuenta el bug al pato de goma y florece al terminar.'), stToggle(capuEnabled(), (v) => { localStorage.setItem('deiza:capu', v ? '1' : '0'); renderStatus(); })));
}

async function stSkills(page) {
  page.append(h('h2', { text: 'Skills' }), h('p', { class: 'st-lead', text: T('Instrucciones en Markdown que Deiza sigue cuando vienen al caso. Se aplican en el chat y en Code.') }));
  const list = h('div', { class: 'st-skills' });
  const pick = h('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', multiple: true, class: 'hidden' });
  page.append(h('div', { class: 'st-actions' }, h('button', { class: 'btn primary small', onclick: () => pick.click() }, icon('upload'), T('Importar .md')), pick), list);
  if (!ST.skills) {
    list.append(h('div', { class: 'pn-empty' }, h('span', { class: 'spin' })));
    const r = await deiza.account.skills();
    ST.skills = (r && r.custom) || [];
    ST.limits = (r && r.limits) || { max_skills: 20, max_chars: 20000 };
    if (ST.open && ST.section === 'skills') renderSettings();
    return;
  }
  const save = async () => {
    const r = await deiza.account.saveSkills(ST.skills);
    if (r && r.custom) ST.skills = r.custom; else toast(T('No se pudieron guardar las skills'));
    if (ST.open && ST.section === 'skills') renderSettings();
  };
  pick.onchange = async () => {
    for (const f of [...pick.files]) {
      if (ST.skills.length >= ST.limits.max_skills) { toast(T('Has llegado al máximo de skills')); break; }
      const text = await f.text();
      const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
      const meta = {};
      if (fm) for (const line of fm[1].split('\n')) { const m = /^(\w+)\s*:\s*(.*)$/.exec(line); if (m) meta[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '').trim(); }
      const body = (fm ? text.slice(fm[0].length) : text).trim().slice(0, ST.limits.max_chars);
      if (!body) continue;
      ST.skills.push({ id: `skill-${Date.now()}-${ST.skills.length}`, name: (meta.name || f.name.replace(/\.(md|markdown|txt)$/i, '')).slice(0, 80), description: (meta.description || '').slice(0, 200), instructions: body, enabled: true });
    }
    pick.value = '';
    await save();
  };
  if (!ST.skills.length) list.append(h('div', { class: 'pn-empty', text: T('Aún no tienes skills. Importa un archivo .md con instrucciones (por ejemplo, tu guía de estilo o cómo escribir tests).') }));
  for (const sk of ST.skills) {
    list.append(h('div', { class: 'st-skill' },
      h('div', { class: 'st-row-txt' }, h('b', { text: sk.name }), h('span', { text: sk.description || `${num((sk.instructions || '').length)} ${T('caracteres')}` })),
      stToggle(sk.enabled !== false, async (v) => { sk.enabled = v; await save(); }),
      h('button', { class: 'icon-btn', title: T('Eliminar'), onclick: async () => { ST.skills = ST.skills.filter(x => x !== sk); await save(); } }, icon('trash'))));
  }
}

function stAbout(page, d) {
  const status = h('span', { class: 'st-mail' });
  page.append(h('div', { class: 'st-about' }, DeizaRose(64, { className: 'breathe' }), h('div', { class: 'wordmark', text: 'Deiza' }),
    h('div', { class: 'st-mail', text: `${T('Versión')} ${d.version} · ${d.platform === 'darwin' ? 'macOS' : d.platform === 'win32' ? 'Windows' : 'Linux'} ${d.arch}` }),
    h('div', { class: 'st-actions' }, S.update ? updateButton(S.update, 'upd-row', true) : h('button', { class: 'btn ghost small', onclick: async () => {
      status.textContent = T('Comprobando…');
      const r = await deiza.settings.checkUpdates();
      status.textContent = !r || r.error ? T('No se pudo comprobar. Revisa tu conexión.') : r.available ? '' : T('Tienes la última versión');
    } }, T('Buscar actualizaciones')), status),
    S.update && S.update.notes ? h('p', { class: 'st-lead', style: { maxWidth: '420px' }, text: S.update.notes }) : null,
    h('div', { class: 'st-links' }, ...[['Novedades', 'https://deiza.org/noticias'], ['Documentación', 'https://deiza.org/docs'], ['Términos', 'https://deiza.org/legal/terminos'], ['Privacidad', 'https://deiza.org/legal/privacidad']]
      .map(([l, u]) => h('button', { class: 'link-btn', onclick: () => deiza.openExternal(u) }, T(l))))));
}

document.addEventListener('keydown', (e) => { if (ST.open && e.key === 'Escape') { e.preventDefault(); closeSettings(); } });
