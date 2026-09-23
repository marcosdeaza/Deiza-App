# Deiza para escritorio: instrucciones para contribuir (personas y agentes)

App Electron (macOS, Windows, Linux). **Chat** muestra el workspace de Deiza en una vista aislada; **Code** es una
interfaz local (`src/renderer/app`) sobre el agente de `src/engine/worker.js`.

## Antes de cambiar nada
- Prueba en desarrollo con `npm start`; para pruebas automáticas, `node test/e2e.js` (Playwright sobre Electron).
- Los módulos de `src/engine/vendor` vienen de Deiza Code: se actualizan con `npm run sync-engine`, no a mano.
- Los mismos IDs de modelo están en `src/renderer/app/app.js`, `src/engine/worker.js` y `src/main/code-host.js`
  (`MODELS`): cámbialos a la vez. Esfuerzo: `low`, `medium`, `high`, `ultra`, `max` (Omnisciente).

## Publicar
- Sube `version` en `package.json` y ejecuta `npm run release -- "notas"`. Las apps instaladas solo se enteran de
  una versión nueva por `latest.json`, que genera ese comando con tamaños y sha256. No lo edites a mano.
- No cambies las claves de `latest.json` (`files`, `zip`, `bytes`, `sha256`, `sizes`): las leen las versiones
  ya instaladas y los instaladores de una línea.

## Estilo
- Paleta cálida de Deiza: granate, ocre, rosa y crema, con serif para los titulares. Nada de morados, degradados
  "de IA" ni emojis en la interfaz. El azul solo se usa para el aviso de actualización.
- Sin parpadeos: nada de remontar árboles grandes, iframes ocultos hasta que cargan y animaciones cortas.
- Textos de la interfaz en español claro y breve (con su traducción en `src/shared/i18n-en.js`).
- Los modelos se presentan siempre con los nombres de Deiza.

## Seguridad
- La vista web no tiene acceso a Node: todo pasa por los puentes de `src/preload`.
- Nunca pidas a un usuario que desactive protecciones del sistema o del antivirus: firma las compilaciones.
