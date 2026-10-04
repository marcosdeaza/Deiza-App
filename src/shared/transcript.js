/**
 * Code transcript reducer, shared by the main process (which persists it) and the renderer
 * (which draws it). Both apply the same worker events, so what is saved is what was seen.
 *
 * Items:
 *   { k:'user', id, text, images, attachments, at, turnId, hist }   hist = history length before it (for edit/retry)
 *   { k:'think', id, text, open, startedAt, ms }   model reasoning (collapsed in the UI)
 *   { k:'text', id, text, open }
 *   { k:'tool', id, name, target, path, status, summary, detail, ms, output }
 *   { k:'plan', id, steps }
 *   { k:'approval', id, name, target, path, diff, command, risky, outside, state }
 *   { k:'notice', id, text, kind }
 *   { k:'handoff', id, path, by, content }   DEIZA_HANDOFF.md left when the usage ran out
 *   { k:'error', id, code, message }
 *   { k:'turn', id, stopReason, elapsedMs, stats, revertible, reverted }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeizaTranscript = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const OUTPUT_CAP = 24000;
  const THINK_CAP = 60000;
  let seq = 0;
  const uid = (p) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

  function closeThink(items) {
    const last = items[items.length - 1];
    if (last && last.k === 'think' && last.open) {
      last.open = false;
      last.ms = Math.max(0, Date.now() - (last.startedAt || Date.now()));
      return last;
    }
    return null;
  }

  function closeText(items) {
    closeThink(items);
    const last = items[items.length - 1];
    if (last && last.k === 'text' && last.open) last.open = false;
  }

  function findTool(items, id) {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].k === 'tool' && items[i].id === id) return items[i];
    return null;
  }

  /**
   * Applies one event. Returns the item that changed (or null) so a renderer can redraw just it.
   * `items` is mutated in place.
   */
  function apply(items, ev) {
    switch (ev.t) {
      case 'user': {
        closeText(items);
        const it = { k: 'user', id: ev.id || uid('u'), text: ev.text || '', images: ev.images || [], attachments: ev.attachments || [], at: ev.at || Date.now(), turnId: ev.turnId };
        if (Number.isInteger(ev.hist)) it.hist = ev.hist;
        items.push(it);
        return it;
      }
      case 'reasoning': {
        const last = items[items.length - 1];
        if (last && last.k === 'think' && last.open) {
          last.text += ev.delta || '';
          if (last.text.length > THINK_CAP) last.text = `…${last.text.slice(-THINK_CAP)}`;
          return last;
        }
        closeText(items);
        const it = { k: 'think', id: uid('th'), text: ev.delta || '', open: true, startedAt: Date.now(), ms: 0 };
        items.push(it);
        return it;
      }
      case 'reasoning_end':
        return closeThink(items);
      case 'text': {
        closeThink(items);
        const last = items[items.length - 1];
        if (last && last.k === 'text' && last.open) { last.text += ev.delta; return last; }
        const it = { k: 'text', id: uid('t'), text: ev.delta, open: true };
        items.push(it);
        return it;
      }
      case 'text_end': {
        const last = items[items.length - 1];
        if (last && last.k === 'text') { last.open = false; return last; }
        return null;
      }
      case 'tool_start': {
        closeText(items);
        const it = { k: 'tool', id: ev.id, name: ev.name, target: ev.target || '', path: ev.path, status: 'running', summary: '', detail: null, ms: 0, output: '' };
        items.push(it);
        return it;
      }
      case 'tool_output': {
        const it = findTool(items, ev.id);
        if (!it) return null;
        it.output = (it.output + ev.chunk);
        if (it.output.length > OUTPUT_CAP) it.output = it.output.slice(-OUTPUT_CAP);
        return it;
      }
      case 'tool_end': {
        const it = findTool(items, ev.id);
        if (!it) return null;
        it.status = ev.status || 'ok';
        it.summary = ev.summary || '';
        it.detail = ev.detail || null;
        it.ms = ev.ms || 0;
        if (it.detail && (it.detail.stdout || it.detail.stderr)) it.output = '';
        return it;
      }
      case 'plan': {
        closeText(items);
        // One checklist per request, updated in place.
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].k === 'user' || items[i].k === 'turn') break;
          if (items[i].k === 'plan') { items[i].steps = ev.steps; return items[i]; }
        }
        const it = { k: 'plan', id: uid('p'), steps: ev.steps || [] };
        items.push(it);
        return it;
      }
      case 'approval': {
        closeText(items);
        const it = { k: 'approval', id: ev.id, name: ev.name, target: ev.target, path: ev.path, diff: ev.diff, command: ev.command, risky: ev.risky, outside: ev.outside, state: 'pending' };
        items.push(it);
        return it;
      }
      case 'approval_resolved': {
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].k === 'approval' && items[i].id === ev.id) { items[i].state = ev.approved ? 'approved' : 'rejected'; return items[i]; }
        }
        return null;
      }
      case 'notice': {
        closeThink(items);
        const it = { k: 'notice', id: uid('n'), text: ev.text, kind: ev.kind || '' };
        items.push(it);
        return it;
      }
      case 'error': {
        closeText(items);
        const it = { k: 'error', id: uid('e'), code: ev.code, message: ev.message || '' };
        items.push(it);
        return it;
      }
      case 'turn_end': {
        closeText(items);
        // Cards still "running" (worker crashed or aborted mid-call) are settled.
        for (const it of items) if (it.k === 'tool' && it.status === 'running') it.status = 'aborted';
        for (const it of items) if (it.k === 'approval' && it.state === 'pending') it.state = 'rejected';
        for (const it of items) if (it.k === 'turn') it.revertible = false;
        const it = { k: 'turn', id: ev.turnId || uid('turn'), stopReason: ev.stopReason, elapsedMs: ev.elapsedMs || 0, stats: ev.stats || {}, revertible: Boolean(ev.revertible), reverted: false };
        items.push(it);
        return it;
      }
      case 'handoff': {
        closeText(items);
        const it = { k: 'handoff', id: uid('h'), path: ev.path || '', by: ev.by || 'agent', content: ev.content || '' };
        items.push(it);
        return it;
      }
      case 'truncate': {
        // Edit or retry of a user message: it and everything after it leave the transcript.
        const at = items.findIndex(x => x.id === ev.itemId || (ev.turnId && x.k === 'user' && x.turnId === ev.turnId));
        if (at >= 0) items.splice(at);
        return null;
      }
      case 'reverted': {
        for (const it of items) if (it.k === 'turn' && it.id === ev.turnId) { it.reverted = true; it.revertible = false; return it; }
        return null;
      }
      default:
        return null;
    }
  }

  return { apply, uid };
}));
