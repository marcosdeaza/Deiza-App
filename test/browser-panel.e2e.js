'use strict';
// Code browser end to end: ./node_modules/.bin/electron test/browser-panel.e2e.js (opens real windows on this screen).
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

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { createBrowserController } = require(path.join(REPO, 'src/main/computer-browser.js'));
  const got = [];
  const b = createBrowserController({ getOwner: () => null, onUserMessage: (id, text) => { got.push([id, text]); return { ok: true }; } });
  const ctx = { sessionId: 'work_7' };
  await b.work('open', { url }, ctx);
  await b.work('click_text', { text: 'Pulsar' }, ctx);
  b.say('work_7', { kind: 'say', text: 'Estoy probando el botón Pulsar.' });
  b.say('work_7', { kind: 'status', text: 'Pensando el siguiente paso' });
  await new Promise(r => setTimeout(r, 400));
  const win = BrowserWindow.getAllWindows()[0];
  const tb = win.webContents;
  let ui = await tb.executeJavaScript(`({ open: !document.getElementById('side').hidden, items: [...document.querySelectorAll('#feed li')].map(li => li.className + ':' + li.textContent),
    status: document.getElementById('side-status-text').textContent })`);
  check('el panel se abre solo con la primera actividad', ui.open, JSON.stringify(ui.items));
  check('el panel muestra acciones y mensajes', ui.items.some(x => x.startsWith('action:')) && ui.items.some(x => x.startsWith('say:')));
  const view = webContents.getAllWebContents().find(w => w.getURL().startsWith(url));
  const pageW = await view.executeJavaScript('innerWidth');
  check('la página deja sitio al panel', pageW <= win.getContentSize()[0] - 300, `página ${pageW} de ${win.getContentSize()[0]}`);
  await tb.executeJavaScript(`(() => { const t = document.getElementById('side-text'); t.value = 'Ahora pulsa Menú'; document.getElementById('side-form').requestSubmit(); })()`);
  await new Promise(r => setTimeout(r, 400));
  check('escribir en el panel llega a la sesión', got.length === 1 && got[0][0] === 'work_7' && got[0][1] === 'Ahora pulsa Menú', JSON.stringify(got));
  ui = await tb.executeJavaScript(`[...document.querySelectorAll('#feed li')].map(li => li.className).join(',')`);
  check('tu mensaje aparece en el panel', ui.includes('user'), ui);
  fs.writeFileSync(path.join(OUT, 'panel.png'), (await tb.capturePage()).toPNG());
  try {
    const id = win.getMediaSourceId().split(':')[1];
    require('node:child_process').execFileSync('screencapture', ['-x', '-o', '-l', id, path.join(OUT, 'panel-window.png')]);
    console.log('captura:', path.join(OUT, 'panel-window.png'));
  } catch (e) { console.log('screencapture:', e.message.split('\n')[0]); }
  await tb.executeJavaScript(`document.getElementById('side-close').click()`);
  await new Promise(r => setTimeout(r, 300));
  const pageW2 = await view.executeJavaScript('innerWidth');
  check('cerrar el panel devuelve el ancho a la página', pageW2 > pageW + 250, `${pageW} -> ${pageW2}`);
  win.close();
  await new Promise(r => setTimeout(r, 300));
  const back = await b.reveal('work_7', url);
  check('mostrar navegador lo reabre en su página', !back.error && BrowserWindow.getAllWindows().length === 1, JSON.stringify(back).slice(0, 120));
  console.log(`\n${ok.length} OK, ${bad.length} MAL${bad.length ? ': ' + bad.join(', ') : ''}`);
  b.shutdown(); server.close(); app.exit(bad.length ? 1 : 0);
}).catch(e => { console.error(e); app.exit(2); });
