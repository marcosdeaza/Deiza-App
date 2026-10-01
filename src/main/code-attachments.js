/** Local attachments selected by the user. Archives are parsed without executing their contents. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const MAX_FILE = 64 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml' };
const VISION_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function inside(root, target) { const rel = path.relative(root, target); return !rel.startsWith('..') && !path.isAbsolute(rel); }
function archiveName(raw) {
  const name = String(raw).replace(/\\/g, '/');
  if (!name || name.includes('\0') || /[\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(p => p === '..' || p.includes(':') || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('El ZIP contiene una ruta no válida para la carpeta de extracción.');
  return name;
}
function extractZip(file, root) {
  const zip = fs.readFileSync(file);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { end = i; break; }
  if (end < 0) throw new Error('El archivo ZIP está dañado o tiene un formato no compatible.');
  const count = zip.readUInt16LE(end + 10), start = zip.readUInt32LE(end + 16);
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || count === 65535 || start === 0xffffffff) throw new Error('Este ZIP dividido o ZIP64 no es compatible.');
  if (count > 2000) throw new Error('El ZIP contiene más de 2.000 entradas. Adjunta una parte más pequeña.');
  const entries = [], used = new Set();
  let total = 0, offset = start;
  for (let i = 0; i < count; i++) {
    if (offset < 0 || offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Índice ZIP no válido.');
    const flags = zip.readUInt16LE(offset + 8), method = zip.readUInt16LE(offset + 10), checksum = zip.readUInt32LE(offset + 16);
    const compressed = zip.readUInt32LE(offset + 20), size = zip.readUInt32LE(offset + 24);
    const nl = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    const attr = zip.readUInt32LE(offset + 38), local = zip.readUInt32LE(offset + 42);
    if (offset + 46 + nl + extra + comment > zip.length) throw new Error('Índice ZIP truncado.');
    const name = archiveName(zip.subarray(offset + 46, offset + 46 + nl).toString('utf8'));
    offset += 46 + nl + extra + comment;
    if (flags & 1) throw new Error('El ZIP está cifrado. Extrae los archivos y adjúntalos.');
    if ((attr >>> 16 & 0xf000) === 0xa000) throw new Error('El ZIP contiene enlaces simbólicos. Adjunta los archivos directamente.');
    if (size === 0xffffffff || compressed === 0xffffffff || local === 0xffffffff) throw new Error('Este ZIP64 no es compatible.');
    if (size > MAX_FILE || (total += size) > MAX_EXPANDED) throw new Error('El ZIP supera el límite de extracción de 256 MB.');
    const target = path.resolve(root, name);
    if (!inside(root, target)) throw new Error('Ruta de archivo no válida.');
    const key = target.toLowerCase();
    if (used.has(key)) throw new Error('El ZIP contiene nombres de archivo duplicados.');
    used.add(key);
    entries.push({ name, size, compressed, method, checksum, local, directory: name.endsWith('/') });
  }
  // Validate every entry before creating any file; extraction stays inside a new private directory.
  fs.mkdirSync(root, { recursive: true });
  try {
    for (const e of entries) {
      const target = path.resolve(root, e.name);
      if (e.directory) { fs.mkdirSync(target, { recursive: true }); continue; }
      if (e.local + 30 > zip.length || zip.readUInt32LE(e.local) !== 0x04034b50) throw new Error('Entrada ZIP dañada.');
      const data = e.local + 30 + zip.readUInt16LE(e.local + 26) + zip.readUInt16LE(e.local + 28);
      if (data + e.compressed > zip.length) throw new Error('Contenido ZIP truncado.');
      const compressed = zip.subarray(data, data + e.compressed);
      const output = e.method === 0 ? compressed : e.method === 8 ? zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, e.size) }) : null;
      if (!output || output.length !== e.size || crc32(output) !== e.checksum) throw new Error('Contenido o compresión ZIP no válidos.');
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, output, { flag: 'wx', mode: 0o600 });
    }
  } catch (err) { fs.rmSync(root, { recursive: true, force: true }); throw err; }
  return entries.map(e => ({ name: e.name, size: e.size, kind: e.directory ? 'folder' : 'file' }));
}

function createAttachmentStore(base) {
  fs.mkdirSync(base, { recursive: true });
  const records = new Map();
  function get(id) {
    if (!/^[a-f0-9]{24}$/.test(String(id))) return null;
    if (!records.has(id)) {
      try { records.set(id, JSON.parse(fs.readFileSync(path.join(base, id, 'manifest.json'), 'utf8'))); } catch { return null; }
    }
    return records.get(id);
  }
  function persist(record) {
    records.set(record.id, record);
    fs.mkdirSync(path.join(base, record.id), { recursive: true });
    fs.writeFileSync(path.join(base, record.id, 'manifest.json'), JSON.stringify(record), { mode: 0o600 });
  }
  async function attach({ id: sessionId, paths = [], files = [] } = {}) {
    const attachments = [], errors = [];
    if (!Array.isArray(paths) || !Array.isArray(files)) return { attachments, errors: ['Lista de adjuntos no válida.'] };
    const items = [...paths.map(p => ({ path: String(p) })), ...files];
    if (items.length > 24) return { attachments, errors: ['Adjunta como máximo 24 archivos o carpetas cada vez.'] };
    for (const item of items) {
      const id = crypto.randomBytes(12).toString('hex');
      const folder = path.join(base, id);
      let name = 'archivo';
      try {
        let kind, size, target, data;
        if (item.path) {
          const source = path.resolve(item.path), stat = fs.statSync(source);
          name = path.basename(source);
          if (stat.isDirectory()) { kind = 'folder'; size = 0; target = fs.realpathSync(source); }
          else if (stat.isFile()) {
            if (stat.size > MAX_FILE) throw new Error('El archivo supera 64 MB.');
            fs.mkdirSync(path.join(folder, 'file'), { recursive: true }); target = path.join(folder, 'file', name); fs.copyFileSync(source, target); fs.chmodSync(target, 0o600); size = stat.size;
          } else throw new Error('No es un archivo o carpeta compatible.');
        } else {
          name = path.basename(String(item.name || 'archivo')).replace(/[\x00-\x1f]/g, '');
          const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?;base64,([a-z0-9+/=\s]+)$/i.exec(String(item.data_url || ''));
          if (!m || m[2].length > MAX_FILE * 1.4) throw new Error('El adjunto no contiene datos válidos o supera 64 MB.');
          data = Buffer.from(m[2], 'base64'); if (data.length > MAX_FILE) throw new Error('El archivo supera 64 MB.');
          fs.mkdirSync(path.join(folder, 'file'), { recursive: true }); target = path.join(folder, 'file', name || 'archivo'); fs.writeFileSync(target, data, { mode: 0o600 }); size = data.length;
        }
        const ext = path.extname(name).toLowerCase();
        kind = kind || (ext === '.zip' ? 'archive' : IMAGE_MIME[ext] ? 'image' : 'file');
        const record = { id, sessionId: sessionId || null, name, path: target, kind, size, ...(IMAGE_MIME[ext] ? { mime_type: IMAGE_MIME[ext] } : {}) };
        if (kind === 'archive') { record.extracted_path = path.join(folder, 'extracted'); record.entries = extractZip(target, record.extracted_path); }
        persist(record); attachments.push(record);
      } catch (err) { fs.rmSync(folder, { recursive: true, force: true }); errors.push(`${name}: ${err.message}`); }
    }
    return { attachments, errors };
  }
  function resolve(list, sessionId) {
    if (!Array.isArray(list) || list.length > 24) throw new Error('Lista de adjuntos no válida.');
    return list.map(item => {
      const record = get(typeof item === 'string' ? item : item?.id);
      if (!record || (record.sessionId && record.sessionId !== sessionId)) throw new Error('El adjunto ya no está disponible en esta sesión. Vuelve a adjuntarlo.');
      if (!fs.existsSync(record.path)) throw new Error(`${record.name}: el archivo o carpeta ya no existe.`);
      record.sessionId = sessionId; persist(record);
      return record;
    });
  }
  function images(list) {
    // Other image formats still attach as files; the agent can inspect their source or convert them.
    const selected = list.filter(a => a.kind === 'image' && VISION_MIME.has(a.mime_type));
    if (selected.length > 6) throw new Error('Adjunta como máximo 6 imágenes por mensaje.');
    return selected.map(a => {
      if (a.size > 8 * 1024 * 1024) throw new Error(`${a.name}: la imagen supera 8 MB.`);
      return `data:${a.mime_type};base64,${fs.readFileSync(a.path).toString('base64')}`;
    });
  }
  function removeSession(id) { for (const folder of fs.readdirSync(base)) { const record = get(folder); if (record?.sessionId === id) { fs.rmSync(path.join(base, folder), { recursive: true, force: true }); records.delete(folder); } } }
  return { attach, resolve, images, removeSession };
}
module.exports = { createAttachmentStore, extractZip };
