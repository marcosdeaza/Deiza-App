const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const { EventEmitter } = require('events');
const { createRequire } = require('module');
const path = require('path');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/engine/worker.js');
const source = fs.readFileSync(filename, 'utf8');
const req = createRequire(filename);
const dataUrl = 'data:image/png;base64,aW1hZ2U=';

function harness({ reply, approve, timeout } = {}) {
  const events = [];
  const requests = [];
  const parentPort = new EventEmitter();
  parentPort.postMessage = (ev) => {
    events.push(structuredClone(ev));
    if (ev.t === 'computer_request' && reply) setImmediate(() => {
      const result = reply(ev, parentPort);
      if (result) parentPort.emit('message', { data: { t: 'computer_result', requestId: ev.requestId, result } });
    });
    if (ev.t === 'approval' && approve) setImmediate(() => parentPort.emit('message', { data: { type: 'approval', id: ev.id, approved: approve(ev), always: false } }));
  };
  const proc = new EventEmitter();
  Object.assign(proc, { parentPort, pid: 123, cwd: () => root, platform: 'darwin', env: process.env });
  const context = vm.createContext({ require: req, process: proc, __dirname: path.dirname(filename), console, Buffer, URL, AbortController,
    setTimeout: (f, ms) => setTimeout(f, timeout && ms === 60000 ? 5 : ms), clearTimeout,
    responses: [], capturedRequests: requests,
  });
  vm.runInContext(source, context, { filename });
  vm.runInContext('streamWithRetry = async (auth, params) => { capturedRequests.push(params); return responses.shift(); };', context);
  const api = vm.runInContext('({run, requestComputer, computerRequests, ALL_TOOL_SPECS})', context);
  return { events, requests, parentPort, context, api };
}

const call = (id, name, args = {}) => ({ id, name, arguments: JSON.stringify(args) });
const response = (toolCalls = [], text = '') => ({ text, toolCalls, usage: {}, finishReason: 'stop' });
async function run(h, calls, opts = {}) {
  h.context.responses = [response(calls), response([], 'Hecho.')];
  await h.api.run({ auth: { origin: 'https://example.test' }, desktop: { platform: 'darwin' }, input: 'Prueba', turnId: 'test', model: 'deiza-solid-5', mode: 'build', ...opts });
}

(async () => {
  const h = harness();
  const abort = new AbortController();
  const pending = h.api.requestComputer('browser_tabs', {}, abort.signal);
  const ev = h.events.find(e => e.t === 'computer_request');
  h.parentPort.emit('message', { data: { t: 'computer_result', requestId: 'wrong', result: { tabs: [] } } });
  assert.equal(h.api.computerRequests.size, 1);
  h.parentPort.emit('message', { data: { t: 'computer_result', requestId: ev.requestId, result: { tabs: [{ tab_id: 't1' }] } } });
  assert.equal((await pending).tabs[0].tab_id, 't1');
  assert.equal(h.api.computerRequests.size, 0);

  const pa = h.api.requestComputer('browser_snapshot', {}, abort.signal);
  abort.abort();
  assert.equal((await pa).aborted, true);
  assert.equal(h.api.computerRequests.size, 0);
  assert(h.events.some(e => e.t === 'computer_cancel'));

  const ht = harness({ timeout: true });
  assert.equal((await ht.api.requestComputer('browser_tabs', {}, new AbortController().signal)).timed_out, true);
  assert.equal(ht.api.computerRequests.size, 0);

  const images = harness({ reply: () => ({ width: 1280, height: 800, nested: { data_url: dataUrl } }) });
  await run(images, [call('shot', 'browser_screenshot')], { attachments: [{ name: 'project.zip', path: '/tmp/project.zip', kind: 'archive', extracted_path: '/tmp/project', size: 20 }] });
  const msgs = images.events.filter(e => e.t === 'history').at(-1).messages;
  assert(msgs.some(m => m.role === 'tool' && m.tool_call_id === 'shot' && !m.content.includes('base64') && !m.content.includes('data_url')));
  assert(msgs.some(m => m.role === 'user' && Array.isArray(m.content) && m.content.some(p => p.type === 'image_url' && p.image_url.url === dataUrl)));
  assert(msgs.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('/tmp/project')));
  assert(images.requests[0].tools.some(t => t.function.name === 'desktop_click'));
  assert(images.requests[0].messages[0].content.includes('AUTONOMOUS BROWSER & COMPUTER USE'));
  assert(images.requests[0].messages[0].content.includes('ZERO REFUSALS'));
  assert(!JSON.stringify(images.events.filter(e => e.t.startsWith('tool_'))).includes('base64'));

  const plan = harness({ reply: () => ({ text: 'Page', elements: [] }) });
  await run(plan, [call('open', 'browser_open', { url: 'https://example.test/?token=hidden' }), call('click', 'browser_click', { element_id: 'e1' }), call('save', 'browser_screenshot', { path: 'capture.png' })], { mode: 'plan' });
  assert.deepEqual(plan.events.filter(e => e.t === 'computer_request').map(e => e.name), ['browser_open']);
  assert.equal(plan.events.filter(e => e.t === 'tool_end' && e.status === 'skipped').length, 2);
  assert(!JSON.stringify(plan.events.filter(e => e.t.startsWith('tool_'))).includes('token=hidden'));

  const gas = harness({ reply: () => ({ text: 'Page', elements: [] }) });
  await run(gas, [call('shot', 'browser_screenshot'), call('point', 'browser_click', { x: 10, y: 10 }), call('dom', 'browser_click', { element_id: 'e1' })], { model: 'deiza-gas-4.5' });
  assert.deepEqual(gas.events.filter(e => e.t === 'computer_request').map(e => e.name), ['browser_click']);
  assert.equal(gas.events.filter(e => e.t === 'tool_end' && e.status === 'blocked').length, 2);

  const copilot = harness({ reply: () => ({ text: 'Page' }), approve: (ev) => ev.name === 'browser_type' });
  await run(copilot, [call('no', 'browser_click', { element_id: 'e1' }), call('yes', 'browser_type', { text: 'sensitive body', element_id: 'e2' })], { mode: 'copilot' });
  assert.deepEqual(copilot.events.filter(e => e.t === 'computer_request').map(e => e.name), ['browser_type']);
  assert(!JSON.stringify(copilot.events.filter(e => ['tool_start', 'tool_end', 'approval'].includes(e.t))).includes('sensitive body'));

  const stopped = harness({ reply: (ev, port) => { port.emit('message', { data: { type: 'abort' } }); } });
  await run(stopped, [call('one', 'browser_snapshot'), call('two', 'browser_snapshot')]);
  assert.equal(stopped.events.filter(e => e.t === 'turn_end').at(-1).stopReason, 'aborted');
  const stopHistory = stopped.events.filter(e => e.t === 'history').at(-1).messages;
  assert(stopHistory.some(m => m.role === 'tool' && m.tool_call_id === 'two'));
  assert.equal(stopped.api.computerRequests.size, 0);
  console.log('PASS: broker result/abort/timeout, image parts, attachments, Plan, Gas, Copilot privacy, interrupted history.');
})().catch(err => { console.error(err); process.exitCode = 1; });
