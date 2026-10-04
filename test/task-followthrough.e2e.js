/** Real app -> IPC host -> utility worker -> SSE -> local file tools, with an isolated fixture. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deiza-followthrough-'));
  const project = path.join(scratch, 'project'), profile = path.join(scratch, 'profile');
  fs.mkdirSync(project); fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'state.json'), JSON.stringify({ mode: 'code' }));
  fs.writeFileSync(path.join(profile, 'code-prefs.json'), JSON.stringify({ syncSessions: false }));
  fs.writeFileSync(path.join(project, 'icon.txt'), 'red');
  fs.writeFileSync(path.join(project, 'verify-and-deploy.js'), `const fs = require('fs');
const color = fs.readFileSync('icon.txt', 'utf8');
if (!['blue','green'].includes(color)) process.exit(1);
fs.mkdirSync('deployed', { recursive:true }); fs.copyFileSync('icon.txt', 'deployed/icon.txt');
console.log('Verified and deployed fixture:', color);
`);
  let phase = 'blue', normal = 0, reviews = 0;
  const requests = [], errors = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url === '/api/code/chat/completions') {
      const body = JSON.parse(raw); requests.push(body);
      const reviewTool = (body.tools || []).find(t => t.function.name === 'task_completion_review');
      let text = '', calls = [];
      if (reviewTool && body.tools.length === 1) {
        reviews++;
        const changed = fs.readFileSync(path.join(project, 'icon.txt'), 'utf8') === phase;
        const deployed = fs.existsSync(path.join(project, 'deployed/icon.txt')) && fs.readFileSync(path.join(project, 'deployed/icon.txt'), 'utf8') === phase;
        calls = [{ name: reviewTool.function.name, arguments: JSON.stringify({ status: changed && deployed ? 'completed' : 'continue', rationale: changed && deployed ? 'La corrección actual está implementada, comprobada y desplegada.' : 'Sólo ha leído el archivo; queda cambiarlo y desplegarlo.', next_action: changed && deployed ? '' : 'Escribe el color solicitado, ejecuta verify-and-deploy.js y comprueba el resultado.' }) }];
      } else {
        const step = normal++;
        if (step === 0) calls = [{ name: 'read_file', arguments: '{"path":"icon.txt"}' }];
        else if (step === 1) text = 'Ahora voy a modificar el icono y desplegarlo.';
        else if (step === 2) calls = [{ name: 'write_file', arguments: JSON.stringify({ path: 'icon.txt', content: phase }) }];
        else if (step === 3) calls = [{ name: 'run_command', arguments: '{"command":"node verify-and-deploy.js"}' }];
        else if (step === 4) text = 'Icono modificado, comprobado y desplegado en la aplicación de prueba.';
        else throw new Error('Unexpected extra execution round');
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta = calls.length ? { tool_calls: calls.map((c, index) => ({ index, id: `call_${phase}_${requests.length}_${index}`, type: 'function', function: c })) } : { content: text };
      res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/code/usage') return res.end(JSON.stringify({ state: 'ok', plan: 'signet', tokens_used: 0, token_limit: 1000000 }));
    if (req.url.startsWith('/api/code/sessions')) return res.end('{"sessions":[]}');
    if (req.url === '/api/skills') return res.end('{"custom":[]}');
    if (req.url === '/auth/me') return res.end('{"user":{"id":7,"name":"Test","plan":"signet"}}');
    res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [ROOT], env: { ...process.env, DEIZA_USER_DATA: profile, DEIZA_URL: `http://127.0.0.1:${server.address().port}`, DEIZA_TEST_TOKEN: 'fixture-only', NODE_ENV: 'test' } });
    await app.firstWindow();
    const ui = app.windows().find(p => p.url().includes('/app/index.html')) || await app.firstWindow();
    ui.on('pageerror', err => errors.push(err.message));
    await ui.waitForSelector('#code');
    await ui.evaluate(() => { window.__turnEvents = []; window.deiza.on('code:event', event => window.__turnEvents.push(event)); });
    const session = await ui.evaluate(folder => window.deiza.code.create({ folder, mode: 'build' }), project);
    assert(session.id);
    for (const color of ['blue', 'green']) {
      phase = color; normal = 0;
      const before = requests.length;
      const eventOffset = await ui.evaluate(() => window.__turnEvents.length);
      const sent = await ui.evaluate(({ id, color }) => window.deiza.code.send({ id, text: `Cambia el icono a ${color}, compruébalo y despliega la corrección.`, mode: 'build' }), { id: session.id, color });
      assert.equal(sent.ok, true);
      await ui.waitForFunction(turn => window.__turnEvents.some(e => e.ev.t === 'turn_end' && e.ev.turnId === turn), sent.turnId, { timeout: 30000 });
      const end = await ui.evaluate(turn => window.__turnEvents.find(e => e.ev.t === 'turn_end' && e.ev.turnId === turn).ev, sent.turnId);
      assert.equal(end.stopReason, 'done');
      assert.equal(fs.readFileSync(path.join(project, 'deployed/icon.txt'), 'utf8'), color);
      assert.equal(normal, 5, 'The promise must continue to write, verify and deploy without another user prompt');
      const text = await ui.evaluate(offset => window.__turnEvents.slice(offset).filter(e => e.ev.t === 'text').map(e => e.ev.delta).join(''), eventOffset);
      assert(!text.includes('Ahora voy a modificar'), 'An unverified candidate must not be presented as the final answer');
      assert(text.includes('Icono modificado'), 'The verified final answer must be visible');
      const audited = requests.slice(before).filter(r => r.tools?.length === 1 && r.tools[0].function.name === 'task_completion_review');
      assert(audited.length >= 1);
      assert(audited.every(r => JSON.stringify(r.messages).includes(`Cambia el icono a ${color}`)), 'Review must use the current correction');
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    assert(reviews >= 2);
    const doc = await ui.evaluate(id => window.deiza.code.get(id), session.id);
    assert.equal(doc.items.filter(i => i.k === 'user').length, 2, 'Automatic continuation must not create extra human messages');
    console.log('PASS: real Electron app, utility worker and SSE finish two corrections through read -> promise -> write -> verify/deploy without user interruptions.');
  } finally {
    if (app) await app.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
