/**
 * DEIZA CODE — UI & Terminal Aesthetics
 * Granate / Burgundy palette (#8C2F39) with clean, modern developer UX.
 */

const { VERSION, IS_CLOSED, MODEL_INFO, NATIVE_MODELS } = require('./config');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1;97m',
  dim: '\x1b[38;5;244m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Granate / Burgundy palette (#8C2F39) - True brand colors
  granate: '\x1b[38;2;140;47;57m',
  granateBold: '\x1b[1m\x1b[38;2;160;50;62m',
  granateBright: '\x1b[38;2;184;74;85m',
  granateDark: '\x1b[38;2;94;31;38m',
  granateBg: '\x1b[48;2;140;47;57m\x1b[1;97m',

  // Accents
  rose: '\x1b[38;2;225;112;128m',
  roseBold: '\x1b[1m\x1b[38;2;225;112;128m',
  gold: '\x1b[1;38;5;214m',
  green: '\x1b[1;38;5;114m',
  greenBright: '\x1b[1;38;5;84m',
  blue: '\x1b[1;38;5;75m',
  cyan: '\x1b[1;38;5;81m',
  red: '\x1b[1;38;5;203m',
  gray: '\x1b[38;5;248m',
  darkGray: '\x1b[38;5;244m',
  guide: '\x1b[38;5;240m',
  white: '\x1b[38;5;254m',
  brightWhite: '\x1b[1;97m',
  codeBg: '\x1b[48;5;236m\x1b[38;5;81m',
};

const BANNER = `
${C.granateBold}  ██████╗  ███████╗ ██╗ ███████╗  █████╗       ██████╗  ██████╗  ██████╗  ███████╗
  ██╔══██╗ ██╔════╝ ██║ ╚══███╔╝ ██╔══██╗     ██╔════╝ ██╔═══██╗ ██╔══██╗ ██╔════╝
  ██║  ██║ ██████╗  ██║   ███╔╝  ███████║     ██║      ██║   ██║ ██║  ██║ ██████╗ 
  ██║  ██║ ██╔═══╝  ██║  ███╔╝   ██╔══██║     ██║      ██║   ██║ ██║  ██║ ██╔═══╝ 
  ██████╔╝ ███████╗ ██║ ███████╗ ██║  ██║     ╚██████╗ ╚██████╔╝ ██████╔╝ ███████╗
  ╚═════╝  ╚══════╝ ╚═╝ ╚══════╝ ╚═╝  ╚═╝      ╚═════╝  ╚═════╝  ╚═════╝  ╚══════╝${C.reset}
  ${C.gray}Autonomous Terminal Coding Agent · v${VERSION}${C.reset}
`;

const MODE_INFO = {
  build: { label: 'BUILD', color: C.granateBright, badge: `${C.granateBright}[BUILD]${C.reset}`, desc: 'Autónomo: edita, ejecuta y verifica sin pedir permiso.' },
  copilot: { label: 'COPILOT', color: C.gold, badge: `${C.gold}[COPILOT]${C.reset}`, desc: 'Supervisado: cada cambio y comando se muestra y se aprueba.' },
  plan: { label: 'PLAN', color: C.cyan, badge: `${C.cyan}[PLAN]${C.reset}`, desc: 'Solo lectura: analiza y propone un plan sin tocar archivos.' },
};

function modeBadge(mode) {
  const info = MODE_INFO[mode] || MODE_INFO.build;
  return info.badge;
}

const MODEL_BADGES = {
  'deiza-liquid': '\x1b[1;38;5;81m[LIQUID 5]\x1b[0m',
  'deiza-solid': '\x1b[1m\x1b[38;2;184;74;85m[SOLID 4.5]\x1b[0m',
  'deiza-gas': '\x1b[1;38;5;114m[GAS 4.1]\x1b[0m',
  'deiza-vainilla': '\x1b[1;38;5;222m[VAINILLA]\x1b[0m',
};

function modelBadge(modelId) {
  const m = String(modelId || '').toLowerCase();
  return MODEL_BADGES[m] || `\x1b[1;38;5;214m[${String(modelId || 'CUSTOM').toUpperCase()}]\x1b[0m`;
}

