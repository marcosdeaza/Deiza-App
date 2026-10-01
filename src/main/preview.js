/**
 * deiza-preview://<folder-id>/<path> serves the files of a Code project to the side panel, so a
 * generated site renders with its relative CSS, JS and images exactly as in a browser. Each
 * project folder gets an opaque host id; requests cannot escape the folder.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { protocol, net } = require('electron');

const SCHEME = 'deiza-preview';
const roots = new Map(); // host -> absolute folder

function hostFor(folder) {
  const abs = path.resolve(folder);
  const host = `p${crypto.createHash('sha256').update(abs).digest('hex').slice(0, 20)}`;
  roots.set(host, abs);
  return host;
}

function urlFor(folder, rel) {
  const clean = String(rel || '').split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/');
  return `${SCHEME}://${hostFor(folder)}/${clean}`;
}

function register(ses) {
  const handler = ses?.protocol || protocol;
  if (handler.isProtocolHandled(SCHEME)) return;
  handler.handle(SCHEME, async (request) => {
    const u = new URL(request.url);
    const root = roots.get(u.hostname);
    if (!root) return new Response('Not found', { status: 404 });
    let rel;
    try { rel = decodeURIComponent(u.pathname); } catch { return new Response('Bad request', { status: 400 }); }
    let full = path.resolve(root, `.${rel}`);
    const r = path.relative(root, full);
    if (r.startsWith('..') || path.isAbsolute(r)) return new Response('Forbidden', { status: 403 });
    try {
      if (fs.statSync(full).isDirectory()) full = path.join(full, 'index.html');
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (!fs.existsSync(full)) return new Response('Not found', { status: 404 });
    try {
      const canonicalRoot = fs.realpathSync(root), canonicalFile = fs.realpathSync(full);
      const relative = path.relative(canonicalRoot, canonicalFile);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
      full = canonicalFile;
    } catch { return new Response('Not found', { status: 404 }); }
    const res = await net.fetch(pathToFileURL(full).toString());
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  });
}

module.exports = { SCHEME, register, urlFor };
