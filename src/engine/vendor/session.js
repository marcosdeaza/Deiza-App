const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const SESSIONS_ROOT = path.join(os.homedir(), '.deiza', 'sessions');

let _cloudSyncConfig = {
  apiKey: '',
  accountBase: 'https://deiza.org',
};

/**
 * Configure credentials for Deiza Cloud session sync
 */
function configureCloudSync({ apiKey, accountBase } = {}) {
  if (apiKey !== undefined) _cloudSyncConfig.apiKey = apiKey || '';
  if (accountBase !== undefined) _cloudSyncConfig.accountBase = accountBase || 'https://deiza.org';
}

/**
 * Retrieves credentials from memory, env, or ~/.deiza/config.json
 */
function getStoredCredentials() {
  if (_cloudSyncConfig.apiKey) {
    return _cloudSyncConfig;
  }
  const envKey = (process.env.DEIZA_API_KEY || '').trim();
  if (envKey) {
    return {
      apiKey: envKey,
      accountBase: process.env.DEIZA_API_BASE || 'https://deiza.org',
    };
  }
  try {
    const cfgPath = path.join(os.homedir(), '.deiza', 'config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed.apiKey) {
        return {
          apiKey: parsed.apiKey,
          accountBase: parsed.accountBase || 'https://deiza.org',
        };
      }
    }
  } catch {}
  return _cloudSyncConfig;
}

/**
 * Fast JSON request helper for background session sync
 */
function httpJson(method, urlStr, { apiKey, body, timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      return resolve({ ok: false, status: 0, data: null });
    }
    const client = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Accept': 'application/json', 'User-Agent': 'deiza-code' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['X-Api-Key'] = apiKey;
    }
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = client.request(url, { method, headers, timeout }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch { data = null; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, data: null }); });
    req.on('error', () => resolve({ ok: false, status: 0, data: null }));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Asynchronously syncs session to Deiza Cloud in background
 */