function renderModelSelector(currentModel = 'deiza-liquid') {
  let out = `\n  ${C.granateBold}Modelos Nativos de Deiza:${C.reset}\n`;
  const list = [
    { num: '1', key: 'deiza-liquid',   short: 'liquid',   info: MODEL_INFO['deiza-liquid'],   color: C.cyan },
    { num: '2', key: 'deiza-solid',    short: 'solid',    info: MODEL_INFO['deiza-solid'],    color: C.granateBright },
    { num: '3', key: 'deiza-gas',      short: 'gas',      info: MODEL_INFO['deiza-gas'],      color: C.green },
    { num: '4', key: 'deiza-vainilla', short: 'vainilla', info: MODEL_INFO['deiza-vainilla'], color: '\x1b[38;5;222m' },
  ];
  for (const item of list) {
    const isAct = item.key === currentModel || item.short === currentModel;
    const mark = isAct ? `${C.green}●${C.reset}` : `${C.darkGray}○${C.reset}`;
    const actBadge = isAct ? ` ${C.green}[ACTIVO]${C.reset}` : '';
    out += `  ${mark} ${C.bold}[${item.num}]${C.reset} ${item.color}${item.info.name.padEnd(18)}${C.reset} ${C.white}/model ${item.short}${C.reset}${actBadge}\n`;
    out += `      ${C.gray}${item.info.desc}${C.reset}\n`;
  }
  out += `\n  ${C.gray}Atajos directos: ${C.white}/liquid${C.gray} · ${C.white}/solid${C.gray} · ${C.white}/gas${C.gray} · ${C.white}/vainilla${C.reset}\n`;
  return out;
}

function renderModes(current) {
  let out = `\n  ${C.granateBold}Modos de permisos de Deiza Code:${C.reset}\n`;
  for (const key of ['build', 'copilot', 'plan']) {
    const info = MODE_INFO[key];
    const mark = key === current ? `${C.green}●${C.reset}` : `${C.darkGray}○${C.reset}`;
    out += `  ${mark} ${info.color}${info.label.padEnd(8)}${C.reset} ${C.white}/${key}${C.reset}${' '.repeat(Math.max(1, 10 - key.length))}${C.gray}${info.desc}${C.reset}\n`;
  }
  out += `  ${C.gray}Cambia con /build, /copilot o /plan. Por defecto: BUILD (guárdalo con /config mode <modo>).${C.reset}\n`;
  return out;
}

/**
 * Single terminal line that is rewritten in place (spinner, tool progress). Falls back to
 * plain prints when stdout is not a TTY (logs, pipes).
 */
