/**
 * Capu renderer regression in real Electron, with the production HTML/CSS/preload and local IPC.
 *   CAPU_TEST_OUTPUT=/path/to/work/capu-motion node test/capu-motion.js
 *   CAPU_TEST_DPRS=1.25,1.5 node test/capu-motion.js
 * The fixture has no tokens, workers or HTTP requests; screenshots/report stay in work/.
 * This exercises Windows renderer styling/DPI, not the native Windows graphics driver.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.env.CAPU_TEST_OUTPUT || path.join(ROOT, 'work/capu-motion'));
const DPRS = (process.env.CAPU_TEST_DPRS || '1.25,1.5').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });

const fixtureSource = `
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
app.setPath('userData', process.env.CAPU_TEST_PROFILE);
app.commandLine.appendSwitch('force-device-scale-factor', process.env.CAPU_TEST_DPR);
const doc = { id: 'capu-local', title: 'Capu regression', folder: '/capu-local', items: [], seq: 0,
  mode: 'build', model: 'deiza-solid-5', effort: 'medium', running: false, updatedAt: Date.now() };
const handle = (name, value) => ipcMain.handle(name, async () => value);
handle('app:init', { mode: 'code', theme: 'dark', platform: 'win32', version: 'test', home: '/capu-local',
  titlebarHeight: 46, language: 'es', auth: { signedIn: true, user: { name: 'Capu Test', plan: 'signet' } } });
handle('code:list', { sessions: [doc], recents: [], lastSession: doc.id });
handle('code:get', doc);
handle('code:prefs', { model: doc.model, effort: doc.effort, mode: doc.mode });
handle('code:usage', { state: 'ok', plan: 'signet', tokens_used: 0, token_limit: 1e6 });
handle('app:update-state', { state: 'idle' });
handle('settings:get', { platform: 'win32', arch: 'x64', language: 'es', version: 'test' });
handle('account:get', { name: 'Capu Test', plan: 'signet' });
handle('code:fs-list', { entries: [] });
handle('settings:set', { ok: true });
handle('code:set-model', { ok: true });
handle('code:set-mode', { ok: true });
handle('app:mic-access', false);
ipcMain.handle('code:send', async () => { await new Promise(r => setTimeout(r, 800)); return { ok: true }; });
ipcMain.on('app:overlay', () => {});
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => cb({ cancel: true }));
  const win = new BrowserWindow({ width: 1260, height: 860, show: true, minWidth: 900, minHeight: 600,
    webPreferences: { preload: path.join(${JSON.stringify(ROOT)}, 'src/preload/app.js'), contextIsolation: true, sandbox: true } });
  win.loadFile(path.join(${JSON.stringify(ROOT)}, 'src/renderer/app/index.html'), { query: { platform: 'win32' } });
});
app.on('window-all-closed', () => app.quit());
`;

// Sample every paint: a model reaction or home trip must never remove or hide the mascot.
async function sample(ui, ms, repeatEvents = false) {
  return ui.evaluate(({ ms, repeatEvents }) => new Promise(resolve => {
    const start = performance.now();
    const hashes = new Set();
    const frames = [];
    let firstHome = null;
    let nextEvent = 0;
    const tick = now => {
      const elapsed = now - start;
      if (repeatEvents && elapsed >= nextEvent) {
        nextEvent = elapsed + 35;
        onCodeEvent({ id: S.cur.id, seq: ++window.__capuSeq, ev: { t: 'text', delta: '.' } });
        onCodeEvent({ id: S.cur.id, seq: ++window.__capuSeq, ev: { t: 'status', kind: 'thinking', text: 'Pensando' } });
      }
      const el = capu.el;
      const svg = el && el.querySelector('svg');
      const bounds = svg && svg.getBoundingClientRect();
      let opacity = 1;
      for (let p = el; p; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
      const target = capuRange()[1];
      const x = el && parseFloat(el.style.left);
      const visible = !!(el && el.isConnected && svg && svg.querySelector('rect') && bounds.width && bounds.height && opacity > 0);
      frames.push({ ms: Math.round(elapsed), visible, x, target, scene: capu.player.scene, kind: capu.moveKind });
      if (svg) hashes.add(svg.innerHTML);
      if (firstHome === null && Math.abs(x - target) <= 1 && capu.moveKind !== 'home') firstHome = elapsed;
      if (elapsed < ms) requestAnimationFrame(tick);
      else resolve({ frames: frames.length, missing: frames.filter(f => !f.visible), distinct: hashes.size,
        firstHome, minX: Math.min(...frames.map(f => f.x)), maxX: Math.max(...frames.map(f => f.x)),
        last: frames[frames.length - 1], scenes: [...new Set(frames.map(f => f.scene))] });
    };
    requestAnimationFrame(tick);
  }), { ms, repeatEvents });
}
function continuous(result, label) {
  assert.ok(result.frames > 5, `${label}: insufficient paint samples`);
  assert.equal(result.missing.length, 0, `${label}: Capu disappeared on a paint`);
}
async function idleAway(ui) {
  await ui.evaluate(() => {
    S.cur.running = false;
    S.status = null;
    S.afterglow = 0;
    capuStopWalk();
    capu.director.set('idle');
    clearTimeout(capu.walkTimer);
    capu.frac = 0;
    capuPlace();
    window.__capuSeq = Math.max(window.__capuSeq || 0, S.cur.seq || 0);
  });
}
async function startWander(ui) {
  await ui.evaluate(() => {
    S.cur.running = false;
    S.status = null;
    capuStopWalk();
    capu.director.set('idle');
    capu.frac = 1;
    capuPlace();
    const rand = Math.random;
    Math.random = () => 0;
    try { capuWander(); } finally { Math.random = rand; }
    clearTimeout(capu.walkTimer);
  });
  assert.equal(await ui.evaluate(() => capu.moveKind), 'wander', 'idle Capu should still wander with OS reduced motion and full setting');
}
async function homeResult(ui, label, repeatEvents = false) {
  const result = await sample(ui, 500, repeatEvents);
  continuous(result, label);
  assert.ok(result.firstHome !== null && result.firstHome <= 500, `${label}: return home exceeded 500 ms`);
  assert.ok(Math.abs(result.last.x - result.last.target) <= 1, `${label}: Capu did not finish at the composer home`);
  return result;
}
async function anchor(ui) {
  const result = await ui.evaluate(() => {
    const a = capu.el.querySelector('svg').getBoundingClientRect();
    const b = capu.el.parentElement.getBoundingClientRect();
    return { foot: a.bottom - b.top, x: parseFloat(capu.el.style.left), range: capuRange(), dpr: devicePixelRatio,
      pixel: CAPU_PX * devicePixelRatio };
  });
  assert.ok(Math.abs(result.foot - 3) < 1.1, 'Capu feet left the top of the composer');
  assert.ok(result.x >= result.range[0] - 1 && result.x <= result.range[1] + 1, 'Capu left the composer after a resize');
  assert.ok(Math.abs(result.pixel - Math.round(result.pixel)) < 1e-5, 'sprite pixels are fractional device pixels');
  return result;
}

async function run(dpr) {
  const scratch = fs.mkdtempSync(path.join(OUT, 'run-'));
  const fixture = path.join(scratch, 'fixture.js');
  fs.writeFileSync(fixture, fixtureSource);
  const env = { ...process.env, CAPU_TEST_PROFILE: path.join(scratch, 'profile'), CAPU_TEST_DPR: String(dpr) };
  delete env.DEIZA_TEST_TOKEN;
  delete env.ELECTRON_RUN_AS_NODE;
  let app, ui, cdp;
  const report = { requestedDpr: dpr, effects: {}, home: {} };
  const errors = [];
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [fixture], env });
    ui = await app.firstWindow();
    ui.on('pageerror', err => errors.push(err.message));
    await ui.waitForFunction(() => typeof capu !== 'undefined' && capu.el && capu.el.isConnected);
    cdp = await app.context().newCDPSession(ui);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1260, height: 820, deviceScaleFactor: dpr, mobile: false });
    await ui.emulateMedia({ reducedMotion: 'reduce' });
    await ui.reload();
    await ui.waitForFunction(() => typeof capu !== 'undefined' && capu.el && capu.el.isConnected);
    assert.equal(await ui.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.equal(await ui.evaluate(() => capuMotion()), 'full', 'default app setting must include all Capu effects');
    assert.equal(await ui.evaluate(() => capu.player.reduced), false, 'OS reduced motion must not silently disable explicit full mode');
    assert.equal(await ui.evaluate(() => document.body.classList.contains('win')), true);
    report.anchor = await anchor(ui);
    assert.ok(Math.abs(report.anchor.dpr - dpr) < .01, 'Electron did not use requested display scale');

    for (const [scene, action] of [
      ['liquid', { model: 'deiza-omniscient' }], ['solid', { model: 'deiza-solid-5' }], ['saiyan', { effort: 'max' }],
    ]) {
      await ui.evaluate(patch => chooseModel(patch), action);
      assert.equal(await ui.evaluate(() => capu.player.scene), scene, `full ${scene} reaction did not start`);
      const result = await sample(ui, scene === 'saiyan' ? 1400 : 700);
      continuous(result, `full ${scene}`);
      assert.ok(result.distinct > 1, `full ${scene} effect is static`);
      if (scene === 'saiyan') {
        const fx = await ui.evaluate(() => {
          const svg = capu.el.querySelector('svg');
          const view = svg.viewBox.baseVal;
          return { overflow: getComputedStyle(svg).overflow,
            outside: [...svg.querySelectorAll('rect')].some(r => Number(r.getAttribute('y')) < 0 || Number(r.getAttribute('x')) < 0 || Number(r.getAttribute('x')) + Number(r.getAttribute('width')) > view.width) };
        });
        assert.equal(fx.overflow, 'visible', 'Saiyan aura must escape the sprite viewport');
        assert.equal(fx.outside, true, 'Saiyan aura pixels are missing');
        report.fx = fx;
        await ui.screenshot({ path: path.join(OUT, `dpr-${dpr}-saiyan.png`) });
      }
      await ui.waitForFunction(() => !capu.director.reacting, null, { timeout: 5000 });
      report.effects[`full-${scene}`] = result;
    }

    // Exercise the user setting itself, preserving the existing stage/player.
    await ui.evaluate(() => { window.__capuStage = capu.el; openSettings('code'); });
    await ui.locator('select[aria-label="Animaciones de Capu"]').selectOption('system');
    await ui.evaluate(() => closeSettings());
    assert.equal(await ui.evaluate(() => capu.player.reduced), true);
    assert.equal(await ui.evaluate(() => window.__capuStage === capu.el), true, 'changing motion remounted Capu');
    for (const [scene, action] of [
      ['liquid', { model: 'deiza-omniscient' }], ['solid', { model: 'deiza-solid-5' }], ['saiyan', { effort: 'medium' }],
    ]) {
      if (scene === 'saiyan') {
        await ui.evaluate(patch => chooseModel(patch), action);
        await ui.waitForFunction(() => !capu.director.reacting, null, { timeout: 5000 });
        await ui.evaluate(() => chooseModel({ effort: 'max' }));
      } else await ui.evaluate(patch => chooseModel(patch), action);
      const total = await ui.evaluate(name => Capu.sceneDuration(name), scene);
      assert.equal(await ui.evaluate(() => capu.player.scene), scene, `system ${scene} vanished synchronously`);
      const result = await sample(ui, total - 180);
      continuous(result, `system ${scene}`);
      assert.deepEqual(result.scenes, [scene], `system ${scene} ended before its original duration`);
      assert.equal(result.distinct, 1, `system ${scene} should hold a still representative pose`);
      await ui.waitForFunction(() => !capu.director.reacting, null, { timeout: 1500 });
      assert.equal(await ui.evaluate(() => capu.player.scene), 'idle');
      report.effects[`system-${scene}`] = { duration: total, ...result };
    }

    // A system-preference change must update existing players without a new scene or remount.
    await ui.emulateMedia({ reducedMotion: 'no-preference' });
    await ui.waitForFunction(() => !capu.player.reduced);
    await ui.emulateMedia({ reducedMotion: 'reduce' });
    await ui.waitForFunction(() => capu.player.reduced);
    await ui.evaluate(() => capuApplyMotion('full'));
    await idleAway(ui);
    await ui.locator('#composer-wrap textarea').fill('Local Capu test');
    await ui.locator('#composer-wrap textarea').press('Enter');
    report.home.submit = await homeResult(ui, 'submit before slow IPC');
    assert.equal(await ui.evaluate(() => S.cur.running), false, 'home should finish before the deliberately slow send IPC');
    await ui.waitForFunction(() => S.cur.running);

    await startWander(ui);
    const wander = await sample(ui, 120);
    continuous(wander, 'idle wander');
    assert.ok(wander.maxX - wander.minX > 1, 'wander movement was suppressed by global reduced CSS');
    await ui.evaluate(() => capuSet('thinking'));
    report.home.walk = await homeResult(ui, 'working interrupts wander', true);

    // A fast completion must keep its bloom when the trip lands, including a composer redraw.
    await idleAway(ui);
    await ui.evaluate(() => {
      capuSet('thinking');
      onCodeEvent({ id: S.cur.id, seq: ++window.__capuSeq, ev: { t: 'turn_end', stopReason: 'done' } });
    });
    report.home.fastCompletion = await homeResult(ui, 'completion while returning');
    assert.equal(report.home.fastCompletion.last.scene, 'bloom', 'landing erased the completion bloom');
    await ui.waitForFunction(() => capu.director.state === 'idle', null, { timeout: 4000 });

    // Completion queued behind a model effect must play bloom and return to idle (and future walks).
    await idleAway(ui);
    await ui.evaluate(() => { capuReact('liquid'); capuSet('done'); });
    await ui.waitForFunction(() => capu.player.scene === 'bloom', null, { timeout: 1800 });
    continuous(await sample(ui, 250), 'completion after reaction');
    await ui.waitForFunction(() => capu.director.state === 'idle', null, { timeout: 4000 });

    await idleAway(ui);
    await ui.locator('#composer-wrap .mic-btn').click();
    report.home.mic = await homeResult(ui, 'microphone before permission');

    await startWander(ui);
    await sample(ui, 100);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 660));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 620, deviceScaleFactor: dpr, mobile: false });
    continuous(await sample(ui, 200), 'resize during wander');
    assert.equal(await ui.evaluate(() => capu.walking), false, 'resize should safely stop the current wander');
    report.resizeWander = await anchor(ui);
    await idleAway(ui);
    await ui.evaluate(() => capuSet('listening'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1260, 860));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1260, height: 820, deviceScaleFactor: dpr, mobile: false });
    report.home.resize = await homeResult(ui, 'resize while returning');
    report.resizeHome = await anchor(ui);

    await startWander(ui);
    await ui.evaluate(() => capuApplyMotion('reduced'));
    report.home.motionSwitch = await homeResult(ui, 'reduced setting interrupts wander');
    assert.equal(await ui.evaluate(() => capu.player.reduced), true);
    assert.equal(await ui.evaluate(() => capu.moveKind), '');
    await ui.screenshot({ path: path.join(OUT, `dpr-${dpr}-home.png`) });
    assert.deepEqual(errors, [], 'renderer page errors');
    console.log(`PASS Capu Windows renderer, DPR ${dpr}, OS reduced motion, effects, home, resize, settings`);
    return report;
  } catch (err) {
    if (ui) await ui.screenshot({ path: path.join(OUT, `dpr-${dpr}-failure.png`) }).catch(() => {});
    throw err;
  } finally {
    if (app) await app.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
(async () => {
  const reports = [];
  for (const dpr of DPRS) reports.push(await run(dpr));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(reports, null, 2) + '\n');
})().catch(err => { console.error(err); process.exitCode = 1; });
