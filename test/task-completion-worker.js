const fs = require('fs');
const os = require('os');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');
const { EventEmitter } = require('events');
const { createRequire } = require('module');

// Exercise the production worker and completion helper. Only model transport and tool effects
// are replaced: every tool name/required-argument definition and the loop itself remain real.
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/engine/worker.js');
const req = createRequire(filename);
const source = fs.readFileSync(filename, 'utf8');
const realTools = req('./vendor/tools');
const fixtures = [];
const call = (id, name, args = {}) => ({ id, name, arguments: JSON.stringify(args) });
const answer = (text = 'Hecho.', toolCalls = [], finishReason = 'stop') => ({ text, toolCalls, finishReason, usage: {} });
const report = (status = 'completed', next_action = '', rationale = 'The observed results satisfy the current request.') => answer('', [call('review', 'task_completion_review', { status, rationale, next_action })], 'tool_calls');
const clone = value => JSON.parse(JSON.stringify(value));

function harness({ normal = [], reviews = [], approve = false, handlers = {}, computer, wire = [] } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'deiza-completion-worker-'));
  fixtures.push(folder);
  fs.writeFileSync(path.join(folder, 'icon.txt'), 'red');
  const events = [], requests = [], executions = [], httpRequests = [];
  const parentPort = new EventEmitter();
  parentPort.postMessage = event => {
    events.push(clone(event));
    if (event.t === 'approval') setImmediate(() => parentPort.emit('message', { data: { type: 'approval', id: event.id, approved: approve } }));
    if (event.t === 'computer_request') setImmediate(() => parentPort.emit('message', { data: { t: 'computer_result', requestId: event.requestId, result: computer ? computer(event) : { error: 'Manual login is required.', blocked: true } } }));
  };
  const proc = new EventEmitter();
  Object.assign(proc, { parentPort, pid: 123, cwd: () => folder, platform: process.platform, env: {} });
  const tools = Object.fromEntries(Object.keys(realTools.Tools).map(name => [name, async args => {
    executions.push({ name, args: clone(args) });
    if (handlers[name]) return handlers[name](args, executions);
    if (name === 'update_plan') return { steps: args.steps };
    if (name === 'read_file') return { path: args.path, content: 'red' };
    if (name === 'write_file') return { path: args.path, bytes: args.content.length };
    return { ok: true };
  }]));
  // A fake HTTP surface also exercises the real SSE parser, without any network connection.
  const http = { request(url, options, callback) {
    const request = new EventEmitter();
    const entry = { url: String(url), options, body: '', destroyed: false };
    httpRequests.push(entry);
    request.write = value => { entry.body += value; };
    request.destroy = () => { entry.destroyed = true; };
    request.end = () => queueMicrotask(() => {
      if (entry.destroyed) return;
      const response = new EventEmitter();
      Object.assign(response, { statusCode: 200, headers: {}, complete: true, resume() {} });
      callback(response);
      for (const chunk of wire.shift() || []) response.emit('data', Buffer.from(chunk));
      response.emit('end');
    });
    return request;
  } };
  const fixtureRequire = name => name === './vendor/tools' ? { ...realTools, Tools: tools, setSearchAuth() {} } : ['http', 'https'].includes(name) ? http : req(name);
  const context = vm.createContext({ require: fixtureRequire, process: proc, __dirname: path.dirname(filename), console, Buffer, URL, AbortController, setTimeout, clearTimeout });
  vm.runInContext(source, context, { filename });
  const abort = () => parentPort.emit('message', { data: { type: 'abort' } });
  const stream = async (auth, params) => {
    const review = params.tools?.length === 1 && params.tools[0].function.name === 'task_completion_review';
    requests.push({ review, messages: clone(params.messages), maxTokens: params.maxTokens, effort: params.effort });
    if (params.signal.aborted) throw new Error('ABORTED');
    const next = (review ? reviews : normal).shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next({ abort, params, events, requests });
    if (next) return next;
    if (review) return report();
    throw new Error('The fixture ran out of normal responses.');
  };
  const command = async args => {
    executions.push({ name: 'run_command', args: clone(args) });
    return handlers.run_command ? handlers.run_command(args, executions) : { exit_code: 0, stdout: 'ok' };
  };
  context.fixtureStream = stream;
  context.fixtureCommand = command;
  vm.runInContext('streamWithRetry = fixtureStream; runCommandLive = fixtureCommand;', context);
  const api = vm.runInContext('({run, streamCompletion})', context);
  return { folder, events, requests, executions, httpRequests, api,
    async run(input = 'Cambia el icono a azul.', options = {}) {
      await api.run({ auth: { origin: 'http://fixture.test', token: 'fixture' }, input, desktop: { platform: process.platform }, mode: 'build', effort: 'low', turnId: 'fixture', ...options });
      return events.filter(event => event.t === 'turn_end').at(-1);
    },
  };
}

