/**
 * Capu — la mascota de Deiza Code, en la terminal.
 *
 * Un capullo de rosa hecho bloque: ocho píxeles de ancho, el pétalo izquierdo más alto y dos ojos
 * que son huecos. En la terminal se pinta con medios bloques (un carácter = 1×2 píxeles), así que
 * ocupa 8 columnas y 5 filas. La versión animada con props (portátil, café, lata, pato de goma)
 * vive en la app de escritorio y en deiza.org; aquí están el retrato, sus frases y /capu.
 */

const fs = require('fs');
const path = require('path');

const CAPU_RGB = {
  X: [192, 74, 86],    // cuerpo
  x: [154, 55, 67],    // lado
  R: [240, 154, 166],  // flor
  L: [148, 176, 124],  // hoja
};

const CAPU_POSES = {
  idle: [
    'XX......',
    'XXX.XX..',
    'XXXXXXXx',
    'XXXXXXXx',
    'XX.XX.Xx',
    'XX.XX.Xx',
    'XXXXXXXx',
    'XXXXXXXx',
    'XXXXXXXx',
    '.X....X.',
  ],
  blink: [
    'XX......',
    'XXX.XX..',
    'XXXXXXXx',
    'XXXXXXXx',
    'XXXXXXXx',
    'XX.XX.Xx',
    'XXXXXXXx',
    'XXXXXXXx',
    'XXXXXXXx',
    '.X....X.',
  ],
  look: [
    'XX......',
    'XXX.XX..',
    'XXXXXXXx',
    'XXXXXXXx',
    'XXX.XX.x',
    'XXX.XX.x',
    'XXXXXXXx',
    'XXXXXXXx',
    'XXXXXXXx',
    '.X....X.',
  ],
  bloom: [
    'X.R..R.X',
    'XRRRRRRX',
    'XXXXXXXx',
    'XXXXXXXx',
    'XX.XX.Xx',
    'XXXXXXXx',
    'XXXXXXXx',
    'XXXXXXXx',
    'XXXXXXXx',
    '.X....X.',
  ],
  wilt: [
    '........',
    'XXX.X...',
    'XXXXXXXx',
    'XXXXXXXx',
    'XXXXXXXx',
    'XX.XX.Xx',
    'XXXXXXXx',
    'XXXXXXXx',
    'XXXXXXXx',
    '.X....X.',
  ],
};

const capuColorOk = () => process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

/** The pose as terminal lines (8 columns × 5 rows). */
function capuLines(pose = 'idle') {
  const rows = CAPU_POSES[pose] || CAPU_POSES.idle;
  const color = capuColorOk();
  const fg = (c) => `\x1b[38;2;${CAPU_RGB[c].join(';')}m`;
  const bg = (c) => `\x1b[48;2;${CAPU_RGB[c].join(';')}m`;
  const out = [];
  for (let y = 0; y < rows.length; y += 2) {
    let line = '';
    let last = '';
    for (let x = 0; x < 8; x++) {
      const a = rows[y][x] === '.' ? null : rows[y][x];
      const b = rows[y + 1] && rows[y + 1][x] !== '.' ? rows[y + 1][x] : null;
      if (!color) { line += a && b ? '█' : a ? '▀' : b ? '▄' : ' '; continue; }
      let code, ch;
      if (!a && !b) { code = '\x1b[0m'; ch = ' '; }
      else if (a && b && a === b) { code = `\x1b[0m${fg(a)}`; ch = '█'; }
      else if (a && b) { code = `${fg(a)}${bg(b)}`; ch = '▀'; }
      else if (a) { code = `\x1b[0m${fg(a)}`; ch = '▀'; }
      else { code = `\x1b[0m${fg(b)}`; ch = '▄'; }
      if (code !== last) { line += code; last = code; }
      line += ch;
    }
    out.push(color ? `${line}\x1b[0m` : line);
  }
  return out;
}

/** Capu on the left, up to five lines of text on the right. */
function capuBeside(textLines, pose = 'idle', indent = '  ') {
  const art = capuLines(pose);
  const n = Math.max(art.length, textLines.length);
  const lines = [];
  for (let i = 0; i < n; i++) lines.push(`${indent}${art[i] || '        '}   ${textLines[i] || ''}`);
  return lines.join('\n');
}

