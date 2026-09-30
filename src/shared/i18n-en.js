/** English strings for the app chrome (keys are the Spanish originals; missing keys fall back to Spanish). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeizaI18nEN = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  return {
    'Ajustes': 'Settings', 'Ajustes…': 'Settings…', 'Cuenta': 'Account', 'General': 'General', 'Acerca de': 'About',
    'Cerrar sesión': 'Sign out', 'Nueva sesión': 'New session', 'Abrir carpeta…': 'Open folder…', 'Modelo': 'Model',
    'Esfuerzo': 'Effort', 'Bajo': 'Low', 'Medio': 'Medium', 'Alto': 'High', 'Omnisciente': 'Max', 'Idioma': 'Language',
    'Razonando': 'Thinking', 'Razonó durante {d}': 'Thought for {d}', 'Transcribiendo…': 'Transcribing…',
    'Archivo': 'File', 'Edición': 'Edit', 'Ver': 'View', 'Ventana': 'Window', 'Ayuda': 'Help', 'Nuevo chat': 'New chat',
    'Nueva sesión de Code': 'New Code session', 'Abrir carpeta en Code…': 'Open folder in Code…', 'Salir': 'Quit',
    'Salir de Deiza': 'Quit Deiza', 'Acerca de Deiza': 'About Deiza', 'Buscar actualizaciones…': 'Check for updates…',
    'Deshacer': 'Undo', 'Rehacer': 'Redo', 'Cortar': 'Cut', 'Copiar': 'Copy', 'Pegar': 'Paste', 'Seleccionar todo': 'Select all',
    'Recargar': 'Reload', 'Atrás': 'Back', 'Adelante': 'Forward', 'Guardar': 'Save', 'Importar .md': 'Import .md',
    'Hecho': 'Done', 'La mascota de Deiza Code te acompaña mientras trabaja: teclea, se toma un café, le cuenta el bug al pato de goma y florece al terminar.': 'The Deiza Code mascot keeps you company while it works: it types, has a coffee, explains the bug to the rubber duck and blooms when it is done.', 'Traspaso guardado': 'Handoff saved', 'Abrir {f}': 'Open {f}', 'Traspaso copiado': 'Handoff copied',
    'No se pudo leer el traspaso': 'Could not read the handoff', 'Copiar traspaso': 'Copy handoff', 'Abrir traspaso': 'Open handoff',
    'El agente no llegó a escribirlo: la app lo ha generado con lo hecho en la sesión.': 'The agent did not get to write it: the app generated it from the session.',
    'Contexto, cambios y lo que queda por hacer, listo para la siguiente sesión o para otra IA.': 'Context, changes and what is left, ready for the next session or another AI.',
    'Modo Plan: el traspaso no se guarda como archivo. Cópialo desde aquí.': 'Plan mode: the handoff is not saved as a file. Copy it from here.',
    'Sin uso disponible por ahora': 'No usage left for now', 'Se renueva en {t}.': 'Resets in {t}.', 'Se renueva cada 5 horas.': 'Resets every 5 hours.',
    'Contexto': 'Context', 'Contexto de la sesión: se mide en la primera respuesta.': 'Session context: measured on the first answer.',
    'Contexto: {u} de {l} tokens ({p} %). Deiza compacta la conversación sola al 70 %.': 'Context: {u} of {l} tokens ({p} %). Deiza compacts the conversation on its own at 70 %.',
    'Límite alcanzado · margen de cortesía': 'Limit reached · courtesy margin', 'Sin uso hasta dentro de {t}': 'No usage until {t} from now', 'unas horas': 'a few hours',
    'Deiza termina lo que está haciendo, lo deja estable y escribe el traspaso en DEIZA_HANDOFF.md. Queda un {p} % del margen.': 'Deiza finishes what it is doing, leaves it stable and writes the handoff to DEIZA_HANDOFF.md. {p} % of the margin left.',
    'Lo que quedó a medias está en DEIZA_HANDOFF.md: ábrelo aquí o pégaselo a la siguiente sesión.': 'What was left unfinished is in DEIZA_HANDOFF.md: open it here or paste it into the next session.',
    'se renueva en {t}': 'resets in {t}', 'Cortesía': 'Courtesy', 'Agotado': 'Used up', 'Uso · semana': 'Usage · week', 'Uso · ventana de 5 h': 'Usage · 5 h window', 'semana {w} %': 'week {w} %',
    'Ventana de 5 horas: {p} %. Semana: {w} %. El uso cuenta lo que lees y escribes, incluido el contexto y el razonamiento.': '5-hour window: {p} %. Week: {w} %. Usage counts what is read and written, context and reasoning included.',
  };
}));
