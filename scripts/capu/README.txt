Capu, la mascota de Deiza Code

Motor canónico: src/renderer/capu.js (UMD, sin dependencias). Lo usan:
  - la app (línea de estado, portada de Code, tarjetas de traspaso),
  - la web: src/lib/capu.js es una copia ESM generada de este archivo (mismo contenido,
    cambia solo el envoltorio: "const Capu = (function () {…})(); export default Capu;"),
  - el CLI tiene su propio retrato en medios bloques (deiza-code/src/mascot.js, 8×5 caracteres).

Si cambias escenas o props aquí, regenera la copia de la web y los assets:
  node scripts/capu/build-assets.js <carpeta>   logos SVG/PNG, animados, poses y ficha (capu-sheet.html)
  node scripts/capu/build-art.js <carpeta>      portada y mural animados (public/art/capu-*.svg de la web)
El kit publicado vive en deiza.org/capu/ (public/capu en el servidor).
