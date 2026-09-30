/**
 * DEIZA CODE — Configuration & Settings
 * Storage in ~/.deiza/config.json plus DEIZA_* environment overrides.
 *
 * Native models (context window in tokens):
 *   - deiza-liquid:   Liquid 5.1 (default, balanced and agentic, 256K)
 *   - deiza-solid:    Solid 5    (the most capable: methodical, coding and research, reads images, 256K)
 *   - deiza-gas:      Gas 4.5    (fastest and lightest, 128K)
 * Vainilla was retired in 2.2.0; saved configs that still name it open Gas.
 *
 * Two different URLs live in the config:
 *   - accountBase: the Deiza account server (login, plan, usage). Always deiza.org.
 *   - apiBase:     the inference endpoint. deiza.org by default; can point to any
 *                  OpenAI-compatible server (Ollama, vLLM, LM Studio...) after login.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEIZA_DIR = path.join(os.homedir(), '.deiza');
const CONFIG_FILE = path.join(DEIZA_DIR, 'config.json');
const SESSIONS_DIR = path.join(DEIZA_DIR, 'sessions');

const VERSION = '2.2.1';
const DEFAULT_DEIZA_API = 'https://deiza.org';
const DEFAULT_MODEL = 'deiza-liquid';

const NATIVE_MODELS = ['deiza-liquid', 'deiza-solid', 'deiza-gas'];

const MODEL_ALIASES = {
  'liquid': 'deiza-liquid',
  'liquid-5': 'deiza-liquid',
  'liquid5': 'deiza-liquid',
  'liquid-5.1': 'deiza-liquid',
  '5': 'deiza-liquid',
  '1': 'deiza-liquid',

  'solid': 'deiza-solid',
  'solid-5': 'deiza-solid',
  'solid5': 'deiza-solid',
  'solid-4.6': 'deiza-solid',
  'solid-4.5': 'deiza-solid',
  'solid45': 'deiza-solid',
  '4.5': 'deiza-solid',
  '2': 'deiza-solid',

  'gas': 'deiza-gas',
  'gas-4.5': 'deiza-gas',
  'gas-4.1': 'deiza-gas',
  'gas41': 'deiza-gas',
  '4.1': 'deiza-gas',
  '3': 'deiza-gas',

  // Vainilla was retired: its names now open Gas
  'vainilla': 'deiza-gas',
  'vanilla': 'deiza-gas',
  'deiza-vainilla': 'deiza-gas',
  '4': 'deiza-gas',

  'omniscient': 'deiza-liquid',
  'deiza-omniscient': 'deiza-liquid',
  'default': 'deiza-liquid',
};

const MODEL_INFO = {
  'deiza-liquid': {
    id: 'deiza-liquid',
    shortName: 'liquid',
    name: 'Deiza Liquid 5.1',
    badge: 'Liquid 5.1 · 256K tokens',
    tag: 'LIQUID 5.1',
    desc: 'Motor principal autónomo. Ventana de 256K tokens, alta velocidad y diffs limpios.',
    tier: 'Equilibrado',
    speed: 'Rápido',
    default: true,
  },
  'deiza-solid': {
    id: 'deiza-solid',
    shortName: 'solid',
    name: 'Deiza Solid 5',
    badge: 'Solid 5 · El más capaz',
    tag: 'SOLID 5',
    desc: 'El más capaz y metódico. Planifica antes de tocar el código y verifica cada paso: arquitectura, refactorizaciones grandes, depuración difícil e investigación.',
    tier: 'Razonamiento',
    speed: 'Analítico',
    default: false,
  },
  'deiza-gas': {
    id: 'deiza-gas',
    shortName: 'gas',
    name: 'Deiza Gas 4.5',
    badge: 'Gas 4.5 · Ultra-rápido',
    tag: 'GAS 4.5',
    desc: 'El más rápido y ligero. Para cambios pequeños, scripts e iteraciones ágiles.',
    tier: 'Velocidad',
    speed: 'Ultra-rápido',
    default: false,
  },

};

// Real context windows (tokens) of the native engines. Compaction starts at 70 % of the window of
// the model in use; custom endpoints get a conservative 128K.
const CONTEXT_LIMITS = {
  'deiza-liquid': 262144,
  'deiza-solid': 262144,
  'deiza-gas': 131072,
};
function contextLimit(model) {
  return CONTEXT_LIMITS[model] || (model && String(model).startsWith('deiza') ? 262144 : 131072);
}

// Build flavor. 'open' = the GitHub edition (any OpenAI-compatible engine can be plugged in);
// 'closed' = the deiza.org installer edition (Deiza native models only, no endpoint options).
// The bundler injects DEIZA_FLAVOR; running from the source tree defaults to open.
const FLAVOR = (typeof DEIZA_FLAVOR !== 'undefined' && DEIZA_FLAVOR) || process.env.DEIZA_FLAVOR || 'open';
const IS_CLOSED = FLAVOR === 'closed';
const MODES = ['build', 'copilot', 'plan'];
const DEFAULT_MODE = 'build';

function ensureDirs() {
  if (!fs.existsSync(DEIZA_DIR)) fs.mkdirSync(DEIZA_DIR, { recursive: true });
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function isDeizaHost(url) {
  try {
    const host = new URL(normalizeUrl(url)).hostname.toLowerCase();
    return host === 'deiza.org' || host.endsWith('.deiza.org');
  } catch {
    return false;
  }
}

function normalizeMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  return MODES.includes(m) ? m : DEFAULT_MODE;
}

function normalizeModel(modelStr, isCustom = false) {
  const s = String(modelStr || '').trim();
  if (isCustom) return s || 'default';
  const lower = s.toLowerCase();
  if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower];
  if (NATIVE_MODELS.includes(lower)) return lower;
  return DEFAULT_MODEL;
}

function loadConfig() {
  ensureDirs();
  let fileConfig = {};
  let needsResave = false;
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch {
      fileConfig = {};
    }
  }

  const accountBase = normalizeUrl(process.env.DEIZA_API_URL || DEFAULT_DEIZA_API);
  const savedEndpoint = IS_CLOSED ? '' : normalizeUrl(fileConfig.endpoint || '');
  const endpoint = IS_CLOSED ? '' : normalizeUrl(process.env.DEIZA_ENDPOINT || savedEndpoint);
  const apiBase = endpoint && !isDeizaHost(endpoint) ? endpoint : accountBase;
  const apiKey = String(process.env.DEIZA_API_KEY || fileConfig.apiKey || '').trim();
  const isCustom = apiBase !== accountBase;

  let rawModel = isCustom
    ? String(process.env.DEIZA_MODEL || fileConfig.endpointModel || fileConfig.model || 'default').trim()
    : String(process.env.DEIZA_MODEL || fileConfig.model || DEFAULT_MODEL).trim();

  const model = normalizeModel(rawModel, isCustom);
  if (!isCustom && fileConfig.model && fileConfig.model !== model) {
    fileConfig.model = model;
    needsResave = true;
  }

  const result = {
    ...fileConfig,
    accountBase,
    apiBase,
    endpoint: apiBase === accountBase ? '' : apiBase,
    apiKey,
    model,
    email: fileConfig.email || '',
    name: fileConfig.name || '',
    plan: fileConfig.plan || '',
    endpointKey: String(process.env.DEIZA_ENDPOINT_KEY || fileConfig.endpointKey || '').trim(),
    endpointModel: fileConfig.endpointModel || '',
    defaultMode: normalizeMode(fileConfig.defaultMode),
    isCustomEndpoint: isCustom,
  };

  if (needsResave) {
    try { saveConfig(result); } catch {}
  }

  return result;
}

function saveConfig(cfg) {
  ensureDirs();
  // Never persist derived fields; the file stays small and forward compatible.
  const { accountBase, isCustomEndpoint, apiBase, mode, usage, ...rest } = cfg || {};
  const toSave = { ...rest, endpoint: cfg.endpoint || '' };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
}

module.exports = {
  CONTEXT_LIMITS,
  contextLimit,
  VERSION,
  FLAVOR,
  IS_CLOSED,
  DEIZA_DIR,
  CONFIG_FILE,
  SESSIONS_DIR,
  DEFAULT_DEIZA_API,
  DEFAULT_MODEL,
  NATIVE_MODELS,
  MODEL_ALIASES,
  MODEL_INFO,
  MODES,
  DEFAULT_MODE,
  loadConfig,
  saveConfig,
  isDeizaHost,
  normalizeMode,
  normalizeModel,
  normalizeUrl,
};
