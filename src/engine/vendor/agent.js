/**
 * DEIZA CODE — Agent Engine & LLM Client
 *
 * Streaming client for the native Deiza API and for any OpenAI-compatible endpoint, plus the
 * multi-turn agent loop. Tools are invoked through native function calling (`tools` in the
 * request, `tool_calls` in the stream); servers without tool support fall back to XML blocks.
 *
 * What long autonomous sessions need, and what this loop does:
 *   - live progress while a tool call streams (file name + size growing), not minutes of silence
 *   - a response cut by the output limit is continued automatically, never silently dropped
 *   - a tool call whose arguments were cut is bounced back with instructions to split the file
 *   - "I'll now create the CSS:" without the call gets nudged once to actually do it
 *   - compact tool results on screen (command output tail, line counts, diffs)
 */

const http = require('http');
const https = require('https');
const { StringDecoder } = require('string_decoder');
const { Tools, TOOL_DEFINITIONS, MAX_TOOL_OUTPUT, isCommandRisky, isCommandCatastrophic, previewChange } = require('./tools');
const { Status, C, createLiveLine, createSpinner, formatBytes, formatDuration, createMarkdownStream, printToolCard } = require('./ui');
const { buildSystemPrompt } = require('./prompt');
const { isDeizaHost, contextLimit } = require('./config');
const { getActiveContextTokens } = require('./session');

const MAX_TURNS = 120;             // tool rounds per user request (a long feature is many rounds)
const MAX_CONTINUATIONS = 6;       // automatic "continue" after an output-limit cut, per request
const MAX_FAILED_ROUNDS = 4;       // consecutive rounds where every tool call failed -> stop and tell the user
// Defaults for the largest native window (256K tokens); per-model values come from contextLimit().
const MAX_CONTEXT_CHARS = 680000;
const COMPACT_THRESHOLD_TOKENS = 180000;
const compactThreshold = (cfg) => Math.floor(contextLimit(cfg && !cfg.isCustomEndpoint ? cfg.model : cfg && cfg.model) * 0.7);
const maxContextChars = (cfg) => Math.floor(contextLimit(cfg && cfg.model) * 2.6);
const DEFAULT_MAX_TOKENS = 16384;  // custom endpoints
const DEIZA_MAX_TOKENS = 32768;    // the Deiza engine allows long outputs: whole files in one call

const TOOL_BY_NAME = Object.fromEntries(TOOL_DEFINITIONS.map(t => [t.name, t]));

/** Missing required parameters are reported to the model instead of crashing inside the tool. */
function validateArgs(name, args) {
  const spec = TOOL_BY_NAME[name];
  if (!spec) return null;
  const missing = (spec.parameters.required || []).filter(k => args[k] === undefined || args[k] === null);
  if (missing.length) {
    return `Error: faltan parámetros obligatorios para ${name}: ${missing.join(', ')}. Parámetros: ${Object.keys(spec.parameters.properties || {}).join(', ')}.`;
  }
  return null;
}

const TOOL_SPECS = TOOL_DEFINITIONS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
const MUTATING_TOOLS = new Set(['edit_file', 'write_file', 'append_file', 'run_command', 'delete_path', 'move_path']);

/**
 * Parses XML-style tool calls from LLM output (fallback mode).
 */
function extractToolCalls(text) {
  const regex = /<tool_call\s+name="([^"]+)"\s*>([\s\S]*?)<\/tool_call>/g;
  const calls = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    let body = match[2].trim();
    body = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      const args = body ? JSON.parse(body) : {};
      calls.push({ id: `xml_${calls.length}`, name, args, arguments: body, fullMatch: match[0] });
    } catch {
      calls.push({ id: `xml_${calls.length}`, name, args: null, arguments: body, fullMatch: match[0], parseError: true });
    }
  }
  return calls;
}

/**
 * Resolve the chat completions URL for a base URL.
 *   https://deiza.org                  -> https://deiza.org/api/code/chat/completions
 *   http://localhost:11434             -> http://localhost:11434/v1/chat/completions
 *   https://host/v1                    -> https://host/v1/chat/completions
 *   https://host/v1/chat/completions   -> unchanged
 */
function completionsUrl(apiBase) {
  const base = String(apiBase || '').replace(/\/+$/, '');
  if (isDeizaHost(base)) return `${base}/api/code/chat/completions`;
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function describeApiError(status, body) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    const err = parsed.error;
    detail = typeof err === 'string' ? err : (err?.message || parsed.message || parsed.detail || '');
    if (detail === 'plan_required' || err?.type === 'plan_required') return 'PLAN_REQUIRED';
    if (detail === 'usage_limit' || detail === 'model_sublimit') return 'USAGE_LIMIT_EXCEEDED';
  } catch {
    detail = String(body || '').slice(0, 200);
  }
  return `API Error (${status})${detail ? `: ${detail}` : ''}`;
}

/**
 * Streaming filter that hides <tool_call>...</tool_call> blocks from the live terminal output
 * (XML fallback mode only; native tool calls never travel inside the text).
 */
function createToolCallFilter() {
  const OPEN = '<tool_call';
  const CLOSE = '</tool_call>';
  let pending = '';
  let inside = false;
  return (chunk) => {
    pending += chunk;
    let out = '';
    while (pending.length) {
      if (inside) {
        const end = pending.indexOf(CLOSE);
        if (end === -1) { pending = pending.slice(-CLOSE.length); return out; }
        pending = pending.slice(end + CLOSE.length);
        inside = false;
        continue;
      }
      const start = pending.indexOf(OPEN);
      if (start !== -1) {
        out += pending.slice(0, start);
        pending = pending.slice(start);
        inside = true;
        continue;
      }
      let keep = 0;
      for (let n = Math.min(OPEN.length - 1, pending.length); n > 0; n--) {
        if (OPEN.startsWith(pending.slice(-n))) { keep = n; break; }
      }
      out += pending.slice(0, pending.length - keep);
      pending = pending.slice(pending.length - keep);
      return out;
    }
    return out;
  };
}

