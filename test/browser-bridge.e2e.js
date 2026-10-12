'use strict';
// Real app/preload/IPC bridge, backed entirely by a loopback fixture (no account or model calls).
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
let application, server;
(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/workspace')) {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>Work bridge</title><script>
        window.received=[];
        const bridge=window.deizaDesktop;
        bridge.onWorkSteer((chatId,text,options)=>{
          received.push({chatId,text,options});
          bridge.workSteerResult(options.requestId,text==='Failure'?{ok:false,error:'offline'}:{ok:true,queued:true});
        });
        bridge.onWorkStop(chatId=>bridge.workState(chatId,{running:false,model:'solid',effort:'high'}));
        bridge.workState(41,{running:true,model:'solid',effort:'high'});
        bridge.workBrowser({chatId:41,requestId:'open-fixture',action:'open',args:{url:location.origin+'/sample'}});
      </script>`);
    } else if (req.url.startsWith('/sample')) {
      res.setHeader('content-type', 'text/html'); res.end('<title>Sample</title><h1>A private page</h1>');
    } else {
      res.setHeader('content-type', 'application/json'); res.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  application = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..')], env: {
    ...process.env, DEIZA_URL: origin, DEIZA_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'deiza-bridge-')),
    DEIZA_TEST_TOKEN: 'bridge-fixture-token',
  } });
  await application.firstWindow();
  let panel;
  for (let i = 0; i < 100 && !panel; i++) {
    panel = application.context().pages().find(page => page.url().endsWith('/computer/index.html'));
    if (!panel) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(panel, 'browser toolbar opened');
  await panel.locator('#side').waitFor({ state: 'visible' });
  assert.equal(await panel.locator('#side-model').inputValue(), 'solid');
  assert.equal(await panel.locator('#side-effort').inputValue(), 'high');
  console.log('OK workspace state reaches the browser selectors through real IPC');
  await panel.locator('#side-model').selectOption('liquid51');
  await panel.locator('#side-effort').selectOption('max');
  await panel.locator('#side-text').fill('Summarise this page');
  await panel.locator('#side-send').click();
  await panel.waitForFunction(() => document.getElementById('side-text').value === '');
  const workspace = application.context().pages().find(page => page.url().startsWith(origin + '/workspace'));
  const received = await workspace.evaluate(() => window.received);
  assert.equal(received[0].chatId, 41);
  assert.equal(received[0].options.model, 'liquid51');
  assert.equal(received[0].options.effort, 'max');
  assert.match(received[0].options.requestId, /^[a-f0-9]{32}$/);
  console.log('OK sending carries model/effort and a correlated acknowledgement');
  await panel.locator('#side-text').fill('Failure');
  await panel.locator('#side-send').click();
  await panel.waitForFunction(() => document.getElementById('side-feedback').classList.contains('failure'));
  assert.equal(await panel.locator('#side-text').inputValue(), 'Failure');
  console.log('OK failed acknowledgement preserves the panel draft');
  await panel.locator('#agent-stop').click();
  await panel.waitForFunction(() => !document.getElementById('agent').classList.contains('on'));
  console.log('OK stop confirmation reaches the browser without pretending to pause');
  // Browser views are WebContentsView instances; Playwright's page inventory can
  // omit them even though the Electron webContents inventory includes the view.
  const external = await application.evaluate(async ({ webContents }, expected) => {
    const view = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(expected));
    if (!view) throw new Error('Work page did not open');
    return view.executeJavaScript('({ desktop: typeof window.deizaDesktop, browser: typeof window.deizaBrowser })');
  }, origin + '/sample');
  assert.equal(external.desktop, 'undefined');
  assert.equal(external.browser, 'undefined');
  console.log('OK pages opened by Work have no privileged preload');
})().then(async () => { await application?.close(); server?.close(); }).catch(async error => {
  console.error(error); await application?.close(); server?.close(); process.exitCode = 1;
});
