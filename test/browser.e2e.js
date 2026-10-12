'use strict';
// Code browser end to end: ./node_modules/.bin/electron test/browser.e2e.js (opens real windows on this screen).
const { app, BrowserWindow, webContents, screen } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const REPO = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'deiza-browser-'));
app.commandLine.appendSwitch('use-mock-keychain');
app.setPath('userData', path.join(OUT, 'ud'));

const PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Banco de pruebas</title>
<style>body{font:16px system-ui;margin:0;padding:28px 40px;background:#f4efe8;color:#222}.row{display:flex;gap:14px;margin:14px 0;align-items:center}
button,input{font:inherit;padding:8px 14px}#list{height:180px;width:420px;overflow:auto;border:1px solid #bbb;background:#fff}
.hov .menu{display:none}.hov:hover .menu{display:inline-block}#board{width:360px;height:200px;background:#ddd;position:relative}
#piece{position:absolute;left:10px;top:10px;width:44px;height:44px;background:#a33;border-radius:8px}#log{font:13px monospace;white-space:pre}</style></head>
<body><h1>Banco de pruebas</h1>
<div class="row"><button onclick="log('click b1')">Pulsar</button><input id="name" placeholder="Nombre" aria-label="Nombre" oninput="log('input '+this.value)">
<a href="/page2">Página 2</a><a href="/page2?tab" target="_blank">Nueva pestaña</a></div>
<div class="row hov"><button>Menú</button><span class="menu"><button onclick="log('menu')">Opción oculta</button></span></div>
<div class="row"><div id="list">${Array.from({ length: 60 }, (_, i) => `<div>Elemento ${i + 1}</div>`).join('')}</div>
<button onclick="document.getElementById('dlg').showModal()">Abrir diálogo</button></div>
<dialog id="dlg"><p>Un diálogo modal</p><button onclick="this.closest('dialog').close();log('dialog closed')">Cerrar diálogo</button></dialog>
<div id="board"><div id="piece"></div></div><p>Registro:</p><div id="log" role="log" aria-label="registro"></div>
<script>function log(m){const d=document.getElementById('log');d.textContent+=m+'\\n';d.setAttribute('aria-label','registro '+d.textContent.replace(/\\n/g,' | '))}
const p=document.getElementById('piece'),b=document.getElementById('board');let drag=null;
p.addEventListener('pointerdown',e=>{drag={x:e.clientX-p.offsetLeft,y:e.clientY-p.offsetTop};p.setPointerCapture(e.pointerId)});
p.addEventListener('pointermove',e=>{if(drag){p.style.left=(e.clientX-drag.x)+'px';p.style.top=(e.clientY-drag.y)+'px'}});
p.addEventListener('pointerup',e=>{drag=null;log('drop '+p.offsetLeft+','+p.offsetTop)});
document.getElementById('list').addEventListener('scroll',function(){this.dataset.top=this.scrollTop},{passive:true});</script></body></html>`;
const PAGE2 = '<!doctype html><title>Página dos</title><h1>Segunda página</h1><p>Hola</p>';

const ok = [], bad = [];
const check = (name, cond, extra = '') => { (cond ? ok : bad).push(name); console.log(`${cond ? 'OK ' : 'MAL'} ${name}${extra ? ' · ' + extra : ''}`); };

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(req.url.startsWith('/page2') ? PAGE2 : PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const owner = new BrowserWindow({ width: 900, height: 600, show: false });
  const { createBrowserController } = require(path.join(REPO, 'src/main/computer-browser.js'));
  const stopped = [];
  const b = createBrowserController({ getOwner: () => owner, onStopAgent: id => stopped.push(id) });
  const ctx = { sessionId: 's1', mode: 'build' };
  const times = {};
  const T = async (name, args = {}) => { const t0 = Date.now(); const r = await b.execute(name, args, ctx); const ms = Date.now() - t0; (times[name] ||= []).push(ms); console.log(`   ${name} ${ms} ms${r.error ? ' ERROR ' + r.error : ''}`); return r; };
  const pageWc = () => webContents.getAllWebContents().find(w => w.getURL().startsWith(url) && !w.getURL().includes('page2'));
  const shellWin = () => BrowserWindow.getAllWindows().find(w => w !== owner);
  const el = (r, role, name) => (r.elements || []).find(e => e.role === role && e.name.includes(name))?.element_id;

  b.setAgent('s1', true);
  let r = await T('browser_open', { url });
  const win = shellWin();
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const wb = win.getBounds();
  check('ventana cubre el área de trabajo', Math.abs(wb.width - area.width) <= 2 && Math.abs(wb.height - area.height) <= 2, `${wb.width}x${wb.height} vs ${area.width}x${area.height}`);
  check('snapshot con elementos', r.elements?.length > 5, `${r.elements?.length} elementos, viewport ${JSON.stringify(r.viewport)} shot ${JSON.stringify(r.screenshot_size)}`);

  r = await T('browser_click', { element_id: el(r, 'button', 'Pulsar') });
  check('clic por elemento', /click b1/.test(r.text), '');
  // capture the page right after a click: the pointer must be there for the user
  fs.writeFileSync(path.join(OUT, 'after-click.png'), (await pageWc().capturePage()).toPNG());
  r = await T('browser_type', { element_id: el(r, 'textbox', 'Nombre'), text: 'Marcos' });
  check('escribir en campo', /input Marcos/.test(r.text));
  r = await T('browser_key', { key: 'Tab' });
  check('tecla', !r.error);

  const shot = await T('browser_screenshot', {});
  const ratioShot = shot.width / shot.height, ratioView = shot.viewport.width / shot.viewport.height;
  check('captura con la forma de la ventana', Math.abs(ratioShot - ratioView) < 0.01 && shot.width <= 1440, `${shot.width}x${shot.height} (viewport ${shot.viewport.width}x${shot.viewport.height})`);
  fs.writeFileSync(path.join(OUT, 'model-shot.jpg'), Buffer.from(shot.data_url.split(',')[1], 'base64'));
  const scale = shot.width / shot.viewport.width;
  const rect = async (sel) => pageWc().executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);

  r = await T('browser_snapshot', {});
  const menu = el(r, 'button', 'Menú');
  r = await T('browser_hover', { element_id: menu });
  check('pasar el ratón abre el menú', /Opción oculta/.test(r.text));

  const lp = await rect('#list');
  r = await T('browser_scroll', { delta_y: 600, x: Math.round(lp.x * scale), y: Math.round(lp.y * scale) });
  const top = await pageWc().executeJavaScript('document.getElementById("list").scrollTop');
  check('desplazar la lista bajo el puntero', top > 300, `scrollTop ${top}`);

  r = await T('browser_click', { element_id: el(r, 'button', 'Abrir diálogo') });
  fs.writeFileSync(path.join(OUT, 'dialog.png'), (await pageWc().capturePage()).toPNG());
  const lifted = await pageWc().executeJavaScript('!!document.querySelector("deiza-pointer")?.matches(":popover-open")');
  check('puntero por encima del diálogo modal', lifted);
  r = await T('browser_click', { element_id: el(r, 'button', 'Cerrar diálogo') });
  check('cerrar diálogo', /dialog closed/.test(r.text));

  const pc = await rect('#piece');
  r = await T('browser_drag', { from_x: Math.round(pc.x * scale), from_y: Math.round(pc.y * scale), to_x: Math.round((pc.x + 200) * scale), to_y: Math.round((pc.y + 100) * scale), observe: 'snapshot' });
  check('arrastrar', /drop 2\d\d,1\d\d/.test(r.text), (r.text.match(/drop [\d,]+/) || [''])[0]);

  r = await T('browser_click', { element_id: el(r, 'link', 'Página 2') });
  check('navegar con clic espera la página nueva', r.title === 'Página dos', r.title);
  r = await T('browser_history', { action: 'back' });
  check('atrás', r.title === 'Banco de pruebas', r.title);

  r = await T('browser_click', { element_id: el(r, 'link', 'Nueva pestaña') });
  await new Promise(res => setTimeout(res, 700));
  const tabs = await T('browser_tabs', {});
  check('target=_blank abre pestaña en la misma ventana', tabs.tabs.length === 2 && BrowserWindow.getAllWindows().length === 2, `${tabs.tabs.length} pestañas`);
  const tb = win.webContents;
  const ui = await tb.executeJavaScript('({tabs: document.querySelectorAll(".tab").length, agent: document.getElementById("agent-text").textContent, on: document.getElementById("agent").classList.contains("on"), stop: !document.getElementById("agent-stop").hidden, caption: getComputedStyle(document.documentElement).getPropertyValue("--caption")})');
  check('barra: pestañas y estado del agente', ui.tabs === 2 && ui.on && ui.stop, JSON.stringify(ui));
  const tabsState = await tb.executeJavaScript('window.deizaBrowser.state()');
  const view = webContents.getAllWebContents().find(w => w.getURL().includes('page2?tab'));
  check('vista debajo de las dos filas', tabsState.chrome === 82, `chrome ${tabsState.chrome}`);
  fs.writeFileSync(path.join(OUT, 'toolbar.png'), (await tb.capturePage({ x: 0, y: 0, width: wb.width, height: 82 })).toPNG());
  fs.writeFileSync(path.join(OUT, 'tab2.png'), (await view.capturePage()).toPNG());
  try {
    const id = win.getMediaSourceId().split(':')[1];
    execFileSync('screencapture', ['-x', '-o', '-l', id, path.join(OUT, 'window.png')]);
    console.log('   captura de ventana guardada');
  } catch (e) { console.log('   screencapture no disponible:', e.message.split('\n')[0]); }

  await tb.executeJavaScript('document.getElementById("agent-stop").click()');
  await new Promise(res => setTimeout(res, 200));
  check('botón Detener llega a Code', stopped.includes('s1'));
  b.setAgent('s1', false);
  await new Promise(res => setTimeout(res, 300));
  const idle = await tb.executeJavaScript('({on: document.getElementById("agent").classList.contains("on"), text: document.getElementById("agent-text").textContent})');
  check('al terminar la barra vuelve a reposo', !idle.on, JSON.stringify(idle));

  console.log('\nTiempos:', Object.entries(times).map(([k, v]) => `${k} ${Math.round(v.reduce((a, c) => a + c, 0) / v.length)} ms`).join(' · '));
  console.log(`\n${ok.length} OK, ${bad.length} MAL${bad.length ? ': ' + bad.join(', ') : ''}`);
  b.shutdown(); server.close(); app.exit(bad.length ? 1 : 0);
}).catch(e => { console.error(e); app.exit(2); });