/**
 * Universal streaming completion.
 * Resolves to { text, toolCalls: [{id, name, arguments}], finishReason, usage }.
 *   onChunk(text)                      assistant prose as it streams
 *   onToolProgress({index, name, args}) called as tool-call arguments accumulate
 */
async function streamCompletion({ apiBase, apiKey, model, messages, tools, onChunk, onToolProgress, maxTokens = DEFAULT_MAX_TOKENS, temperature = 0.2, signal }) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(completionsUrl(apiBase));
    } catch {
      return reject(new Error(`Endpoint no válido: ${apiBase}`));
    }
    const client = url.protocol === 'https:' ? https : http;
    const native = isDeizaHost(apiBase);

    const body = { model, messages, stream: true, temperature, max_tokens: maxTokens, stream_options: { include_usage: true } };
    if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    const payload = JSON.stringify(body);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Content-Length': Buffer.byteLength(payload),
      'User-Agent': 'deiza-code',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['X-Api-Key'] = apiKey;
    }

    let usage = null;
    let fullText = '';
    let finishReason = null;
    const calls = new Map(); // index -> {id, name, arguments}
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (err) reject(err); else resolve(value);
    };
    const onAbort = () => { try { req.destroy(); } catch {} finish(new Error('ABORTED')); };

    const req = client.request(url, { method: 'POST', headers, timeout: 300000 }, (res) => {
      if (res.statusCode === 401 && native) { res.resume(); return finish(new Error('AUTH_EXPIRED')); }
      if ((res.statusCode === 403 || res.statusCode === 402) && native) {
        let b = '';
        res.on('data', c => { b += c; });
        res.on('end', () => finish(new Error(describeApiError(res.statusCode, b) === 'PLAN_REQUIRED' ? 'PLAN_REQUIRED' : 'AUTH_EXPIRED')));
        return;
      }
      if ((res.statusCode === 401 || res.statusCode === 403) && !native) {
        res.resume();
        return finish(new Error(`El endpoint ${url.origin} rechazó la clave (${res.statusCode}). Configúrala con --key <clave> o DEIZA_ENDPOINT_KEY, o vuelve al motor nativo con /endpoint deiza.`));
      }
      if (res.statusCode === 429) { res.resume(); return finish(new Error('USAGE_LIMIT_EXCEEDED')); }
      if (res.statusCode >= 400) {
        let errBody = '';
        res.on('data', c => { errBody += c; });
        res.on('end', () => {
          const err = new Error(describeApiError(res.statusCode, errBody));
          err.status = res.statusCode;
          err.body = errBody;
          finish(err);
        });
        return;
      }

      let buffer = '';
      const decoder = new StringDecoder('utf8');
      const handleEvent = (dataStr) => {
        if (dataStr === '[DONE]') return;
        let parsed;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          return; // keepalive or non-JSON noise
        }
        if (parsed.error) {
          const msg = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || 'Error del modelo');
          throw new Error(msg);
        }
        if (parsed.usage) usage = parsed.usage;
        const choice = parsed.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || choice.message || {};
        const text = delta.content ?? choice.text ?? parsed.delta ?? parsed.chunk ?? '';
        if (text) {
          fullText += text;
          if (onChunk) onChunk(text);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = Number.isInteger(tc.index) ? tc.index : calls.size;
            let cur = calls.get(idx);
            if (!cur) { cur = { id: '', name: '', arguments: '' }; calls.set(idx, cur); }
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (typeof tc.function?.arguments === 'string') cur.arguments += tc.function.arguments;
            if (onToolProgress) onToolProgress({ index: idx, name: cur.name, args: cur.arguments });
          }
        }
      };

      res.on('data', (chunk) => {
        buffer += decoder.write(chunk);
        const lines = buffer.split('\n');
        buffer = lines.pop();
        try {
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) continue;
            if (trimmed.startsWith('data:')) handleEvent(trimmed.slice(5).trim());
            else handleEvent(trimmed);
          }
        } catch (err) {
          req.destroy();
          finish(err);
        }
      });

      res.on('end', () => {
        buffer += decoder.end();
        if (buffer.trim()) {
          try { handleEvent(buffer.trim().replace(/^data:\s*/, '')); } catch (err) { return finish(err); }
        }
        const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c], i) => ({
          id: c.id || `call_${Date.now().toString(36)}_${i}`,
          name: c.name,
          arguments: c.arguments,
        }));
        finish(null, { text: fullText, toolCalls, finishReason, usage });
      });
      res.on('close', () => {
        if (!res.complete && !settled) {
          finish(new Error('La conexión con el motor se cerró antes de completar la respuesta.'));
        }
      });
      res.on('error', (err) => finish(err));
    });

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('timeout', () => { req.destroy(new Error('El motor no respondió a tiempo (timeout).')); });
    req.on('error', (err) => finish(new Error(err.code === 'ECONNREFUSED' ? `No se pudo conectar con ${url.origin}` : err.message)));
    req.write(payload);
    req.end();
  });
}

/**
 * Executes streamCompletion with automatic retry on transient connection drops or 502/503/504 errors
 */