const reviewRequests = h => h.requests.filter(request => request.review);
const normalRequests = h => h.requests.filter(request => !request.review);
const evidence = request => JSON.parse(request.messages[1].content[0].text);
const history = h => h.events.filter(event => event.t === 'history').at(-1).messages;
function pairedHistory(h) {
  const messages = history(h);
  for (let i = 0; i < messages.length; i++) for (const tool of messages[i].tool_calls || []) {
    assert(messages.slice(i + 1).some(message => message.role === 'tool' && message.tool_call_id === tool.id), `Missing result for ${tool.id}`);
  }
}
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Hecho after only read continues the same current request', async () => {
  const h = harness({ normal: [answer('', [call('read', 'read_file', { path: 'icon.txt' })]), answer(), answer('', [call('write', 'write_file', { path: 'icon.txt', content: 'blue' })]), answer('Icono azul.')], reviews: [report('continue', 'Change icon.txt to blue.', 'Reading the current icon has not changed it.'), report()] });
  assert.equal((await h.run()).stopReason, 'done');
  assert.deepEqual(h.executions.map(item => item.name), ['read_file', 'write_file']);
  assert.equal(reviewRequests(h).length, 2);
  assert.deepEqual(evidence(reviewRequests(h)[0]).current_turn_tool_results.map(item => item.name), ['read_file']);
  for (const request of reviewRequests(h)) assert.equal(evidence(request).current_user_request, 'Cambia el icono a azul.');
  assert(normalRequests(h)[2].messages.at(-1).content.includes('CONTINUACIÓN AUTOMÁTICA'));
  assert(reviewRequests(h).every(request => request.maxTokens === 2048 && request.effort === 'low'));
  pairedHistory(h);
});

test('an open requested plan overrides a premature completed report', async () => {
  const steps = [{ title: 'Cambiar el icono', status: 'pending' }];
  const h = harness({ normal: [answer('', [call('p1', 'update_plan', { steps })]), answer(), answer('', [call('p2', 'update_plan', { steps: [{ ...steps[0], status: 'completed' }] })]), answer()], reviews: [report(), report()] });
  assert.equal((await h.run('Implementa el cambio del icono.')).stopReason, 'done');
  assert.equal(reviewRequests(h).length, 2);
  assert(normalRequests(h)[2].messages.at(-1).content.includes('Cambiar el icono'));
});

test('a failed build remains evidence until the authorized fix passes', async () => {
  let builds = 0;
  const h = harness({ normal: [answer('', [call('fail', 'run_command', { command: 'npm run build' })]), answer(), answer('', [call('fix', 'write_file', { path: 'icon.txt', content: 'blue' }), call('pass', 'run_command', { command: 'npm run build' })]), answer()], reviews: [report('continue', 'Fix the build error and run npm run build again.', 'The latest verification failed.'), report()], handlers: { run_command: () => ({ exit_code: ++builds === 1 ? 1 : 0, stderr: builds === 1 ? 'fixture build error' : '' }) } });
  assert.equal((await h.run('Arregla el icono y comprueba el build.')).stopReason, 'done');
  const first = evidence(reviewRequests(h)[0]);
  assert.equal(first.failed_tools, 1);
  assert.equal(first.current_turn_tool_results[0].result.exit_code, 1);
  assert.equal(builds, 2);
});

test('a Spanish future action with punctuation cannot finish without acting', async () => {
  const h = harness({ normal: [answer('Ahora corregiré el icono.'), answer('', [call('write', 'write_file', { path: 'icon.txt', content: 'blue' })]), answer('Icono corregido.')], reviews: [report(), report()] });
  assert.equal((await h.run('Corrige el icono.')).stopReason, 'done');
  assert.equal(h.executions.length, 1);
  assert.equal(reviewRequests(h).length, 2);
});

test('an English future action cannot finish without acting', async () => {
  const h = harness({ normal: [answer("I'll fix the icon now."), answer('', [call('write', 'write_file', { path: 'icon.txt', content: 'blue' })]), answer('The icon is fixed.')], reviews: [report(), report()] });
  assert.equal((await h.run('Fix the icon.')).stopReason, 'done');
  assert.equal(h.executions.length, 1);
});

