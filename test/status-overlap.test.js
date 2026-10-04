/**
 * Tests that status labels with long commands NEVER overlap or cross Capu,
 * and that drag-and-drop of scripts, zips, folders, and images works properly.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deiza-status-test-'));

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
    app = await electron.launch({
      executablePath: require('electron'),
      args: [fixturePath],
      env,
    });
    const ui = await app.firstWindow();
    await ui.waitForLoadState('domcontentloaded');
    await ui.waitForFunction(() => typeof S !== 'undefined' && S.cur && capu.el?.isConnected);
    await ui.evaluate(() => { window.__capuSeq = S.cur.seq || 0; });

    // 1. Verify Capu and status line are present
    const hasCapu = await ui.evaluate(() => Boolean(capu.el && capu.el.isConnected));
    assert.equal(hasCapu, true, 'Capu must be mounted on composer');

    // 2. Emit an extremely long command status
    const longCommand = 'npm run build:production -- --optimize-chunks --output-dir=/Users/marcos/very/deep/nested/directory/that/goes/on/and/on/forever/with/extremely/long/arguments/and/flags/index.js && node server.js --config=prod.json --verbose';
    await ui.evaluate((cmd) => {
      onCodeEvent({
        id: S.cur.id,
        seq: ++window.__capuSeq || 1,
        ev: { t: 'status', kind: 'running', name: 'run_command', text: cmd },
      });
    }, longCommand);

    // Wait for frame and fit
    await ui.waitForTimeout(100);

    const check = await ui.evaluate(() => {
      const label = document.querySelector('#statusline .status-label');
      const capuEl = capu.el;
      if (!label || !capuEl) return null;
      const lRect = label.getBoundingClientRect();
      const cRect = capuEl.getBoundingClientRect();
      const em = label.querySelector('em');
      return {
        labelRight: lRect.right,
        labelLeft: lRect.left,
        capuLeft: cRect.left,
        capuRight: cRect.right,
        labelMaxWidth: label.style.maxWidth,
        gap: cRect.left - lRect.right,
        emText: em ? em.textContent : '',
        emOverflow: em ? getComputedStyle(em).overflow : '',
      };
    });

    assert.ok(check, 'Status label and Capu elements must be queryable');
    console.log('Status positioning with long command:', check);
    assert.ok(check.labelRight <= check.capuLeft, `Label right (${check.labelRight}px) must NOT exceed Capu left (${check.capuLeft}px)! Gap: ${check.gap}px`);
    assert.ok(check.gap >= 10, `Label must have at least 10px buffer before Capu! Gap: ${check.gap}px`);

    // 3. Test completion "Hecho" status
    await ui.evaluate(() => {
      onCodeEvent({
        id: S.cur.id,
        seq: ++window.__capuSeq,
        ev: { t: 'turn_end', stopReason: 'done' },
      });
    });
    await ui.waitForTimeout(100);

    const doneCheck = await ui.evaluate(() => {
      const label = document.querySelector('#statusline .status-label');
      const capuEl = capu.el;
      if (!label || !capuEl) return null;
      const lRect = label.getBoundingClientRect();
      const cRect = capuEl.getBoundingClientRect();
      return {
        labelRight: lRect.right,
        capuLeft: cRect.left,
        gap: cRect.left - lRect.right,
        text: label.textContent,
      };
    });
    console.log('Done status check:', doneCheck);
    assert.ok(doneCheck.labelRight <= doneCheck.capuLeft, 'Done status must not overlap Capu');

    // Incomplete and blocked turns are persisted warnings, with no successful completion glow.
    for (const [language, reason, expected] of [
      ['es', 'incomplete', 'Queda trabajo pendiente'], ['es', 'blocked', 'Necesita tu ayuda'],
      ['en', 'incomplete', 'Work remains'], ['en', 'blocked', 'Needs your help'],
    ]) {
      const state = await ui.evaluate(({ language, reason }) => {
        DeizaI18n.setLanguage(language);
        S.cur.running = true;
        onCodeEvent({ id: S.cur.id, seq: ++window.__capuSeq, ev: { t: 'turn_end', turnId: `test-${language}-${reason}`, stopReason: reason } });
        const turn = [...document.querySelectorAll('.turn')].at(-1);
        return { text: turn.textContent, success: Boolean(turn.querySelector('.ok')), glow: S.afterglow, running: S.cur.running };
      }, { language, reason });
      assert.ok(state.text.includes(expected), `${reason} must show its specific state in ${language}`);
      assert.equal(state.success, false);
      assert.equal(state.glow, 0);
      assert.equal(state.running, false);
    }
    await ui.evaluate(() => DeizaI18n.setLanguage('es'));

    // 4. Test dropping a script, a zip, an image, and a folder into the active chat session
    const dropResult = await ui.evaluate(async () => {
      const mockFiles = [
        { name: 'deploy.sh', path: '/Users/marcos/deploy.sh', type: '' },
        { name: 'backup.zip', path: '/Users/marcos/backup.zip', type: 'application/zip' },
        { name: 'test.py', path: '/Users/marcos/test.py', type: 'text/x-python' },
        { name: 'screenshot.png', path: '/Users/marcos/screenshot.png', type: 'image/png' },
      ];
      // Simulate drop event on #code
      const dt = { files: mockFiles };
      const event = new Event('drop', { bubbles: true, cancelable: true });
      event.dataTransfer = dt;
      document.querySelector('#code').dispatchEvent(event);
      await new Promise(r => setTimeout(r, 200));
      return {
        attachments: S.attachments.map(a => a.name),
        errors: [],
      };
    });

    console.log('Drop result:', dropResult);
    assert.ok(dropResult.attachments.includes('deploy.sh'), 'deploy.sh should be attached');
    assert.ok(dropResult.attachments.includes('backup.zip'), 'backup.zip should be attached');
    assert.ok(dropResult.attachments.includes('test.py'), 'test.py should be attached');
    assert.ok(dropResult.attachments.includes('screenshot.png'), 'screenshot.png should be attached');

    // A cloud reload of the current id must read its new transcript while preserving the draft.
    await ui.fill('#composer-wrap textarea', 'Mi corrección aún sin enviar');
    const draftAttachments = await ui.evaluate(() => S.attachments.map(a => a.id));
    await app.evaluate(() => {
      global.fixtureDoc.seq = 100;
      global.fixtureDoc.items = [{ k: 'user', id: 'remote-user', text: 'Actualizado desde otro ordenador' }];
    });
    await ui.evaluate(() => openSession(S.cur.id, true));
    assert.equal(await ui.locator('#composer-wrap textarea').inputValue(), 'Mi corrección aún sin enviar');
    assert.deepEqual(await ui.evaluate(() => S.attachments.map(a => a.id)), draftAttachments);
    assert.equal(await ui.evaluate(() => S.cur.items[0].text), 'Actualizado desde otro ordenador');
    assert.equal(await ui.evaluate(() => S.cur.seq), 100);

    // Events after the IPC snapshot must be replayed; events already inside it must not duplicate.
    await app.evaluate(() => { global.codeGetDelay = 160; global.fixtureDoc.seq = 200; });
    const buffered = await ui.evaluate(async () => {
      const reload = openSession(S.cur.id, true);
      onCodeEvent({ id: S.cur.id, seq: 199, ev: { t: 'text', delta: 'Already in the snapshot' } });
      onCodeEvent({ id: S.cur.id, seq: 201, ev: { t: 'text', delta: 'Texto llegado durante la recarga' } });
      await reload;
      return { seq: S.cur.seq, texts: S.cur.items.filter(it => it.k === 'text').map(it => it.text) };
    });
    assert.equal(buffered.seq, 201);
    assert.deepEqual(buffered.texts, ['Texto llegado durante la recarga']);

    // Two overlapping reloads of the same id may finish out of order: the newest request wins.
    await app.evaluate(() => {
      global.codeGetResponses = [
        { doc: { ...global.fixtureDoc, seq: 300, title: 'Older delayed copy' }, delay: 160 },
        { doc: { ...global.fixtureDoc, seq: 400, title: 'Newest copy' }, delay: 20 },
      ];
    });
    await ui.evaluate(async () => { const first = openSession(S.cur.id, true); const second = openSession(S.cur.id, true); await Promise.all([first, second]); });
    assert.equal(await ui.evaluate(() => S.cur.title), 'Newest copy');
    assert.equal(await ui.evaluate(() => S.cur.seq), 400);
    assert.equal(await ui.locator('#composer-wrap textarea').inputValue(), 'Mi corrección aún sin enviar');
    assert.deepEqual(await ui.evaluate(() => S.attachments.map(a => a.id)), draftAttachments);

    // A failed reload leaves the current draft and its visible attachment chips available.
    await app.evaluate(() => { global.codeGetResponses = [{ doc: null, delay: 0 }]; });
    await ui.evaluate(() => openSession(S.cur.id, true));
    assert.equal(await ui.locator('#composer-wrap textarea').inputValue(), 'Mi corrección aún sin enviar');
    assert.equal(await ui.locator('#composer-wrap .file-att').count(), draftAttachments.length);
    assert.equal(await ui.evaluate(() => S.cur.seq), 400);

    console.log('PASS: status clipping, completion states, attachments and session reload races');
  } finally {
    if (app) await app.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