async function streamCompletionWithRetry(params, maxRetries = 5) {
  // Transient: dropped or refused connections (a server restart cuts streams with "aborted"),
  // gateway errors and the engine's own "interrumpida" notices. Backoff covers ~40 s in total.
  const delays = [2000, 4000, 7000, 10000, 15000];
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, delays[Math.min(attempt - 1, delays.length - 1)]));
      }
      return await streamCompletion(params);
    } catch (err) {
      lastErr = err;
      if (params.signal?.aborted || err.message === 'ABORTED' || err.message === 'PLAN_REQUIRED' || err.message === 'AUTH_EXPIRED' || err.message === 'USAGE_LIMIT_EXCEEDED') {
        throw err;
      }
      const msg = String(err.message || '');
      const code = String(err.code || '');
      const isTransient = /timeout|inactividad|interrumpid|cerró antes|aborted|econnreset|econnrefused|epipe|socket|premature|reset|upstream|no se pudo conectar|502|503|504/i.test(msg)
        || /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN/.test(code)
        || (err.status >= 500 && err.status <= 504);
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      process.stdout.write(`\n  \x1b[38;2;230;180;80m⚠ Conexión con el motor interrumpida. Reanudando automáticamente... (${attempt + 1}/${maxRetries})\x1b[0m\n`);
    }
  }
  throw lastErr;
}

/**
 * Keep the conversation within the model's window: drop the oldest exchanges first, never the
 * system prompt, and never leave an orphan tool result at the top.
 */
function trimContext(messages, maxChars = MAX_CONTEXT_CHARS) {
  const size = () => messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
  while (messages.length > 6 && size() > maxChars) {
    messages.splice(1, 1);
    while (messages.length > 2 && messages[1].role === 'tool') messages.splice(1, 1);
  }
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Arguments that stop mid-way (output limit hit) rather than being malformed JSON. */
function looksTruncatedJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  try {
    JSON.parse(text);
    return false;
  } catch (err) {
    const msg = String(err.message || '');
    return !text.endsWith('}') || /unexpected end|unterminated/i.test(msg);
  }
}

function argPath(rawArgs) {
  const m = /"(?:path|from|url)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(rawArgs || '');
  if (!m) return '';
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}

function argCommand(rawArgs) {
  const m = /"command"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(rawArgs || '');
  if (!m) return '';
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}

/**
 * Smart conversation context compaction (automatic, before the window fills up).
 * Compresses historical turns, tool outputs, and discussions into a dense, structured
 * architectural summary, drastically reducing active tokens while preserving full memory.
 */
function compactContext(messages, { force = false, threshold = COMPACT_THRESHOLD_TOKENS } = {}) {
  if (!Array.isArray(messages) || messages.length < 4) {
    return { compacted: false, reason: 'history_too_short' };
  }

  const beforeTokens = getActiveContextTokens(messages);
  if (!force && beforeTokens < threshold) {
    return { compacted: false, reason: 'under_threshold', beforeTokens };
  }

  const sysMsg = messages[0]?.role === 'system' ? messages[0] : null;
  const startIndex = sysMsg ? 1 : 0;
  
  // Keep the most recent user/assistant exchange intact (last 4 non-system turns)
  const nonSystemCount = messages.length - startIndex;
  if (nonSystemCount <= 3) {
    return { compacted: false, reason: 'history_too_short' };
  }
  const keepCount = Math.min(4, Math.max(2, Math.floor(nonSystemCount / 3)));
  const splitIndex = messages.length - keepCount;
  if (splitIndex <= startIndex) {
    return { compacted: false, reason: 'history_too_short' };
  }

  const turnsToCompact = messages.slice(startIndex, splitIndex);
  const recentTurns = messages.slice(splitIndex);

  // Extract user requests, files created/modified/read, bash commands, and assistant conclusions
  const userRequests = [];
  const modifiedFiles = new Set();
  const readFiles = new Set();
  const executedCommands = [];
  const keyConclusions = [];

  for (const m of turnsToCompact) {
    if (!m) continue;
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(p => p.text || '').join(' ') : '';
      if (text && !text.startsWith('[MEMORIA DE SESIÓN COMPACTADA') && !text.startsWith('[CONTEXTO PREVIO COMPACTADO')) {
        const firstLine = text.trim().split('\n')[0].slice(0, 140);
        userRequests.push(firstLine);
      }
    } else if (m.role === 'assistant') {
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const fn = tc?.function || {};
          const name = fn.name;
          const args = parseArgs(fn.arguments) || {};
          if (name === 'write_file' || name === 'append_file' || name === 'edit_file') {
            if (args.path) modifiedFiles.add(args.path);
          } else if (name === 'read_file' || name === 'view_image') {
            if (args.path) readFiles.add(args.path);
          } else if (name === 'run_command' && args.command) {
            executedCommands.push(args.command.slice(0, 90));
          }
        }
      }
      if (typeof m.content === 'string' && m.content.trim()) {
        const lines = m.content.trim().split('\n').filter(l => l.trim());
        const summarySnippet = lines[lines.length - 1].slice(0, 160);
        if (summarySnippet && !summarySnippet.startsWith('✓')) {
          keyConclusions.push(summarySnippet);
        }
      }
    }
  }

  let summary = `[MEMORIA DE SESIÓN COMPACTADA · AUTO-COMPACT]\n`;
  if (userRequests.length > 0) {
    summary += `• Objetivos abordados por el usuario:\n  - ${userRequests.slice(-8).join('\n  - ')}\n`;
  }
  if (modifiedFiles.size > 0) {
    summary += `• Archivos creados o modificados en la sesión:\n  - ${Array.from(modifiedFiles).join('\n  - ')}\n`;
  }
  if (readFiles.size > 0) {
    summary += `• Archivos leídos o consultados:\n  - ${Array.from(readFiles).slice(-10).join('\n  - ')}\n`;
  }
  if (executedCommands.length > 0) {
    summary += `• Comandos de terminal ejecutados:\n  - ${executedCommands.slice(-8).join('\n  - ')}\n`;
  }
  if (keyConclusions.length > 0) {
    summary += `• Conclusiones técnicas y decisiones previas:\n  - ${keyConclusions.slice(-5).join('\n  - ')}\n`;
  }
  summary += `• Estado: Sesión compactada exitosamente. Continúa trabajando desde los mensajes recientes sin perder coherencia.`;

  const compactAnchor = [
    {
      role: 'user',
      content: summary,
    },
    {
      role: 'assistant',
      content: 'Memoria de la conversación compactada y consolidada. Tengo presente todo el historial del proyecto, archivos modificados y decisiones previas. Continuamos con el objetivo actual.',
    },
  ];

  messages.length = 0;
  if (sysMsg) messages.push(sysMsg);
  messages.push(...compactAnchor);
  messages.push(...recentTurns);

  // Clean any dangling tool messages right after compact anchor
  const anchorEnd = (sysMsg ? 1 : 0) + compactAnchor.length;
  while (messages.length > anchorEnd && messages[anchorEnd].role === 'tool') {
    messages.splice(anchorEnd, 1);
  }

  const afterTokens = getActiveContextTokens(messages);
  const freedPct = Math.max(0, Math.round(((beforeTokens - afterTokens) / (beforeTokens || 1)) * 100));

  return {
    compacted: true,
    beforeTokens,
    afterTokens,
    freedPct,
  };
}

