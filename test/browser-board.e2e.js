'use strict';
// Chess board moves by square (browser_board_move): ./node_modules/.bin/electron test/browser-board.e2e.js
const { app } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const REPO = path.join(__dirname, '..');
app.commandLine.appendSwitch('use-mock-keychain');
app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'deiza-board-')));
const ok = [], bad = [];
const check = (name, cond, extra = '') => { (cond ? ok : bad).push(name); console.log(`${cond ? 'OK ' : 'MAL'} ${name}${extra ? ' · ' + extra : ''}`); };
// A chess.com-like board: <wc-chess-board> 560 px, ".flipped" when black, pointer drag, promotion window.
const board = (flipped) => `<!doctype html><title>Tablero</title><style>body{margin:0;padding:40px 120px;background:#312e2b}
wc-chess-board{display:block;width:560px;height:560px;position:relative;background:conic-gradient(#769656 25%,#eeeed2 0 50%,#769656 0 75%,#eeeed2 0) 0 0/140px 140px}
.promotion-window{position:absolute;display:none}.promotion-window.on{display:block}.promotion-piece{width:70px;height:70px;background:#fff;border:1px solid #000}</style>
<wc-chess-board class="${flipped ? 'flipped' : ''}"><div class="promotion-window"><div class="promotion-piece wq"></div><div class="promotion-piece bq"></div></div></wc-chess-board><pre id="log"></pre>
<script>const b=document.querySelector('wc-chess-board'),L=document.getElementById('log');const flip=b.classList.contains('flipped');
const sq=(e)=>{const r=b.getBoundingClientRect();let c=Math.floor((e.clientX-r.left)/(r.width/8)),w=Math.floor((e.clientY-r.top)/(r.height/8));if(flip){c=7-c;w=7-w;}return 'abcdefgh'[c]+(8-w);};
let from=null;b.addEventListener('pointerdown',e=>{from=sq(e)});b.addEventListener('pointerup',e=>{const to=sq(e);L.textContent+='move '+from+to+'\\n';if(to[1]==='8'||to[1]==='1'){document.querySelector('.promotion-window').classList.add('on')}});
document.querySelectorAll('.promotion-piece').forEach(p=>p.addEventListener('click',()=>{L.textContent+='promo '+p.className.split(' ')[1]+'\\n'}));</script>`;
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(board(req.url.includes('black'))); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const { createBrowserController } = require(path.join(REPO, 'src/main/computer-browser.js'));
  const b = createBrowserController({ getOwner: () => null });
  const ctx = { sessionId: 'board1', mode: 'build' };
  let r = await b.execute('browser_open', { url: base + 'white' }, ctx);
  r = await b.execute('browser_screenshot', {}, ctx);
  check('la captura dice dónde está el tablero', r.board && r.board.w > 400 && r.board.orientation === 'white', JSON.stringify(r.board));
  r = await b.execute('browser_board_move', { from: 'e2', to: 'e4', observe: 'snapshot' }, ctx);
  check('mueve e2→e4 con blancas', /move e2e4/.test(r.text || ''), (r.text || '').match(/move \w+/)?.[0] || r.error);
  r = await b.execute('browser_board_move', { from: 'g1', to: 'f3', observe: 'snapshot' }, ctx);
  check('mueve g1→f3', /move g1f3/.test(r.text || ''));
  r = await b.execute('browser_board_move', { from: 'a7', to: 'a8', promotion: 'q', observe: 'snapshot' }, ctx);
  check('corona a dama', /move a7a8/.test(r.text || '') && /promo wq/.test(r.text || ''), (r.text || '').split('\n').filter(l => /move|promo/.test(l)).slice(-2).join(' | '));
  r = await b.execute('browser_open', { url: base + 'black' }, ctx);
  r = await b.execute('browser_board_move', { from: 'e7', to: 'e5', observe: 'snapshot' }, ctx);
  check('tablero girado (negras): e7→e5', /move e7e5/.test(r.text || ''), (r.text || '').match(/move \w+/)?.[0]);
  r = await b.execute('browser_board_move', { from: 'e9', to: 'e5' }, ctx);
  check('casilla mal escrita: error claro', /notación algebraica/.test(r.error || ''), r.error);
  // Work bridge
  const w = await b.work('open', { url: base + 'white' }, { sessionId: 'work_9' });
  check('Work ve el tablero en su estado', w.board && w.board.orientation === 'white');
  const m = await b.work('board_move', { from: 'd2', to: 'd4' }, { sessionId: 'work_9' });
  const rd = await b.work('read', {}, { sessionId: 'work_9' });
  check('Work: board_move d2→d4', /move d2d4/.test(rd.text || '') && m.clicked, JSON.stringify(m.clicked));
  // Windows paths are project files, not URL schemes
  const proj = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'deiza-proj-'));
  fs.writeFileSync(path.join(proj, 'index.html'), '<title>Proyecto</title><h1>Hola</h1>');
  r = await b.execute('browser_open', { url: path.join(proj, 'index.html') }, { sessionId: 'board1', folder: proj, mode: 'build' });
  check('ruta absoluta del proyecto abre la vista previa', r.title === 'Proyecto', r.error || r.title);
  r = await b.execute('browser_open', { url: 'file://' + path.join(proj, 'index.html') }, { sessionId: 'board1', folder: proj, mode: 'build' });
  check('file:// del proyecto abre la vista previa', r.title === 'Proyecto', r.error || r.title);
  r = await b.execute('browser_key', { key: 'F5' }, ctx);
  check('tecla F5', !r.error, r.error);
  console.log(`\n${ok.length} OK, ${bad.length} MAL${bad.length ? ': ' + bad.join(', ') : ''}`);
  b.shutdown(); server.close(); app.exit(bad.length ? 1 : 0);
}).catch(e => { console.error(e); app.exit(2); });
