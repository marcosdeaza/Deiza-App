'use strict';
// Retries after a workspace reconnect must share the original action, never submit twice.
const { app, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
app.commandLine.appendSwitch('use-mock-keychain');
app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'deiza-reconnect-')));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const host = require('../src/main/computer-host');
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<title>Reconnect</title><button onclick="window.submits=(window.submits||0)+1">Submit</button>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  host.init({ getOwner: () => null });
  const first = await host.work({ chatId: 17, requestId: 'open_1', action: 'open', args: { url } });
  if (first.error) throw Error(first.error);
  const click = { chatId: 17, requestId: 'click_1', action: 'click_text', args: { text: 'Submit' } };
  const [a, b] = await Promise.all([host.work(click), host.work(click)]);
  if (a.error || b.error) throw Error(a.error || b.error);
  await host.work(click); // retry after completion, as a replayed pending event
  const page = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(url));
  if (await page.executeJavaScript('window.submits') !== 1) throw Error('The action ran more than once.');
  console.log('OK concurrent and completed replays click only once');
  const collision = await host.work({ ...click, args: { text: 'Other' } });
  if (!collision.error) throw Error('A reused ID accepted a different action.');
  console.log('OK reused ID rejects a different action');
  const secondChat = await host.work({ chatId: 18, requestId: 'open_1', action: 'open', args: { url } });
  if (secondChat.error) throw Error(secondChat.error);
  await host.work({ ...click, chatId: 18 });
  const pages = webContents.getAllWebContents().filter(wc => wc.getURL().startsWith(url));
  if (pages.length !== 2 || (await Promise.all(pages.map(wc => wc.executeJavaScript('window.submits')))).some(n => n !== 1)) throw Error('Request IDs were not isolated per chat.');
  console.log('OK request IDs are isolated per chat');
  host.shutdown(); server.close(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
