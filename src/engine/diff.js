/**
 * Line diff (Myers, O((N+M)·D)) turned into display hunks for the Code UI.
 * Common prefix/suffix are trimmed first, so typical edits cost almost nothing; a pathological
 * rewrite beyond MAX_D falls back to "replace the changed block".
 */

const MAX_D = 1500;
const CONTEXT = 3;
const MAX_LINES_SHOWN = 600;

function splitLines(text) {
  if (!text) return [];
  const lines = String(text).split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let dEnd = -1;
  outer: for (let d = 0; d <= max; d++) {
    if (d > MAX_D) return null;
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { dEnd = d; break outer; }
    }
  }
  const ops = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d > 0; d--) {
    const vd = trace[d];
    const get = (k) => vd[k + d + 1];
    const k = x - y;
    const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push(['=', x - 1, y - 1]); x--; y--; }
    if (x === prevX) ops.push(['+', -1, y - 1]);
    else ops.push(['-', x - 1, -1]);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { ops.push(['=', x - 1, y - 1]); x--; y--; }
  return ops.reverse();
}

/**
 * @returns {{added:number, removed:number, hunks:Array, truncated:boolean, isNew:boolean, deleted:boolean}}
 * hunk = { oldStart, newStart, lines: [[' '|'-'|'+', text], ...] }  (1-based line numbers)
 */
function diffText(before, after, { isNew = false, deleted = false } = {}) {
  const a = splitLines(before);
  const b = splitLines(after);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);

  let ops = myers(midA, midB);
  if (!ops) {
    ops = [...midA.map((_, i) => ['-', i, -1]), ...midB.map((_, j) => ['+', -1, j])];
  }
  // Re-base onto the full files, with the trimmed prefix/suffix as equal lines.
  const full = [];
  for (let i = 0; i < pre; i++) full.push(['=', i, i]);
  for (const [t, i, j] of ops) full.push([t, i < 0 ? -1 : i + pre, j < 0 ? -1 : j + pre]);
  for (let s = 0; s < suf; s++) full.push(['=', a.length - suf + s, b.length - suf + s]);

  let added = 0;
  let removed = 0;
  for (const [t] of full) { if (t === '+') added++; else if (t === '-') removed++; }

  const hunks = [];
  let shown = 0;
  let truncated = false;
  let i = 0;
  while (i < full.length) {
    if (full[i][0] === '=') { i++; continue; }
    let start = Math.max(0, i - CONTEXT);
    // extend the hunk while changes are within 2*CONTEXT of each other
    let end = i;
    let lastChange = i;
    while (end < full.length) {
      if (full[end][0] !== '=') lastChange = end;
      else if (end - lastChange > CONTEXT * 2) break;
      end++;
    }
    end = Math.min(full.length, lastChange + CONTEXT + 1);
    const slice = full.slice(start, end);
    const lineNo = (col) => {
      for (const op of slice) if (op[col] >= 0) return op[col] + 1;
      for (let s = start - 1; s >= 0; s--) if (full[s][col] >= 0) return full[s][col] + 2;
      return 1;
    };
    const oldStart = lineNo(1);
    const newStart = lineNo(2);
    const lines = [];
    for (const [t, ai, bj] of slice) {
      if (shown >= MAX_LINES_SHOWN) { truncated = true; break; }
      lines.push([t === '=' ? ' ' : t, t === '+' ? b[bj] : a[ai]]);
      shown++;
    }
    hunks.push({ oldStart, newStart, lines });
    if (truncated) break;
    i = end;
  }
  return { added, removed, hunks, truncated, isNew, deleted };
}

module.exports = { diffText, splitLines };