// What Capu is up to while the engine works: innocence plus the classic programmer memes.
const CAPU_PHRASES = {
  thinking: [
    'Pensando', 'Regando el capullo', 'Soplando el café', 'Preguntándole al pato de goma',
    'Leyendo la documentación que nadie lee', 'Buscando el punto y coma perdido', 'Abriendo otra lata',
    'Contando las llaves', 'Mirando al techo con determinación', 'Negociando con el linter',
  ],
  writing: [
    'Escribiendo', 'Tecleando con las hojas', 'Pegando pegatinas en el portátil', 'Nombrando variables con cariño',
    'Indentando a mano', 'Quitando el console.log número 47',
  ],
  running: [
    'Ejecutando', 'Mirando la barra de progreso', 'Esperando a que compile', 'Dándole a npm install un momento',
    'Jurando que en su máquina funciona',
  ],
  reading: ['Leyendo', 'Con la lupa en el código', 'Siguiendo el hilo del import'],
};

/** A label function for createSpinner: the plain verb first, then a phrase every few seconds. */
function capuLabel(kind = 'thinking', first) {
  const list = CAPU_PHRASES[kind] || CAPU_PHRASES.thinking;
  const start = Date.now();
  let pick = 0;
  let lastSwap = start;
  return () => {
    const now = Date.now();
    if (now - start < 4000) return first || list[0];
    if (now - lastSwap > 3500 || pick === 0) {
      lastSwap = now;
      let next = pick;
      while (list.length > 1 && next === pick) next = 1 + Math.floor(Math.random() * (list.length - 1));
      pick = next;
    }
    return `${list[pick]}…`;
  };
}

/** /capu: a short animation in place (blink, look around, bloom). */
async function playCapu() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const text = [
    '\x1b[1mCapu\x1b[0m',
    '\x1b[38;5;248mla mascota de Deiza Code\x1b[0m',
    '\x1b[38;5;244mun capullo de rosa hecho bloque\x1b[0m',
    '\x1b[38;5;244mflorece cuando terminas algo\x1b[0m',
  ];
  if (!process.stdout.isTTY) { console.log(capuBeside(text)); return; }
  const seq = [['idle', 700], ['blink', 120], ['idle', 600], ['look', 700], ['idle', 400], ['blink', 120], ['idle', 300], ['bloom', 1400], ['idle', 200]];
  process.stdout.write('\n');
  let first = true;
  for (const [pose, ms] of seq) {
    if (!first) process.stdout.write('\x1b[5A');
    first = false;
    process.stdout.write(capuBeside(text, pose).split('\n').map(l => `\x1b[2K${l}`).join('\n') + '\n');
    await sleep(ms);
  }
  process.stdout.write('\n');
}

/**
 * Courtesy margin (usage limit reached mid-task): the engine is told to leave DEIZA_HANDOFF.md.
 * If it did not manage to, write one from the session so nothing is lost.
 */
function ensureHandoff({ startedAt, userInput, files = [], commands = [], messages = [], mode = 'build' }) {
  const file = path.join(process.cwd(), 'DEIZA_HANDOFF.md');
  try {
    const st = fs.statSync(file);
    if (st.mtimeMs >= startedAt - 1000) return { path: file, by: 'agent' };
  } catch { /* not there yet */ }
  const lastText = [...messages].reverse().find(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim());
  const date = new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
  const md = [
    '# Traspaso de Deiza Code',
    '',
    `Sesión cortada por el límite de uso el ${date}. Este resumen lo ha escrito el CLI a partir de la sesión porque el agente no llegó a dejar el suyo.`,
    '',
    '## Objetivo',
    String(userInput || '').trim().slice(0, 2000) || '(sin descripción)',
    '',
    '## Cambios hechos en la última petición',
    files.length ? files.map(f => `- ${f}`).join('\n') : '- Ningún archivo modificado.',
    '',
    ...(commands.length ? ['## Comandos ejecutados', commands.map(c => `- \`${String(c).replace(/`/g, "'")}\``).join('\n'), ''] : []),
    '## Última respuesta del agente',
    lastText ? String(lastText.content).trim().slice(0, 3000) : '(sin texto)',
    '',
    '## Pendiente',
    '- [ ] Revisar que los archivos listados arriba están completos y funcionan.',
    '- [ ] Terminar lo que pedía el objetivo.',
    '',
    '## Cómo continuar',
    'Abre una sesión nueva en esta carpeta y pega:',
    '',
    '```text',
    'Continúa el trabajo descrito en DEIZA_HANDOFF.md. Revisa primero el estado de los archivos que lista, termina lo pendiente y actualiza el traspaso al acabar.',
    '```',
    '',
  ].join('\n');
  if (mode === 'plan') return { path: '', by: 'cli', content: md };
  fs.writeFileSync(file, md, 'utf8');
  return { path: file, by: 'cli' };
}

module.exports = { CAPU_POSES, capuLines, capuBeside, CAPU_PHRASES, capuLabel, playCapu, ensureHandoff };