const TOOL_VERB = {
  write_file: '+ [write]', append_file: '+ [append]', edit_file: '~ [edit]', read_file: '› [read]', list_dir: '› [list]',
  search_files: '› [search]', run_command: '$ [bash]', delete_path: '- [delete]', move_path: '→ [move]', fetch_url: '› [fetch]',
  update_plan: '* [plan]', invoke_subagent: '› [agent]', view_image: '› [image]',
};
const TOOL_COLOR = {
  write_file: C.green, append_file: C.green, edit_file: C.blue, read_file: C.cyan, list_dir: C.gray, search_files: C.gray,
  run_command: C.gold, delete_path: C.red, move_path: C.gold, fetch_url: C.cyan, update_plan: C.gold, invoke_subagent: C.rose, view_image: C.cyan,
};

function toolLabel(call) {
  const a = call.args || {};
  switch (call.name) {
    case 'run_command': return Status.executing(a.command || '');
    case 'edit_file': return Status.editing(a.path);
    case 'write_file': return Status.writing(a.path);
    case 'append_file': return Status.appending(a.path);
    case 'read_file': return Status.reading(a.path + (a.start_line ? ` (${a.start_line}-${a.end_line || ''})` : ''));
    case 'list_dir': return Status.listing(a.path || '.');
    case 'search_files': return Status.searching(a.query);
    case 'delete_path': return Status.deleting(a.path);
    case 'move_path': return Status.moving(a.from, a.to);
    case 'fetch_url': return Status.fetching(a.url);
    case 'update_plan': return Status.planning();
    case 'invoke_subagent': return Status.subagent(a.role || 'Worker', a.task);
    case 'view_image': return Status.vision(a.path);
    default: return `  ${C.granateBold}● [${call.name}]${C.reset} ${C.gray}${JSON.stringify(a).slice(0, 120)}${C.reset}`;
  }
}

function buildToolCardData(call, result, tookMs) {
  const name = call.name;
  const a = call.args || {};
  const verb = TOOL_VERB[name] || `● [${name}]`;
  const color = TOOL_COLOR[name] || C.granateBold;
  const isError = !!(result && result.error);

  let target = '';
  let lines = [];
  let status = '✓ ok';

  switch (name) {
    case 'run_command': {
      target = a.command || '';
      const out = String(result?.stdout || '').split('\n').filter(l => l.trim());
      const err = String(result?.stderr || '').split('\n').filter(l => l.trim());
      const tail = [...out.slice(-8), ...err.slice(-4)];
      lines = tail.map(l => (l.length > 140 ? l.slice(0, 137) + '...' : l));
      if (result?.blocked) { status = 'bloqueado'; }
      else if (result?.killed_by_timeout) { status = 'timeout'; }
      else if (result?.exit_code === 0) { status = '✓ exit 0'; }
      else { status = `✖ exit ${result?.exit_code ?? '?'}`; }
      break;
    }
    case 'edit_file': {
      target = a.path || '';
      if (result?.error) { lines = [String(result.error).slice(0, 200)]; status = '✖ error'; }
      else { status = '✓ guardado'; }
      break;
    }
    case 'write_file': {
      target = a.path || '';
      if (result?.error) { lines = [String(result.error).slice(0, 200)]; status = '✖ error'; }
      else {
        lines = [`${result?.status === 'created' ? 'creado' : 'sobrescrito'} · ${result?.lines ?? '?'} líneas · ${formatBytes(result?.bytes_written || 0)}`];
        status = '✓ guardado';
      }
      break;
    }
    case 'append_file': {
      target = a.path || '';
      if (result?.error) { lines = [String(result.error).slice(0, 200)]; status = '✖ error'; }
      else {
        lines = [`+${formatBytes(result?.bytes_appended || 0)} · ahora ${result?.total_lines ?? '?'} líneas`];
        status = '✓ añadido';
      }
      break;
    }
    case 'read_file': {
      target = (a.path || '') + (a.start_line ? ` (${a.start_line}-${a.end_line || ''})` : '');
      if (result?.error) { lines = [String(result.error).slice(0, 200)]; status = '✖ error'; }
      else { status = `✓ ${result?.total_lines ?? '?'} líneas leídas`; }
      break;
    }
    case 'list_dir': {
      target = a.path || '.';
      if (result?.error) { lines = [String(result.error).slice(0, 200)]; status = '✖ error'; }
      else { status = `✓ ${result?.total_items ?? 0} elementos`; }
      break;
    }
    case 'search_files': {
      target = a.query || '';
      if (result?.error) { lines = [String(result.error).slice(0, 200)]; status = '✖ error'; }
      else { status = `✓ ${result?.matches_count ?? 0} coincidencias`; }
      break;
    }
    case 'delete_path': {
      target = a.path || '';
      status = result?.error ? '✖ error' : '✓ eliminado';
      break;
    }
    case 'move_path': {
      target = `${a.from} → ${a.to}`;
      status = result?.error ? '✖ error' : '✓ movido';
      break;
    }
    case 'fetch_url': {
      target = a.url || '';
      if (result?.error) { lines = [String(result.error).slice(0, 200)]; status = '✖ error'; }
      else {
        lines = [`HTTP ${result?.status} · ${formatBytes((result?.content || '').length)}${result?.truncated ? ' (truncado)' : ''}`];
        status = (result?.status && result.status < 400) ? '✓ completado' : `HTTP ${result?.status}`;
      }
      break;
    }
    case 'invoke_subagent': {
      target = `[${a.role || 'Worker'}] ${a.task || ''}`;
      if (result?.error) { lines = [String(result.error).slice(0, 200)]; status = '✖ error'; }
      else {
        lines = [`informe de ${formatBytes((result?.report || '').length)}`];
        status = '✓ completado';
      }
      break;
    }
    case 'view_image': {
      target = a.path || '';
      if (result?.error) { lines = [String(result.error).slice(0, 200)]; status = '✖ error'; }
      else {
        lines = [`${formatBytes(result?.size_bytes || 0)} · ${result?.mime_type || ''}`];
        status = '✓ analizada';
      }
      break;
    }
    default: {
      target = JSON.stringify(a).slice(0, 100);
      status = isError ? '✖ error' : '✓ ok';
      break;
    }
  }

  const errStatus = isError || status.startsWith('✖') || status === 'bloqueado' || status === 'timeout';
  return { verb, color, target, lines, status, isError: errStatus, durationMs: tookMs };
}

