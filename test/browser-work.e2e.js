'use strict';
// Code browser end to end: ./node_modules/.bin/electron test/browser-work.e2e.js (opens real windows on this screen).
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
  const url = `127.0.0.1:${server.address().port}/`;
  const { createBrowserController } = require(path.join(REPO, 'src/main/computer-browser.js'));
  const b = createBrowserController({ getOwner: () => null });
  const ctx = { sessionId: 'work_42' };
  const W = async (action, args = {}) => { const t0 = Date.now(); const r = await b.work(action, args, ctx); console.log(`   ${action} ${Date.now() - t0} ms${r.error ? ' ERROR ' + r.error : ''}`); return r; };
  let r = await W('status');
  check('status sin página', r.open === false);
  r = await W('open', { url: 'http://' + url });
  check('open devuelve captura y elementos', r.shot && r.w > 1000 && r.elements?.length > 5, `${r.w}x${r.h}, ${r.elements?.length} elementos`);
  const btn = r.elements.find(e => e.l === 'Pulsar');
  r = await W('click', { x: btn.x, y: btn.y });
  r = await W('read');
  check('clic en coordenadas de captura', /click b1/.test(r.text), (r.text.match(/click b1/) || [''])[0]);
  check('read con enlaces', r.links?.length >= 2 && r.title === 'Banco de pruebas', `${r.links?.length} enlaces`);
  r = await W('click_text', { text: 'Nombre' });
  r = await W('click', { x: r.elements.find(e => e.t.startsWith('input')).x, y: r.elements.find(e => e.t.startsWith('input')).y });
  r = await W('type', { text: 'Aya' });
  r = await W('read');
  check('escribir', /input Aya/.test(r.text));
  r = await W('click_text', { text: 'abrir diálogo' });
  check('click_text devuelve el punto', r.clicked && r.clicked.x > 0, JSON.stringify(r.clicked));
  r = await W('click_text', { text: 'Cerrar diálogo' });
  r = await W('read');
  check('click_text en diálogo', /dialog closed/.test(r.text));
  r = await W('scroll', { dy: 400 });
  check('scroll', !r.error);
  r = await W('click_text', { text: 'Página 2' });
  check('navegar con click_text', r.title === 'Página dos', r.title);
  r = await W('back');
  check('atrás', r.title === 'Banco de pruebas', r.title);
  r = await W('click_text', { text: 'no existe esto' });
  check('error claro sin elemento', /No hay ningún elemento/.test(r.error || ''), r.error);
  console.log(`\n${ok.length} OK, ${bad.length} MAL${bad.length ? ': ' + bad.join(', ') : ''}`);
  b.shutdown(); server.close(); app.exit(bad.length ? 1 : 0);
}).catch(e => { console.error(e); app.exit(2); });
