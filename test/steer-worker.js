// Messages written while a turn runs, and long autonomous runs past the effort's round budget.
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

function harness() {
  const events = [];
  const parentPort = new EventEmitter();
  parentPort.postMessage = (ev) => events.push(structuredClone(ev));
  const proc = new EventEmitter();
  Object.assign(proc, { parentPort, pid: 321, cwd: () => root, platform: 'darwin', env: process.env });
  const context = vm.createContext({ require: req, process: proc, __dirname: path.dirname(filename), console, Buffer, URL, AbortController,
    setTimeout, clearTimeout, responses: [], capturedRequests: [] });
  vm.runInContext(source, context, { filename });
  vm.runInContext(`streamWithRetry = async (auth, params) => {
    if (params.tools?.length === 1 && params.tools[0].function.name === 'task_completion_review') return {
      text: '', toolCalls: [{name:'task_completion_review', arguments:JSON.stringify({status:'completed',rationale:'Hecho según las herramientas.',next_action:''})}], finishReason:'tool_calls', usage:{}
    };
    capturedRequests.push(JSON.parse(JSON.stringify(params.messages)));
    const r = responses.shift();
    return typeof r === 'function' ? r(params) : r;
  };`, context);
  const steer = (id, text) => parentPort.emit('message', { data: { type: 'steer', id, text } });
  const run = (opts = {}) => vm.runInContext('run', context)({ auth: { origin: 'https://example.test' }, desktop: { platform: 'darwin' },
    input: 'Lee package.json', turnId: 't1', model: 'deiza-solid-5', mode: 'build', effort: 'low', ...opts });
  return { events, context, steer, run };
}
const answer = (text) => ({ text, toolCalls: [], usage: {}, finishReason: 'stop' });
const read = (i) => ({ text: '', toolCalls: [{ id: `c${i}`, name: 'read_file', arguments: JSON.stringify({ path: 'package.json', start_line: i, end_line: i }) }], usage: {}, finishReason: 'tool_calls' });
const asked = (messages, text) => messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes(text));

(async () => {
  {
    // Written while the model is only reasoning: the step restarts with the message in context.
    const h = harness();
    h.context.responses = [
      (params) => { h.steer('s1', 'Usa la versión, no el nombre'); if (params.signal.aborted) throw new Error('ABORTED'); return read(1); },
      read(2),
      answer('Hecho.'),
    ];
    await h.run();
    const reqs = h.context.capturedRequests;
    assert.ok(asked(reqs[1], 'Usa la versión, no el nombre'), 'the restarted step must carry the message');
    assert.ok(!reqs[1].some(m => m.role === 'tool'), 'the interrupted step must not have run its tools');
    assert.deepEqual(h.events.find(e => e.t === 'steer_read').ids, ['s1']);
    assert.equal(h.events.at(-1).stopReason, 'done');
  }
  {
    // Written while the final answer streams: the turn answers it too instead of ending.
    const h = harness();
    h.context.responses = [
      (params) => { params.onChunk('Ya está.'); h.steer('s2', 'Añade también la licencia'); return answer('Ya está.'); },
      read(1),
      answer('Licencia añadida.'),
    ];
    await h.run();
    const reqs = h.context.capturedRequests;
    assert.equal(reqs.length, 3);
    assert.ok(asked(reqs[1], 'Añade también la licencia'));
    assert.equal(h.events.at(-1).stopReason, 'done');
  }
  {
    // A message that arrives when no turn runs is reported back as unread.
    const h = harness();
    h.steer('s3', 'hola');
    assert.deepEqual(h.events.find(e => e.t === 'steer_unread').ids, ['s3']);
  }
  {
    // Low effort allows 40 rounds; real progress earns more blocks instead of a "continúa" pause.
    const h = harness();
    h.context.responses = [...Array.from({ length: 55 }, (_, i) => read(i + 1)), answer('Leído entero.')];
    await h.run();
    const end = h.events.at(-1);
    assert.equal(end.t, 'turn_end');
    assert.equal(end.stopReason, 'done');
    assert.ok(h.events.some(e => e.t === 'notice' && /Tarea larga/.test(e.text)));
  }
  {
    // No progress at the checkpoint (the same failing call again and again) still stops.
    const h = harness();
    const same = { text: '', toolCalls: [{ id: 'x', name: 'read_file', arguments: JSON.stringify({ path: 'no-existe.txt' }) }], usage: {}, finishReason: 'tool_calls' };
    h.context.responses = Array.from({ length: 60 }, () => same);
    await h.run();
    assert.ok(['stuck', 'max_turns'].includes(h.events.at(-1).stopReason), h.events.at(-1).stopReason);
  }
  console.log('PASS: steer while reasoning, steer during the final answer, unread steer, long runs past the budget, no-progress stop.');
})().catch((err) => { console.error(err); process.exit(1); });
