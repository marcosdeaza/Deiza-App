/**
 * Code composer while a turn runs: Stop is never greyed out, what you write goes into the running
 * turn (code:steer), and Stop unlocks the window when the turn had already ended.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deiza-steer-test-'));

const fixtureSource = `
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
app.setPath('userData', ${JSON.stringify(scratch)});
const doc = { id: 'test-session', title: 'Test Session', folder: '/test-folder', items: [], seq: 0,
  mode: 'build', model: 'deiza-solid-5', effort: 'medium', running: false, updatedAt: Date.now() };
global.fixtureDoc = doc;
global.codeGetDelay = 0;
global.codeGetResponses = [];
const handle = (name, value) => ipcMain.handle(name, async () => value);
handle('app:init', { mode: 'code', theme: 'dark', platform: 'win32', version: 'test', home: '/test-folder',
  titlebarHeight: 46, language: 'es', auth: { signedIn: true, user: { name: 'Test User', plan: 'signet' } } });
handle('code:list', { sessions: [doc], recents: [], lastSession: doc.id });
ipcMain.handle('code:get', async () => {
  const queued = global.codeGetResponses.shift();
  const snapshot = structuredClone(queued ? queued.doc : global.fixtureDoc);
  const delay = queued ? queued.delay : global.codeGetDelay;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  return snapshot;
});
handle('code:prefs', { model: doc.model, effort: doc.effort, mode: doc.mode });
handle('code:usage', { state: 'ok', plan: 'signet', tokens_used: 0, token_limit: 1e6 });
handle('app:update-state', { state: 'idle' });
handle('settings:get', { platform: 'win32', arch: 'x64', language: 'es', version: 'test' });
handle('account:get', { name: 'Test User', plan: 'signet' });
handle('code:fs-list', { entries: [] });
handle('settings:set', { ok: true });
handle('code:set-model', { ok: true });
handle('code:set-mode', { ok: true });
handle('app:mic-access', false);
ipcMain.handle('code:attach', async (_e, { paths = [], files = [] }) => {
  return { attachments: [...paths.map(p => ({ id: 'att_' + path.basename(p), name: path.basename(p), kind: 'file', size: 1024 })), ...files], errors: [] };
});
ipcMain.handle('code:create', async (_e, { folder }) => {
  if (folder.endsWith('.py') || folder.endsWith('.zip') || folder.endsWith('.sh')) return { error: 'folder' };
  return { id: 'new-session', folder };
});
ipcMain.on('app:overlay', () => {});
global.steers = []; global.aborts = []; global.steerReply = { ok: true, id: 'u_s1' }; global.abortReply = { ok: true };
ipcMain.handle('code:steer', async (_e, p) => { global.steers.push(p); return global.steerReply; });
ipcMain.handle('code:abort', async (_e, id) => { global.aborts.push(id); return global.abortReply; });
ipcMain.handle('code:send', async (_e, p) => { (global.sends ||= []).push(p); return { ok: true, turnId: 't2' }; });
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }));
  const win = new BrowserWindow({ width: 1100, height: 750, show: true, minWidth: 800, minHeight: 600,
    webPreferences: { preload: path.join(${JSON.stringify(ROOT)}, 'src/preload/app.js'), contextIsolation: true, sandbox: true } });
  win.loadFile(path.join(${JSON.stringify(ROOT)}, 'src/renderer/app/index.html'), { query: { platform: 'win32' } });
});
app.on('window-all-closed', () => app.quit());
`;

(async () => {
  const fixturePath = path.join(scratch, 'main.js');
  fs.writeFileSync(fixturePath, fixtureSource);
  let app;
  try {
    const env = { ...process.env, NODE_ENV: 'test' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.DEIZA_TEST_TOKEN;
    app = await electron.launch({ executablePath: require('electron'), args: [fixturePath], env });
    const ui = await app.firstWindow();
    await ui.waitForLoadState('domcontentloaded');
    await ui.waitForFunction(() => typeof S !== 'undefined' && S.cur && document.querySelector('#composer-wrap textarea'));
    let seq = 0;
    const event = (ev) => ui.evaluate(({ ev, seq }) => onCodeEvent({ id: S.cur.id, seq, ev }), { ev, seq: ++seq });

    // A turn starts.
    await event({ t: 'user', id: 'u_1', text: 'Haz la web', turnId: 't1', hist: 0 });
    await event({ t: 'status', kind: 'thinking', text: 'Razonando' });
    const ta = ui.locator('#composer-wrap textarea');
    const stop = ui.locator('#composer-wrap .send:not(.steer-send)');
    assert.equal(await stop.isDisabled(), false, 'Stop enabled while running');
    // Typing and clearing the box used to grey Stop out.
    await ta.fill('x'); await ta.fill('');
    assert.equal(await stop.isDisabled(), false, 'Stop must stay enabled after typing and clearing');
    assert.equal(await ui.locator('#composer-wrap .steer-send').isVisible(), false, 'no send-now button with an empty box');

    // Writing while it works: Enter sends into the running turn.
    await ta.fill('Ponla en azul');
    assert.equal(await ui.locator('#composer-wrap .steer-send').isVisible(), true, 'send-now button appears');
    await ta.press('Enter');
    await ui.waitForTimeout(150);
    const steers = await app.evaluate(() => global.steers);
    assert.deepEqual(steers, [{ id: 'test-session', text: 'Ponla en azul' }]);
    assert.equal(await ta.inputValue(), '', 'box cleared after sending');
    await event({ t: 'user', id: 'u_s1', text: 'Ponla en azul', turnId: 't1', steer: true });
    assert.match(await ui.locator('.msg-user.steer .steer-note').innerText(), /siguiente paso/);
    await event({ t: 'steer_read', ids: ['u_s1'] });
    assert.match(await ui.locator('.msg-user.steer .steer-note').innerText(), /Leído/);
    assert.equal(await ui.locator('.msg-user.steer .ua-btn[title="Editar"]').count(), 0, 'no edit/retry on mid-turn messages');

    // Stop when the main process says nothing runs: the window must leave "Deteniendo".
    await app.evaluate(() => { global.abortReply = { ok: true, idle: true }; });
    await stop.click();
    await ui.waitForTimeout(900);
    assert.equal(await ui.evaluate(() => S.cur.running), false, 'window unlocked after a stale Stop');
    assert.deepEqual(await app.evaluate(() => global.aborts), ['test-session']);

    // Stopped before reading a message: it comes back to the box.
    await event({ t: 'user', id: 'u_2', text: 'Otra', turnId: 't2', hist: 2 });
    await event({ t: 'steer_returned', ids: ['u_2'], text: 'Revisa el logo' });
    assert.equal(await ta.inputValue(), 'Revisa el logo');
    console.log('PASS: Stop never greyed out, steer on Enter, read marks, stale Stop unlock, returned text.');
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err); process.exit(1); });