function syncSessionToCloud(session) {
  return new Promise((resolve) => {
    try {
      const creds = getStoredCredentials();
      if (!creds.apiKey || !session || !session.id) return resolve(false);
      const base = (creds.accountBase || 'https://deiza.org').replace(/\/+$/, '');
      const url = `${base}/api/code/sessions/${encodeURIComponent(session.id)}`;
      httpJson('PUT', url, {
        apiKey: creds.apiKey,
        body: { session },
        timeout: 6000,
      }).then((res) => resolve(res && res.ok)).catch(() => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Fetches a single session from Deiza Cloud
 */
function fetchCloudSession(sessionId) {
  return new Promise((resolve) => {
    try {
      const creds = getStoredCredentials();
      if (!creds.apiKey || !sessionId) return resolve(null);
      const base = (creds.accountBase || 'https://deiza.org').replace(/\/+$/, '');
      const url = `${base}/api/code/sessions/${encodeURIComponent(sessionId)}`;
      httpJson('GET', url, {
        apiKey: creds.apiKey,
        timeout: 6000,
      }).then((res) => {
        if (res && res.ok && res.data && res.data.session) {
          resolve(res.data.session);
        } else {
          resolve(null);
        }
      }).catch(() => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Lists all cloud-synced sessions for user
 */
function listCloudSessions() {
  return new Promise((resolve) => {
    try {
      const creds = getStoredCredentials();
      if (!creds.apiKey) return resolve([]);
      const base = (creds.accountBase || 'https://deiza.org').replace(/\/+$/, '');
      const url = `${base}/api/code/sessions`;
      httpJson('GET', url, {
        apiKey: creds.apiKey,
        timeout: 5000,
      }).then((res) => {
        if (res && res.ok && Array.isArray(res.data?.sessions)) {
          resolve(res.data.sessions);
        } else {
          resolve([]);
        }
      }).catch(() => resolve([]));
    } catch {
      resolve([]);
    }
  });
}

/**
 * Deletes a session from Deiza Cloud
 */
function deleteCloudSession(sessionId) {
  return new Promise((resolve) => {
    try {
      const creds = getStoredCredentials();
      if (!creds.apiKey || !sessionId) return resolve(false);
      const base = (creds.accountBase || 'https://deiza.org').replace(/\/+$/, '');
      const url = `${base}/api/code/sessions/${encodeURIComponent(sessionId)}`;
      httpJson('DELETE', url, {
        apiKey: creds.apiKey,
        timeout: 5000,
      }).then((res) => resolve(res && res.ok)).catch(() => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Normalizes CWD path for consistent workspace hashing across OSes
 */
function normalizeCwd(cwd = process.cwd()) {
  let resolved = path.resolve(cwd || process.cwd());
  if (process.platform === 'win32') {
    resolved = resolved.replace(/^[A-Za-z]:/, (m) => m.toLowerCase());
  }
  return resolved;
}

/**
 * Generates a stable directory name for a workspace path
 */
function getWorkspaceHash(cwd = process.cwd()) {
  const norm = normalizeCwd(cwd);
  return crypto.createHash('md5').update(norm).digest('hex').slice(0, 12);
}

/**
 * Returns the directory where sessions for the current workspace are stored
 */
function getWorkspaceSessionsDir(cwd = process.cwd()) {
  const hash = getWorkspaceHash(cwd);
  const dir = path.join(SESSIONS_ROOT, hash);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Generates a unique session ID
 */
function generateSessionId() {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(3).toString('hex');
  return `ses_${dateStr}_${rand}`;
}

/**
 * Quick token estimator for fallback when backend doesn't send usage header
 */
function estimateTokens(text) {
  if (!text) return 0;
  if (typeof text !== 'string') text = JSON.stringify(text);
  return Math.max(1, Math.ceil(text.length / 3.8));
}

/**
 * Accurately calculates current active context tokens from in-memory messages array
 */
function getActiveContextTokens(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let totalChars = 0;
  for (const m of messages) {
    if (!m) continue;
    if (typeof m.content === 'string') {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (typeof part?.text === 'string') totalChars += part.text.length;
      }
    }
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        totalChars += String(tc?.function?.arguments || '').length + 50;
      }
    }
  }
  return Math.max(1, Math.ceil(totalChars / 3.8));
}

/**
 * Creates a new session object
 */
function createSession(cwd = process.cwd(), mode = 'build', customTitle = null) {
  const id = generateSessionId();
  const session = {
    id,
    title: customTitle || 'Nueva conversación',
    cwd: normalizeCwd(cwd),
    mode,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contextTokens: 0,
    tokens: {
      prompt: 0,
      completion: 0,
      total: 0,
    },
    messages: [],
  };
  saveSession(session);
  return session;
}

/**
 * Saves a session to disk and asynchronously syncs with Deiza Cloud
 */
function saveSession(session) {
  try {
    if (!session || !session.id) return;
    const dir = getWorkspaceSessionsDir(session.cwd || process.cwd());
    const filePath = path.join(dir, `${session.id}.json`);
    session.updatedAt = new Date().toISOString();
    if (!session.tokens) {
      session.tokens = { prompt: 0, completion: 0, total: 0 };
    }
    if (Array.isArray(session.messages)) {
      session.contextTokens = getActiveContextTokens(session.messages);
    }
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');

    // Background cloud sync (fire-and-forget, never throws or blocks)
    syncSessionToCloud(session).catch(() => {});
  } catch (err) {
    // Fail silently without crashing CLI
  }
}

/**
 * Resolves full or partial session ID across current workspace and other local workspaces
 */
function findSessionId(query, cwd = process.cwd()) {
  if (!query) return null;
  const clean = query.trim();
  const currentDir = getWorkspaceSessionsDir(cwd);

  // 1. Current workspace match
  if (fs.existsSync(currentDir)) {
    const files = fs.readdirSync(currentDir).filter(f => f.endsWith('.json'));
    if (files.includes(`${clean}.json`)) return clean;
    const match = files.find(f => {
      const id = f.replace('.json', '');
      return id.includes(clean) || id.endsWith(clean);
    });
    if (match) return match.replace('.json', '');
  }

  // 2. Global fallback across other workspace directories
  if (fs.existsSync(SESSIONS_ROOT)) {
    try {
      const wsDirs = fs.readdirSync(SESSIONS_ROOT);
      for (const d of wsDirs) {
        const fullDir = path.join(SESSIONS_ROOT, d);
        if (fullDir === currentDir) continue;
        try {
          if (!fs.statSync(fullDir).isDirectory()) continue;
          const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.json'));
          if (files.includes(`${clean}.json`)) return clean;
          const match = files.find(f => {
            const id = f.replace('.json', '');
            return id.includes(clean) || id.endsWith(clean);
          });
          if (match) return match.replace('.json', '');
        } catch {}
      }
    } catch {}
  }

  return null;
}

/**
 * Reads and validates a session JSON file
 */
function readAndNormalizeSession(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.tokens) {
      data.tokens = { prompt: 0, completion: 0, total: 0 };
    }
    if (!data.contextTokens && Array.isArray(data.messages)) {
      data.contextTokens = getActiveContextTokens(data.messages);
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Synchronously loads a session from current or any other local workspace
 */
function loadSession(sessionIdOrQuery, cwd = process.cwd()) {
  try {
    const resolvedId = findSessionId(sessionIdOrQuery, cwd) || sessionIdOrQuery;
    const currentDir = getWorkspaceSessionsDir(cwd);
    const filePath = path.join(currentDir, `${resolvedId}.json`);

    // 1. Current workspace
    if (fs.existsSync(filePath)) {
      return readAndNormalizeSession(filePath);
    }

    // 2. Search other local workspaces
    if (fs.existsSync(SESSIONS_ROOT)) {
      const wsDirs = fs.readdirSync(SESSIONS_ROOT);
      for (const d of wsDirs) {
        const candidate = path.join(SESSIONS_ROOT, d, `${resolvedId}.json`);
        if (fs.existsSync(candidate)) {
          const loaded = readAndNormalizeSession(candidate);
          if (loaded) {
            // Cache in current workspace for fast future lookups
            saveSession(loaded);
            return loaded;
          }
        }
      }
    }
  } catch (err) {}
  return null;
}

/**
 * Asynchronously loads a session, checking local disk first, then Deiza Cloud
 */
async function loadSessionAsync(sessionIdOrQuery, cwd = process.cwd()) {
  const local = loadSession(sessionIdOrQuery, cwd);
  if (local) return local;

  const targetId = (findSessionId(sessionIdOrQuery, cwd) || sessionIdOrQuery).trim();
  try {
    const cloudSession = await fetchCloudSession(targetId);
    if (cloudSession && cloudSession.id) {
      cloudSession.cwd = normalizeCwd(cwd);
      saveSession(cloudSession);
      return cloudSession;
    }
  } catch {}
  return null;
}

/**
 * Adds token consumption to a session
 */
function addSessionTokens(session, usage = {}, messages = null) {
  if (!session) return;
  if (!session.tokens) {
    session.tokens = { prompt: 0, completion: 0, total: 0 };
  }
  const p = Number(usage.promptTokens || usage.prompt_tokens || 0);
  const c = Number(usage.completionTokens || usage.completion_tokens || 0);
  const t = Number(usage.totalTokens || usage.total_tokens || (p + c));

  session.tokens.prompt = (session.tokens.prompt || 0) + p;
  session.tokens.completion = (session.tokens.completion || 0) + c;
  session.tokens.total = (session.tokens.total || 0) + t;

  if (messages && Array.isArray(messages)) {
    session.contextTokens = getActiveContextTokens(messages);
  } else if (Array.isArray(session.messages)) {
    session.contextTokens = getActiveContextTokens(session.messages);
  }
  saveSession(session);
}

/**
 * Lists sessions for the given workspace, with optional multi-workspace fallback
 */
function listSessions(cwd = process.cwd(), { includeAll = true } = {}) {
  try {
    const currentDir = getWorkspaceSessionsDir(cwd);
    const sessions = [];
    const seenIds = new Set();

    // 1. Current workspace
    if (fs.existsSync(currentDir)) {
      const files = fs.readdirSync(currentDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const filePath = path.join(currentDir, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (data && data.id && !seenIds.has(data.id)) {
            seenIds.add(data.id);
            sessions.push({
              id: data.id,
              title: data.title || 'Conversación sin título',
              mode: data.mode || 'build',
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
              contextTokens: data.contextTokens || getActiveContextTokens(data.messages || []),
              tokens: data.tokens || { prompt: 0, completion: 0, total: 0 },
              messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
              isCurrentWorkspace: true,
              source: 'local',
            });
          }
        } catch {}
      }
    }

    // 2. Fallback to other local workspaces if requested or if current is empty
    if (includeAll && fs.existsSync(SESSIONS_ROOT)) {
      try {
        const wsDirs = fs.readdirSync(SESSIONS_ROOT);
        for (const d of wsDirs) {
          const fullDir = path.join(SESSIONS_ROOT, d);
          if (fullDir === currentDir) continue;
          try {
            if (!fs.statSync(fullDir).isDirectory()) continue;
            const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
              try {
                const filePath = path.join(fullDir, file);
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (data && data.id && !seenIds.has(data.id)) {
                  seenIds.add(data.id);
                  sessions.push({
                    id: data.id,
                    title: data.title || 'Conversación sin título',
                    mode: data.mode || 'build',
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                    contextTokens: data.contextTokens || getActiveContextTokens(data.messages || []),
                    tokens: data.tokens || { prompt: 0, completion: 0, total: 0 },
                    messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
                    isCurrentWorkspace: false,
                    source: 'other_workspace',
                  });
                }
              } catch {}
            }
          } catch {}
        }
      } catch {}
    }

    return sessions.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch (err) {
    return [];
  }
}

/**
 * Asynchronously lists sessions merging local workspace, other workspaces, and Deiza Cloud
 */
async function listSessionsWithCloud(cwd = process.cwd()) {
  const localList = listSessions(cwd, { includeAll: true });
  const seenIds = new Set(localList.map(s => s.id));

  try {
    const cloudSessions = await listCloudSessions();
    if (Array.isArray(cloudSessions)) {
      for (const cs of cloudSessions) {
        if (!cs || !cs.id || seenIds.has(cs.id)) continue;
        seenIds.add(cs.id);
        localList.push({
          id: cs.id,
          title: cs.title || 'Conversación en nube',
          mode: cs.mode || 'build',
          createdAt: cs.created_at || cs.createdAt,
          updatedAt: cs.updated_at || cs.updatedAt,
          contextTokens: cs.contextTokens || 0,
          tokens: cs.tokens || { prompt: 0, completion: 0, total: 0 },
          messageCount: cs.messageCount || 0,
          isCurrentWorkspace: false,
          source: 'cloud',
        });
      }
    }
  } catch {}

  return localList.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

/**
 * Returns the most recent session for this workspace, if any
 */
function getLatestSession(cwd = process.cwd()) {
  const currentDir = getWorkspaceSessionsDir(cwd);
  if (fs.existsSync(currentDir)) {
    const files = fs.readdirSync(currentDir).filter(f => f.endsWith('.json'));
    if (files.length > 0) {
      const localSessions = listSessions(cwd, { includeAll: false });
      if (localSessions.length > 0) {
        return loadSession(localSessions[0].id, cwd);
      }
    }
  }
  return null;
}

/**
 * Updates session title based on first user prompt if still default
 */
function updateSessionTitleFromPrompt(session, promptText) {
  if (!session || !promptText) return;
  if (session.title === 'Nueva conversación' || !session.title) {
    const cleaned = promptText.trim().replace(/[\r\n]+/g, ' ');
    session.title = cleaned.length > 45 ? cleaned.slice(0, 42) + '...' : cleaned;
    saveSession(session);
  }
}

/**
 * Deletes a session locally and from Deiza Cloud
 */
function deleteSession(sessionIdOrQuery, cwd = process.cwd()) {
  try {
    const resolvedId = findSessionId(sessionIdOrQuery, cwd) || (typeof sessionIdOrQuery === 'string' ? sessionIdOrQuery.trim() : null);
    if (!resolvedId) return { success: false, id: sessionIdOrQuery };

    let deletedLocally = false;

    // 1. Delete from current workspace
    const currentDir = getWorkspaceSessionsDir(cwd);
    const filePath = path.join(currentDir, `${resolvedId}.json`);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); deletedLocally = true; } catch {}
    }

    // 2. Delete from any other local workspace folder
    if (fs.existsSync(SESSIONS_ROOT)) {
      try {
        const wsDirs = fs.readdirSync(SESSIONS_ROOT);
        for (const d of wsDirs) {
          const candidate = path.join(SESSIONS_ROOT, d, `${resolvedId}.json`);
          if (fs.existsSync(candidate)) {
            try { fs.unlinkSync(candidate); deletedLocally = true; } catch {}
          }
        }
      } catch {}
    }

    // 3. Delete from cloud
    deleteCloudSession(resolvedId).catch(() => {});

    return { success: true, id: resolvedId };
  } catch (err) {}
  return { success: false, id: sessionIdOrQuery };
}

module.exports = {
  createSession,
  saveSession,
  loadSession,
  loadSessionAsync,
  listSessions,
  listSessionsWithCloud,
  getLatestSession,
  updateSessionTitleFromPrompt,
  deleteSession,
  addSessionTokens,
  getActiveContextTokens,
  estimateTokens,
  findSessionId,
  getWorkspaceHash,
  configureCloudSync,
  syncSessionToCloud,
  fetchCloudSession,
  listCloudSessions,
  deleteCloudSession,
};
