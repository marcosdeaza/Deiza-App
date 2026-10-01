// Builds every static Capu asset from capu.js into ./out
const C = require('../../src/renderer/capu.js');
const fs = require('fs');
const path = require('path');
// node scripts/capu/build-assets.js [carpeta]   (por defecto assets/)
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'out'));
fs.mkdirSync(OUT, { recursive: true });
const w = (f, s) => fs.writeFileSync(path.join(OUT, f), s);

// 1. base silhouette (8x10) — the logo
const baseGrid = C.base();
const baseSVG = (fill, eyes) => {
  const g = C.base({ eyes });
  let r = '';
  g.forEach((row, y) => { let x = 0; while (x < 8) { if (!row[x]) { x++; continue; } let x2 = x; while (x2 + 1 < 8 && row[x2 + 1]) x2++; r += `<rect x="${x}" y="${y}" width="${x2 - x + 1}" height="1"/>`; x = x2 + 1; } });
  return r;
};
w('capu.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 10" width="160" height="200" shape-rendering="crispEdges" role="img"><title>Capu</title><g fill="${C.PAL.X}">${baseSVG()}</g></svg>`);
w('capu-mono.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 10" width="160" height="200" shape-rendering="crispEdges" role="img"><title>Capu</title><g fill="currentColor">${baseSVG()}</g></svg>`);
w('capu-cream.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 10" width="160" height="200" shape-rendering="crispEdges" role="img"><title>Capu</title><g fill="${C.PAL.W}">${baseSVG()}</g></svg>`);
// padded square version (favicon / avatar)
w('capu-square.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -1 12 12" width="240" height="240" shape-rendering="crispEdges" role="img"><title>Capu</title><g fill="${C.PAL.X}">${baseSVG()}</g></svg>`);
// app tile: cream Capu on granate, and granate on cream
const tile = (bg, fg, name) => w(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="512" height="512" shape-rendering="crispEdges" role="img"><title>Capu</title><rect width="16" height="16" rx="3.4" fill="${bg}" shape-rendering="geometricPrecision"/><g transform="translate(4 3)" fill="${fg}">${baseSVG()}</g></svg>`);
tile(C.PAL.X, C.PAL.W, 'capu-tile.svg');
tile('#F1E9DE', C.PAL.X, 'capu-tile-light.svg');
tile('#1E1918', C.PAL.X, 'capu-tile-dark.svg');

// 2. fine-resolution idle (the "hero" still)
const idleBox = C.sceneBox(['idle']);
w('capu-hero.svg', C.toSVG(C.frameAt('idle', 0), { px: 10, crop: idleBox, title: 'Capu' }));

// 3. poses (one still per scene) for the character sheet
const POSES = [['idle', 0, 'Reposo'], ['hello', 2, 'Hola'], ['thinking', 3, 'Pensando'], ['typing', 0, 'Programando'],
  ['coffee', 0, 'Café'], ['can', 5, 'Lata'], ['can', 9, 'A tope'], ['duck', 0, 'Pato de goma'], ['reading', 0, 'Leyendo'],
  ['waiting', 9, 'Compilando'], ['npm', 1, 'npm install'], ['git', 2, 'git push'], ['tests', 1, 'Tests'], ['pass', 2, 'Pasan'],
  ['fail', 1, 'Fallan'], ['web', 1, 'Web'], ['focus', 0, 'Concentrado'], ['fine', 0, 'Todo bien'], ['build', 0, 'Build'],
  ['copilot', 2, 'Copilot'], ['plan', 1, 'Plan'], ['low', 4, 'Esfuerzo bajo'], ['high', 1, 'Esfuerzo alto'], ['saiyan', 12, 'Omnisciente'],
  ['listen', 1, 'Escuchando'], ['solid', 4, 'Solid 5'], ['liquid', 1, 'Liquid'], ['gas', 2, 'Gas'], ['water', 2, 'Riego'],
  ['ask', 0, 'Aprobación'], ['bloom', 5, 'Terminado'], ['wilt', 0, 'Traspaso'], ['sleep', 2, 'Dormido']];
fs.mkdirSync(path.join(OUT, 'poses'), { recursive: true });
const all = C.sceneBox(Object.keys(C.SCENES));
for (const [n, i, label] of POSES) fs.writeFileSync(path.join(OUT, 'poses', `${n}-${i}.svg`), C.toSVG(C.frameAt(n, i), { px: 6, crop: C.SCENES[n].fx ? C.sceneBox([n]) : all, title: `Capu: ${label}` }));

// 4. self-contained animated SVG: frames stacked, shown one at a time with CSS steps
function animated(scenes, name, px) {
  const box = C.sceneBox(scenes);
  const frames = [];
  for (const s of scenes) C.SCENES[s].frames.forEach((f, i) => frames.push([f[0], C.frameAt(s, i)]));
  const total = frames.reduce((a, f) => a + f[0], 0);
  let t = 0, groups = '', css = '';
  frames.forEach(([ms, g], k) => {
    const a = (t / total * 100).toFixed(4), b = ((t + ms) / total * 100).toFixed(4);
    t += ms;
    const inner = C.toSVG(g, { px: 1, crop: box }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    groups += `<g class="f${k}">${inner}</g>`;
    css += `.f${k}{animation-name:k${k}}@keyframes k${k}{0%,${a}%{visibility:hidden}${a}%,${b}%{visibility:visible}${b}%,100%{visibility:hidden}}`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.w} ${box.h}" width="${box.w * px}" height="${box.h * px}" shape-rendering="crispEdges" role="img"><title>Capu</title><style>g{visibility:hidden;animation-duration:${total}ms;animation-iteration-count:infinite;animation-timing-function:step-end}${css}@media (prefers-reduced-motion:reduce){g{animation:none}.f0{visibility:visible}}</style>${groups}</svg>`;
  w(name, svg);
  return { frames: frames.length, total, bytes: svg.length };
}
console.log('reel', animated(['idle', 'thinking', 'typing', 'coffee', 'can', 'duck', 'bloom'], 'capu-animated.svg', 6));
console.log('idle', animated(['idle'], 'capu-idle.svg', 6));
console.log('typing', animated(['typing'], 'capu-typing.svg', 6));
console.log('bloom', animated(['hello', 'idle', 'bloom'], 'capu-hello.svg', 6));

// 5. terminal banner (for README / docs)
w('capu.ansi.txt', C.toANSI(C.frameAt('idle', 0), {}).join('\n') + '\n');

// 6. character sheet (HTML → PNG by the caller)
let sheet = `<!doctype html><meta charset=utf-8><title>Capu</title><style>
@font-face{font-family:Play;src:local('Playfair Display')}
body{margin:0;background:#1d1a19;color:#e9e1d6;font:14px/1.5 -apple-system,system-ui;padding:56px 64px;width:1280px;box-sizing:border-box}
h1{font:400 64px/1 'Playfair Display',Georgia,serif;margin:0} .lede{color:#a99f94;max-width:760px;margin:14px 0 40px;font-size:16px}
.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:12px} figure{margin:0;background:#231f1e;border-radius:10px;padding:10px 6px 8px;text-align:center}
figure svg{width:100%;height:auto} figcaption{color:#8d837a;font-size:12px}
.row{display:flex;gap:28px;align-items:flex-end;margin:0 0 44px} .row div{display:flex;flex-direction:column;align-items:center;gap:8px;color:#8d837a;font-size:12px}
.cream{background:#efe7dc;border-radius:10px;padding:14px}
.pal{display:flex;gap:10px;margin-top:40px} .sw{width:120px} .sw i{display:block;height:56px;border-radius:8px;margin-bottom:6px}
</style><h1>Capu</h1><p class=lede>La mascota de Deiza Code. Un capullo de rosa hecho bloque: ocho píxeles de ancho, el pétalo izquierdo más alto y dos ojos que son huecos. Le brotan brazos de hoja cuando necesita coger algo, florece al terminar y se mustia cuando se acaba el uso.</p>
<div class=row>
<div>${fs.readFileSync(path.join(OUT, 'capu.svg'), 'utf8').replace('width="160" height="200"', 'width="96" height="120"')}logo</div>
<div>${fs.readFileSync(path.join(OUT, 'capu.svg'), 'utf8').replace('width="160" height="200"', 'width="32" height="40"')}32 px</div>
<div>${fs.readFileSync(path.join(OUT, 'capu.svg'), 'utf8').replace('width="160" height="200"', 'width="16" height="20"')}16 px</div>
<div class=cream>${fs.readFileSync(path.join(OUT, 'capu.svg'), 'utf8').replace('width="160" height="200"', 'width="96" height="120"')}</div>
<div>${fs.readFileSync(path.join(OUT, 'capu-tile.svg'), 'utf8').replace('width="512" height="512"', 'width="120" height="120"')}icono</div>
<div>${fs.readFileSync(path.join(OUT, 'capu-tile-light.svg'), 'utf8').replace('width="512" height="512"', 'width="120" height="120"')}</div>
<div>${fs.readFileSync(path.join(OUT, 'capu-tile-dark.svg'), 'utf8').replace('width="512" height="512"', 'width="120" height="120"')}</div>
</div><div class=grid>`;
for (const [n, i, label] of POSES) sheet += `<figure>${C.toSVG(C.frameAt(n, i), { px: 3, crop: all })}<figcaption>${label}</figcaption></figure>`;
sheet += `</div><div class=pal>` + [['X', 'Cuerpo'], ['x', 'Lado'], ['R', 'Flor'], ['L', 'Hoja'], ['W', 'Crema'], ['d', 'Grafito'], ['Y', 'Ocre']]
  .map(([k, n]) => `<div class=sw><i style="background:${C.PAL[k]}"></i>${n} ${C.PAL[k]}</div>`).join('') + `</div>`;
w('capu-sheet.html', sheet);