test('manual login is a blocker without another action or review loop', async () => {
  const h = harness({ normal: [answer('', [call('login', 'browser_snapshot')]), answer('Inicia sesión manualmente para poder leer el correo.')], reviews: [report('blocked', '', 'The user must sign in to the mail account.')] });
  assert.equal((await h.run('Lee mis correos.')).stopReason, 'blocked');
  assert.equal(h.events.filter(event => event.t === 'computer_request').length, 1);
  assert.equal(reviewRequests(h).length, 1);
  assert.equal(normalRequests(h).length, 2);
});

test('a rejected mutation is failed evidence and is not retried', async () => {
  const h = harness({ normal: [answer('', [call('write', 'write_file', { path: 'icon.txt', content: 'blue' })]), answer('Has rechazado el cambio; necesito tu decisión.')], reviews: [report('blocked', '', 'The user rejected the file change.')] });
  assert.equal((await h.run('Cambia el icono.', { mode: 'copilot' })).stopReason, 'blocked');
  assert.equal(h.executions.length, 0);
  assert.equal(evidence(reviewRequests(h)[0]).failed_tools, 1);
  assert.equal(h.events.filter(event => event.t === 'approval').length, 1);
});

test('Plan can finish with pending implementation steps in its delivered plan', async () => {
  const h = harness({ normal: [answer('', [call('plan', 'update_plan', { steps: [{ title: 'Cambiar el icono', status: 'pending' }] })]), answer('Plan: cambiar el icono y comprobar la compilación.')], reviews: [report()] });
  assert.equal((await h.run('Planifica el cambio del icono.', { mode: 'plan' })).stopReason, 'done');
  assert.equal(normalRequests(h).length, 2);
  assert.equal(reviewRequests(h).length, 1);
  assert.equal(evidence(reviewRequests(h)[0]).plan_is_the_deliverable, true);
  assert.deepEqual(h.executions.map(item => item.name), ['update_plan']);
});

test('Plan intercepts a mutation but can still finish its textual deliverable', async () => {
  const h = harness({ normal: [answer('', [call('write', 'write_file', { path: 'icon.txt', content: 'blue' })]), answer('Plan entregado: cambiar el icono y comprobar la compilación.')], reviews: [report()] });
  assert.equal((await h.run('Planifica el cambio del icono.', { mode: 'plan' })).stopReason, 'done');
  assert.equal(h.executions.length, 0);
  assert.equal(evidence(reviewRequests(h)[0]).failed_tools, 1);
  assert.equal(evidence(reviewRequests(h)[0]).plan_is_the_deliverable, true);
  assert.equal(normalRequests(h).length, 2);
});

for (const input of ['How do I deploy this?', '¿Cómo funciona el despliegue?', '¿Qué es refactorizar?', 'Explica cómo cambiar el icono.', 'What is a build?']) test(`initial Q&A uses one completion: ${input}`, async () => {
  const h = harness({ normal: [answer('Una explicación completa de la pregunta.')] });
  assert.equal((await h.run(input)).stopReason, 'done');
  assert.equal(h.requests.length, 1);
});

for (const input of ['Cambia el icono.', 'Añade un icono.', 'Sigue.', 'Change the icon.', 'Add an icon.', 'Continue.']) test(`short action receives a completion review: ${input}`, async () => {
  const h = harness({ normal: [answer('Resultado completado.')], reviews: [report()] });
  assert.equal((await h.run(input)).stopReason, 'done');
  assert.equal(reviewRequests(h).length, 1);
});

test('short follow-up interprets prior authorization without reopening old work', async () => {
  const h = harness({ normal: [answer('Ahora el icono es azul.')], reviews: [report()] });
  assert.equal((await h.run('azul', { messages: [{ role: 'user', content: 'Cambia el icono.' }, { role: 'assistant', content: '¿Qué color prefieres?' }] })).stopReason, 'done');
  assert.equal(reviewRequests(h).length, 1);
  const data = evidence(reviewRequests(h)[0]);
  assert.equal(data.current_user_request, 'azul');
  assert(data.context_for_interpreting_followup_only.some(message => message.text === 'Cambia el icono.'));
  assert.equal(data.current_turn_tool_results.length, 0);
});

test('a new Q&A after an old action does not incur a completion review', async () => {
  const h = harness({ normal: [answer('4.')] });
  assert.equal((await h.run('¿Cuánto es 2 + 2?', { messages: [{ role: 'user', content: 'Cambia el icono.' }, { role: 'assistant', content: 'Icono cambiado.' }] })).stopReason, 'done');
  assert.equal(h.requests.length, 1);
});

