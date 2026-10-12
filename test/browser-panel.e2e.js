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
  const speech = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/api/transcribe') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => { speech.push({ token: req.headers['x-auth-token'], body: Buffer.concat(chunks).toString() }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ transcript: 'Resume las tareas de esta semana' })); });
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { createBrowserController } = require(path.join(REPO, 'src/main/computer-browser.js'));
  const codeHost = require(path.join(REPO, 'src/main/code-host.js'));
  codeHost.init({ origin: url.replace(/\/$/, ''), auth: { getToken: () => 'panel-test-token' }, getLanguage: () => 'es' });
  codeHost.setPref('syncSessions', false);
  const got = [];
  let failNext = false, micAllowed = false, stopped = 0;
  const b = createBrowserController({ getOwner: () => null, onStopAgent: () => { stopped++; }, onUserMessage: (id, text, options) => {
    if (failNext) { failNext = false; return { error: 'offline' }; }
    got.push([id, text, options]); return { ok: true, queued: true };
  }, onMicAccess: () => micAllowed, onTranscribe: payload => codeHost.transcribe(payload) });
  await b.open({}); // a manually opened browser is adopted by the first Work chat
  b.setWorkState('work_7', { running: true, model: 'solid', effort: 'high' });
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
  ui = await tb.executeJavaScript(`({model:document.getElementById('side-model').value,effort:document.getElementById('side-effort').value,label:document.getElementById('options-label').textContent})`);
  check('el panel refleja el modelo del chat y explica cuándo cambia', ui.model === 'solid' && ui.effort === 'high' && /próximo encargo/.test(ui.label), JSON.stringify(ui));
  const view = webContents.getAllWebContents().find(w => w.getURL().startsWith(url));
  const pageW = await view.executeJavaScript('innerWidth');
  check('la página deja sitio al panel', pageW <= win.getContentSize()[0] - 300, `página ${pageW} de ${win.getContentSize()[0]}`);
  await tb.executeJavaScript(`window.keptFeedRow=document.querySelector('#feed li')`);
  await tb.executeJavaScript(`window.deizaBrowser.options({model:'liquid51',effort:'max'})`);
  await tb.executeJavaScript(`(() => { const t = document.getElementById('side-text'); t.value = 'Ahora pulsa Menú'; document.getElementById('side-form').requestSubmit(); })()`);
  await new Promise(r => setTimeout(r, 400));
  check('escribir en el panel llega a la sesión', got.length === 1 && got[0][0] === 'work_7' && got[0][1] === 'Ahora pulsa Menú', JSON.stringify(got));
  check('el mensaje lleva el modelo y esfuerzo elegidos para el siguiente encargo', got[0]?.[2]?.model === 'liquid51' && got[0]?.[2]?.effort === 'max');
  b.setWorkState('work_7', { running: true, model: 'liquid51', effort: 'max' });
  ui = await tb.executeJavaScript(`[...document.querySelectorAll('#feed li')].map(li => li.className).join(',')`);
  check('tu mensaje aparece en el panel', ui.includes('user'), ui);
  check('los nuevos mensajes conservan las filas anteriores sin remontarlas', await tb.executeJavaScript(`window.keptFeedRow===document.querySelector('#feed li')`));
  failNext = true;
  await tb.executeJavaScript(`document.getElementById('side-text').value='Este mensaje debe conservarse';document.getElementById('side-form').requestSubmit()`);
  await new Promise(r => setTimeout(r, 200));
  ui = await tb.executeJavaScript(`({draft:document.getElementById('side-text').value,error:document.getElementById('side-feedback').textContent})`);
  check('un fallo conserva el borrador y muestra el error', ui.draft === 'Este mensaje debe conservarse' && /No se pudo enviar/.test(ui.error), JSON.stringify(ui));
  check('las páginas externas no tienen el puente ni el token', await view.executeJavaScript(`typeof window.deizaBrowser === 'undefined' && typeof window.deizaDesktop === 'undefined'`));
  await tb.executeJavaScript(`document.getElementById('side-mic').click()`);
  await new Promise(r => setTimeout(r, 200));
  check('dictado denegado muestra cómo activar el permiso', await tb.executeJavaScript(`/micrófono/.test(document.getElementById('side-feedback').textContent)`));
  micAllowed = true;
  await tb.executeJavaScript(`(() => {
    window.voiceTracksStopped=0;
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>window.voiceTracksStopped++}]})}});
    window.MediaRecorder=class {
      static isTypeSupported(){return true} constructor(){this.state='inactive';this.mimeType='audio/webm'}
      start(){this.state='recording'} stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array(900)],{type:'audio/webm'})});setTimeout(()=>this.onstop?.(),0)}
    };
    document.getElementById('side-text').value=''; document.getElementById('side-mic').click();
  })()`);
  await new Promise(r => setTimeout(r, 750));
  await tb.executeJavaScript(`document.getElementById('voice-done').click()`);
  await new Promise(r => setTimeout(r, 500));
  ui = await tb.executeJavaScript(`({draft:document.getElementById('side-text').value,stopped:window.voiceTracksStopped,hidden:document.getElementById('voice-strip').hidden})`);
  check('dictado usa la API autenticada y queda en la caja sin enviarse', ui.draft === 'Resume las tareas de esta semana' && speech.length === 1 && speech[0].token === 'panel-test-token' && speech[0].body.includes('name="audio"') && got.length === 1, JSON.stringify(ui));
  check('dictado libera el micrófono al terminar', ui.stopped === 1 && ui.hidden);
  fs.writeFileSync(path.join(OUT, 'panel.png'), (await tb.capturePage()).toPNG());
  try {
    const id = win.getMediaSourceId().split(':')[1];
    require('node:child_process').execFileSync('screencapture', ['-x', '-o', '-l', id, path.join(OUT, 'panel-window.png')]);
    console.log('captura:', path.join(OUT, 'panel-window.png'));
  } catch (e) { console.log('screencapture:', e.message.split('\n')[0]); }
  await tb.executeJavaScript(`document.getElementById('side-mic').click()`);
  await new Promise(r => setTimeout(r, 100));
  await tb.executeJavaScript(`document.getElementById('side-close').click()`);
  await new Promise(r => setTimeout(r, 300));
  const pageW2 = await view.executeJavaScript('innerWidth');
  check('cerrar el panel devuelve el ancho a la página', pageW2 > pageW + 250, `${pageW} -> ${pageW2}`);
  check('ocultar el panel no detiene el encargo', stopped === 0);
  check('ocultar el panel corta el micrófono y descarta el audio', await tb.executeJavaScript(`window.voiceTracksStopped===2 && document.getElementById('voice-strip').hidden`) && speech.length === 1);
  await tb.executeJavaScript(`document.getElementById('panel-toggle').click()`);
  await new Promise(r => setTimeout(r, 100));
  await tb.executeJavaScript(`document.getElementById('agent-stop').click()`);
  await new Promise(r => setTimeout(r, 100));
  check('detener espera a la confirmación del chat', stopped === 1 && await tb.executeJavaScript(`/deteniendo/.test(document.getElementById('side-state').textContent)`));
  b.setWorkState('work_7', { running: false, model: 'liquid51', effort: 'max' });
  win.close();
  await new Promise(r => setTimeout(r, 300));
  const back = await b.reveal('work_7', url);
  check('mostrar navegador lo reabre en su página', !back.error && BrowserWindow.getAllWindows().length === 1, JSON.stringify(back).slice(0, 120));
  const reopened = BrowserWindow.getAllWindows()[0];
  reopened.setBounds({ width: 640, height: 420 });
  await new Promise(r => setTimeout(r, 200));
  ui = await reopened.webContents.executeJavaScript(`({model:document.getElementById('side-model').value,effort:document.getElementById('side-effort').value,optionsBottom:document.getElementById('side-options').getBoundingClientRect().bottom,height:innerHeight,bodyWidth:document.body.scrollWidth,width:innerWidth})`);
  check('reabrir conserva modelo y esfuerzo', ui.model === 'liquid51' && ui.effort === 'max');
  check('el panel cabe en la ventana mínima sin ocultar los controles', ui.optionsBottom <= ui.height && ui.bodyWidth <= ui.width, JSON.stringify(ui));
  fs.writeFileSync(path.join(OUT, 'panel-small.png'), (await reopened.webContents.capturePage()).toPNG());
  require('../src/shared/i18n').setLanguage('en');
  b.say('work_7', { kind: 'status', text: 'Ready' });
  await new Promise(r => setTimeout(r, 100));
  check('modelo, esfuerzo y voz tienen etiquetas accesibles en inglés', await reopened.webContents.executeJavaScript(`document.getElementById('side-model').getAttribute('aria-label')==='Model' && document.getElementById('side-effort').getAttribute('aria-label')==='Effort' && document.getElementById('side-mic').getAttribute('aria-label')==='Dictate a message' && document.getElementById('side-effort').options[0].textContent==='Low'`));
  console.log(`\n${ok.length} OK, ${bad.length} MAL${bad.length ? ': ' + bad.join(', ') : ''}`);
  b.shutdown(); codeHost.shutdown(); server.close(); app.exit(bad.length ? 1 : 0);
}).catch(e => { console.error(e); app.exit(2); });
