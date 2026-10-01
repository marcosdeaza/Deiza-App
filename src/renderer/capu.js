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

  function blank() {
    const g = [];
    for (let y = 0; y < H; y++) g.push(new Array(W).fill(null));
    return g;
  }
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
  const TOP_OFF = { bloom: [-2, -2], wilt: [-4, 0] };

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
      'tddddddddddddddddt',
      'tdrRrddddddddddddt',
      'tdRqRdddddKKKKKddt',
      'tdrRrdddddKGKKKddt',
      'tdddddddddKKGGKddt',
      'tddddddddddddddddt',
      'tddYddddwwwwdddddt',
      'tdYYYdddwvvwdddddt',
      'tddYddddddddddddDt',
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
      const b = body(g, { eyes: eyes || 'down', dy: k % 4 === 1 ? 1 : 0 });
      const ly = BY + 13;
      // screen light on the face, just above the lid
      if (k % 3 !== 2) fill(g, b.x0 + 1, ly - 1, 14, 1, 'r');
      if (k % 3 === 0) fill(g, b.x0 + 3, ly - 2, 10, 1, 'r');
      stamp(g, b.x0 - 1, ly, P.laptop);
      stamp(g, b.x0 - 3, ly + 11, P.laptopBase);
      // the terminal sticker's cursor blinks
      if (k % 2) put(g, b.x0 + 12, ly + 5, 'K');
      // leaf hands reaching the keys, alternating
      stamp(g, b.x0 - 3, ly + 7 + (k % 2), ['LL', '.l']);
      stamp(g, b.x0 + 17, ly + 7 + ((k + 1) % 2), ['LL', 'l.']);
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
      const b = body(g, { eyes: eyes || 'open', armR: sip ? 'high' : 'hold' });
      if (sip) {
        stamp(g, b.x0 + 18, BY - 2, P.mug);
      } else {
        stamp(g, b.x0 + 19, BY + 14, P.mug);
        stamp(g, b.x0 + 20, BY + 7 - (k % 2), k % 2 ? P.steam1 : P.steam2);
        stamp(g, b.x0 + 24, BY + 8 - (k % 2), k % 2 ? P.steam2 : P.steam1);
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
      const b = body(g, { eyes: k === 7 ? 'closed' : 'squint', armR: 'hold' });
      stamp(g, b.x0 + 19, BY + 14, P.mug);
      const fl = [P.flame1, P.flame2, P.flame3];
      stamp(g, b.x0 - 9, BY + 14, fl[k % 3]);
      stamp(g, b.x0 - 4, BY + 16, fl[(k + 1) % 3]);
      stamp(g, b.x0 + 29, BY + 14, fl[(k + 2) % 3]);
      if (k % 4 === 0) stamp(g, b.x0 + 20, BY + 7, P.steam1);
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
      stamp(g, BX - 7, BY + 17, P.canCrushed);
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
    const g = blank();
    s.frames[Math.max(0, Math.min(i, s.frames.length - 1))][1](g);
    return g;
  }
  function frame(name, t) { return frameAt(name, frameIndex(name, t || 0)); }

  function bbox(grids) {
    let x1 = Infinity, y1 = Infinity, x2 = -1, y2 = -1;
    for (const g of grids) for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x]) {
      if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y;
    }
    return x2 < 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
  }
  // A crop that contains every frame of the given scenes (so the sprite never jumps).
  function sceneBox(names, pad) {
    const grids = [];
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
  function toSVG(g, opts) {
    opts = opts || {};
    const px = opts.px || 4;
    const gh = g.length, gw = g[0].length;
    const box = opts.crop || { x: 0, y: 0, w: gw, h: gh };
    const pal = Object.assign({}, PAL, opts.palette || {});
    let rects = '';
    for (let y = box.y; y < box.y + box.h; y++) {
      let x = box.x;
      while (x < box.x + box.w) {
        const c = g[y] && g[y][x];
        if (!c) { x++; continue; }
        let x2 = x;
        while (x2 + 1 < box.x + box.w && g[y][x2 + 1] === c) x2++;
        rects += `<rect x="${x - box.x}" y="${y - box.y}" width="${x2 - x + 1}" height="1" fill="${opts.mono || pal[c] || c}"/>`;
        x = x2 + 1;
      }
    }
    const dims = opts.fluid ? 'width="100%" height="100%"' : `width="${box.w * px}" height="${box.h * px}"`;
    const title = opts.title ? `<title>${opts.title}</title>` : '';
    const role = opts.title ? ' role="img"' : ' aria-hidden="true"';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.w} ${box.h}" ${dims} shape-rendering="crispEdges"${role}>${title}${rects}</svg>`;
  }

  function rgb(h) { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`; }
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
        const a = (g[y] && g[y][x]) || null;
        const b = (g[y + 1] && g[y + 1][x]) || null;
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
    this.el.innerHTML = toSVG(frameAt(this.scene, i), { px: this.opts.px, crop: this.opts.crop || undefined, fluid: this.opts.fluid });
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
  function Director(player, opts) {
    this.p = player;
    this.opts = Object.assign({ sleepAfter: 60000 }, opts || {});
    this.state = 'idle';
    this.since = Date.now();
    this.gagTimer = null;
    this.idleTimer = null;
    this.set('idle');
  }
  Director.prototype._base = function (state) {
    return {
      idle: 'idle', thinking: 'thinking', writing: 'typing', reading: 'reading', running: 'waiting',
      debugging: 'duck', grace: 'wilt', exhausted: 'sleep', done: 'idle', error: 'idle', watch: 'watch',
    }[state] || 'idle';
  };
  Director.prototype.set = function (state) {
    const prev = this.state;
    if (state === prev && state !== 'done' && state !== 'error') return;
    if (state === 'error') this._afterError = (prev === 'error' || prev === 'done' || prev === 'hello') ? 'idle' : prev;
    this.state = state;
    this.since = Date.now();
    clearTimeout(this.gagTimer);
    clearTimeout(this.idleTimer);
    if (state === 'done') { this.p.play('bloom', () => this.set('idle')); return; }
    if (state === 'error') { this.p.play('oops', () => this.set(this._afterError || 'thinking')); return; }
    if (state === 'hello') { this.p.play('hello', () => this.set('idle')); return; }
    this.p.play(this._base(state));
    this._scheduleGag();
  };
  Director.prototype._scheduleGag = function () {
    const st = this.state;
    const gags = {
      idle: [['coffee', 7000], ['duck', 5000], ['focus', 6000], ['can', 0], ['hello', 0], ['reading', 4000]],
      thinking: [['coffee', 6000], ['can', 0]],
      writing: [['focus', 6000], ['coffee', 5000]],
      running: [['coffee', 6000], ['can', 0], ['focus', 5000]],
      debugging: [['fine', 5000], ['coffee', 5000]],
      reading: [['coffee', 4000]],
    }[st];
    if (st === 'idle') {
      this.idleTimer = setTimeout(() => { if (this.state === 'idle') this.p.play('sleep'); }, this.opts.sleepAfter);
    }
    if (!gags) return;
    const wait = st === 'idle' ? 14000 + Math.random() * 22000 : 9000 + Math.random() * 9000;
    this.gagTimer = setTimeout(() => {
      if (this.state !== st) return;
      const [name, dur] = gags[Math.floor(Math.random() * gags.length)];
      const back = () => { if (this.state === st) { this.p.play(this._base(st)); this._scheduleGag(); } };
      if (dur) { this.p.play(name); this.gagTimer = setTimeout(back, dur); }
      else this.p.play(name, back);
    }, wait);
  };
  /** A gag right now (a click on Capu), then back to whatever it was doing. */
  Director.prototype.poke = function () {
    const st = this.state;
    const pick = ['hello', 'can', 'oops', 'bloom'][Math.floor(Math.random() * 4)];
    clearTimeout(this.gagTimer);
    clearTimeout(this.idleTimer);
    this.p.play(pick, () => { if (this.state === st) { this.p.play(this._base(st)); this._scheduleGag(); } });
  };
  Director.prototype.stop = function () { clearTimeout(this.gagTimer); clearTimeout(this.idleTimer); this.p.stop(); };

  return {
    PAL, W, H, SCENES: S, P, TOPS, base, blank, put, stamp, fill, body, frame, frameAt, frameIndex,
    sceneDuration, bbox, sceneBox, centeredBox, toSVG, toANSI, Player, Director,
  };
}));