test('abort as the answer arrives causes no review or tool execution', async () => {
  const h = harness({ normal: [({ abort }) => { abort(); return answer(); }] });
  assert.equal((await h.run()).stopReason, 'aborted');
  assert.equal(reviewRequests(h).length, 0);
  assert.equal(h.executions.length, 0);
});

test('abort as tool calls arrive pairs their history without executing them', async () => {
  const h = harness({ normal: [({ abort }) => { abort(); return answer('', [call('one', 'write_file', { path: 'icon.txt', content: 'blue' }), call('two', 'run_command', { command: 'npm run build' })]); }] });
  assert.equal((await h.run()).stopReason, 'aborted');
  assert.equal(h.requests.length, 1);
  assert.equal(h.executions.length, 0);
  pairedHistory(h);
});

test('second instance continuation after interruption seamlessly resumes complex workflow', async () => {
  const h = harness({
    normal: [
      ({ abort }) => {
        abort();
        return answer('', [
          call('call_1', 'read_file', { path: 'server.js' }),
          call('call_2', 'write_file', { path: 'server.js', content: 'const ok = true;' })
        ]);
      },
      answer('', [call('call_3', 'write_file', { path: 'server.js', content: 'const ok = true;' })]),
      answer('Servidor actualizado correctamente.')
    ],
    reviews: [
      report()
    ]
  });

  const res1 = await h.run('Actualiza el archivo server.js');
  assert.equal(res1.stopReason, 'aborted');
  const hist1 = history(h);
  assert.equal(hist1[hist1.length - 1].role, 'assistant');
  assert(/interrumpid/i.test(hist1[hist1.length - 1].content));

  const res2 = await h.run('continúa', { messages: hist1 });
  assert.equal(res2.stopReason, 'done');
  const hist2 = history(h);
  assert.equal(hist2[hist2.length - 1].role, 'assistant');

  for (let i = 0; i < hist2.length - 1; i++) {
    if (hist2[i].role === 'tool') {
      assert.notEqual(hist2[i + 1].role, 'user', `Violation at index ${i}: tool followed directly by user`);
    }
    if (hist2[i].role === 'user') {
      assert.notEqual(hist2[i + 1].role, 'user', `Violation at index ${i}: consecutive user messages`);
    }
  }
});

test('abort as a completion review arrives cannot report done', async () => {
  const h = harness({ normal: [answer('Resultado completo.')], reviews: [({ abort }) => { abort(); return report(); }] });
  assert.equal((await h.run('Corrige el icono.')).stopReason, 'aborted');
  assert.equal(h.requests.length, 2);
  assert.equal(h.executions.length, 0);
});

test('invalid completion reviews stop after four attempts without acting', async () => {
  const h = harness({ normal: Array.from({ length: 4 }, () => answer()), reviews: Array.from({ length: 4 }, () => answer('not JSON')) });
  assert.equal((await h.run()).stopReason, 'incomplete');
  assert.equal(normalRequests(h).length, 4);
  assert.equal(reviewRequests(h).length, 4);
  assert.equal(h.executions.length, 0);
});

for (const finishReason of ['length', 'incomplete']) test(`a ${finishReason} review report never proves completion`, async () => {
  const h = harness({ normal: Array.from({ length: 4 }, () => answer()), reviews: Array.from({ length: 4 }, () => ({ ...report(), finishReason })) });
  assert.equal((await h.run()).stopReason, 'incomplete');
  assert.equal(reviewRequests(h).length, 4);
});

test('repeated truncated answers stop within the effort continuation budget', async () => {
  const h = harness({ normal: Array.from({ length: 4 }, () => answer('Parte sin terminar.', [], 'length')) });
  assert.equal((await h.run()).stopReason, 'incomplete');
  assert.equal(normalRequests(h).length, 4);
  assert.equal(reviewRequests(h).length, 0);
});

test('complete JSON calls in an EOF-only response never execute and have paired errors', async () => {
  const h = harness({ normal: [answer('', [call('unsafe', 'write_file', { path: 'icon.txt', content: 'blue' }), call('cmd', 'run_command', { command: 'npm run build' })], 'incomplete'), answer('Falta una confirmación externa.')], reviews: [report('blocked', '', 'The fixture needs external access.')] });
  assert.equal((await h.run()).stopReason, 'blocked');
  assert.equal(h.executions.length, 0);
  const results = history(h).filter(message => message.role === 'tool');
  assert.equal(results.length, 2);
  assert(results.every(message => JSON.parse(message.content).error.includes('NO se ha ejecutado')));
  assert.equal(evidence(reviewRequests(h)[0]).failed_tools, 2);
  pairedHistory(h);
});

