/**
 * Deiza's visible pointer inside the pages of the Code browser.
 *
 * The program runs through CDP in an isolated world, so page scripts cannot reach its state;
 * the only shared piece is one node with a shadow root that is aria-hidden, click-through and
 * promoted to the top layer (modal dialogs and fullscreen elements do not cover it). It only
 * uses DOM, CSSOM and Web Animations calls, which a page's CSP or Trusted Types do not block.
 * Movement runs on the compositor, so it stays smooth while the main process waits for it.
 */
'use strict';

/* eslint-disable no-undef */
async function pointerProgram(op) {
  const doc = document;
  const root = doc.documentElement;
  if (!root) return { ok: false };
  const g = globalThis;
  const W = innerWidth, H = innerHeight;
  const clampX = v => Math.max(0, Math.min(W - 1, Number(v) || 0));
  const clampY = v => Math.max(0, Math.min(H - 1, Number(v) || 0));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const css = (el, rules) => { for (const k in rules) el.style.setProperty(k, rules[k], 'important'); return el; };
  let p = g.__deizaPointer;
  const fresh = !p || !p.host.isConnected || p.host.ownerDocument !== doc;

  if (fresh) {
    if (op.kind === 'hide' || op.kind === 'conceal' || op.kind === 'reveal') return { ok: false };
    for (const old of doc.querySelectorAll('deiza-pointer')) old.remove();
    const host = css(doc.createElement('deiza-pointer'), {
      all: 'initial', display: 'block', position: 'fixed', inset: '0', width: '100vw', height: '100vh', margin: '0',
      padding: '0', border: '0', background: 'transparent', overflow: 'visible', 'pointer-events': 'none',
      'z-index': '2147483647', contain: 'strict', 'color-scheme': 'normal',
    });
    host.setAttribute('aria-hidden', 'true');
    const shadow = host.attachShadow({ mode: 'closed' });
    const cursor = css(doc.createElement('div'), {
      position: 'absolute', left: '0', top: '0', width: '0', height: '0', 'will-change': 'transform, opacity',
      opacity: '0', transition: 'opacity .2s ease',
    });
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('width', '28'); svg.setAttribute('height', '28'); svg.setAttribute('viewBox', '0 0 28 28');
    css(svg, { position: 'absolute', left: '-4px', top: '-3px', overflow: 'visible', filter: 'drop-shadow(0 3px 5px rgba(24, 9, 12, .42))' });
    const arrow = doc.createElementNS(ns, 'path');
    arrow.setAttribute('d', 'M4 3 L4 22.4 L9.1 17.7 L12.6 25.4 L16.3 23.8 L12.9 16.3 L20 16.3 Z');
    arrow.setAttribute('fill', '#b8404f');
    arrow.setAttribute('stroke', '#fbf3ea');
    arrow.setAttribute('stroke-width', '1.7');
    arrow.setAttribute('stroke-linejoin', 'round');
    svg.append(arrow);
    const tag = css(doc.createElement('div'), {
      position: 'absolute', left: '18px', top: '23px', padding: '4px 9px 5px', 'border-radius': '7px',
      background: '#6f1f2c', color: '#fbf3ea', font: '600 11.5px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      'letter-spacing': '.01em', 'white-space': 'nowrap', 'max-width': '280px', overflow: 'hidden', 'text-overflow': 'ellipsis',
      'box-shadow': '0 6px 18px rgba(24, 9, 12, .34), inset 0 0 0 1px rgba(251, 243, 234, .16)',
    });
    const ring = css(doc.createElement('div'), {
      position: 'absolute', left: '-18px', top: '-18px', width: '36px', height: '36px', 'box-sizing': 'border-box',
      'border-radius': '50%', border: '2px solid #e0707f', opacity: '0',
    });
    cursor.append(svg, tag);
    shadow.append(ring, cursor);
    root.appendChild(host);
    p = g.__deizaPointer = { host, cursor, tag, ring, x: NaN, y: NaN, idle: 0, relabel: 0 };
  }

  const place = (x, y) => { p.x = x; p.y = y; css(p.cursor, { transform: `translate3d(${x}px, ${y}px, 0)` }); };
  if (op.kind === 'conceal') {
    // Captures are of the page, not of Deiza's pointer: hide it for the frame the capture reads.
    css(p.host, { visibility: 'hidden' });
    await Promise.race([new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))), sleep(70)]);
    return { ok: true };
  }
  if (op.kind === 'reveal') { css(p.host, { visibility: 'visible' }); return { ok: true }; }
  if (op.kind === 'hide') { clearTimeout(p.idle); css(p.cursor, { opacity: '0' }); return { ok: true }; }

  // A new document starts the pointer where it was on the previous one.
  if (!Number.isFinite(p.x)) {
    const sx = Number.isFinite(op.fromX) ? op.fromX : Number.isFinite(op.x) ? op.x : W / 2;
    const sy = Number.isFinite(op.fromY) ? op.fromY : Number.isFinite(op.y) ? op.y : H / 2;
    place(clampX(sx), clampY(sy));
  }
  // Re-entering the top layer keeps the pointer above dialogs opened after it.
  try {
    if (p.host.popover !== 'manual') p.host.popover = 'manual';
    if (p.host.matches(':popover-open')) p.host.hidePopover();
    p.host.showPopover();
  } catch { /* no popover support: z-index still applies */ }
  css(p.host, { visibility: 'visible' });
  css(p.cursor, { opacity: '1' });
  clearTimeout(p.relabel);
  p.tag.textContent = op.label || 'Deiza';

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (Number.isFinite(op.x) && Number.isFinite(op.y)) {
    const x = clampX(op.x), y = clampY(op.y);
    const dx = x - p.x, dy = y - p.y, dist = Math.hypot(dx, dy);
    const ms = reduce || dist < 2 ? 0 : Number.isFinite(op.ms) ? op.ms : Math.round(Math.min(340, Math.max(110, 70 + dist * 0.3)));
    if (ms > 0) {
      // A slight arc reads as a hand moving, not a teleport along a ruler.
      const bend = op.kind === 'drag' ? 0 : Math.min(48, dist * 0.07);
      const mx = p.x + dx * 0.55 - (dy / dist) * bend, my = p.y + dy * 0.55 + (dx / dist) * bend;
      const anim = p.cursor.animate([
        { transform: `translate3d(${p.x}px, ${p.y}px, 0)` },
        { transform: `translate3d(${mx}px, ${my}px, 0)`, offset: 0.55 },
        { transform: `translate3d(${x}px, ${y}px, 0)` },
      ], { duration: ms, easing: op.kind === 'drag' ? 'linear' : 'cubic-bezier(.25, .75, .3, 1)' });
      place(x, y);
      await Promise.race([anim.finished.catch(() => {}), sleep(ms + 90)]);
    } else place(x, y);
  }

  if (op.kind === 'click') {
    css(p.ring, { transform: `translate3d(${p.x}px, ${p.y}px, 0)` });
    p.ring.animate([{ opacity: 0.95, scale: 0.35 }, { opacity: 0, scale: 1.55 }], { duration: reduce ? 1 : 460, easing: 'cubic-bezier(.2, .8, .3, 1)' });
    p.cursor.animate([{ scale: 1 }, { scale: 0.82 }, { scale: 1 }], { duration: reduce ? 1 : 200, easing: 'ease-out' });
  }
  if (op.label) p.relabel = setTimeout(() => { p.tag.textContent = 'Deiza'; }, 1600);
  clearTimeout(p.idle);
  p.idle = setTimeout(() => css(p.cursor, { opacity: '0' }), 20000);
  return { ok: true, x: p.x, y: p.y };
}

const POINTER_SOURCE = pointerProgram.toString();

module.exports = { POINTER_SOURCE };
