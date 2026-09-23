/**
 * End-to-end run of the real app with Playwright (Electron driver).
 *   node test/e2e.js [welcome|chat|code]     screenshots go to test/shots/
 * Uses a throwaway profile; `code` needs DEIZA_TEST_TOKEN (a session token of a paid test account).
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const scenario = process.argv[2] || 'welcome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'deiza-e2e-'));
  const env = { ...process.env, DEIZA_USER_DATA: profile };
  if (scenario === 'welcome') delete env.DEIZA_TEST_TOKEN;
  const exec = process.env.E2E_EXEC;
  const app = await electron.launch(exec ? { executablePath: exec, args: [], env } : { args: [ROOT], env, executablePath: require('electron') });
  app.process().stdout.on('data', d => process.stdout.write(`[main] ${d}`));
  app.process().stderr.on('data', d => process.stderr.write(`[main!] ${d}`));
  await app.firstWindow();
  let ui = null;
  for (let i = 0; i < 40 && !ui; i++) {
    ui = app.windows().find(p => p.url().startsWith('file:') && p.url().includes('/app/index.html'));
    if (!ui) await sleep(250);
  }
  ui.on('console', m => { if (m.type() === 'error') console.log('[ui error]', m.text()); });
  ui.on('pageerror', e => console.log('[ui pageerror]', e.message));
  await ui.waitForLoadState('domcontentloaded');
  await sleep(2500);
  const shot = async (name) => { await ui.screenshot({ path: path.join(SHOTS, `${name}.png`) }); console.log('shot', name); };

  if (scenario === 'welcome') {
    await shot('welcome');
    await ui.fill('#welcome input[type=email]', 'no-es-un-email');
    await ui.click('#welcome button[type=submit]');
    await sleep(300);
    await shot('welcome-invalid');
  }

  if (scenario === 'chat' || scenario === 'code') {
    // the chat view is a WebContentsView: find its page
    await sleep(4000);
    const pages = app.context().pages();
    console.log('pages:', pages.map(p => p.url()));
    const chat = pages.find(p => p.url().startsWith('https://deiza.org'));
    if (chat) { await chat.screenshot({ path: path.join(SHOTS, 'chat-view.png') }); console.log('chat url', chat.url()); }
    await shot('titlebar-chat');
  }

  if (scenario === 'code') {
    await ui.click('#seg-code');
    await sleep(800);
    await shot('code-empty');
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'deiza-proyecto-'));
    fs.writeFileSync(path.join(folder, 'README.md'), '# Proyecto de prueba\n');
    const created = await ui.evaluate((f) => window.deiza.code.create({ folder: f, mode: 'build' }), folder);
    console.log('session', created.id, folder);
    await ui.evaluate(() => new Promise(r => setTimeout(r, 300)));
    await ui.evaluate((id) => document.querySelector(`.sb-item`) && document.querySelector('.sb-item').click(), created.id);
    await sleep(800);
    const prompt = process.env.E2E_PROMPT || 'Crea una página web estática de una sola pantalla para una cafetería llamada "Rosa y Tinta": index.html y styles.css, estética editorial cálida, sin frameworks. No ejecutes servidores.';
    await ui.fill('#composer-wrap textarea', prompt);
    await ui.keyboard.press('Enter');
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 6 * 60 * 1000) {
      await sleep(4000);
      const running = await ui.evaluate(() => Boolean(document.querySelector('#statusline .inner')));
      if (n++ === 2) await shot('code-running');
      if (!running && n > 2) break;
    }
    console.log('turn finished in', Math.round((Date.now() - t0) / 1000), 's');
    await shot('code-done');
    const html = path.join(folder, 'index.html');
    if (fs.existsSync(html)) {
      await ui.evaluate(() => window.__openForTest && window.__openForTest('index.html'));
      await sleep(2500);
      await shot('code-preview');
    }
    console.log('files:', fs.readdirSync(folder));
  }
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
