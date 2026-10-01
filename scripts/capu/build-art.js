// Animated SVG compositions for news/ads: several Capus, each looping its own scene.
const C = require('../../src/renderer/capu.js');
const fs = require('fs');
function slotGroups(slotIdx, scenes, dx, dy) {
  const box = C.centeredBox(scenes, 0);
  const frames = [];
  for (const s of scenes) C.SCENES[s].frames.forEach((f, i) => frames.push([f[0], C.frameAt(s, i)]));
  const total = frames.reduce((a, f) => a + f[0], 0);
  let t = 0, g = '', css = '';
  frames.forEach(([ms, grid], k) => {
    const a = (t / total * 100).toFixed(3), b = ((t + ms) / total * 100).toFixed(3);
    t += ms;
    const inner = C.toSVG(grid, { px: 1, crop: box }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const cls = `s${slotIdx}f${k}`;
    g += `<g class="${cls}">${inner}</g>`;
    css += `.${cls}{animation:k${cls} ${total}ms step-end infinite}@keyframes k${cls}{0%,${a}%{visibility:hidden}${a}%,${b}%{visibility:visible}${b}%,100%{visibility:hidden}}`;
  });
  return { svg: `<g transform="translate(${dx} ${dy})">${g}</g>`, css, box };
}
function compose({ w, h, bg, slots, ground, title }) {
  let body = '', css = '';
  slots.forEach((sl, i) => {
    const box = C.centeredBox(sl.scenes, 0);
    const dx = Math.round(sl.cx - box.w / 2), dy = Math.round(sl.by - box.h);
    const r = slotGroups(i, sl.scenes, dx, dy);
    body += r.svg; css += r.css;
  });
  const g = ground ? `<rect x="0" y="${ground.y}" width="${w}" height="${h - ground.y}" fill="${ground.fill}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 10}" height="${h * 10}" shape-rendering="crispEdges" role="img"><title>${title}</title><style>g[class]{visibility:hidden}${css}@media (prefers-reduced-motion:reduce){g[class]{animation:none!important}${slots.map((_, i) => `.s${i}f0`).join(',')}{visibility:visible}}</style><rect width="${w}" height="${h}" fill="${bg}"/>${g}${body}</svg>`;
}
// node scripts/capu/build-art.js <carpeta>: portada 16:9 y mural 21:9 animados para noticias y anuncios
const out = process.argv[2] || require('path').join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
// 16:9 hero: cream paper, one Capu cycling through its day
fs.writeFileSync(`${out}/capu-hero.svg`, compose({
  w: 64, h: 36, bg: '#EFE7DC', ground: { y: 29, fill: '#E6DCCD' }, title: 'Capu, la mascota de Deiza Code',
  slots: [{ scenes: ['hello', 'typing', 'coffee', 'can', 'duck', 'bloom'], cx: 32, by: 30 }],
}));
// 21:9 mural: the cast, each doing their thing at once, on warm dark; laid out by real widths
{
  const cast = [['typing'], ['coffee'], ['duck'], ['focus'], ['fine']];
  const gap = 6, margin = 8;
  const widths = cast.map(sc => { const b = C.sceneBox(sc, 0); return { b, w: b.w }; });
  const total = widths.reduce((a, x) => a + x.w, 0) + gap * (cast.length - 1) + margin * 2;
  const W = total, H = Math.round(W * 9 / 21);
  let x = margin;
  const slots = cast.map((sc, i) => {
    const b = widths[i].b;
    // centre of this slot's box, expressed as the body centre so centredBox lines up
    const bodyCx = 24; // BX + 8 in capu.js
    const cx = x + (bodyCx - b.x);
    x += b.w + gap;
    return { scenes: sc, cx, by: Math.round(H * 0.8) };
  });
  fs.writeFileSync(`${out}/capu-mural.svg`, compose({
    w: W, h: H, bg: '#1E1918', ground: { y: Math.round(H * 0.8) - 1, fill: '#241E1C' },
    title: 'Capu programando, con café, con el pato de goma, concentrado y en llamas pero tranquilo', slots,
  }));
}
console.log(fs.statSync(`${out}/capu-hero.svg`).size, fs.statSync(`${out}/capu-mural.svg`).size);