const isTTY = !!process.stdout.isTTY;
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function createLiveLine() {
  let active = false;
  let last = '';
  return {
    set(text) {
      if (!isTTY) {
        if (text !== last) process.stdout.write(text + '\n');
        last = text;
        return;
      }
      process.stdout.write(`\r\x1b[2K${text}`);
      active = true;
      last = text;
    },
    clear() {
      if (active && isTTY) process.stdout.write('\r\x1b[2K');
      active = false;
      last = '';
    },
    done(finalText) {
      if (finalText !== undefined) this.set(finalText);
      if (active && isTTY) process.stdout.write('\n');
      else if (!isTTY && finalText === undefined && last) { /* already printed */ }
      active = false;
      last = '';
    },
    isActive: () => active,
  };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  if (m < 60) return `${m}m ${String(remSec).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const remMin = m % 60;
  return `${h}h ${String(remMin).padStart(2, '0')}m ${String(remSec).padStart(2, '0')}s`;
}

function createSpinner(live, label) {
  const start = Date.now();
  let frame = 0;
  let timer = null;
  let currentLabel = label;
  const render = () => {
    const elapsed = formatDuration(Date.now() - start);
    const text = typeof currentLabel === 'function' ? currentLabel() : currentLabel;
    live.set(`  ${C.granateBright}${SPIN[frame % SPIN.length]}${C.reset} ${C.gray}${text}${C.reset} ${C.darkGray}· ${elapsed}${C.reset}`);
    frame++;
  };
  if (isTTY) { render(); timer = setInterval(render, 100); }
  else process.stdout.write(`  ● ${typeof label === 'function' ? label() : label}\n`);
  return {
    setLabel(next) { currentLabel = next; },
    getElapsed() { return Date.now() - start; },
    getElapsedText() { return formatDuration(Date.now() - start); },
    stop() { if (timer) clearInterval(timer); timer = null; live.clear(); },
  };
}

const Status = {
  thinking: `  ${C.granateBright}●${C.reset} ${C.gray}Analizando y procesando...${C.reset}`,
  executing: (cmd) => `  ${C.gold}$ [bash]${C.reset} ${C.white}${cmd}${C.reset}`,
  editing: (file) => `  ${C.blue}~ [edit]${C.reset} ${C.white}${file}${C.reset}`,
  writing: (file) => `  ${C.green}+ [write]${C.reset} ${C.white}${file}${C.reset}`,
  appending: (file) => `  ${C.green}+ [append]${C.reset} ${C.white}${file}${C.reset}`,
  reading: (file) => `  ${C.cyan}› [read]${C.reset} ${C.white}${file}${C.reset}`,
  listing: (dir) => `  ${C.gray}› [list]${C.reset} ${C.white}${dir}${C.reset}`,
  searching: (query) => `  ${C.gray}› [search]${C.reset} ${C.white}${query}${C.reset}`,
  deleting: (p) => `  ${C.red}- [delete]${C.reset} ${C.white}${p}${C.reset}`,
  moving: (from, to) => `  ${C.gold}→ [move]${C.reset} ${C.white}${from} → ${to}${C.reset}`,
  fetching: (url) => `  ${C.cyan}› [fetch]${C.reset} ${C.white}${url}${C.reset}`,
  planning: () => `  ${C.gold}* [plan]${C.reset} ${C.gray}actualizando el plan${C.reset}`,
  subagent: (role, task) => `  ${C.rose}› [agent:${role}]${C.reset} ${C.white}${task}${C.reset}`,
  vision: (file) => `  ${C.cyan}› [image]${C.reset} ${C.white}${file}${C.reset}`,
  success: `  ${C.green}✓${C.reset} ${C.white}Completado con éxito${C.reset}`,
  error: (msg) => `  ${C.red}✖ Error:${C.reset} ${C.white}${msg}${C.reset}`,
};

/**
 * Format a visual unified diff for terminal display
 */
function renderDiff(filePath, oldContent, newContent) {
  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent ? newContent.split('\n') : [];

  let out = `\n  ${C.guide}╭─ ${C.blue}~ [diff]${C.reset} ${C.white}${filePath}${C.reset}\n`;

  // Find range of differences
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const contextBefore = Math.max(0, start - 2);
  const contextAfterOld = Math.min(oldLines.length, oldEnd + 3);
  const contextAfterNew = Math.min(newLines.length, newEnd + 3);

  // Context before
  for (let i = contextBefore; i < start; i++) {
    out += `  ${C.guide}│${C.reset}   ${C.darkGray}${String(i + 1).padStart(4)} │${C.reset}   ${oldLines[i]}\n`;
  }

  // Deletions
  for (let i = start; i <= oldEnd; i++) {
    out += `  ${C.guide}│${C.reset}   ${C.red}${String(i + 1).padStart(4)} - │ - ${oldLines[i]}${C.reset}\n`;
  }

  // Additions
  for (let i = start; i <= newEnd; i++) {
    out += `  ${C.guide}│${C.reset}   ${C.green}${String(i + 1).padStart(4)} + │ + ${newLines[i]}${C.reset}\n`;
  }

  // Context after
  for (let i = oldEnd + 1; i < contextAfterOld; i++) {
    out += `  ${C.guide}│${C.reset}   ${C.darkGray}${String(i + 1).padStart(4)} │${C.reset}   ${oldLines[i]}\n`;
  }

  out += `  ${C.guide}╰──────────────────────────────────────────────────${C.reset}\n`;
  return out;
}

/**
 * Boxen-like bordered message with modern rounded corners
 */
function box(title, content, color = C.granateBold) {
  const lines = content.split('\n');
  const maxLen = Math.max(title.length + 4, ...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length));
  const border = '─'.repeat(maxLen + 2);

  let out = `\n  ${color}╭─ ${C.brightWhite}${title}${C.reset}${color} ${'─'.repeat(Math.max(0, maxLen - title.length - 1))}╮${C.reset}\n`;
  for (const line of lines) {
    const rawLen = line.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = ' '.repeat(Math.max(0, maxLen - rawLen));
    out += `  ${color}│${C.reset} ${line}${padding} ${color}│${C.reset}\n`;
  }
  out += `  ${color}╰${border}╯${C.reset}\n`;
  return out;
}

/**
 * Simple syntax highlighting for static markdown snippets
 */
function highlightMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, `${C.cyan}$1${C.reset}`)
    .replace(/\*\*([^*]+)\*\*/g, `${C.brightWhite}$1${C.reset}`)
    .replace(/__([^_]+)__/g, `${C.brightWhite}$1${C.reset}`);
}

/**
 * Live line-based streaming markdown renderer for terminal display.
 * Transforms bold, inline code, headers, code blocks, lists, and quotes into high-contrast ANSI.
 */
function createMarkdownStream(onWrite) {
  let inCodeBlock = false;
  let codeLang = '';
  let buffer = '';

  function renderLine(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        codeLang = trimmed.slice(3).trim();
        return `  ${C.guide}╭─ ${C.gold}${codeLang || 'code'}${C.reset} ${C.guide}${'─'.repeat(Math.max(16, 54 - (codeLang ? codeLang.length + 5 : 4)))}╮${C.reset}`;
      } else {
        return `  ${C.guide}╰${'─'.repeat(56)}╯${C.reset}`;
      }
    }

    if (inCodeBlock) {
      return `  ${C.guide}│${C.reset}  ${C.white}${line}${C.reset}`;
    }

    if (!trimmed) return '';

    // Headers
    if (/^#\s+/.test(line)) {
      return `\n  ${C.granateBright}━━━ ${C.brightWhite}${line.replace(/^#\s+/, '')}${C.reset}${C.granateBright} ━━━${C.reset}\n`;
    }
    if (/^##\s+/.test(line)) {
      return `\n  ${C.roseBold}■ ${C.brightWhite}${line.replace(/^##\s+/, '')}${C.reset}\n`;
    }
    if (/^###\s+/.test(line)) {
      return `\n  ${C.gold}◆ ${C.brightWhite}${line.replace(/^###\s+/, '')}${C.reset}`;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      return `  ${C.guide}${'─'.repeat(56)}${C.reset}`;
    }

    // Blockquote
    if (/^>\s*/.test(line)) {
      return `  ${C.guide}│${C.reset} ${C.dim}${line.replace(/^>\s*/, '')}${C.reset}`;
    }

    let out = line;

    // Bullet lists: * or -
    if (/^(\s*)[*-]\s+(.*)/.test(out)) {
      out = out.replace(/^(\s*)[*-]\s+(.*)/, (m, indent, rest) => {
        return `${indent}  ${C.granateBright}•${C.reset} ${rest}`;
      });
    } else if (/^(\s*)(\d+)\.\s+(.*)/.test(out)) {
      out = out.replace(/^(\s*)(\d+)\.\s+(.*)/, (m, indent, num, rest) => {
        return `${indent}  ${C.gold}${num}.${C.reset} ${rest}`;
      });
    } else {
      out = `  ${out}`;
    }

    // Inline formatting:
    // Bold: **text** or __text__ -> bright bold white
    out = out.replace(/\*\*([^*]+)\*\*/g, `${C.brightWhite}$1${C.reset}${C.white}`);
    out = out.replace(/__([^_]+)__/g, `${C.brightWhite}$1${C.reset}${C.white}`);

    // Inline code: `code` -> vivid cyan
    out = out.replace(/`([^`]+)`/g, `${C.cyan}$1${C.reset}${C.white}`);

    return `${C.white}${out}${C.reset}`;
  }

  return {
    write(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep remainder
      for (const line of lines) {
        onWrite(renderLine(line) + '\n');
      }
    },
    flush() {
      if (buffer) {
        onWrite(renderLine(buffer) + '\n');
        buffer = '';
      }
    },
  };
}

/**
 * Renders a structured tool execution card with rounded border container
 */
function printToolCard({ verb, color, target, lines = [], status = '✓ ok', isError = false, durationMs }) {
  const durStr = durationMs !== undefined ? ` · ${formatDuration(durationMs)}` : '';
  const outLines = [];
  outLines.push(`  ${C.guide}╭─${C.reset} ${color}${verb}${C.reset} ${C.white}${target}${C.reset}`);
  for (const l of lines) {
    if (!l) continue;
    outLines.push(`  ${C.guide}│${C.reset}  ${C.gray}${l}${C.reset}`);
  }
  const statusColor = isError ? C.red : C.green;
  outLines.push(`  ${C.guide}╰─${C.reset} ${statusColor}${status}${C.reset}${C.darkGray}${durStr}${C.reset}\n`);
  process.stdout.write(outLines.join('\n'));
}

const COMMANDS_REGISTRY = [
  { cmd: '/build', args: '', desc: 'Modo BUILD (por defecto): autónomo, sin pedir permisos', cat: 'Modos' },
  { cmd: '/copilot', args: '', desc: 'Modo COPILOT: revisa y aprueba cada cambio y comando', cat: 'Modos' },
  { cmd: '/plan', args: '', desc: 'Modo PLAN: análisis y plan de implementación sin tocar archivos', cat: 'Modos' },
  { cmd: '/mode', args: '[build|copilot|plan]', desc: 'Ver o cambiar el modo de permisos activo', cat: 'Modos' },
  { cmd: '/session', args: '[list|new|resume|delete|info]', desc: 'Gestor de sesiones: listar, crear, reanudar, borrar y métricas', cat: 'Sesión' },
  { cmd: '/compact', args: '', desc: 'Compactar y comprimir la memoria de contexto', cat: 'Sesión' },
  { cmd: '/tokens', args: '', desc: 'Métricas de la ventana de contexto y tokens de la sesión', cat: 'Sesión' },
  { cmd: '/context', args: '', desc: 'Alias de /tokens', cat: 'Sesión' },
  { cmd: '/history', args: '', desc: 'Ver historial de conversaciones y consumo de tokens', cat: 'Conversaciones' },
  { cmd: '/resume', args: '[id]', desc: 'Continuar una conversación anterior con todo su contexto', cat: 'Conversaciones' },
  { cmd: '/new', args: '[título]', desc: 'Iniciar una nueva conversación limpia en este workspace', cat: 'Conversaciones' },
  { cmd: '/paste', args: '', desc: 'Pegar captura del portapapeles (Win+Shift+S / PrtScn / Cmd+Shift+4)', cat: 'Herramientas' },
  { cmd: '/image', args: '<ruta> [inst]', desc: 'Analizar capturas o maquetas con visión multimodal', cat: 'Herramientas' },
  { cmd: '/agent', args: '<rol> <tarea>', desc: 'Lanzar un subagente worker aislado (ej: Auditor, Tester)', cat: 'Agentes' },
  { cmd: '/whoami', args: '', desc: 'Ver tu cuenta, plan, tokens y cuota activa', cat: 'Cuenta' },
  { cmd: '/usage', args: '', desc: 'Consultar consumo de tokens y ventana de 5 horas', cat: 'Cuenta' },
  { cmd: '/login', args: '', desc: 'Iniciar sesión con tu cuenta de Deiza (navegador o API Key)', cat: 'Cuenta' },
  { cmd: '/logout', args: '', desc: 'Cerrar sesión en esta máquina', cat: 'Cuenta' },
  { cmd: '/update', args: '', desc: 'Comprobar y actualizar Deiza Code a la última versión', cat: 'Sistema' },
  { cmd: '/upgrade', args: '', desc: 'Alias de /update (comprobar y actualizar a la última versión)', cat: 'Sistema' },
  { cmd: '/model', args: '[1-4|nombre]', desc: 'Cambiar de modelo (Liquid 5, Solid 4.6, Gas 4.5, Vainilla)', cat: 'Configuración' },
  { cmd: '/liquid', args: '', desc: 'Activar modelo Deiza Liquid 5 (Equilibrado · 256K tokens)', cat: 'Modelos' },
  { cmd: '/solid', args: '', desc: 'Activar modelo Deiza Solid 4.6 (Razonamiento profundo y arquitectura)', cat: 'Modelos' },
  { cmd: '/gas', args: '', desc: 'Activar modelo Deiza Gas 4.5 (Velocidad ultra-rápida y visión)', cat: 'Modelos' },
  { cmd: '/vainilla', args: '', desc: 'Activar modelo Deiza Vainilla (Ultra-rápido, conversacional y 100% ilimitado)', cat: 'Modelos' },
  { cmd: '/endpoint', args: '[url|deiza]', desc: 'Usar otro motor OpenAI-compatible (Ollama, vLLM...) o volver a Deiza', cat: 'Configuración' },
  { cmd: '/config', args: '', desc: 'Ver o modificar la configuración local', cat: 'Configuración' },
  { cmd: '/init', args: '', desc: 'Crear directivas .deizarules en la raíz del repo', cat: 'Proyecto' },
  { cmd: '/clear', args: '', desc: 'Limpiar el contexto de la conversación actual', cat: 'Sesión' },
  { cmd: '/help', args: '', desc: 'Ver todos los comandos', cat: 'Ayuda' },
  { cmd: '/exit', args: '', desc: 'Salir de Deiza Code', cat: 'Sesión' },
];

/**
 * Renders an interactive command palette preview
 */
function renderCommandPalette(filter = '') {
  const query = filter.trim().toLowerCase();
  const matches = COMMANDS_REGISTRY.filter(c => {
    if (!query || query === '/') return true;
    const cleanQ = query.startsWith('/') ? query : `/${query}`;
    return c.cmd.toLowerCase().startsWith(cleanQ) || c.desc.toLowerCase().includes(query.replace(/^\//, ''));
  });

  if (matches.length === 0) return '';

  let out = `\n  ${C.guide}╭─ ${C.brightWhite}Comandos Disponibles${C.reset} ${C.gray}(escribe para filtrar o presiona [Tab] para autocompletar)${C.reset} ${C.guide}${'─'.repeat(16)}╮${C.reset}\n`;
  for (const item of matches.slice(0, 10)) {
    const cmdStr = `${C.bold}${C.rose}${item.cmd}${C.reset}${item.args ? ` ${C.gray}${item.args}${C.reset}` : ''}`;
    const rawCmdLen = item.cmd.length + (item.args ? item.args.length + 1 : 0);
    const padLen = Math.max(2, 28 - rawCmdLen);
    const padding = ' '.repeat(padLen);
    out += `  ${C.guide}│${C.reset}   ${cmdStr}${padding}${C.white}${item.desc}${C.reset}\n`;
  }
  if (matches.length > 10) {
    out += `  ${C.guide}│${C.reset}   ${C.gray}... y ${matches.length - 10} comandos más (escribe más letras para filtrar)${C.reset}\n`;
  }
  out += `  ${C.guide}╰────────────────────────────────────────────────────────────────────────────────────────╯${C.reset}\n`;
  return out;
}

/**
 * Format /whoami account profile view
 */
function renderWhoami({ email, name, plan, apiKey, apiBase, isCustom, usage, currentMode }) {
  const usedPct = usage && usage.token_limit > 0 ? Math.round((usage.tokens_used / usage.token_limit) * 100) : 0;
  const mins = usage?.reset_in_seconds ? Math.ceil(usage.reset_in_seconds / 60) : 0;
  const resetText = mins > 0 ? `Se reinicia en ${Math.floor(mins / 60)}h ${mins % 60}m` : '0% (se iniciará al enviar un mensaje)';
  const keySnippet = apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'No configurada';

  let content = '';
  content += `${C.white}Cuenta / Usuario:${C.reset}   ${C.bold}${name ? `${name} · ` : ''}${email || 'Conectada'}${C.reset}\n`;
  content += `${C.white}Plan de Suscripción:${C.reset} ${C.granateBold}[${(plan || 'pro').toUpperCase()}]${C.reset} (Acceso completo Deiza Code)\n`;
  content += `${C.white}Motor:${C.reset}              ${isCustom ? `${C.gold}Endpoint personalizado ${apiBase}${C.reset}` : `${C.green}Nativo Deiza.org${C.reset}`}\n`;
  content += `${C.white}API Key Guardada:${C.reset}   ${C.gray}${keySnippet}${C.reset}\n`;
  content += `${C.white}Modo de permisos:${C.reset}   ${modeBadge(currentMode)} ${C.gray}${(MODE_INFO[currentMode] || MODE_INFO.build).desc}${C.reset}\n`;
  if (usage) {
    content += `${C.white}Tokens Utilizados:${C.reset}  ${usage.tokens_used.toLocaleString()} / ${usage.token_limit.toLocaleString()} (${usedPct}%)\n`;
    content += `${C.white}Ventana 5 Horas:${C.reset}    ${C.gray}${resetText}${C.reset}\n`;
  }
  content += `${C.white}Motor de Inferencia:${C.reset} ${isCustom ? `${C.granateBright}${C.reset}` : `${C.granateBright}Deiza Omniscient${C.reset} ${C.gray}[Deiza Liquid 5.1 · infraestructura dedicada]${C.reset}`}`;

  return box('Perfil de Usuario — Deiza Code', content, C.granate);
}

function renderSessionList(sessions, activeSessionId) {
  if (!sessions || sessions.length === 0) {
    return `\n  ${C.gray}No hay conversaciones guardadas. Usa ${C.white}/session new${C.gray} para iniciar una limpia.${C.reset}\n`;
  }

  let totalTokensAll = 0;
  let content = `  ${C.darkGray}Sesiones disponibles (usa ${C.white}/session resume <id>${C.darkGray} para continuar o ${C.white}/session delete <id>${C.darkGray} para borrar):${C.reset}\n\n`;

  for (const s of sessions) {
    const isActive = s.id === activeSessionId;
    const bullet = isActive ? `${C.green}● [ACTIVA]${C.reset}` : `${C.gray}○${C.reset}`;
    const modeStr = modeBadge(s.mode || 'build');
    const dateStr = s.updatedAt ? new Date(s.updatedAt).toLocaleString('es-ES', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const title = s.title.length > 28 ? s.title.slice(0, 26) + '..' : s.title;
    const tokens = s.tokens || { total: 0 };
    totalTokensAll += (tokens.total || 0);

    const tokenStr = tokens.total > 0
      ? `${C.gold}${tokens.total.toLocaleString()} tok${C.reset}`
      : `${C.darkGray}0 tok${C.reset}`;

    const originTag = s.source === 'cloud'
      ? ` ${C.cyan}[Nube]${C.reset}`
      : (!s.isCurrentWorkspace ? ` ${C.gray}[Global]${C.reset}` : '');

    content += `  ${bullet} ${C.bold}${C.white}${s.id}${C.reset}  ${modeStr}${originTag}  ${C.gray}${dateStr}${C.reset}  ${C.white}${title}${C.reset}  ${tokenStr}  ${C.darkGray}(${s.messageCount} msgs)${C.reset}\n`;
  }

  content += `\n  ${C.darkGray}───────────────────────────────────────────────────────────────────${C.reset}\n`;
  content += `  ${C.white}Total sesiones sincronizadas:${C.reset} ${C.bold}${C.green}${sessions.length}${C.reset} ${C.white}conversaciones (${totalTokensAll.toLocaleString()} tokens acumulados).${C.reset}\n`;
  content += `  ${C.gray}Comandos rápidos: /session new [nombre] · /session resume <id> · /session delete <id> · /session info${C.reset}`;

  return box('Historial de Sesiones (Local & Nube Deiza)', content, C.granate);
}

function renderSessionInfo(session) {
  if (!session) return `\n  ${C.gray}No hay información de sesión activa.${C.reset}\n`;
  const tokens = session.tokens || { prompt: 0, completion: 0, total: 0 };
  const modeStr = `${modeBadge(session.mode || 'build')} ${C.gray}${(MODE_INFO[session.mode] || MODE_INFO.build).desc}${C.reset}`;
  const created = session.createdAt ? new Date(session.createdAt).toLocaleString('es-ES') : '-';
  const updated = session.updatedAt ? new Date(session.updatedAt).toLocaleString('es-ES') : '-';
  const msgCount = Array.isArray(session.messages) ? session.messages.length : 0;

  let content = '';
  content += `${C.white}ID de Sesión:${C.reset}         ${C.bold}${C.rose}${session.id}${C.reset}\n`;
  content += `${C.white}Título / Asunto:${C.reset}      ${C.bold}${session.title || 'Nueva conversación'}${C.reset}\n`;
  content += `${C.white}Modo de Trabajo:${C.reset}      ${modeStr}\n`;
  content += `${C.white}Ruta Workspace:${C.reset}       ${C.gray}${session.cwd || process.cwd()}${C.reset}\n`;
  content += `${C.white}Mensajes Guardados:${C.reset}   ${C.bold}${msgCount}${C.reset} mensajes\n`;
  content += `${C.white}Inicio de Conversación:${C.reset}${C.gray} ${created}${C.reset}\n`;
  content += `${C.white}Última Actualización:${C.reset}  ${C.gray}${updated}${C.reset}\n\n`;
  content += `${C.granateBright}── Métricas de Consumo de Tokens (Esta Sesión) ──${C.reset}\n`;
  content += `${C.white}Tokens de Entrada (Prompt):${C.reset}      ${C.bold}${tokens.prompt.toLocaleString()}${C.reset}\n`;
  content += `${C.white}Tokens de Salida (Completion):${C.reset}  ${C.bold}${tokens.completion.toLocaleString()}${C.reset}\n`;
  content += `${C.white}Total Tokens Sesión:${C.reset}            ${C.bold}${C.green}${tokens.total.toLocaleString()}${C.reset} tokens consumidos\n`;

  return box(`Métricas de Sesión — ${session.id}`, content, C.granate);
}

/**
 * Renders the context compaction results box
 */
function renderCompactionCard(beforeTokens, afterTokens, freedPct, limit = 262144) {
  const lim = `${Math.round(limit / 1024)}K`;
  let content = '';
  content += `${C.white}Contexto Previo:      ${C.gold}${beforeTokens.toLocaleString()}${C.reset} tokens (${((beforeTokens / limit) * 100).toFixed(1)}% de ${lim})\n`;
  content += `${C.white}Contexto Compactado:  ${C.green}${C.bold}${afterTokens.toLocaleString()}${C.reset} tokens (${((afterTokens / limit) * 100).toFixed(2)}% de ${lim})\n`;
  content += `${C.white}Espacio Recuperado:   ${C.cyan}${C.bold}${freedPct}% de reducción${C.reset} (espacio libre)\n\n`;
  content += `${C.gray}✓ La memoria del proyecto (archivos editados, comandos y decisiones) se preservó intacta.${C.reset}`;
  return box('Compactación de Contexto', content, C.granate);
}

/**
 * Interactive arrow-key session selector (TUI)
 */
function selectSessionInteractive(sessions, activeSessionId) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !sessions || sessions.length === 0) {
      return resolve(null);
    }

    const items = [
      ...sessions.map((s) => ({
        type: 'session',
        id: s.id,
        title: s.title || 'Conversación sin título',
        mode: s.mode || 'build',
        date: s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('es-ES', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        msgCount: s.messageCount || (Array.isArray(s.messages) ? s.messages.length : 0),
        tokens: s.tokens?.total || 0,
        isActive: s.id === activeSessionId,
        source: s.source || 'local',
        isCurrentWorkspace: s.isCurrentWorkspace !== false,
      })),
      {
        type: 'new',
        id: 'new',
        title: '+ Iniciar nueva conversación limpia',
        mode: 'build',
        date: '',
        msgCount: 0,
        tokens: 0,
        isActive: false,
        source: 'local',
        isCurrentWorkspace: true,
      },
    ];

    let selectedIndex = 0;
    const initialActiveIdx = items.findIndex(it => it.isActive);
    if (initialActiveIdx >= 0) selectedIndex = initialActiveIdx;

    let renderedLinesCount = 0;

    const render = () => {
      // Clear previous render cleanly
      if (renderedLinesCount > 0) {
        process.stdout.write(`\x1b[${renderedLinesCount}A\x1b[0J`);
      }

      let out = `\n  ${C.granateBold}╭─ Selector Interactivo de Sesiones ──────────────────────────────────────╮${C.reset}\n`;
      out += `  ${C.gray}│ Usa las flechas [↑/↓] para navegar, [Enter] para elegir, [Esc] para salir │${C.reset}\n`;
      out += `  ${C.granateBold}├─────────────────────────────────────────────────────────────────────────┤${C.reset}\n`;

      const visibleSlice = items.slice(0, 10);
      visibleSlice.forEach((item, idx) => {
        const isSelected = idx === selectedIndex;
        const pointer = isSelected ? `${C.granateBright}❯${C.reset}` : ' ';
        const activeMarker = item.isActive ? ` ${C.green}●${C.reset}` : '  ';

        if (item.type === 'new') {
          const label = isSelected
            ? `${C.greenBright}${C.bold}${item.title}${C.reset}`
            : `${C.gray}${item.title}${C.reset}`;
          out += `  │  ${pointer}  ${label.padEnd(80)}│\n`;
        } else {
          const idColor = isSelected ? `${C.white}${C.bold}` : `${C.gray}`;
          const badge = modeBadge(item.mode);
          const rawTitle = item.title.length > 26 ? item.title.slice(0, 24) + '..' : item.title;
          const titleStr = isSelected ? `${C.white}${C.bold}${rawTitle}${C.reset}` : `${C.white}${rawTitle}${C.reset}`;
          const tokStr = item.tokens > 0 ? `${C.gold}${(item.tokens / 1000).toFixed(1)}k tok${C.reset}` : `${C.darkGray}0 tok${C.reset}`;
          const countStr = `${C.gray}${item.msgCount}m${C.reset}`;
          const cloudIcon = item.source === 'cloud' ? `${C.cyan}☁ ${C.reset}` : '';

          out += `  │  ${pointer}${activeMarker} ${cloudIcon}${idColor}${item.id}${C.reset}  ${badge}  ${titleStr.padEnd(28)} ${tokStr} · ${countStr}   │\n`;
        }
      });

      out += `  ${C.granateBold}╰─────────────────────────────────────────────────────────────────────────╯${C.reset}\n`;

      process.stdout.write(out);
      renderedLinesCount = out.split('\n').length - 1;
    };

    const wasRaw = process.stdin.isRaw;
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (chunk) => {
      const s = chunk.toString();
      // Arrow Up (\u001b[A or k)
      if (s === '\u001b[A' || s === 'k') {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        render();
        return;
      }
      // Arrow Down (\u001b[B or j)
      if (s === '\u001b[B' || s === 'j') {
        selectedIndex = (selectedIndex + 1) % items.length;
        render();
        return;
      }
      // Enter
      if (s === '\r' || s === '\n') {
        cleanup();
        const chosen = items[selectedIndex];
        resolve(chosen);
        return;
      }
      // Escape or Ctrl+C or q
      if (s === '\u001b' || s === '\u0003' || s === 'q' || s === 'Q') {
        cleanup();
        resolve(null);
        return;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      if (process.stdin.setRawMode) process.stdin.setRawMode(wasRaw || false);
      if (renderedLinesCount > 0) {
        process.stdout.write(`\x1b[${renderedLinesCount}A\x1b[0J`);
      }
    };

    process.stdin.on('data', onData);
    render();
  });
}

module.exports = {
  C,
  BANNER,
  createLiveLine,
  createSpinner,
  formatBytes,
  formatDuration,
  MODE_INFO,
  modeBadge,
  modelBadge,
  renderModes,
  renderModelSelector,
  Status,
  renderDiff,
  box,
  highlightMarkdown,
  createMarkdownStream,
  printToolCard,
  COMMANDS_REGISTRY,
  renderCommandPalette,
  renderWhoami,
  renderSessionList,
  renderSessionInfo,
  renderCompactionCard,
  selectSessionInteractive,
};