test('repeated incomplete streams with tool calls remain bounded and never execute', async () => {
  const h = harness({ normal: Array.from({ length: 4 }, (_, i) => answer('', [call(`unsafe${i}`, 'write_file', { path: 'icon.txt', content: 'blue' })], 'incomplete')) });
  assert.equal((await h.run()).stopReason, 'incomplete');
  assert.equal(normalRequests(h).length, 4);
  assert.equal(reviewRequests(h).length, 0);
  assert.equal(h.executions.length, 0);
  pairedHistory(h);
});

test('initial usage limit stops without review, tools or a handoff write', async () => {
  const h = harness({ normal: [new Error('USAGE_LIMIT')] });
  assert.equal((await h.run()).stopReason, 'error');
  assert.equal(h.requests.length, 1);
  assert.equal(h.executions.length, 0);
  assert(!fs.existsSync(path.join(h.folder, 'DEIZA_HANDOFF.md')));
  assert(h.events.some(event => event.t === 'error' && event.code === 'usage'));
});

test('usage limit after activity preserves a handoff and does not claim completion', async () => {
  const h = harness({ normal: [answer('', [call('read', 'read_file', { path: 'icon.txt' })]), new Error('USAGE_LIMIT')] });
  assert.equal((await h.run()).stopReason, 'error');
  assert.equal(reviewRequests(h).length, 0);
  assert(fs.readFileSync(path.join(h.folder, 'DEIZA_HANDOFF.md'), 'utf8').includes('Cambia el icono a azul.'));
});

test('Plan quota handoff is returned in memory without changing files', async () => {
  const h = harness({ normal: [answer('', [call('read', 'read_file', { path: 'icon.txt' })]), new Error('USAGE_LIMIT')] });
  assert.equal((await h.run('Planifica el cambio.', { mode: 'plan' })).stopReason, 'error');
  assert(!fs.existsSync(path.join(h.folder, 'DEIZA_HANDOFF.md')));
  assert(h.events.some(event => event.t === 'handoff' && event.content));
});

test('the real SSE parser distinguishes EOF and DONE from an explicit terminal', async () => {
  const event = data => `data: ${JSON.stringify(data)}\n\n`;
  const content = event({ choices: [{ delta: { content: 'Listo.' }, finish_reason: null }] });
  const h = harness({ wire: [[content], [content, 'data: [DONE]\n\n'], [content, event({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']] });
  for (const expected of ['incomplete', 'incomplete', 'stop']) {
    const response = await h.api.streamCompletion({ origin: 'http://fixture.test', token: 'fixture' }, { model: 'deiza-solid-5', effort: 'low', messages: [], maxTokens: 100, signal: new AbortController().signal });
    assert.equal(response.finishReason, expected);
    assert.equal(response.text, 'Listo.');
  }
  assert.equal(h.httpRequests.length, 3);
});

test('long computer evidence keeps the review bounded and retains the latest failed verification', async () => {
  const completion = req('./vendor/task-completion').createTaskCompletion({ request: 'Audit and fix the application.' });
  for (let i = 0; i < 40; i++) completion.recordTool('browser_snapshot', { url: `https://fixture.test/${i}` }, {
    elements: Array.from({ length: 30 }, (_, id) => ({ id: String(id), text: 'x'.repeat(2400), role: 'button' })),
    data_url: `data:image/png;base64,${'a'.repeat(20000)}`,
  });
  completion.recordTool('run_command', { command: 'npm run build' }, { exit_code: 1, stderr: 'fixture compilation failed' });
  const messages = completion.reviewMessages('Hecho.');
  assert(messages[1].content[0].text.length <= 40000);
  assert(!messages[1].content[0].text.includes('data:image'));
  const facts = JSON.parse(messages[1].content[0].text);
  assert.equal(facts.current_turn_tool_results.at(-1).name, 'run_command');
  assert.equal(facts.current_turn_tool_results.at(-1).failed, true);
  assert.equal(facts.current_turn_tool_results.at(-1).result.exit_code, 1);
  assert.equal(facts.current_turn_milestones.length, 0);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
  }
  console.log(`${tests.length - failed}/${tests.length} completion-worker regressions passed.`);
  if (failed) process.exitCode = 1;
})().finally(() => {
  for (const folder of fixtures) fs.rmSync(folder, { recursive: true, force: true });
});