/** One dim line (or a few) summarizing what a tool did, printed under its label. */
function toolResultSummary(name, result) {
  if (!result || typeof result !== 'object') return '';
  const dim = (t) => `    ${C.darkGray}${t}${C.reset}`;
  if (result.error) return `    ${C.granateBright}✖ ${String(result.error).slice(0, 300)}${C.reset}`;
  switch (name) {
    case 'write_file': return dim(`${result.status === 'created' ? 'creado' : 'sobrescrito'} · ${result.lines ?? '?'} líneas · ${formatBytes(result.bytes_written || 0)}`);
    case 'append_file': return dim(`+${formatBytes(result.bytes_appended || 0)} · ahora ${result.total_lines ?? '?'} líneas`);
    case 'edit_file': return '';
    case 'read_file': return dim(`${result.total_lines ?? '?'} líneas${result.showing_range ? ` (mostrando ${result.showing_range[0]}-${result.showing_range[1]})` : ''}`);
    case 'list_dir': return dim(`${result.total_items ?? 0} elementos`);
    case 'search_files': return dim(`${result.matches_count ?? 0} coincidencias`);
    case 'fetch_url': return dim(`HTTP ${result.status} · ${formatBytes((result.content || '').length)}${result.truncated ? ' (truncado)' : ''}`);
    case 'delete_path': case 'move_path': return dim(result.status || 'ok');
    case 'update_plan': return '';
    case 'invoke_subagent': return dim(`informe de ${formatBytes((result.report || '').length)}`);
    case 'view_image': return dim(`${formatBytes(result.size_bytes || 0)} · ${result.mime_type || ''}`);
    case 'run_command': {
      const lines = [];
      const out = String(result.stdout || '').split('\n').filter(l => l.trim());
      const err = String(result.stderr || '').split('\n').filter(l => l.trim());
      const tail = [...out.slice(-10), ...err.slice(-4)];
      for (const l of tail) lines.push(dim(l.length > 160 ? l.slice(0, 157) + '...' : l));
      const code = result.blocked ? 'bloqueado' : (result.killed_by_timeout ? 'timeout' : `exit ${result.exit_code}`);
      lines.push(result.exit_code === 0 && !result.blocked ? dim(code) : `    ${C.granateBright}${code}${C.reset}`);
      return lines.join('\n');
    }
    default: return '';
  }
}

/** Does the reply end by announcing an action it did not take? ("Ahora creo el CSS:") */
function looksUnfinished(text) {
  const lines = String(text || '').trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  const last = lines[lines.length - 1];
  if (/[:：]$/.test(last)) return true;
  return /^(ahora|a continuación|seguidamente|luego|después|procedo|paso \d|voy a|vamos a|next|now)\b/i.test(last) && !/[.!?]$/.test(last);
}

/**
 * Multi-turn agentic loop.
 *   mode = 'build'   -> autonomous, no confirmations (catastrophic commands are refused)
 *   mode = 'copilot' -> every write/edit/command is previewed and approved
 *   mode = 'plan'    -> read-only, mutations are simulated
 */
