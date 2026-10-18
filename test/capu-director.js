/* Capu regressions: node test/capu-director.js (no app, network or real-time waits). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(legacy = false) {
  let now = 1000, nextId = 0;
  const timers = new Map(), listeners = new Set();
  const media = { matches: true };
  if (legacy) {
    media.addListener = fn => listeners.add(fn);
    media.removeListener = fn => listeners.delete(fn);
  } else {
    media.addEventListener = (_, fn) => listeners.add(fn);
    media.removeEventListener = (_, fn) => listeners.delete(fn);
  }
  const context = vm.createContext({
    module: { exports: {} }, Date: { now: () => now }, matchMedia: () => media,
    setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const source = path.join(__dirname, '../src/renderer/capu.js');
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  function advance(ms) {
    const end = now + ms;
    for (let ticks = 0; ; ticks++) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(ticks < 10000, 'Timer loop must terminate');
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  return { Capu: context.module.exports, timers, listeners, media, advance };
}

const { Capu, timers, advance } = harness();
for (const scene of ['liquid', 'solid', 'saiyan']) {
  const p = new Capu.Player({ innerHTML: '' }, { motion: 'reduced' });
  const d = new Capu.Director(p);
  d.react(scene);
  assert.equal(p.last, Capu.frameIndex(scene, Capu.sceneDuration(scene) / 2));
  advance(Capu.sceneDuration(scene) - 1);
  assert.equal(p.scene, scene); assert.equal(d.reacting, true);
  advance(1);
  assert.equal(p.scene, 'idle'); assert.equal(d.reacting, false);
  d.stop();
}
for (const motion of ['full', 'reduced']) {
  for (const [state, scene, final] of [['done', 'bloom', 'idle'], ['error', 'oops', 'reading'], ['hello', 'hello', 'idle']]) {
    const p = new Capu.Player({ innerHTML: '' }, { motion });
    const d = new Capu.Director(p);
    d.set('reading'); d.react('liquid'); advance(100); d.set(state);
    assert.equal(p.scene, 'liquid');
    if (state === 'error') assert.equal(d._afterError, 'reading');
    advance(Capu.sceneDuration('liquid') - 100);
    assert.equal(p.scene, scene); assert.equal(d.reacting, false);
    advance(Capu.sceneDuration(scene));
    assert.equal(d.state, final); assert.equal(p.scene, final);
    d.pause(); d.set(state);
    const start = p.t0, endCallback = p.onEnd;
    advance(200); d.resume(true);
    assert.equal(p.scene, scene); assert.equal(p.t0, start); assert.equal(p.onEnd, endCallback);
    advance(Capu.sceneDuration(scene) - 200);
    assert.equal(d.state, final);
    d.stop();
  }
  const p = new Capu.Player({ innerHTML: '' }, { motion });
  const d = new Capu.Director(p);
  d.pause(); p.play('walk'); d.resume(); assert.equal(p.scene, 'idle'); d.stop();
}
assert.equal(timers.size, 0);

for (const legacy of [false, true]) {
  const h = harness(legacy), p = new h.Capu.Player({ innerHTML: '' });
  assert.equal(p.motion, 'system'); assert.equal(p.reduced, true); assert.equal(p.timer, null);
  assert.equal(h.listeners.size, 1);
  h.media.matches = false; for (const fn of [...h.listeners]) fn();
  assert.equal(p.reduced, false); assert.ok(p.timer);
  const start = p.t0;
  p.setMotion('reduced'); assert.equal(p.t0, start); assert.equal(p.timer, null); assert.equal(h.listeners.size, 0);
  p.setMotion('system'); assert.equal(h.listeners.size, 1);
  p.stop(); assert.equal(p.timer, null); assert.equal(h.listeners.size, 0);
  h.media.matches = true;
  p.setMotion('full'); assert.equal(p.timer, null);
  p.play('idle'); assert.equal(p.reduced, false); assert.ok(p.timer);
  p.setMotion('system'); assert.equal(p.reduced, true); assert.equal(h.listeners.size, 1);
  p.stop(); assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0);
}
// Forms: one Capu per model family, sharing the centre and the ground line.
{
  const { Capu: C, timers: tm, advance: adv } = harness();
  assert.equal(C.formFor('deiza-gas-5.5'), 'gas'); assert.equal(C.formFor('deiza-gas-4.5'), 'gas');
  assert.equal(C.formFor('deiza-solid-5'), 'solid'); assert.equal(C.formFor('deiza-omniscient'), 'liquid');
  assert.equal(C.formFor('deiza-liquid-5.1'), 'liquid'); assert.equal(C.formFor(undefined), 'liquid');
  // the body itself (Gas's wisp of vapour does not count)
  const box = (form) => {
    const g = C.frameAt('idle', 0, form);
    for (const row of g) for (let x = 0; x < row.length; x++) if (!['X', 'x', 'F', 'Y', 'y', 'g'].includes(row[x])) row[x] = null;
    return C.bbox([g]);
  };
  const [gas, liquid, solid] = ['gas', 'liquid', 'solid'].map(box);
  assert.ok(gas.w < liquid.w && liquid.w < solid.w, 'Gas < Liquid < Solid in width');
  assert.ok(gas.h < liquid.h && liquid.h < solid.h, 'Gas < Liquid < Solid in height');
  for (const b of [gas, liquid, solid]) assert.equal(b.y + b.h, 28, 'every form stands on the same ground');
  assert.deepEqual(C.frameAt('idle', 0), C.frameAt('idle', 0, 'liquid'), 'Liquid is the default form');
  assert.ok(C.frameAt('idle', 0, 'gas').pal, 'Gas carries its own palette');
  // every scene draws in every form without throwing
  for (const form of Object.keys(C.FORMS)) for (const n of Object.keys(C.SCENES)) {
    for (let i = 0; i < C.SCENES[n].frames.length; i++) C.frameAt(n, i, form, 'liquid');
  }
  for (const motion of ['full', 'reduced']) {
    const p = new C.Player({ innerHTML: '' }, { motion, form: 'solid' });
    const d = new C.Director(p);
    assert.equal(p.form, 'solid');
    d.morph('gas', 'gas');
    assert.equal(p.form, 'gas'); assert.equal(p.from, 'solid'); assert.equal(p.scene, 'evolve');
    adv(C.sceneDuration('evolve'));
    assert.equal(p.scene, 'gas'); assert.equal(d.reacting, true);
    adv(C.sceneDuration('gas'));
    assert.equal(p.scene, 'idle'); assert.equal(d.reacting, false);
    d.morph('gas', 'gas');
    assert.equal(p.scene, 'gas', 'same form: only the model reaction');
    adv(C.sceneDuration('gas'));
    p.setForm('nope'); assert.equal(p.form, 'liquid');
    d.stop();
  }
  assert.equal(tm.size, 0);
}
console.log('Capu regressions passed: reactions, deferred states, return home, motion changes, forms and cleanup.');
