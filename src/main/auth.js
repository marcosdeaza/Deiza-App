/**
 * The Deiza session token lives in the Chat view (localStorage `deiza:auth_token`, written by
 * the web login). The chat preload reports it here; it is kept encrypted with the OS keychain
 * (safeStorage) so Code mode works right after launch, before the web has loaded.
 * The token never reaches the local UI renderer: only the main process and the Code workers.
 */
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const file = () => path.join(app.getPath('userData'), 'session.bin');
let token = '';
let user = null;
const listeners = new Set();

function load() {
  try {
    const raw = fs.readFileSync(file());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    const parsed = JSON.parse(text);
    token = String(parsed.token || '');
    user = parsed.user || null;
  } catch {
    token = '';
    user = null;
  }
}

function persist() {
  try {
    if (!token) { fs.rmSync(file(), { force: true }); return; }
    const text = JSON.stringify({ token, user });
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8');
    fs.writeFileSync(file(), data);
  } catch (err) {
    console.error('auth persist:', err.message);
  }
}

function set(nextToken, nextUser) {
  const t = String(nextToken || '').trim();
  const changed = t !== token || JSON.stringify(nextUser || null) !== JSON.stringify(user);
  token = t;
  user = t ? (nextUser || user) : null;
  if (!changed) return;
  persist();
  for (const fn of listeners) fn(state());
}

function state() {
  return {
    signedIn: Boolean(token),
    user: user ? { name: user.name || '', email: user.email || '', plan: user.plan || '', avatar: user.avatar || '' } : null,
  };
}

module.exports = {
  load,
  set,
  state,
  getToken: () => token,
  onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
};