async function runAgentTurn({ cfg, messages, userInput, confirmCallback, mode = 'build', images = [], quiet = false, signal, onToolModeChange }) {
  let toolMode = cfg.toolMode === 'xml' ? 'xml' : 'native';
  const startedAt = Date.now();
  const stats = { tools: 0, files: new Set(), commands: 0, prompt: 0, completion: 0, turns: 0 };

  const setSystem = () => {
    const sys = buildSystemPrompt(mode, { toolMode });
    if (messages.length === 0 || messages[0].role !== 'system') messages.unshift({ role: 'system', content: sys });
    else messages[0].content = sys;
  };
  setSystem();

  if (images && images.length > 0) {
    const multimodalContent = [{ type: 'text', text: userInput }];
    for (const img of images) {
      const url = typeof img === 'string' ? img : (img.data_url || img.dataUrl || img.base64 || img.url);
      if (url) multimodalContent.push({ type: 'image_url', image_url: { url } });
    }
    messages.push({ role: 'user', content: multimodalContent });
  } else {
    messages.push({ role: 'user', content: userInput });
  }

  const live = createLiveLine();
  if (!quiet) console.log(`\n${C.guide}─────────────────────────────────────────────────────────────${C.reset}`);

  let continuations = 0;
  let nudged = false;
  let failedRounds = 0;
  let stopReason = 'done';

  while (stats.turns < MAX_TURNS) {
    if (signal?.aborted) { stopReason = 'aborted'; break; }
    stats.turns++;

    // Auto-compaction if context approaches saturation (> 750k tokens)
    if (getActiveContextTokens(messages) >= compactThreshold(cfg)) {
      if (!quiet) console.log(`\n  ${C.gold}● [compactor]${C.reset} ${C.gray}El contexto supera los ${(compactThreshold(cfg) / 1000).toFixed(0)}k tokens. Compactando memoria para mantener máxima velocidad y precisión...${C.reset}`);
      const comp = compactContext(messages, { force: true });
      if (comp.compacted && !quiet) {
        console.log(`  ${C.green}✓ Contexto compactado:${C.reset} de ${C.gold}${comp.beforeTokens.toLocaleString()} tokens${C.reset} a ${C.green}${comp.afterTokens.toLocaleString()} tokens${C.reset} (${comp.freedPct}% liberado)\n`);
      }
    }

    trimContext(messages, maxContextChars(cfg));

    const promptLen = JSON.stringify(messages).length;
    const estPromptTok = Math.max(1, Math.ceil(promptLen / 3.8));
    const visible = toolMode === 'xml' ? createToolCallFilter() : (t) => t;
    const spinner = createSpinner(live, stats.turns === 1 ? 'Pensando' : 'Continuando');
    let hasStreamed = false;
    let lastToolIdx = -1;
    let lastToolRender = 0;
    let toolLineOpen = false;

    const stopSpinner = () => { spinner.stop(); };
    // The streaming progress line is replaced by the definitive label + result once the call runs.
    const closeToolLine = () => { if (toolLineOpen) { live.clear(); toolLineOpen = false; } };

    const mdStream = createMarkdownStream((rendered) => {
      stopSpinner();
      closeToolLine();
      if (!hasStreamed) {
        process.stdout.write('\n');
        hasStreamed = true;
      }
      process.stdout.write(rendered);
    });

    let result;
    try {
      result = await streamCompletionWithRetry({
        apiBase: cfg.apiBase,
        apiKey: cfg.isCustomEndpoint ? (cfg.endpointKey || '') : cfg.apiKey,
        model: cfg.model,
        messages,
        tools: toolMode === 'native' ? TOOL_SPECS : null,
        maxTokens: cfg.maxTokens || (isDeizaHost(cfg.apiBase) ? DEIZA_MAX_TOKENS : DEFAULT_MAX_TOKENS),
        signal,
        onChunk: (chunk) => {
          let text = visible(chunk);
          if (!text) return;
          mdStream.write(text);
        },
        onToolProgress: ({ index, name, args }) => {
          stopSpinner();
          mdStream.flush();
          if (index !== lastToolIdx) {
            closeToolLine();
            if (hasStreamed) { process.stdout.write('\n'); hasStreamed = false; }
            lastToolIdx = index;
            lastToolRender = 0;
          }
          const now = Date.now();
          if (!process.stdout.isTTY && lastToolRender && args.length > 300) return; // pipes/logs: one line per call
          if (now - lastToolRender < 120 && args.length < 200000) return;
          lastToolRender = now;
          const target = name === 'run_command' ? argCommand(args) : argPath(args);
          const verb = TOOL_VERB[name] || `● [${name}]`;
          const color = TOOL_COLOR[name] || C.granateBold;
          const size = args.length > 300 ? ` ${C.darkGray}· ${formatBytes(args.length)}${C.reset}` : '';
          live.set(`  ${color}${verb}${C.reset} ${C.white}${target || (name ? '' : '…')}${C.reset}${size} ${C.darkGray}…${C.reset}`);
          toolLineOpen = true;
        },
      });
    } catch (err) {
      stopSpinner();
      closeToolLine();
      mdStream.flush();
      // A server that does not understand `tools` (some local endpoints): switch to XML blocks and retry.
      if (toolMode === 'native' && err.status >= 400 && err.status < 500 && /tool/i.test(String(err.body || err.message)) && !isDeizaHost(cfg.apiBase)) {
        toolMode = 'xml';
        cfg.toolMode = 'xml';
        if (onToolModeChange) onToolModeChange('xml');
        setSystem();
        console.log(`  ${C.gold}Este endpoint no soporta function calling: usando el formato XML de herramientas.${C.reset}`);
        stats.turns--;
        continue;
      }
      throw err;
    }
    stopSpinner();
    closeToolLine();
    mdStream.flush();

    const assistantText = result.text || '';
    const tail = visible('');
    if (tail.trim()) { mdStream.write(tail); mdStream.flush(); hasStreamed = true; }
    if (hasStreamed) process.stdout.write('\n');

    stats.prompt += Number(result.usage?.prompt_tokens || estPromptTok);
    stats.completion += Number(result.usage?.completion_tokens || Math.max(1, Math.ceil((assistantText.length + result.toolCalls.reduce((n, c) => n + c.arguments.length, 0)) / 3.8)));

    let toolCalls;
    if (toolMode === 'native') {
      toolCalls = result.toolCalls.map(c => {
        const args = parseArgs(c.arguments);
        const cut = args === null && looksTruncatedJson(c.arguments);
        return { ...c, args, cut };
      });
      const assistantMsg = { role: 'assistant', content: assistantText || (toolCalls.length ? null : '') };
      // The engine validates the history: a cut argument string must be replaced by valid JSON.
      if (toolCalls.length) assistantMsg.tool_calls = toolCalls.map(c => ({
        id: c.id, type: 'function',
        function: { name: c.name, arguments: c.args ? c.arguments : JSON.stringify({ truncated: true, path: argPath(c.arguments) || undefined, partial_prefix: String(c.arguments || '').slice(0, 160) }) },
      }));
      messages.push(assistantMsg);
    } else {
      toolCalls = extractToolCalls(assistantText).map(c => ({ ...c, cut: c.parseError && looksTruncatedJson(c.arguments) }));
      messages.push({ role: 'assistant', content: assistantText });
    }
    const truncated = result.finishReason === 'length' || toolCalls.some(c => c.cut);
    const pushResult = (call, payload) => {
      let serialized = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      if (serialized.length > MAX_TOOL_OUTPUT) serialized = serialized.slice(0, MAX_TOOL_OUTPUT) + '\n... (salida truncada)';
      if (toolMode === 'native') messages.push({ role: 'tool', tool_call_id: call.id, content: serialized });
      else messages.push({ role: 'user', content: `<tool_response name="${call.name}">\n${serialized}\n</tool_response>` });
    };

    if (toolCalls.length === 0) {
      if (truncated && continuations < MAX_CONTINUATIONS) {
        continuations++;
        console.log(`  ${C.darkGray}(respuesta cortada por longitud, continuando ${continuations}/${MAX_CONTINUATIONS})${C.reset}`);
        messages.push({ role: 'user', content: 'Tu respuesta se cortó por el límite de longitud. Continúa exactamente donde lo dejaste, sin repetir nada de lo anterior. Si estabas escribiendo un archivo, hazlo con las herramientas (write_file + append_file por partes).' });
        continue;
      }
      if (!nudged && looksUnfinished(assistantText)) {
        nudged = true;
        messages.push({ role: 'user', content: 'Has anunciado una acción pero no has llamado a ninguna herramienta. Continúa y ejecútala ahora con las herramientas (write_file/append_file/edit_file/run_command...). No repitas la explicación.' });
        continue;
      }
      break;
    }

    let roundOk = 0;
    for (const call of toolCalls) {
      if (signal?.aborted) { stopReason = 'aborted'; break; }
      const fn = Tools[call.name];
      if (!call.args || typeof call.args !== 'object') {
        const cut = call.cut || result.finishReason === 'length';
        console.log(`  ${C.granateBright}✖ ${call.name || 'herramienta'}${argPath(call.arguments) ? ` ${argPath(call.arguments)}` : ''}:${C.reset} ${C.gray}${cut ? 'llamada cortada por el límite de salida, se pide reintentar por partes' : 'argumentos no válidos'}${C.reset}`);
        pushResult(call, cut
          ? `Error: los argumentos de esta llamada se cortaron por el límite de longitud de salida (el archivo no se ha escrito). Vuelve a hacerlo en varias llamadas más pequeñas: write_file con la primera parte (máximo ~150 líneas / 6 KB) y después append_file con cada parte siguiente, una llamada por parte, hasta completar el archivo. Cada llamada debe incluir los parámetros path y content.`
          : 'Error: los argumentos de la herramienta no son JSON válido. Vuelve a emitir la llamada con JSON correcto.');
        continue;
      }
      if (!fn) {
        pushResult(call, `Error: herramienta '${call.name}' no reconocida. Herramientas disponibles: ${TOOL_DEFINITIONS.map(t => t.name).join(', ')}.`);
        continue;
      }
      const invalid = validateArgs(call.name, call.args);
      if (invalid) {
        console.log(`  ${C.granateBright}✖ ${call.name}:${C.reset} ${C.gray}${invalid.replace(/^Error: /, '')}${C.reset}`);
        pushResult(call, invalid);
        continue;
      }

      if (mode === 'plan' && MUTATING_TOOLS.has(call.name)) {
        const readOnlyCmd = call.name === 'run_command' && /^\s*(git\s+(status|log|diff|branch|show)|ls|dir|cat|type|pwd|npm\s+(test|run\s+(test|lint|build))|pytest|cargo\s+(check|test)|go\s+(test|vet))\b/i.test(call.args.command || '');
        if (!readOnlyCmd) {
          console.log(`  ${C.cyan}[PLAN]${C.reset} ${C.gray}Simulando ${call.name} sin tocar el disco...${C.reset}`);
          pushResult(call, `[PLAN MODE] La acción ${call.name} fue interceptada: en modo PLAN no se modifica nada. Describe el cambio en el plan y continúa.`);
          continue;
        }
      }

      if (call.name === 'run_command' && isCommandCatastrophic(call.args.command || '')) {
        console.log(`  ${C.granateBright}✖ Comando bloqueado:${C.reset} ${call.args.command}`);
        pushResult(call, 'Comando bloqueado por Deiza Code (destruiría el sistema o el disco). Busca otra forma de conseguir el objetivo.');
        continue;
      }

      let previewed = false;
      if (mode === 'copilot' && MUTATING_TOOLS.has(call.name) && confirmCallback) {
        let approved;
        if (call.name === 'run_command') {
          const risky = isCommandRisky(call.args.command || '') ? ` ${C.granateBright}(destructivo)${C.reset}` : '';
          approved = await confirmCallback(`[COPILOT] Ejecutar${risky}: ${C.gold}${call.args.command}${C.reset} [S/n]: `);
        } else if (call.name === 'delete_path' || call.name === 'move_path') {
          approved = await confirmCallback(`[COPILOT] ${call.name === 'delete_path' ? 'Borrar' : 'Mover'} ${C.white}${call.args.path || call.args.from}${C.reset}${call.args.to ? ` → ${call.args.to}` : ''}? [S/n]: `);
        } else {
          const preview = previewChange(call.name === 'append_file' ? 'write_file' : call.name, call.name === 'append_file' ? { path: call.args.path, content: String(call.args.content || '') } : call.args);
          if (!preview.ok) { pushResult(call, `Error: ${preview.error}`); continue; }
          if (preview.diff && call.name !== 'append_file') { process.stdout.write(preview.diff); previewed = true; }
          approved = await confirmCallback(`[COPILOT] Aplicar ${call.name === 'append_file' ? 'añadido' : 'este cambio'} en ${C.white}${call.args.path}${C.reset}? [S/n]: `);
        }
        if (!approved) {
          console.log(`  ${C.gray}Cambio rechazado por el usuario.${C.reset}`);
          pushResult(call, 'El usuario ha RECHAZADO esta acción. No la repitas; pregunta qué prefiere o propón una alternativa.');
          continue;
        }
      }

      stats.tools++;
      if (['write_file', 'append_file', 'edit_file'].includes(call.name) && call.args.path) stats.files.add(call.args.path);
      if (call.name === 'run_command') stats.commands++;
      const t0 = Date.now();
      let toolResult;
      let toolTimer = null;
      if (['run_command', 'fetch_url', 'invoke_subagent'].includes(call.name)) {
        toolTimer = setInterval(() => {
          const el = formatDuration(Date.now() - t0);
          live.set(`  ${C.guide}│${C.reset}  ${C.gold}⠋ ejecutando...${C.reset} ${C.white}${call.args?.command || call.name}${C.reset} ${C.darkGray}· ${el}${C.reset}`);
        }, 120);
      }
      try {
        toolResult = await fn(call.args, { cfg, mode, messages, streamCompletion, quietDiff: previewed });
      } catch (err) {
        toolResult = { error: err.message };
      } finally {
        if (toolTimer) { clearInterval(toolTimer); toolTimer = null; live.clear(); }
      }
      const took = Date.now() - t0;
      if (call.name !== 'update_plan') {
        const cardData = buildToolCardData(call, toolResult, took);
        printToolCard(cardData);
      }
      pushResult(call, toolResult);
      if (!(toolResult && toolResult.error)) roundOk++;
    }
    if (stopReason === 'aborted') break;

    if (!roundOk && toolCalls.length) failedRounds++;
    else failedRounds = 0;
    if (failedRounds >= MAX_FAILED_ROUNDS) { stopReason = 'stuck'; break; }

    if (truncated && continuations < MAX_CONTINUATIONS) {
      continuations++;
      messages.push({ role: 'user', content: 'Continúa exactamente desde donde se cortó la respuesta.' });
      continue;
    }
    if (!toolCalls.length && looksUnfinished(assistantText) && !nudged) {
      nudged = true;
      messages.push({ role: 'user', content: 'Continúa y ejecuta la acción que acabas de anunciar con la herramienta correspondiente.' });
      continue;
    }
    // Continuous autonomous loop: when tools were executed, continue to the next round so the model processes their results!
    if (toolCalls.length > 0) {
      continue;
    }
    break;
  }

  if (stats.turns >= MAX_TURNS) stopReason = 'max_turns';

  if (!quiet) {
    const elapsed = formatDuration(Date.now() - startedAt);
    const parts = [];
    if (stats.tools) parts.push(`${stats.tools} herramienta${stats.tools === 1 ? '' : 's'}`);
    if (stats.files.size) parts.push(`${stats.files.size} archivo${stats.files.size === 1 ? '' : 's'}`);
    if (stats.commands) parts.push(`${stats.commands} comando${stats.commands === 1 ? '' : 's'}`);
    parts.push(`${(stats.prompt + stats.completion).toLocaleString()} tokens`);
    if (stopReason === 'aborted') console.log(`  ${C.gold}[interrumpido]${C.reset} ${C.darkGray}· ${elapsed} · ${parts.join(' · ')}${C.reset}`);
    else if (stopReason === 'max_turns') console.log(`  ${C.gold}! Se alcanzó el máximo de ${MAX_TURNS} rondas en esta petición; pide "continúa" para seguir.${C.reset} ${C.darkGray}· ${elapsed} · ${parts.join(' · ')}${C.reset}`);
    else if (stopReason === 'stuck') console.log(`  ${C.red}✖ El motor no consigue ejecutar sus propias llamadas (${MAX_FAILED_ROUNDS} rondas seguidas fallidas). Reformula la petición o divídela en pasos más pequeños.${C.reset} ${C.darkGray}· ${elapsed} · ${parts.join(' · ')}${C.reset}`);
    else console.log(`  ${C.green}✓ Completado con éxito en ${C.bold}${elapsed}${C.reset} ${C.darkGray}· ${parts.join(' · ')}${C.reset}`);
    console.log(`${C.guide}─────────────────────────────────────────────────────────────${C.reset}\n`);
  }

  return {
    turnCount: stats.turns,
    toolsExecuted: stats.tools,
    stopReason,
    elapsedMs: Date.now() - startedAt,
    elapsedText: formatDuration(Date.now() - startedAt),
    usage: { promptTokens: stats.prompt, completionTokens: stats.completion, totalTokens: stats.prompt + stats.completion },
  };
}

module.exports = {
  extractToolCalls,
  createToolCallFilter,
  completionsUrl,
  streamCompletion,
  runAgentTurn,
  compactContext,
  COMPACT_THRESHOLD_TOKENS,
  TOOL_SPECS,
};
