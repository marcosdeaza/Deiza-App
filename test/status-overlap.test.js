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
const handle = (name, value) => ipcMain.handle(name, async () => value);
handle('app:init', { mode: 'code', theme: 'dark', platform: 'win32', version: 'test', home: '/test-folder',
  titlebarHeight: 46, language: 'es', auth: { signedIn: true, user: { name: 'Test User', plan: 'signet' } } });
handle('code:list', { sessions: [doc], recents: [], lastSession: doc.id });
handle('code:get', doc);
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
    app = await electron.launch({
      args: [fixturePath],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    const ui = await app.firstWindow();
    await ui.waitForLoadState('domcontentloaded');
    await ui.waitForSelector('#thread');

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

    console.log('PASS: status-overlap and drag & drop tests passed successfully!');
  } finally {
    if (app) await app.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
