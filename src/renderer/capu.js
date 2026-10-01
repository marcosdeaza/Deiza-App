/*!
 * Capu — la mascota de Deiza Code.
 *
 * Un capullo de rosa hecho bloque: ocho píxeles gordos de ancho, el pétalo izquierdo más alto que
 * el resto y dos ojos que son huecos (a través de ellos se ve el fondo). Le brotan brazos de hoja
 * cuando necesita coger algo. Florece al terminar una tarea y se mustia cuando se acaba el uso.
 *
 * Dos resoluciones:
 *   - la silueta base, 8×10 (logo, favicon, terminal);
 *   - la escena animada, a doble resolución: Capu se dibuja con píxeles de 2×2 y los props
 *     (portátil, lata, café, pato de goma…) a píxel fino, como iconos de 16 px.
 *
 * Un solo archivo sin dependencias (navegador, Electron y Node):
 *   Capu.frame(scene, t)          rejilla de colores (o null) para el instante t en ms
 *   Capu.toSVG(grid, opts)        <svg> pixel-perfect (opts.px, opts.crop, opts.mono)
 *   Capu.toANSI(grid, opts)       texto en color para terminal (medios bloques)
 *   Capu.base(opts)               la silueta base 8×10 (opts.eyes, opts.top)
 *   new Capu.Player(el, opts)     anima dentro de un elemento del DOM
 *   new Capu.Director(player)     elige escena según lo que hace el agente
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Capu = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PAL = {
    X: '#C04A56', // cuerpo
    x: '#9A3743', // cuerpo en sombra
    R: '#F09AA6', // rosa claro (corazón de la flor)
    r: '#DE6A79', // rosa medio
    q: '#B8404E', // rosa oscuro (espiral)
    L: '#94B07C', // hoja
    l: '#6F8E5D', // hoja en sombra
    W: '#F4ECE1', // crema
    w: '#DDD3C6', // crema en sombra
    v: '#B9AEA1', // crema oscuro
    S: '#CFC8BF', // aluminio
    s: '#A8A097', // aluminio en sombra
    t: '#857D75', // aluminio oscuro
    d: '#5B5450', // grafito
    D: '#39322F', // grafito oscuro
    K: '#1F1918', // tinta
    Y: '#E7B447', // ocre / amarillo
    y: '#C28B2C', // ocre oscuro
    O: '#E4793A', // naranja
    o: '#C9542E', // naranja oscuro (llama)
    C: '#6E4431', // café
    c: '#8E5B40', // café claro
    G: '#A7C98A', // verde terminal
    Z: '#A79D92', // vapor
    k: '#C99A66', // cartón
    j: '#9C7046', // cartón en sombra
    g: '#F7D46A', // oro claro (aura)
    B: '#7FB3C9', // agua (solo en el agua de Liquid)
    h: '#FFF6CF', // oro blanco (núcleo del aura, destello)
    a: '#F7D46A4D', // aura translúcida
    A: '#FFE58C99', // corriente del aura
    e: '#F2FBFF', // rayo
    E: '#86D3F2', // rayo en sombra
    T: '#4FD1C5', // ojos Super Saiyan
  };

  // ── silueta base 8×10 (1 píxel = 1 píxel gordo) ─────────────────────────────────────────────
  const BASE_TOP = {
    bud: ['XX......', 'XXX.XX..'],
    bloom: ['X.R..R.X', 'XRRqRRRX'],
    wilt: ['........', 'XXX.X...'],
  };
  function base(opts) {
    opts = opts || {};
    const rows = [];
    const top = BASE_TOP[opts.top || 'bud'];
    rows.push(top[0].split(''), top[1].split(''));
    for (let i = 0; i < 7; i++) rows.push('XXXXXXXX'.split(''));
    rows.push('.X....X.'.split(''));
    const eyes = opts.eyes === 'closed' ? [[2, 5], [5, 5]] : [[2, 4], [2, 5], [5, 4], [5, 5]];
    for (const [x, y] of eyes) rows[y][x] = '.';
    return rows.map((r) => r.map((c) => (c === '.' ? null : c)));
  }

  // ── escena a resolución fina ────────────────────────────────────────────────────────────────
  const W = 54;
  const H = 36;
  const BX = 16;  // borde izquierdo del cuerpo (fino)
  const BY = 8;   // punta del pétalo alto (fino)

  // A frame grid. Scenes that burst out of the stage (fx) get `oy` extra rows above row 0;
  // drawing code works in raw rows, everything else reads scene coordinates through at().
  function blank(oy) {
    oy = oy || 0;
    const g = [];
    for (let y = 0; y < H + oy; y++) g.push(new Array(W).fill(null));
    g.oy = oy;
    return g;
  }
  function at(g, x, y) { const r = g[y + (g.oy || 0)]; return (r && r[x]) || null; }
  function put(g, x, y, c) {
    if (x < 0 || y < 0 || x >= g[0].length || y >= g.length) return;
    g[y][x] = c === '_' ? null : c;
  }
  // rows: strings; '.' or ' ' = untouched, '_' = transparent hole, anything else = palette key
  function stamp(g, x, y, rows, flip) {
    for (let j = 0; j < rows.length; j++) {
      const row = flip ? rows[j].split('').reverse().join('') : rows[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        put(g, x + i, y + j, ch);
      }
    }
  }
  function fill(g, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c); }
  // recolour only the pixels that already have colour `from`
  function tint(g, x, y, w, h, from, to) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { if (g[y + j] && g[y + j][x + i] === from) g[y + j][x + i] = to; }
  }

  // Tops at fine resolution (16 wide, 4 tall), drawn above the body block.
  const TOPS = {
    bud: [
      'XXXX............',
      'XXXX............',
      'XXXXXX..XXXX....',
      'XXXXXX..XXXX....',
    ],
    // pétalo alto que se mueve un poco (tic)
    twitch: [
      '.XXXX...........',
      'XXXXX...........',
      'XXXXXX..XXXX....',
      'XXXXXX..XXXX....',
    ],
    half: [
      'XXXX............',
      'XXXXX..rr.......',
      'XXXXXXrRRrXX....',
      'XXXXXXrqRRXXXX..',
    ],
    // abierta: los pétalos se separan como brazos y asoma la rosa
    bloom: [
      '..XX..........XX....',
      '.XXXX..rRRr..XXXX...',
      'XXXXX.rRqqRr.XXXXX..',
      'XXXXXrRqRRqRrXXXXX..',
      '.XXXXrRRqqRRrXXXX...',
      '..XXXXrRRRRrXXXX....',
    ],
    // mustio: el pétalo alto se dobla y cuelga por fuera
    wilt: [
      '....................',
      '....................',
      '.XXXXXXXX..XXXX.....',
      'XX..XXXXXXXXXXXXXXXX',
    ],
  };
  // Super Saiyan: the petals turn into golden spikes; the tallest is still the one on the left
  TOPS.saiyan = [
    '....h.................',
    '...hg.................',
    '...gY.......h.........',
    '..gYY......hg.........',
    '..gYYy....gYg.....h...',
    'h.gYYy...gYYy....hg...',
    'gYgYYYy.gYYYy...gYy..h',
    '.gYYYYYygYYYYy.gYYy.gY',
    '..gYYYYYYYYYYYgYYYYgYy',
    '..yYYYYYYYYYYYYYYYYYy.',
    '...yYYYYYYYYYYYYYYYy..',
    '...yyYYYYYYYYYYYYYyy..',
  ];
  // same hair a moment later: the tips sway in the aura
  TOPS.saiyan2 = [
    '...h..................',
    '...hg.................',
    '..hgY........h........',
    '..gYY.......hg........',
    '..gYYy....hgYg...h....',
    '.hgYYy...gYYYy...hg...',
    'hYgYYYy.gYYYy...gYy...',
    '.gYYYYYygYYYYy.gYYy.hY',
    '..gYYYYYYYYYYYgYYYYgYy',
    '..yYYYYYYYYYYYYYYYYYy.',
    '...yYYYYYYYYYYYYYYYy..',
    '...yyYYYYYYYYYYYYYyy..',
  ];
  const TOP_OFF = { bloom: [-2, -2], wilt: [-4, 0], saiyan: [-3, -8], saiyan2: [-3, -8] };

  // Eye holes (fine coords relative to the body's top-left corner, below the top rows).
  const EY = 8;   // top row of the eyes (relative to BY)
  function eyeRects(kind) {
    const L = 4, R = 10;
    switch (kind) {
      case 'closed': return [[L, EY + 3, 2, 1], [R, EY + 3, 2, 1]];
      case 'half': return [[L, EY + 2, 2, 2], [R, EY + 2, 2, 2]];
      case 'up': return [[L, EY - 1, 2, 4], [R, EY - 1, 2, 4]];
      case 'down': return [[L, EY + 1, 2, 4], [R, EY + 1, 2, 4]];
      case 'left': return [[L - 1, EY, 2, 4], [R - 1, EY, 2, 4]];
      case 'right': return [[L + 1, EY, 2, 4], [R + 1, EY, 2, 4]];
      case 'upright': return [[L + 1, EY - 1, 2, 4], [R + 1, EY - 1, 2, 4]];
      case 'downright': return [[L + 1, EY + 1, 2, 4], [R + 1, EY + 1, 2, 4]];
      case 'wide': return [[L, EY - 1, 2, 6], [R, EY - 1, 2, 6]];
      case 'squint': return [[L - 1, EY + 2, 3, 1], [R, EY + 2, 3, 1]];
      default: return [[L, EY, 2, 4], [R, EY, 2, 4]];
    }
  }
  function happyEyes(g, x0, y0) {
    for (const ex of [3, 9]) {
      put(g, x0 + ex, y0 + EY + 2, '_');
      put(g, x0 + ex + 1, y0 + EY + 1, '_');
      put(g, x0 + ex + 2, y0 + EY + 1, '_');
      put(g, x0 + ex + 3, y0 + EY + 2, '_');
    }
  }

  // Leaf arms. Sprites are drawn from the attach point on each side; `flip` mirrors them.
  const LEAF = {
    down: ['l..', '.L.', '.LL', '..L'],
    out: ['lLLL', '..LL'],
    up: ['..LL', '.LL.', 'l...'],
    high: ['...L', '..LL', '.LL.', 'l...'],
    hold: ['lL..', '.LLL'],
    wave1: ['.LL', 'LL.', 'l..'],
    wave2: ['L..', 'LL.', '.L.', 'l..'],
    type1: ['l', 'L', 'L'],
    type2: ['l', 'L'],
  };
  const ARM_Y = { down: 14, out: 15, up: 11, high: 9, hold: 16, wave1: 11, wave2: 10, type1: 17, type2: 17 };

  /**
   * o: { dx, dy, top, eyes, armL, armR, squash (0-2 fine px), legs: 'step'|'none' }
   * Returns the body's origin so props can be placed next to it.
   */
  function body(g, o) {
    o = o || {};
    const x0 = BX + (o.dx || 0);
    const sq = o.squash || 0;
    const y0 = BY + (o.dy || 0) + sq;
    const tk = o.top || 'bud';
    const off = TOP_OFF[tk] || [0, 0];
    stamp(g, x0 + off[0], y0 + off[1], TOPS[tk]);
    fill(g, x0, y0 + 4, 16, 14 - sq, 'X');
    // soft shade on the right edge: a monolith has a side
    fill(g, x0 + 15, y0 + 5, 1, 12 - sq, 'x');
    const legY = y0 + 18 - sq;
    if (o.legs !== 'none') {
      const stepL = o.legs === 'stepL' ? 1 : 0;
      const stepR = o.legs === 'step' || o.legs === 'stepR' ? 1 : 0;
      fill(g, x0 + 2, legY - stepL, 2, 2, 'X');
      fill(g, x0 + 12, legY - stepR, 2, 2, 'X');
    }
    const ey = y0 - sq;
    if (o.eyes === 'happy') happyEyes(g, x0, ey + sq);
    else for (const [ex, eyy, w, h] of eyeRects(o.eyes)) fill(g, x0 + ex, ey + eyy + sq, w, h, '_');
    if (o.armL) {
      const s = LEAF[o.armL];
      stamp(g, x0 - s[0].length, y0 + ARM_Y[o.armL], s, true);
    }
    if (o.armR) stamp(g, x0 + 16, y0 + ARM_Y[o.armR], LEAF[o.armR]);
    return { x0, y0 };
  }

  // ── props (píxel fino) ──────────────────────────────────────────────────────────────────────
  const P = {
    mug: [
      '.wwwwww...',
      'wCccCCCw..',
      'WWWWWWWwW.',
      'WWWWWWWw.W',
      'rrrrrrrq.W',
      'WWWWWWWw.W',
      'WWWWWWWwW.',
      'wWWWWWWw..',
      '.vvvvvv...',
    ],
    steam1: ['.Z.', 'Z..', '.Z.', '..Z', '.Z.'],
    steam2: ['Z..', '.Z.', '..Z', '.Z.', 'Z..'],
    can: [
      '.SSSS.',
      'SWWSSs',
      'SWSSSs',
      'KKKKKD',
      'KKKYKD',
      'KKYYKD',
      'KYYYKD',
      'KKYKKD',
      'KYKKKD',
      'SWSSSs',
      'SWSSSs',
      '.tttt.',
    ],
    // lata tumbada sobre la cabeza (la boca a la izquierda, gotea)
    canPour: [
      '..SSSSSKKKKKKSS.',
      '.tSWWWWKYKYYKSWs',
      'SSSSSSSKKYYKKSSs',
      '..sssssDDDDDDss.',
    ],
    canCrushed: [
      '.SSs..',
      'SKYKSs',
      '.sKKYs',
      'SSttS.',
    ],
    laptop: [
      'tSSSSSSSSSSSSSSSSt',
      'tdrRrdddddKKKKKddt',
      'tdRqRdddddKGKKKddt',
      'tdrRrdddddKKGGKddt',
      'tddYddddwwwwdddddt',
      'tdYYYdddwvvwdddddt',
      'tttttttttttttttttt',
    ],
    laptopBase: ['DDDDDDDDDDDDDDDDDDDDDD'],
    duck: [
      '...YYYY....',
      '..YYYYYY...',
      '..YKYYYY...',
      'OOOYYYYY..Y',
      '.OOYYYYYYYY',
      '..YYYYYYYYY',
      '.YYYYYYYYYy',
      '.YYYYYYYYy.',
      '..yyyyyyy..',
    ],
    lens: [
      '.ttSSt.',
      'tS...St',
      'S.....S',
      'S.....S',
      'S.....s',
      'tS...st',
      '.tssst.',
    ],
    lensHandle: ['dd.', '.dd', '..D'],
    phones: [
      '....tttttttttttt....',
      '..ttddddddddddddtt..',
      '.tdd............ddt.',
      '.dd..............dd.',
      '.d................d.',
    ],
    cupL: ['.tdd', 'tdDD', 'dDDr', 'dDDr', 'dDDr', 'tdDD', '.tdd'],
    note1: ['.W', '.W', 'WW', 'W.'],
    note2: ['.WW', '.W.', 'WW.'],
    z1: ['WW', '.W', 'WW'],
    z2: ['WWW', '..W', '.W.', 'WWW'],
    z3: ['WWWW', '...W', '..W.', '.W..', 'WWWW'],
    flame1: ['..Y..', '.YO..', '.OOo.', 'OOYOo', 'oOYOo', '.oOo.'],
    flame2: ['.Y...', '.OY..', '.OOO.', 'oOYOO', 'oOYOo', '.oOo.'],
    flame3: ['...Y.', '..OY.', '.OOO.', 'OOYOo', 'oOYYo', '.oOo.'],
    drop: ['.W.', 'WWW', 'WWW', '.W.'],
    bang: ['YY', 'YY', 'YY', '..', 'YY'],
    bar: [
      'DDDDDDDDDDDDDD',
      'D............D',
      'D............D',
      'DDDDDDDDDDDDDD',
    ],
    paper: [
      'WWWWWWWW',
      'WvvvvvvW',
      'WWWWWWWW',
      'WvvvvvWW',
      'WWWWWWWW',
      'WvvvvvvW',
      'WWWWWWWW',
      'wwwwwwww',
    ],
    pencil: ['...R', '..Y.', '.Y..', 'K...'],
    heart: ['.r.r.', 'rrrrr', 'rrrrr', '.rrr.', '..r..'],
    spark: ['..Y..', '..Y..', 'YY.YY', '..Y..', '..Y..'],
    dot: ['WW', 'WW'],
    dotDim: ['ww', 'ww'],
  };

  // ── escenas ─────────────────────────────────────────────────────────────────────────────────
  // SCENES[name] = { loop, frames: [[ms, draw(g)]] }
  const S = {};
  const pose = (o, ...extra) => (g) => { const b = body(g, o); for (const e of extra) e(g, b); };

  // reposo: respira, parpadea, mira, mueve el pétalo
  S.idle = { loop: true, frames: [
    [1600, pose({})],
    [700, pose({ squash: 1 })],
    [1400, pose({})],
    [110, pose({ eyes: 'closed' })],
    [1500, pose({})],
    [800, pose({ eyes: 'left' })],
    [900, pose({ eyes: 'right' })],
    [260, pose({ top: 'twitch' })],
    [1300, pose({})],
    [700, pose({ squash: 1 })],
    [110, pose({ eyes: 'closed' })],
    [140, pose({})],
    [110, pose({ eyes: 'closed' })],
    [1800, pose({})],
  ] };

  // saludo
  S.hello = { loop: false, frames: [
    [200, pose({ armR: 'out', eyes: 'happy' })],
    [200, pose({ armR: 'wave1', eyes: 'happy' })],
    [200, pose({ armR: 'wave2', eyes: 'happy' })],
    [200, pose({ armR: 'wave1', eyes: 'happy' })],
    [200, pose({ armR: 'wave2', eyes: 'happy' })],
    [500, pose({ armR: 'down' })],
  ] };

  // mirando cómo escribes (el compositor queda abajo a la derecha)
  S.watch = { loop: true, frames: [
    [1500, pose({ eyes: 'downright' })],
    [110, pose({ eyes: 'closed' })],
    [1300, pose({ eyes: 'downright' })],
    [600, pose({ eyes: 'down' })],
    [900, pose({ eyes: 'downright', top: 'twitch' })],
  ] };

  // pensando: mira arriba y se encienden tres puntos
  const dots = (n) => (g, b) => {
    for (let i = 0; i < 3; i++) stamp(g, b.x0 + 19 + i * 4, b.y0 + 2 - i, i < n ? P.dot : P.dotDim);
  };
  S.thinking = { loop: true, frames: [
    [360, pose({ eyes: 'upright' }, dots(0))],
    [360, pose({ eyes: 'upright' }, dots(1))],
    [360, pose({ eyes: 'upright' }, dots(2))],
    [520, pose({ eyes: 'upright' }, dots(3))],
    [110, pose({ eyes: 'closed' }, dots(3))],
    [360, pose({ eyes: 'up' }, dots(0))],
    [360, pose({ eyes: 'up' }, dots(1))],
    [360, pose({ eyes: 'up' }, dots(2))],
    [520, pose({ eyes: 'up', top: 'twitch' }, dots(3))],
  ] };

  // tecleando en un portátil lleno de pegatinas; la pantalla le ilumina la cara
  function typing(k, eyes) {
    return (g) => {
      const b = body(g, { eyes: eyes || 'open', dy: k % 4 === 1 ? 1 : 0 });
      const ly = BY + 12;
      // screen light on the face, just above the lid (only on the body, never over the eyes)
      if (k % 3 !== 2) tint(g, b.x0 + 1, ly - 1, 14, 1, 'X', 'r');
      if (k % 3 === 0) tint(g, b.x0 + 3, ly - 2, 10, 1, 'X', 'r');
      stamp(g, b.x0 - 1, ly, P.laptop);
      stamp(g, b.x0 - 3, ly + 7, P.laptopBase);
      // the terminal sticker's cursor blinks
      if (k % 2) put(g, b.x0 + 12, ly + 3, 'K');
      // leaf hands reaching the keys, alternating
      stamp(g, b.x0 - 3, ly + 4 + (k % 2), ['LL', '.l']);
      stamp(g, b.x0 + 17, ly + 4 + ((k + 1) % 2), ['LL', 'l.']);
    };
  }
  S.typing = { loop: true, frames: [
    [150, typing(0)], [150, typing(1)], [150, typing(2)], [150, typing(3)], [150, typing(4)], [150, typing(5)],
    [150, typing(0)], [150, typing(1)], [500, typing(2, 'open')], [110, typing(2, 'closed')],
    [150, typing(3)], [150, typing(4)], [150, typing(5)], [150, typing(0)], [600, typing(1, 'downright')],
  ] };

  // café con vapor; sorbo por el hueco de los pétalos
  function coffee(k, eyes, sip) {
    return (g) => {
      const b = body(g, { eyes: eyes || 'open', armR: sip ? 'high' : 'out' });
      if (sip) {
        stamp(g, b.x0 + 18, BY - 2, P.mug);
      } else {
        stamp(g, b.x0 + 19, BY + 10, P.mug);
        stamp(g, b.x0 + 20, BY + 3 - (k % 2), k % 2 ? P.steam1 : P.steam2);
        stamp(g, b.x0 + 24, BY + 4 - (k % 2), k % 2 ? P.steam2 : P.steam1);
      }
    };
  }
  S.coffee = { loop: true, frames: [
    [420, coffee(0)], [420, coffee(1)], [420, coffee(0)], [420, coffee(1)], [110, coffee(1, 'closed')],
    [420, coffee(0)], [420, coffee(1)], [520, coffee(0, 'up', true)], [700, coffee(0, 'closed', true)],
    [500, coffee(0, 'happy')], [420, coffee(1, 'happy')], [420, coffee(0)],
  ] };

  // lata: la coge, se la echa por arriba y se pone a tope
  function can(stage, k) {
    return (g) => {
      if (stage === 'hold') {
        const b = body(g, { armR: 'hold' });
        stamp(g, b.x0 + 19, BY + 9, P.can);
      } else if (stage === 'lift') {
        const b = body(g, { armR: 'high', eyes: 'upright' });
        stamp(g, b.x0 + 18, BY - 4, P.can);
      } else if (stage === 'pour') {
        const b = body(g, { armR: 'high', eyes: 'closed' });
        stamp(g, b.x0 + 5, BY - 6, P.canPour);
        // drops fall into the notch between the petals
        put(g, b.x0 + 6, BY - 2 + (k % 2) * 2, 'Y');
        put(g, b.x0 + 7, BY + 1 - (k % 2), 'Y');
        put(g, b.x0 + 6, BY + 2, 'y');
      } else if (stage === 'buzz') {
        const j = k % 2 ? 1 : -1;
        const b = body(g, { dx: j, eyes: 'wide', armL: 'up', armR: 'up' });
        stamp(g, b.x0 - 8, BY + 2 + (k % 2), P.spark);
        stamp(g, b.x0 + 21, BY + 1 + ((k + 1) % 2), P.spark);
        stamp(g, BX + 22, BY + 16, P.canCrushed);
      }
    };
  }
  S.can = { loop: false, frames: [
    [600, can('hold')], [110, (g) => { const b = body(g, { armR: 'hold', eyes: 'closed' }); stamp(g, b.x0 + 19, BY + 9, P.can); }],
    [400, can('hold')], [420, can('lift')],
    [220, can('pour', 0)], [220, can('pour', 1)], [220, can('pour', 0)], [220, can('pour', 1)],
    [80, can('buzz', 0)], [80, can('buzz', 1)], [80, can('buzz', 0)], [80, can('buzz', 1)],
    [80, can('buzz', 0)], [80, can('buzz', 1)], [80, can('buzz', 0)], [80, can('buzz', 1)],
    [700, (g) => { const b = body(g, { eyes: 'wide' }); stamp(g, b.x0 + 22, BY + 16, P.canCrushed); }],
  ] };

  // pato de goma: le cuenta el bug
  function duck(k, eyes, talk) {
    return (g) => {
      const b = body(g, { eyes: eyes || 'right', armR: talk ? (k % 2 ? 'up' : 'out') : 'down' });
      stamp(g, b.x0 + 22, BY + 11, P.duck);
      if (talk) {
        stamp(g, b.x0 + 18, BY + 1, k % 2 ? P.dot : P.dotDim);
        stamp(g, b.x0 + 22, BY - 1, k % 2 ? P.dotDim : P.dot);
      }
    };
  }
  S.duck = { loop: true, frames: [
    [280, duck(0, 'right', true)], [280, duck(1, 'right', true)], [280, duck(0, 'right', true)],
    [280, duck(1, 'right', true)], [280, duck(0, 'right', true)], [900, duck(0, 'right')],
    [110, duck(0, 'closed')], [700, duck(0, 'upright')], [280, duck(1, 'right', true)], [280, duck(0, 'right', true)],
  ] };

  // leyendo con lupa: el ojo de detrás de la lente se ve enorme
  function reading(k) {
    return (g) => {
      const look = ['left', 'open', 'right', 'open'][k % 4];
      const b = body(g, { eyes: look, armR: 'out' });
      const lx = b.x0 + 7;
      const ly = BY + 9;
      // magnified eye: fill the lens with body and cut a big eye
      fill(g, lx + 1, ly + 1, 5, 5, 'X');
      fill(g, lx + 2 + (look === 'left' ? -1 : look === 'right' ? 1 : 0), ly + 1, 3, 5, '_');
      stamp(g, lx, ly, P.lens);
      stamp(g, lx + 6, ly + 6, P.lensHandle);
    };
  }
  S.reading = { loop: true, frames: [[520, reading(0)], [360, reading(1)], [520, reading(2)], [360, reading(3)]] };

  // esperando un comando largo: barra de progreso y pie que golpea el suelo
  function waiting(k, fillN) {
    return (g) => {
      const b = body(g, { eyes: k % 5 === 4 ? 'closed' : 'upright', legs: k % 2 ? 'stepR' : undefined });
      stamp(g, b.x0 + 18, BY - 2, P.bar);
      fill(g, b.x0 + 20, BY, Math.min(10, fillN), 1, 'G');
      fill(g, b.x0 + 20, BY - 1, Math.min(10, fillN), 1, 'G');
    };
  }
  S.waiting = { loop: true, frames: [] };
  for (let i = 0; i < 12; i++) S.waiting.frames.push([260, waiting(i, [1, 1, 2, 2, 3, 4, 4, 5, 6, 8, 9, 10][i])]);
  S.waiting.frames.push([600, waiting(12, 10)]);

  // concentrado con auriculares y notas de música
  function focus(k) {
    return (g) => {
      const bob = k % 2;
      const b = body(g, { eyes: k === 5 ? 'closed' : 'happy', dy: bob });
      stamp(g, b.x0 - 2, BY - 2 + bob, P.phones);
      stamp(g, b.x0 - 3, BY + 7 + bob, P.cupL);
      stamp(g, b.x0 + 15, BY + 7 + bob, P.cupL, true);
      stamp(g, b.x0 + 21 + (k % 3), BY + 2 - (k % 3), k % 2 ? P.note1 : P.note2);
    };
  }
  S.focus = { loop: true, frames: [[330, focus(0)], [330, focus(1)], [330, focus(2)], [330, focus(3)], [330, focus(4)], [150, focus(5)]] };

  // algo se ha roto: todo bien, todo en llamas
  function fine(k) {
    return (g) => {
      const b = body(g, { eyes: k === 7 ? 'closed' : 'squint', armR: 'out' });
      stamp(g, b.x0 + 19, BY + 10, P.mug);
      const fl = [P.flame1, P.flame2, P.flame3];
      stamp(g, b.x0 - 9, BY + 14, fl[k % 3]);
      stamp(g, b.x0 - 4, BY + 14, fl[(k + 1) % 3]);
      stamp(g, b.x0 + 29, BY + 14, fl[(k + 2) % 3]);
      if (k % 4 === 0) stamp(g, b.x0 + 20, BY + 3, P.steam1);
    };
  }
  S.fine = { loop: true, frames: [] };
  for (let i = 0; i < 8; i++) S.fine.frames.push([170, fine(i)]);

  // error breve: gota de sudor y exclamación
  S.oops = { loop: false, frames: [
    [120, pose({ eyes: 'wide', dy: -1 })],
    [500, pose({ eyes: 'wide' }, (g, b) => { stamp(g, b.x0 + 18, BY - 1, P.bang); stamp(g, b.x0 - 4, BY + 6, P.drop); })],
    [500, pose({ eyes: 'squint' }, (g, b) => { stamp(g, b.x0 - 4, BY + 8, P.drop); })],
    [300, pose({ eyes: 'half' })],
  ] };

  // terminó: florece y salta
  S.bloom = { loop: false, frames: [
    [140, pose({ squash: 2, eyes: 'happy' })],
    [140, pose({ top: 'half', eyes: 'happy', dy: -3 })],
    [200, pose({ top: 'bloom', eyes: 'happy', dy: -5, armL: 'up', armR: 'up' })],
    [140, pose({ top: 'bloom', eyes: 'happy', dy: -2, armL: 'high', armR: 'high' })],
    [120, pose({ top: 'bloom', eyes: 'happy', squash: 1, armL: 'out', armR: 'out' })],
    [900, pose({ top: 'bloom', eyes: 'happy' }, (g, b) => stamp(g, b.x0 + 19, BY - 1, P.heart))],
    [600, pose({ top: 'bloom', eyes: 'open' })],
    [220, pose({ top: 'half', eyes: 'open' })],
  ] };

  // uso de cortesía: mustio, escribiendo el traspaso
  function wilt(k) {
    return (g) => {
      const b = body(g, { top: 'wilt', eyes: k === 3 ? 'closed' : 'half', squash: 2, armR: 'hold' });
      stamp(g, b.x0 + 19, BY + 12, P.paper);
      stamp(g, b.x0 + 23 + (k % 2), BY + 9 + (k % 2), P.pencil);
      stamp(g, BX - 7, BY + 16, P.canCrushed);
    };
  }
  S.wilt = { loop: true, frames: [[380, wilt(0)], [380, wilt(1)], [380, wilt(0)], [140, wilt(3)], [380, wilt(1)]] };

  // dormido
  function sleep(k) {
    return (g) => {
      const b = body(g, { eyes: 'closed', squash: k % 2 ? 1 : 0 });
      const zs = [[b.x0 + 18, BY + 4, P.z1], [b.x0 + 22, BY - 1, P.z2], [b.x0 + 27, BY - 7, P.z3]];
      for (let i = 0; i <= k % 3; i++) stamp(g, zs[i][0], zs[i][1], zs[i][2]);
    };
  }
  S.sleep = { loop: true, frames: [[750, sleep(0)], [750, sleep(1)], [750, sleep(2)], [750, sleep(3)], [750, sleep(4)], [750, sleep(5)]] };

  // ── escenas nuevas: reacciones a la interfaz y estereotipos de programador ──────────────────
  Object.assign(P, {
    hardhat: [
      '....YYYYYYYY....',
      '..YYYYYYYYYYYY..',
      '.YYYYYyYYYYYYYY.',
      '.YYYYYyYYYYYYYY.',
      'yyyyyyyyyyyyyyyy',
      '.yyyyyyyyyyyyyy.',
    ],
    hammerUp: ['ddd.', 'ddd.', '.c..', '..c.', '...c'],
    hammerDown: ['....', 'c...', '.c..', '..cdd', '...dd'],
    pilotcap: [
      '....CCCCCCCC....',
      '..CCCCCCCCCCCC..',
      '.CCCcCCCCCCcCCC.',
      'CCCCCCCCCCCCCCCC',
    ],
    goggles: [
      'DDDDDDDDDDDDDDDD',
      '.tWWt....tWWt...',
      '.tWwt....tWwt...',
      '..tt......tt....',
    ],
    blueprint: [
      'wWWWWWWWWWWWw',
      'WvWWvWWvWWvWW',
      'WWWYYYWWWWWWW',
      'WvWWvYYvWWvWW',
      'WWWWWWYYYWWWW',
      'WvWWvWWvYvvWW',
      'wWWWWWWWWWWWw',
    ],
    shades: [
      'KKKKKKKKKKKKKKKK',
      '.KWKKKK..KWKKKK.',
      '..KKKK....KKKK..',
    ],
    headband: ['rrrrrrrrrrrrrrrr', 'qqqqqqqqqqqqqqqq'],
    tailA: ['rrr', '.rr', '..r'],
    tailB: ['r..', 'rrr', '.r.'],
    ear: ['.LL.', 'LLLl', 'LL.l', 'LLLl', '.LL.'],
    arc1: ['w.', '.w', '.w', 'w.'],
    arc2: ['w..', '.w.', '..w', '..w', '.w.', 'w..'],
    polaroid: [
      'WWWWWWWW',
      'WDDDDDDW',
      'WDDYDDDW',
      'WDdDDdDW',
      'WdLddLdW',
      'WLLLLLLW',
      'WWWWWWWW',
      'WWWWWWWW',
    ],
    sign: [
      'WWWWWWW',
      'WWYYYWW',
      'WWWWYWW',
      'WWWYYWW',
      'WWWWWWW',
      'WWWYWWW',
      'WWWWWWW',
      '...c...',
      '...c...',
    ],
    box: [
      'jjjjjjjjjjjjjjjjjj',
      'jkkkkkkkyykkkkkkkj',
      'jkkkkkkkyykkkkkkkj',
      'jkWWWWWWWWWWWkkkkj',
      'jkWvvvvvvvvvWkkkkj',
      'jkWWWWWWWWWWWkkkkj',
      'jkkkkkkkyykkkkkkkj',
      'jjjjjjjjjjjjjjjjjj',
    ],
    cube: ['.OOOO.', 'OOOOOo', 'OOWOOo', 'OOOOOo', 'OOOOOo', '.oooo.'],
    clipboard: ['..dd...', 'tWWWWWt', 'tWGWvvt', 'tWWWWWt', 'tWGWvvt', 'tWWWWWt', 'tWGWvvt', 'ttttttt'],
    bigcheck: ['.......GG', '......GG.', '.....GG..', 'GG..GG...', '.GGGG....', '..GG.....'],
    cross: ['rr...rr', '.rr.rr.', '..rrr..', '.rr.rr.', 'rr...rr'],
    binoculars: ['.dd..dd.', 'dDDddDDd', 'dWDddDWd', '.dd..dd.'],
    bin: ['ssssssss', '.tdddddt.', '.tdtdtdt', '.tdtdtdt', '.tdtdtdt', '..tttttt'],
    ball: ['.W.', 'WWW', '.W.'],
    wcan: ['..s.....', '.sSSs..s', 'sSSSSss.', 'sSSSSs..', '.ssss...'],
    phone: ['DDDD', 'DwwD', 'DWwD', 'DwWD', 'DwwD', 'DDDD'],
    one: ['.Y.', 'YY.', '.Y.', '.Y.', 'YYY'],
    em: ['Y...Y', 'YY.YY', 'Y.Y.Y', 'Y...Y', 'Y...Y'],
    bolt: ['..Y', '.Y.', 'YYY', '.Y.', 'Y..'],
    confetti: ['R...Y..G', '..G...W.', '.Y..R...', 'W....G.R'],
  });

  // walking along the input bar (the host app moves the sprite and mirrors it to walk left)
  S.walk = { loop: true, frames: [
    [150, pose({ eyes: 'right', legs: 'stepL' })],
    [150, pose({ eyes: 'right', dy: -1 })],
    [150, pose({ eyes: 'right', legs: 'stepR' })],
    [150, pose({ eyes: 'right', dy: -1 })],
  ] };

  // Build: casco de obra y martillo
  function build(k) {
    return (g) => {
      const b = body(g, { eyes: k % 2 ? 'squint' : 'open', armR: k % 2 ? 'out' : 'high', dy: k % 2 ? 1 : 0 });
      stamp(g, b.x0, b.y0 - 2, P.hardhat);
      stamp(g, b.x0 + 17, b.y0 + (k % 2 ? 9 : 1), k % 2 ? P.hammerDown : P.hammerUp);
      if (k % 2) { put(g, b.x0 + 22, b.y0 + 14, 'Y'); put(g, b.x0 + 24, b.y0 + 12, 'Y'); }
    };
  }
  S.build = { loop: false, frames: [[260, build(0)], [160, build(1)], [260, build(2)], [160, build(3)], [260, build(4)], [160, build(5)], [500, build(0)]] };

  // Copilot: gorra de piloto, gafas y pulgar arriba
  function copilot(k) {
    return (g) => {
      const b = body(g, { eyes: k === 2 ? 'happy' : 'open', armR: k >= 2 ? 'up' : 'out' });
      for (let y = 0; y < 4; y++) for (let x = -2; x < 20; x++) put(g, b.x0 + x, b.y0 + y, '_');
      stamp(g, b.x0, b.y0, P.pilotcap);
      stamp(g, b.x0, b.y0 + 4, P.goggles);
      if (k >= 2) stamp(g, b.x0 + 18, b.y0 + 5, ['LL', 'LL', 'l.']);
    };
  }
  S.copilot = { loop: false, frames: [[300, copilot(0)], [300, copilot(1)], [700, copilot(2)], [500, copilot(3)]] };

  // Plan: despliega el plano y lo estudia
  function plan(k) {
    return (g) => {
      const eyes = ['downright', 'down', 'downright', 'down'][k % 4];
      const b = body(g, { eyes, armL: 'out', armR: 'out' });
      stamp(g, b.x0 + 1, b.y0 + 11, P.blueprint);
      if (k % 2) put(g, b.x0 + 6 + k, b.y0 + 13 + (k % 3), 'r');
    };
  }
  S.plan = { loop: false, frames: [[420, plan(0)], [420, plan(1)], [420, plan(2)], [420, plan(3)], [300, plan(4)]] };

  // Esfuerzo bajo: las gafas de sol bajan solas ("deal with it")
  function low(k) {
    return (g) => {
      const b = body(g, { eyes: 'half' });
      const yy = [b.y0 - 8, b.y0 - 4, b.y0, b.y0 + 4, b.y0 + 8, b.y0 + 8][Math.min(k, 5)];
      stamp(g, b.x0, yy, P.shades);
    };
  }
  S.low = { loop: false, frames: [[140, low(0)], [140, low(1)], [140, low(2)], [140, low(3)], [900, low(4)], [300, low(5)]] };

  // Esfuerzo medio: asiente
  S.mid = { loop: false, frames: [[180, pose({ eyes: 'happy', dy: 1 })], [180, pose({ eyes: 'happy' })], [180, pose({ eyes: 'happy', dy: 1 })], [400, pose({})]] };

  // Esfuerzo alto: cinta en la frente al viento
  function high(k, ultra) {
    return (g) => {
      const b = body(g, { eyes: ultra ? 'wide' : 'squint', armL: k % 2 ? 'up' : 'down', armR: k % 2 ? 'up' : 'down' });
      stamp(g, b.x0, b.y0 + 5, P.headband);
      stamp(g, b.x0 - 3, b.y0 + 5 + (k % 2), k % 2 ? P.tailA : P.tailB);
      if (ultra) { stamp(g, b.x0 - 8, b.y0 + 2 + (k % 2), P.spark); stamp(g, b.x0 + 21, b.y0 + 3 - (k % 2), P.spark); }
    };
  }
  S.high = { loop: false, frames: [[220, high(0)], [220, high(1)], [220, high(2)], [220, high(3)], [500, high(4)]] };
  S.ultra = { loop: false, frames: [[160, high(0, 1)], [160, high(1, 1)], [160, high(2, 1)], [160, high(3, 1)], [160, high(4, 1)], [160, high(5, 1)], [500, high(6, 1)]] };

  // ── Omnisciente: transformación Super Saiyan ────────────────────────────────────────────────
  // A moment, not a mode: Capu charges, explodes into a golden flame aura that bursts out of the
  // stage (the scene keeps SSJ_OY extra rows above row 0), crackles for a while and powers down.
  const SSJ_OY = 18;
  const hash = (a, b) => (((a + 11) * 73856093) ^ ((b + 7) * 19349663)) >>> 0;
  const tri = (u) => 1 - Math.abs((u - Math.floor(u)) * 2 - 1);
  const sp = (g, x, y, c) => put(g, x, y + SSJ_OY, c);   // put in scene coordinates

  // the flame, in scene coordinates: power 0-1 grows it, k moves the tongues
  function flameMask(k, power) {
    const cx = BX + 7.5, cy = 16;
    const rx = 21 * power, ryUp = 22 * power, ryDown = 17;
    const tongues = 14 * power;
    const m = [];
    for (let y = -SSJ_OY; y < 28; y++) {
      const row = new Array(W).fill(false);
      for (let x = 0; x < W; x++) {
        const dx = x - cx;
        const r = rx + (power > 0.3 ? 1.4 * Math.sin(y * 0.55 + k * 1.9) : 0);
        if (r <= 0 || Math.abs(dx) > r) continue;
        const f = 1 - (dx / r) * (dx / r);
        if (y >= cy) { row[x] = (y - cy) <= ryDown * Math.sqrt(f); continue; }
        // above the middle: a dome with pointed tongues, taller in the centre, each on its own beat
        const u = dx / 5.5 + k * 0.37;
        const lift = tongues * f * (0.5 + 0.5 * ((hash(Math.floor(u), k >> 1) % 100) / 100)) * Math.pow(tri(u), 1.5);
        row[x] = y >= cy - ryUp * Math.sqrt(f) - lift;
      }
      m.push(row);
    }
    return m;
  }

  // paints the aura behind Capu in layers, like the flame sprites of the old fighting games: a
  // dithered ochre rim, gold, light gold with energy streaming upwards and a white-hot halo around
  // a thin dark outline that keeps the golden hair readable (`shape` = Capu alone on a spare grid)
  function paintAura(g, k, power, shape, solid) {
    const m = flameMask(k, power);
    const inside = (x, y) => { const r = m[y + SSJ_OY]; return !!(r && r[x]); };
    // depth: how many erosions each pixel survives (0 = on the edge), capped at 4
    let cur = m, depth = m.map((r) => r.map((v) => (v ? 0 : -1)));
    for (let d = 1; d <= 4; d++) {
      const nx = cur.map((r, j) => r.map((v, i) => v && i > 0 && i < W - 1 && j > 0 && j < cur.length - 1 &&
        r[i - 1] && r[i + 1] && cur[j - 1][i] && cur[j + 1][i]));
      nx.forEach((r, j) => r.forEach((v, i) => { if (v) depth[j][i] = d; }));
      cur = nx;
    }
    const near = (x, y, d) => {
      if (!shape) return false;
      for (let j = -d; j <= d; j++) for (let i = -d; i <= d; i++) if (at(shape, x + i, y + j)) return true;
      return false;
    };
    for (let y = -SSJ_OY; y < 28; y++) for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      if (solid) { sp(g, x, y, 'h'); continue; }
      const d = depth[y + SSJ_OY][x];
      const odd = (x + y + k) % 2 === 0;
      if (near(x, y, 1)) { sp(g, x, y, 'y'); continue; }
      if (near(x, y, 3)) { sp(g, x, y, 'h'); continue; }
      if (near(x, y, 4)) { sp(g, x, y, odd ? 'h' : 'g'); continue; }
      if (d === 0) { if (odd) sp(g, x, y, 'Y'); continue; }
      if (d === 1) { sp(g, x, y, 'Y'); continue; }
      if (d === 2) { sp(g, x, y, odd ? 'Y' : 'g'); continue; }
      const lane = hash(x, 3) % 5;
      sp(g, x, y, x % 2 === 0 && (y + 96 + k * 3 + lane * 2) % 8 < 3 ? 'h' : 'g');
    }
  }

  // a lightning crack: zigzag down from (x, y), scene coordinates
  function zap(g, x, y, n, seed) {
    let cx = x;
    for (let i = 0; i < n; i++) {
      sp(g, cx, y + i, 'e');
      if (i % 3 === 1) sp(g, cx + ((seed >> 3) & 1 ? 1 : -1), y + i, 'E');
      cx += (seed >> (i % 12)) & 1 ? 1 : -1;
    }
  }
  function zaps(g, k, count) {
    for (let j = 0; j < count; j++) {
      const s = hash(j, k);
      if (s % 4 === 0) continue;
      const left = j % 2 === 0;
      zap(g, left ? 3 + (s % 11) : 32 + (s % 13), -12 + ((s >> 4) % 26), 5 + ((s >> 9) % 6), s >> 2);
    }
  }

  // rocks torn from the ground float up past Capu
  function rocks(g, k) {
    const spots = [4, 9, 14, 33, 38, 44, 7, 41];
    spots.forEach((x, i) => {
      const y = 26 - ((k * 3 + i * 5) % 30);
      const big = i < 6;
      sp(g, x + (k + i) % 2, y, 't');
      if (big) { sp(g, x + 1 + (k + i) % 2, y, 'd'); sp(g, x + (k + i) % 2, y + 1, 'd'); sp(g, x + 1 + (k + i) % 2, y + 1, 'D'); }
    });
  }

  function tealEyes(g, b) {
    for (const [ex, ey, w, h] of eyeRects('open')) {
      fill(g, b.x0 + ex, b.y0 + ey, w, h, 'T');
      put(g, b.x0 + ex, b.y0 + ey, 'e');
    }
  }

  function ssjCharge(k) {
    return (g) => {
      const o = { dy: SSJ_OY, dx: k === 0 ? 0 : (k % 2 ? 1 : -1), squash: k === 0 ? 2 : 1, eyes: 'squint', armL: 'down', armR: 'down' };
      if (k >= 3) { const sh = blank(SSJ_OY); body(sh, o); paintAura(g, k, 0.14 + 0.07 * (k - 3), sh); }
      // energy gathering: sparks spiral in towards Capu
      for (let j = 0; j < 10; j++) {
        const ang = j * Math.PI / 5 + k * 0.5;
        const r = 26 - k * 4;
        sp(g, Math.round(BX + 7.5 + Math.cos(ang) * r), Math.round(15 + Math.sin(ang) * r * 0.75), j % 2 ? 'h' : 'e');
      }
      // pebbles start to float and dust kicks up at the feet
      for (const [x, i] of [[8, 0], [12, 1], [36, 2], [41, 3]]) sp(g, x, 27 - Math.max(0, k - 1 - (i % 2)), 't');
      if (k >= 1) { sp(g, 12, 27, 'w'); sp(g, 13, 26, 'w'); sp(g, 34, 27, 'w'); sp(g, 33, 26, 'w'); }
      const b = body(g, o);
      if (k === 3 || k === 5) tint(g, b.x0 - 1, b.y0, 18, 4, 'X', 'Y');
    };
  }

  function ssjBurst(k) {
    return (g) => {
      const o = { dy: SSJ_OY, top: 'saiyan', eyes: 'wide', armL: 'down', armR: 'down' };
      const sh = blank(SSJ_OY); body(sh, o);
      paintAura(g, k, k === 0 ? 0.85 : 1.08, sh, k === 0);
      // shockwave: rays out to the edges of the stage
      for (let j = 0; j < 16; j++) {
        const ang = j * Math.PI / 8 + 0.2;
        for (let r = k === 0 ? 14 : 22; r < 44; r += k === 0 ? 1 : 2) {
          const y = Math.round(12 + Math.sin(ang) * r * 0.8);
          if (y < 28) sp(g, Math.round(BX + 7.5 + Math.cos(ang) * r), y, r % 4 ? 'h' : 'g');
        }
      }
      body(g, o);
    };
  }

  function ssjFull(k) {
    return (g) => {
      const o = { dy: SSJ_OY, top: (k >> 1) % 2 ? 'saiyan2' : 'saiyan', eyes: 'open', armL: 'down', armR: 'down' };
      const sh = blank(SSJ_OY); body(sh, o);
      paintAura(g, k, 1, sh);
      zaps(g, k, 3);
      rocks(g, k);
      const b = body(g, o);
      tealEyes(g, b);
    };
  }

  function ssjDown(k) {
    return (g) => {
      const o = { dy: SSJ_OY, top: k === 0 ? 'saiyan' : 'bud', eyes: ['open', 'half', 'closed', 'open'][k], armL: k < 2 ? 'down' : undefined, armR: k < 2 ? 'down' : undefined, squash: k === 2 ? 1 : 0 };
      if (k < 2) { const sh = blank(SSJ_OY); body(sh, o); paintAura(g, k, k === 0 ? 0.55 : 0.22, sh); }
      const b = body(g, o);
      if (k === 0) tealEyes(g, b);
      if (k === 1) tint(g, b.x0 - 1, b.y0, 18, 4, 'X', 'Y');
      if (k >= 1) { stamp(g, b.x0 + 1, b.y0 - 6 + k, P.steam1); stamp(g, b.x0 + 12, b.y0 - 5 + k, P.steam2); }
    };
  }

  S.saiyan = { loop: false, fx: true, oy: SSJ_OY, frames: [
    [300, ssjCharge(0)], [110, ssjCharge(1)], [110, ssjCharge(2)], [100, ssjCharge(3)], [90, ssjCharge(4)], [90, ssjCharge(5)],
    [70, ssjBurst(0)], [110, ssjBurst(1)],
    ...Array.from({ length: 16 }, (_, k) => [95, ssjFull(k)]),
    [150, ssjDown(0)], [160, ssjDown(1)], [260, ssjDown(2)], [380, ssjDown(3)],
  ] };
  // vuelve a la normalidad (al bajar el esfuerzo)
  S.calm = { loop: false, frames: [[160, pose({ eyes: 'closed', squash: 1 })], [160, pose({ eyes: 'half' })], [300, pose({})]] };

  // Micrófono: se pone la hoja en la oreja y escucha; luego toma notas
  function listen(k) {
    return (g) => {
      const b = body(g, { eyes: k % 6 === 5 ? 'closed' : 'upright', armR: 'high' });
      stamp(g, b.x0 + 16, b.y0 + 4, P.ear);
      if (k % 2 === 0) stamp(g, b.x0 + 21, b.y0 + 5, P.arc1);
      stamp(g, b.x0 + 23, b.y0 + 4, k % 2 ? P.arc2 : P.arc1);
    };
  }
  S.listen = { loop: true, frames: [[300, listen(0)], [300, listen(1)], [300, listen(2)], [300, listen(3)], [300, listen(4)], [140, listen(5)]] };
  function notes(k) {
    return (g) => {
      const b = body(g, { eyes: 'downright', armR: 'out' });
      stamp(g, b.x0 + 19, b.y0 + 12, P.paper);
      stamp(g, b.x0 + 23 + (k % 2), b.y0 + 9 + (k % 2), P.pencil);
    };
  }
  S.notes = { loop: false, frames: [[220, notes(0)], [220, notes(1)], [220, notes(0)], [220, notes(1)], [220, notes(0)], [400, notes(1)]] };

  // Modelos: Gas sale disparado, Liquid surfea una ola, Solid se vuelve piedra y saca el 1M
  function gas(k) {
    return (g) => {
      const b = body(g, { eyes: 'right', dx: 2, legs: k % 2 ? 'stepL' : 'stepR' });
      for (const [yy, len] of [[6, 8], [10, 11], [14, 7]]) fill(g, b.x0 - 4 - len - (k % 2) * 2, b.y0 + yy, len, 1, 'w');
      stamp(g, b.x0 - 6 - (k % 3), b.y0 + 17, ['ZZ', 'Z.']);
    };
  }
  S.gas = { loop: false, frames: [[110, gas(0)], [110, gas(1)], [110, gas(2)], [110, gas(3)], [110, gas(4)], [110, gas(5)], [300, pose({ eyes: 'happy' })]] };
  function liquid(k) {
    return (g) => {
      const b = body(g, { eyes: 'happy', dy: k % 2 ? -1 : 0, armL: 'out', armR: 'out' });
      const wave = ['..WW......WW......WW......WW..', '.WBBW....WBBW....WBBW....WBBW.', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'];
      stamp(g, b.x0 - 7 - (k % 4) * 2, b.y0 + 17 - (k % 2 ? -1 : 0), wave);
      if (k % 2) { put(g, b.x0 - 3, b.y0 + 12, 'B'); put(g, b.x0 + 19, b.y0 + 11, 'B'); }
    };
  }
  S.liquid = { loop: false, frames: [[160, liquid(0)], [160, liquid(1)], [160, liquid(2)], [160, liquid(3)], [160, liquid(4)], [160, liquid(5)], [300, pose({ eyes: 'happy' })]] };
  function solid(k) {
    return (g) => {
      const stone = k < 3;
      const b = body(g, { eyes: stone ? 'closed' : 'happy', armL: stone ? undefined : 'high', armR: stone ? undefined : 'high', squash: k === 3 ? 1 : 0 });
      if (stone) {
        tint(g, 0, 0, 54, 36, 'X', 'S');
        tint(g, 0, 0, 54, 36, 'x', 't');
        put(g, b.x0 + 5, b.y0 + 6, 't'); put(g, b.x0 + 6, b.y0 + 7, 't'); put(g, b.x0 + 6, b.y0 + 8, 't');
        put(g, b.x0 + 11, b.y0 + 13, 't'); put(g, b.x0 + 10, b.y0 + 14, 't');
        if (k === 2) { put(g, b.x0 - 2, b.y0 + 17, 'Z'); put(g, b.x0 + 17, b.y0 + 17, 'Z'); }
      } else {
        stamp(g, b.x0 + 19, b.y0 - 6, P.one);
        stamp(g, b.x0 + 23, b.y0 - 6, P.em);
      }
    };
  }
  S.solid = { loop: false, frames: [[260, solid(0)], [260, solid(1)], [160, solid(2)], [120, solid(3)], [900, solid(4)]] };

  // Imagen adjunta: mira la foto
  S.photo = { loop: false, frames: [
    [300, pose({ eyes: 'right', armR: 'out' }, (g, b) => stamp(g, b.x0 + 19, b.y0 + 7, P.polaroid))],
    [900, pose({ eyes: 'upright', armR: 'out' }, (g, b) => stamp(g, b.x0 + 19, b.y0 + 7, P.polaroid))],
    [110, pose({ eyes: 'closed', armR: 'out' }, (g, b) => stamp(g, b.x0 + 19, b.y0 + 7, P.polaroid))],
    [500, pose({ eyes: 'right', armR: 'out' }, (g, b) => stamp(g, b.x0 + 19, b.y0 + 7, P.polaroid))],
  ] };

  // Detener: manos arriba
  S.halt = { loop: false, frames: [
    [120, pose({ eyes: 'wide', dy: -2, armL: 'high', armR: 'high' })],
    [600, pose({ eyes: 'wide', armL: 'high', armR: 'high' }, (g, b) => stamp(g, b.x0 + 19, b.y0 - 2, P.bang))],
    [300, pose({ eyes: 'half' })],
  ] };

  // Esperando tu aprobación: cartel con interrogación
  function ask(k) {
    return (g) => {
      const b = body(g, { eyes: k === 3 ? 'closed' : 'downright', armR: 'out', legs: k % 2 ? 'stepR' : undefined });
      stamp(g, b.x0 + 18, b.y0 + 3 + (k % 2 ? 0 : 1), P.sign);
    };
  }
  S.ask = { loop: true, frames: [[380, ask(0)], [380, ask(1)], [380, ask(0)], [120, ask(3)], [380, ask(1)]] };

  // npm install: levanta una caja de node_modules enorme
  function npm(k) {
    return (g) => {
      const b = body(g, { eyes: k % 4 === 3 ? 'closed' : 'squint', squash: 2, armL: 'high', armR: 'high', dx: k % 2 ? 1 : 0 });
      stamp(g, b.x0 - 1 + (k % 2), 2, P.box);
      if (k % 3 === 0) stamp(g, b.x0 - 4, b.y0 + 6, P.drop);
    };
  }
  S.npm = { loop: true, frames: [[300, npm(0)], [300, npm(1)], [300, npm(2)], [300, npm(3)], [300, npm(4)], [300, npm(5)]] };

  // git push: empuja el commit
  function git(k) {
    return (g) => {
      const b = body(g, { eyes: 'right', armR: 'out', dx: k % 4, legs: k % 2 ? 'stepL' : 'stepR' });
      stamp(g, b.x0 + 20, b.y0 + 13, P.cube);
      if (k % 2) stamp(g, b.x0 - 3, b.y0 + 17, ['Z.', '.Z']);
    };
  }
  S.git = { loop: true, frames: [[200, git(0)], [200, git(1)], [200, git(2)], [200, git(3)], [500, git(3)]] };

  // tests: repasa la lista; pasan (check y confeti) o fallan (se tapa la cara)
  function tests(k) {
    return (g) => {
      const b = body(g, { eyes: k % 3 === 2 ? 'closed' : 'downright', armR: 'out' });
      stamp(g, b.x0 + 18, b.y0 + 8, P.clipboard);
      stamp(g, b.x0 + 24, b.y0 + 9 + (k % 3) * 2, P.pencil);
    };
  }
  S.tests = { loop: true, frames: [[300, tests(0)], [300, tests(1)], [300, tests(2)], [300, tests(3)]] };
  S.pass = { loop: false, frames: [
    [160, pose({ eyes: 'happy', dy: -3, armL: 'high', armR: 'high' }, (g, b) => stamp(g, b.x0 + 4, 0, P.bigcheck))],
    [160, pose({ eyes: 'happy', armL: 'up', armR: 'up' }, (g, b) => { stamp(g, b.x0 + 4, 0, P.bigcheck); stamp(g, b.x0 - 6, b.y0 + 2, P.confetti); })],
    [600, pose({ eyes: 'happy' }, (g, b) => { stamp(g, b.x0 + 4, 0, P.bigcheck); stamp(g, b.x0 - 6, b.y0 + 5, P.confetti); stamp(g, b.x0 + 14, b.y0 + 3, P.confetti); })],
    [300, pose({ eyes: 'happy' })],
  ] };
  S.fail = { loop: false, frames: [
    [200, pose({ eyes: 'wide' }, (g, b) => stamp(g, b.x0 + 19, b.y0 - 3, P.cross))],
    [900, pose({ eyes: 'closed', armL: 'up' }, (g, b) => { stamp(g, b.x0 + 19, b.y0 - 3, P.cross); stamp(g, b.x0 + 1, b.y0 + 7, ['LLLLLL', 'lLLLLL', '.LLLL.']); })],
    [300, pose({ eyes: 'half' })],
  ] };

  // web: prismáticos
  function web(k) {
    return (g) => {
      const b = body(g, { eyes: 'open', armL: 'up', armR: 'up' });
      stamp(g, b.x0 + 4 + [-1, 0, 1, 0][k % 4], b.y0 + 7, P.binoculars);
    };
  }
  S.web = { loop: true, frames: [[420, web(0)], [360, web(1)], [420, web(2)], [360, web(3)]] };

  // borrar: tira la bola de papel a la papelera
  S.trash = { loop: false, frames: [
    [200, pose({ eyes: 'right', armR: 'up' }, (g, b) => { stamp(g, b.x0 + 26, b.y0 + 13, P.bin); stamp(g, b.x0 + 18, b.y0 + 6, P.ball); })],
    [160, pose({ eyes: 'right', armR: 'out' }, (g, b) => { stamp(g, b.x0 + 26, b.y0 + 13, P.bin); stamp(g, b.x0 + 23, b.y0 + 4, P.ball); })],
    [160, pose({ eyes: 'right' }, (g, b) => { stamp(g, b.x0 + 26, b.y0 + 13, P.bin); stamp(g, b.x0 + 28, b.y0 + 9, P.ball); })],
    [500, pose({ eyes: 'happy' }, (g, b) => stamp(g, b.x0 + 26, b.y0 + 13, P.bin))],
  ] };

  // gags de reposo: se riega a sí mismo, se estira, mira el móvil
  function water(k) {
    return (g) => {
      const b = body(g, { eyes: k >= 4 ? 'happy' : 'up', armR: 'high', top: k >= 5 ? 'twitch' : undefined });
      stamp(g, b.x0 + 12, b.y0 - 6, P.wcan);
      if (k >= 1 && k <= 4) { put(g, b.x0 + 11, b.y0 - 2 + (k % 2), 'B'); put(g, b.x0 + 9, b.y0 - 1 + ((k + 1) % 2), 'B'); put(g, b.x0 + 10, b.y0 + 1, 'B'); }
    };
  }
  S.water = { loop: false, frames: [[400, water(0)], [200, water(1)], [200, water(2)], [200, water(3)], [200, water(4)], [600, water(5)], [300, pose({ eyes: 'happy' })]] };
  S.stretch = { loop: false, frames: [
    [300, pose({ eyes: 'closed', armL: 'up', armR: 'up' })],
    [600, pose({ eyes: 'closed', dy: -2, armL: 'high', armR: 'high' })],
    [300, pose({ eyes: 'closed', squash: 1 })],
    [400, pose({ eyes: 'half' })],
    [300, pose({})],
  ] };
  function phone(k) {
    return (g) => {
      const b = body(g, { eyes: k === 4 ? 'closed' : 'downright', armR: 'out' });
      const scr = k % 2 ? ['DDDD', 'DWwD', 'DwwD', 'DwWD', 'DwwD', 'DDDD'] : P.phone;
      stamp(g, b.x0 + 18, b.y0 + 10, scr);
    };
  }
  S.phone = { loop: true, frames: [[500, phone(0)], [300, phone(1)], [500, phone(2)], [300, phone(3)], [120, phone(4)]] };

  // ── fotogramas ──────────────────────────────────────────────────────────────────────────────
  function sceneDuration(name) {
    const s = S[name] || S.idle;
    return s.frames.reduce((a, f) => a + f[0], 0);
  }
  function frameIndex(name, t) {
    const s = S[name] || S.idle;
    const total = sceneDuration(name);
    let tt = s.loop ? (t % total) : Math.min(t, total - 1);
    for (let i = 0; i < s.frames.length; i++) {
      if (tt < s.frames[i][0]) return i;
      tt -= s.frames[i][0];
    }
    return s.frames.length - 1;
  }
  function frameAt(name, i) {
    const s = S[name] || S.idle;
    const g = blank(s.oy);
    s.frames[Math.max(0, Math.min(i, s.frames.length - 1))][1](g);
    return g;
  }
  function frame(name, t) { return frameAt(name, frameIndex(name, t || 0)); }

  function bbox(grids) {
    let x1 = Infinity, y1 = Infinity, x2 = -1, y2 = -1;
    for (const g of grids) for (let gy = 0; gy < g.length; gy++) for (let x = 0; x < g[gy].length; x++) if (g[gy][x]) {
      const y = gy - (g.oy || 0);
      if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y;
    }
    return x2 < 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
  }
  // A crop that contains every frame of the given scenes (so the sprite never jumps). Scenes that
  // burst out of the stage (fx) only count when nothing else is asked for: they overflow the box.
  function sceneBox(names, pad) {
    const grids = [];
    const calm = names.filter((n) => !(S[n] || S.idle).fx);
    if (calm.length) names = calm;
    for (const n of names) for (let i = 0; i < (S[n] || S.idle).frames.length; i++) grids.push(frameAt(n, i));
    const b = bbox(grids);
    pad = pad || 0;
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  }

  // Same, but symmetric around the body so a centred Capu stays centred.
  function centeredBox(names, pad) {
    const b = sceneBox(names, pad);
    const cx = BX + 8;
    const half = Math.max(cx - b.x, b.x + b.w - cx);
    return { x: cx - half, y: b.y, w: half * 2, h: b.h };
  }

  // ── salida ──────────────────────────────────────────────────────────────────────────────────
  // opts.bleed: also draw what falls outside the crop (fx scenes), overflowing the <svg> box.
  function toSVG(g, opts) {
    opts = opts || {};
    const px = opts.px || 4;
    const oy = g.oy || 0;
    const gw = g[0].length;
    const box = opts.crop || { x: 0, y: -oy, w: gw, h: g.length };
    const pal = Object.assign({}, PAL, opts.palette || {});
    const x0 = opts.bleed ? 0 : Math.max(0, box.x), x1 = opts.bleed ? gw : Math.min(gw, box.x + box.w);
    let rects = '', out = false;
    for (let gy = 0; gy < g.length; gy++) {
      const y = gy - oy;
      const inY = y >= box.y && y < box.y + box.h;
      if (!inY && !opts.bleed) continue;
      const row = g[gy];
      let x = x0;
      while (x < x1) {
        const c = row[x];
        if (!c) { x++; continue; }
        let x2 = x;
        while (x2 + 1 < x1 && row[x2 + 1] === c) x2++;
        if (!inY || x < box.x || x2 >= box.x + box.w) out = true;
        rects += `<rect x="${x - box.x}" y="${y - box.y}" width="${x2 - x + 1}" height="1" fill="${opts.mono || pal[c] || c}"/>`;
        x = x2 + 1;
      }
    }
    const dims = opts.fluid ? 'width="100%" height="100%"' : `width="${box.w * px}" height="${box.h * px}"`;
    const title = opts.title ? `<title>${opts.title}</title>` : '';
    const role = opts.title ? ' role="img"' : ' aria-hidden="true"';
    const over = out ? ' overflow="visible" style="overflow:visible;pointer-events:none"' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.w} ${box.h}" ${dims} shape-rendering="crispEdges"${role}${over}>${title}${rects}</svg>`;
  }

  function rgb(h) { const n = parseInt(h.slice(1, 7), 16); return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`; }
  /** Terminal: one character = 1 column × 2 rows of pixels (▀ ▄ █). */
  function toANSI(g, opts) {
    opts = opts || {};
    const box = opts.crop || bbox([g]);
    const pal = Object.assign({}, PAL, opts.palette || {});
    const color = opts.color !== false;
    const lines = [];
    const start = box.y - (box.h % 2);
    for (let y = start; y < box.y + box.h; y += 2) {
      let line = opts.indent || '';
      let last = '';
      for (let x = box.x; x < box.x + box.w; x++) {
        const a = at(g, x, y);
        const b = at(g, x, y + 1);
        let ch, code;
        if (!a && !b) { ch = ' '; code = '\x1b[0m'; }
        else if (a && b && a === b) { ch = '█'; code = `\x1b[0m\x1b[38;2;${rgb(pal[a])}m`; }
        else if (a && b) { ch = '▀'; code = `\x1b[38;2;${rgb(pal[a])}m\x1b[48;2;${rgb(pal[b])}m`; }
        else if (a) { ch = '▀'; code = `\x1b[0m\x1b[38;2;${rgb(pal[a])}m`; }
        else { ch = '▄'; code = `\x1b[0m\x1b[38;2;${rgb(pal[b])}m`; }
        if (color && code !== last) { line += code; last = code; }
        line += ch;
      }
      if (color) line += '\x1b[0m';
      lines.push(line);
    }
    return lines;
  }

  // ── reproductor DOM ─────────────────────────────────────────────────────────────────────────
  function Player(el, opts) {
    this.el = el;
    this.opts = Object.assign({ px: 3, crop: null, fluid: false }, opts || {});
    this.scene = null;
    this.t0 = 0;
    this.last = -1;
    this.timer = null;
    this.onEnd = null;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.play(this.opts.scene || 'idle');
  }
  Player.prototype.play = function (scene, onEnd) {
    if (!S[scene]) scene = 'idle';
    if (scene === this.scene && this.timer && !onEnd) return this;
    this.scene = scene;
    this.onEnd = onEnd || null;
    this.t0 = Date.now();
    this.last = -1;
    this._tick();
    return this;
  };
  Player.prototype._render = function (i) {
    this.el.innerHTML = toSVG(frameAt(this.scene, i), { px: this.opts.px, crop: this.opts.crop || undefined, fluid: this.opts.fluid, bleed: this.opts.bleed !== false && !!S[this.scene].fx });
  };
  Player.prototype._tick = function () {
    clearTimeout(this.timer);
    this.timer = null;
    const s = S[this.scene];
    const total = sceneDuration(this.scene);
    const t = Date.now() - this.t0;
    const i = this.reduced ? (s.loop ? 0 : s.frames.length - 1) : frameIndex(this.scene, t);
    if (i !== this.last) { this.last = i; this._render(i); }
    if (!s.loop && (t >= total || this.reduced)) {
      const cb = this.onEnd; this.onEnd = null;
      if (cb) cb();
      return;
    }
    if (this.reduced) return;
    let acc = 0, next = 100;
    const tt = s.loop ? t % total : t;
    for (const f of s.frames) { acc += f[0]; if (acc > tt) { next = acc - tt; break; } }
    this.timer = setTimeout(() => this._tick(), Math.max(30, next));
  };
  Player.prototype.stop = function () { clearTimeout(this.timer); this.timer = null; };

  /**
   * Director: turns agent activity into scenes, with occasional gags so it does not loop the same
   * animation for minutes. set(state) with: idle | thinking | writing | reading | running | error |
   * done | grace | exhausted | debugging.
   */
  // Work states hold their scene for a minimum time, so a 0.2 s tool call never flashes a scene.
  const WORK = new Set(['thinking', 'writing', 'reading', 'running', 'web', 'npm', 'git', 'tests', 'debugging']);
  const MIN_HOLD = 2200;
  function Director(player, opts) {
    this.p = player;
    this.opts = Object.assign({ sleepAfter: 60000 }, opts || {});
    this.state = 'idle';
    this.since = 0;
    this.gagTimer = null;
    this.idleTimer = null;
    this.holdTimer = null;
    this.pending = null;
    this.reacting = false;
    this.paused = false;
    this.set('idle');
  }
  Director.prototype._base = function (state) {
    return {
      idle: 'idle', thinking: 'thinking', writing: 'typing', reading: 'reading', running: 'waiting',
      debugging: 'duck', grace: 'wilt', exhausted: 'sleep', done: 'idle', error: 'idle', watch: 'watch',
      listening: 'listen', approval: 'ask', web: 'web', npm: 'npm', git: 'git', tests: 'tests',
    }[state] || 'idle';
  };
  Director.prototype.set = function (state) {
    const prev = this.state;
    if (state === prev && state !== 'done' && state !== 'error') { this.pending = null; return; }
    // between two work scenes, keep the current one on screen for a moment
    if (WORK.has(prev) && WORK.has(state) && Date.now() - this.since < MIN_HOLD) {
      this.pending = state;
      if (!this.holdTimer) {
        this.holdTimer = setTimeout(() => {
          this.holdTimer = null;
          const next = this.pending;
          this.pending = null;
          if (next) this.set(next);
        }, MIN_HOLD - (Date.now() - this.since));
      }
      return;
    }
    this.pending = null;
    if (state === 'error') this._afterError = (prev === 'error' || prev === 'done' || prev === 'hello') ? 'idle' : prev;
    this.state = state;
    this.since = Date.now();
    clearTimeout(this.gagTimer);
    clearTimeout(this.idleTimer);
    if (this.reacting) return;           // the reaction on screen finishes first, then shows this state
    if (state === 'done') { this._oneShot('bloom', () => this.set('idle')); return; }
    if (state === 'error') { this._oneShot('oops', () => this.set(this._afterError || 'thinking')); return; }
    if (state === 'hello') { this._oneShot('hello', () => this.set('idle')); return; }
    this.p.play(this._base(state));
    this._scheduleGag();
  };
  Director.prototype._oneShot = function (scene, after) {
    this.p.play(scene, after);
  };
  /** A reaction to something the user did (mode, effort, model, mic, image…): plays now, then back. */
  Director.prototype.react = function (scene, after) {
    if (!S[scene]) return;
    clearTimeout(this.gagTimer);
    clearTimeout(this.idleTimer);
    this.reacting = true;
    this.p.play(scene, () => {
      this.reacting = false;
      if (after) after();
      this.since = Date.now();
      this.p.play(this._base(this.state));
      this._scheduleGag();
    });
  };
  Director.prototype.pause = function () { this.paused = true; clearTimeout(this.gagTimer); clearTimeout(this.idleTimer); };
  Director.prototype.resume = function () {
    this.paused = false;
    if (!this.reacting) { this.p.play(this._base(this.state)); this._scheduleGag(); }
  };
  Director.prototype._scheduleGag = function () {
    if (this.paused) return;
    const st = this.state;
    const gags = {
      idle: [['coffee', 7000], ['duck', 5000], ['focus', 6000], ['can', 0], ['hello', 0], ['reading', 4000],
        ['water', 0], ['stretch', 0], ['phone', 5000]],
      thinking: [['coffee', 6000], ['can', 0]],
      writing: [['focus', 6000], ['coffee', 5000]],
      running: [['coffee', 6000], ['can', 0], ['focus', 5000], ['phone', 4000]],
      debugging: [['fine', 5000], ['coffee', 5000]],
      reading: [['coffee', 4000]],
    }[st];
    if (st === 'idle') {
      this.idleTimer = setTimeout(() => { if (this.state === 'idle' && !this.paused && !this.reacting) this.p.play('sleep'); }, this.opts.sleepAfter);
    }
    if (!gags) return;
    const wait = st === 'idle' ? 15000 + Math.random() * 20000 : 9000 + Math.random() * 9000;
    this.gagTimer = setTimeout(() => {
      if (this.state !== st || this.paused || this.reacting) return;
      if (this.opts.onGag && this.opts.onGag(st) === false) { this._scheduleGag(); return; }
      const [name, dur] = gags[Math.floor(Math.random() * gags.length)];
      const back = () => { if (this.state === st && !this.reacting) { this.p.play(this._base(st)); this._scheduleGag(); } };
      if (dur) { this.p.play(name); this.gagTimer = setTimeout(back, dur); }
      else this.p.play(name, back);
    }, wait);
  };
  /** A click on Capu: an instant trick, then back to whatever it was doing. */
  Director.prototype.poke = function () {
    const pick = ['hello', 'can', 'oops', 'bloom', 'water', 'stretch', 'pass'][Math.floor(Math.random() * 7)];
    this.react(pick);
  };
  Director.prototype.stop = function () { clearTimeout(this.gagTimer); clearTimeout(this.idleTimer); clearTimeout(this.holdTimer); this.p.stop(); };

  return {
    PAL, W, H, SCENES: S, P, TOPS, base, blank, at, put, stamp, fill, body, frame, frameAt, frameIndex,
    sceneDuration, bbox, sceneBox, centeredBox, toSVG, toANSI, Player, Director,
  };
}));
