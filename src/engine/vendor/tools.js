/**
 * DEIZA CODE — Local Execution Tools
 * Surgical file reading, writing, editing with visual diffs, shell execution, and searches.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const { renderDiff, Status } = require('./ui');

const MAX_TOOL_OUTPUT = 60000;

function countLines(text) {
  if (!text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function insideWorkspace(fullPath) {
  const root = path.resolve(process.cwd());
  const rel = path.relative(root, fullPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Commands that destroy data: COPILOT mode asks before running them, BUILD mode runs them
// (it is the autonomous mode) except the catastrophic ones below, which are never executed.
const RISKY_PATTERNS = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bdrop\s+(database|table)\b/i,
  /\btruncate\s+table\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:>\s*\//,
  /\b(rmdir|rd)\s+\/s\b/i,
  /\bdel\s+.*\/[sq]\b/i,
];

// Never run, in any mode: wiping the machine, the disk or the whole home directory.
const CATASTROPHIC_PATTERNS = [
  /\brm\s+-[a-z]*r[a-z]*\s+(\/|\/\*|~|~\/|\$HOME|\/home|\/Users|\/etc|\/usr|\/var|\/boot)(\s|$)/i,
  /\brm\s+-[a-z]*r[a-z]*\s+--no-preserve-root/i,
  /\bmkfs(\.[a-z0-9]+)?\s+\/dev\//i,
  /\bdd\s+.*of=\/dev\/(sd|nvme|disk|hd|mmcblk)/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
  /\bformat\s+[a-z]:/i,
  /\b(rd|rmdir)\s+\/s\s+\/q\s+[a-z]:\\?(\s|$)/i,
  /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i,
];

function isCommandRisky(command) {
  return RISKY_PATTERNS.some(p => p.test(command || ''));
}

function isCommandCatastrophic(command) {
  return CATASTROPHIC_PATTERNS.some(p => p.test(command || ''));
}

/**
 * COPILOT previews: compute what a tool WOULD change without touching the disk.
 * Returns { ok, diff, error } so the user can approve the exact change.
 */
function previewChange(name, args = {}) {
  try {
    if (name === 'write_file') {
      const fullPath = path.resolve(process.cwd(), args.path || '');
      const existed = fs.existsSync(fullPath);
      const oldContent = existed ? fs.readFileSync(fullPath, 'utf-8') : '';
      const content = String(args.content ?? '');
      if (!existed) {
        const lines = content.split('\n');
        const shown = lines.slice(0, 40).map(l => `  \x1b[38;2;60;180;110m+ ${l}\x1b[0m`).join('\n');
        const more = lines.length > 40 ? `\n  \x1b[38;2;130;130;140m... (${lines.length - 40} líneas más)\x1b[0m` : '';
        return { ok: true, diff: `\n  \x1b[1mNuevo archivo:\x1b[0m ${args.path} (${lines.length} líneas)\n${shown}${more}\n` };
      }
      return { ok: true, diff: renderDiff(args.path, oldContent, content) };
    }
    if (name === 'edit_file') {
      const fullPath = path.resolve(process.cwd(), args.path || '');
      if (!fs.existsSync(fullPath)) return { ok: false, error: `File not found: ${args.path}` };
      const content = fs.readFileSync(fullPath, 'utf-8');
      const oldStr = String(args.old_string ?? '');
      if (!content.includes(oldStr)) return { ok: false, error: `Could not find exact text match in ${args.path}.` };
      if (content.split(oldStr).length - 1 > 1) return { ok: false, error: 'Target string is not unique.' };
      return { ok: true, diff: renderDiff(args.path, content, content.replace(oldStr, String(args.new_string ?? ''))) };
    }
    return { ok: true, diff: '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const Tools = {
  async read_file({ path: targetPath, start_line, end_line }) {
    try {
      const fullPath = path.resolve(process.cwd(), targetPath);
      if (!fs.existsSync(fullPath)) {
        return { error: `File not found: ${targetPath}` };
      }
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return { error: `${targetPath} is a directory, not a file. Use list_dir instead.` };
      }
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const lines = raw.split('\n');
      const start = Math.max(1, start_line || 1);
      const end = Math.min(lines.length, end_line || lines.length);

      const sliced = lines.slice(start - 1, end).map((l, i) => `${start + i} | ${l}`).join('\n');
      return {
        path: targetPath,
        total_lines: lines.length,
        showing_range: [start, end],
        content: sliced,
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async write_file({ path: targetPath, content }, ctx = {}) {
    try {
      const fullPath = path.resolve(process.cwd(), targetPath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const existed = fs.existsSync(fullPath);
      const oldContent = existed ? fs.readFileSync(fullPath, 'utf-8') : '';

      fs.writeFileSync(fullPath, content, 'utf-8');

      if (existed && !ctx.quietDiff) {
        process.stdout.write(renderDiff(targetPath, oldContent, content));
      }

      return {
        path: targetPath,
        status: existed ? 'overwritten' : 'created',
        bytes_written: Buffer.byteLength(content, 'utf-8'),
        lines: countLines(content),
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async append_file({ path: targetPath, content }) {
    try {
      const fullPath = path.resolve(process.cwd(), targetPath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const existed = fs.existsSync(fullPath);
      const before = existed ? fs.readFileSync(fullPath, 'utf-8') : '';
      const glue = existed && before.length && !before.endsWith('\n') && !String(content).startsWith('\n') ? '\n' : '';
      fs.appendFileSync(fullPath, glue + String(content ?? ''), 'utf-8');
      const after = fs.readFileSync(fullPath, 'utf-8');
      return {
        path: targetPath,
        status: existed ? 'appended' : 'created',
        bytes_appended: Buffer.byteLength(String(content ?? ''), 'utf-8'),
        total_lines: countLines(after),
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async delete_path({ path: targetPath, recursive = false }) {
    try {
      const fullPath = path.resolve(process.cwd(), targetPath);
      if (!insideWorkspace(fullPath) || fullPath === path.resolve(process.cwd())) {
        return { error: 'Solo se pueden borrar rutas dentro del workspace actual (y nunca su raíz).' };
      }
      if (!fs.existsSync(fullPath)) return { error: `Path not found: ${targetPath}` };
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (!recursive) return { error: `${targetPath} es un directorio: pasa recursive=true para borrarlo con su contenido.` };
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
      return { path: targetPath, status: 'deleted' };
    } catch (err) {
      return { error: err.message };
    }
  },

  async move_path({ from, to }) {
    try {
      const src = path.resolve(process.cwd(), from || '');
      const dst = path.resolve(process.cwd(), to || '');
      if (!insideWorkspace(src) || !insideWorkspace(dst)) return { error: 'Solo se pueden mover rutas dentro del workspace actual.' };
      if (!fs.existsSync(src)) return { error: `Path not found: ${from}` };
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
      return { from, to, status: 'moved' };
    } catch (err) {
      return { error: err.message };
    }
  },

  async fetch_url({ url, max_chars = 40000 }) {
    return new Promise((resolve) => {
      let target;
      try {
        target = new URL(url);
      } catch {
        return resolve({ error: `URL no válida: ${url}` });
      }
      if (!/^https?:$/.test(target.protocol)) return resolve({ error: 'Solo se admiten URLs http(s).' });
      const client = target.protocol === 'https:' ? https : http;
      const req = client.get(target, { headers: { 'User-Agent': 'deiza-code', 'Accept': 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' }, timeout: 20000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return Tools.fetch_url({ url: new URL(res.headers.location, target).toString(), max_chars }).then(resolve);
        }
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (c) => { if (body.length < 600000) body += c; });
        res.on('end', () => {
          const type = String(res.headers['content-type'] || '');
          let text = body;
          if (/html/i.test(type)) {
            text = body
              .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
          }
          const limit = Math.min(Math.max(Number(max_chars) || 40000, 1000), 120000);
          resolve({ url: target.toString(), status: res.statusCode, content_type: type, truncated: text.length > limit, content: text.slice(0, limit) });
        });
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', (err) => resolve({ error: err.message }));
    });
  },

  async update_plan({ steps }) {
    if (!Array.isArray(steps) || !steps.length) return { error: 'steps debe ser una lista de {title, status}.' };
    const clean = steps.slice(0, 30).map((st, i) => ({
      id: i + 1,
      title: String((st && st.title) || '').slice(0, 140),
      status: ['pending', 'in_progress', 'done', 'skipped'].includes(st && st.status) ? st.status : 'pending',
    })).filter(st => st.title);
    const icon = { pending: '○', in_progress: '◐', done: '●', skipped: '−' };
    const color = { pending: '\x1b[38;2;130;130;140m', in_progress: '\x1b[38;2;230;180;80m', done: '\x1b[38;2;60;180;110m', skipped: '\x1b[38;2;75;75;85m' };
    let out = `\n  \x1b[1mPlan\x1b[0m\n`;
    for (const st of clean) out += `  ${color[st.status]}${icon[st.status]} ${st.title}\x1b[0m\n`;
    process.stdout.write(out + '\n');
    Tools._lastPlan = clean;
    return { status: 'plan_updated', steps: clean, done: clean.filter(s => s.status === 'done').length, total: clean.length };
  },

  async edit_file({ path: targetPath, old_string, new_string }, ctx = {}) {
    try {
      const fullPath = path.resolve(process.cwd(), targetPath);
      if (!fs.existsSync(fullPath)) {
        return { error: `File not found: ${targetPath}` };
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (!content.includes(old_string)) {
        return {
          error: `Could not find exact text match in ${targetPath}. Please inspect the file with read_file first.`,
        };
      }

      const occurrences = content.split(old_string).length - 1;
      if (occurrences > 1) {
        return {
          error: `Found ${occurrences} occurrences of target string. Provide more surrounding context lines to make it unique.`,
        };
      }

      const newContent = content.replace(old_string, new_string);
      fs.writeFileSync(fullPath, newContent, 'utf-8');

      // Visual diff in terminal (COPILOT already showed it as a preview)
      if (!ctx.quietDiff) process.stdout.write(renderDiff(targetPath, content, newContent));

      return {
        path: targetPath,
        status: 'edited',
        occurrences_replaced: 1,
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async list_dir({ path: targetPath = '.', max_depth = 1 }) {
    try {
      const fullPath = path.resolve(process.cwd(), targetPath);
      if (!fs.existsSync(fullPath)) return { error: `Directory not found: ${targetPath}` };

      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      const items = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        size_bytes: e.isDirectory() ? null : fs.statSync(path.join(fullPath, e.name)).size,
      }));

      return {
        directory: targetPath,
        total_items: items.length,
        items,
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async run_command({ command, cwd, timeout_ms = 120000 }) {
    if (isCommandCatastrophic(command)) {
      return { command, exit_code: 126, stdout: '', stderr: 'Comando bloqueado por Deiza Code: destruiría el sistema o el disco.', blocked: true };
    }
    return new Promise((resolve) => {
      const execCwd = cwd ? path.resolve(process.cwd(), cwd) : process.cwd();
      const limit = Math.min(Math.max(Number(timeout_ms) || 120000, 1000), 600000);
      exec(command, {
        cwd: execCwd,
        timeout: limit,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, CI: 'true', DEBIAN_FRONTEND: 'noninteractive' },
      }, (err, stdout, stderr) => {
        resolve({
          command,
          exit_code: err ? (err.code || 1) : 0,
          stdout: (stdout || '').trim().slice(-30000),
          stderr: (stderr || '').trim().slice(-10000),
          killed_by_timeout: err?.killed || false,
        });
      });
    });
  },

  async search_files({ query, path: targetPath = '.', is_regex = false, file_glob = '' }) {
    try {
      const fullPath = path.resolve(process.cwd(), targetPath);
      const results = [];
      const regex = is_regex ? new RegExp(query, 'i') : null;
      const ignore = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '__pycache__', '.venv', 'target', '.next']);
      const globRe = file_glob
        ? new RegExp('^' + String(file_glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$', 'i')
        : null;

      function searchDir(cur) {
        if (results.length >= 50) return;
        try {
          const list = fs.readdirSync(cur, { withFileTypes: true });
          for (const item of list) {
            if (ignore.has(item.name) || item.name.startsWith('.')) continue;
            const itemPath = path.join(cur, item.name);
            if (item.isDirectory()) {
              searchDir(itemPath);
            } else {
              if (globRe && !globRe.test(path.relative(process.cwd(), itemPath).split(path.sep).join('/'))) continue;
              try {
                if (fs.statSync(itemPath).size > 2 * 1024 * 1024) continue;
                const content = fs.readFileSync(itemPath, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  const match = regex ? regex.test(lines[i]) : lines[i].includes(query);
                  if (match) {
                    results.push({
                      file: path.relative(process.cwd(), itemPath),
                      line: i + 1,
                      content: lines[i].trim(),
                    });
                    if (results.length >= 50) break;
                  }
                }
              } catch {}
            }
          }
        } catch {}
      }

      searchDir(fullPath);
      return { query, matches_count: results.length, matches: results };
    } catch (err) {
      return { error: err.message };
    }
  },

  async invoke_subagent({ task, role = 'Research', context_paths = [] }, ctx = {}) {
    try {
      let extraContext = '';
      if (Array.isArray(context_paths)) {
        for (const p of context_paths.slice(0, 5)) {
          try {
            const full = path.resolve(process.cwd(), p);
            if (fs.existsSync(full) && fs.statSync(full).isFile()) {
              const snippet = fs.readFileSync(full, 'utf-8').slice(0, 4000);
              extraContext += `\n--- Archivo: ${p} ---\n${snippet}\n`;
            }
          } catch {}
        }
      }

      if (ctx.streamCompletion && ctx.cfg) {
        process.stdout.write(`    \x1b[38;2;130;130;140msubagente ${role} trabajando...\x1b[0m\n`);

        const subMessages = [
          {
            role: 'system',
            content: `You are an autonomous subagent with role "${role}" in Deiza Code.
Your goal is to inspect the project context and complete the assigned task:
"${task}"
${extraContext ? `Provided context files:\n${extraContext}` : ''}
Provide a crisp, actionable, structured report with code snippets, root cause, or conclusions.`,
          },
          {
            role: 'user',
            content: `Execute the task: "${task}". Return a technical summary.`,
          },
        ];

        let streamedSubagent = '';
        await ctx.streamCompletion({
          apiBase: ctx.cfg.apiBase,
          apiKey: ctx.cfg.isCustomEndpoint ? (ctx.cfg.endpointKey || '') : ctx.cfg.apiKey,
          model: ctx.cfg.model,
          messages: subMessages,
          onChunk: (chunk) => {
            streamedSubagent += chunk;
          },
        });


        return {
          role,
          task,
          status: 'completed',
          report: streamedSubagent.trim(),
        };
      } else {
        return {
          role,
          task,
          status: 'completed',
          report: `Subagente (${role}) procesó la tarea "${task}".`,
        };
      }
    } catch (err) {
      return { error: `Error en subagente: ${err.message}` };
    }
  },

  async view_image({ path: imagePath }) {
    try {
      const fullPath = path.resolve(process.cwd(), imagePath);
      if (!fs.existsSync(fullPath)) {
        return { error: `Imagen no encontrada: ${imagePath}` };
      }
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return { error: `${imagePath} es un directorio, no una imagen.` };
      }

      const ext = path.extname(fullPath).toLowerCase().replace('.', '');
      const valid = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
      if (!valid.includes(ext)) {
        return { error: `Formato de imagen no soportado (.${ext}). Formatos: png, jpg, jpeg, webp, gif, svg` };
      }

      const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const buf = fs.readFileSync(fullPath);
      const b64 = buf.toString('base64');

      return {
        path: imagePath,
        mime_type: mimeType,
        size_bytes: stat.size,
        data_url: `data:${mimeType};base64,${b64}`,
        note: `Imagen cargada con éxito (${stat.size} bytes). Los datos visuales están disponibles para el modelo multimodal.`,
      };
    } catch (err) {
      return { error: err.message };
    }
  },
};

const TOOL_DEFINITIONS = [
  {
    name: 'read_file',
    description: 'Read a file with line numbers. Use start_line/end_line to read a range of a big file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute file path.' },
        start_line: { type: 'number', description: 'Optional 1-indexed starting line.' },
        end_line: { type: 'number', description: 'Optional 1-indexed ending line.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content. Keep each call under ~250 lines; for longer files write the first part here and add the rest with append_file (several calls). Never leave a file half-written.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write (parent folders are created).' },
        content: { type: 'string', description: 'Complete content for this part of the file.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'append_file',
    description: 'Append content to the end of an existing file (creates it if missing). Use it to continue a long file started with write_file, chunk by chunk.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to append to.' },
        content: { type: 'string', description: 'Content to append.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Surgical edit: replace one unique old_string with new_string. Include enough surrounding lines so old_string matches exactly once. Read the file first.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit.' },
        old_string: { type: 'string', description: 'Exact text to replace (must be unique in the file).' },
        new_string: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_dir',
    description: 'List a directory (files and subdirectories with sizes).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list (default: workspace root).' },
      },
    },
  },
  {
    name: 'search_files',
    description: 'Search text or a regex across workspace files (node_modules, .git, dist, build are skipped). Returns file, line and content for up to 50 matches.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'String or regex to look for.' },
        path: { type: 'string', description: 'Directory to search within (default: workspace root).' },
        is_regex: { type: 'boolean', description: 'Treat query as a regular expression.' },
        file_glob: { type: 'string', description: 'Optional glob to restrict files, e.g. "src/**/*.ts" or "*.py".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the workspace and capture stdout, stderr and exit code (builds, tests, git, installs, scripts...). Long-running servers must be started in the background (e.g. with & / start).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command line to execute.' },
        cwd: { type: 'string', description: 'Working directory (default: workspace root).' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 120000, max 600000).' },
      },
      required: ['command'],
    },
  },
  {
    name: 'delete_path',
    description: 'Delete a file, or a directory with recursive=true. Only inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete.' },
        recursive: { type: 'boolean', description: 'Required to delete a non-empty directory.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_path',
    description: 'Move or rename a file or directory inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current path.' },
        to: { type: 'string', description: 'New path.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch a web page or API (GET) and return its text (HTML is reduced to readable text). Useful for docs, changelogs and package READMEs.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL to fetch.' },
        max_chars: { type: 'number', description: 'Max characters to return (default 40000).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'update_plan',
    description: 'Show the user your step-by-step plan for a multi-step task and keep it updated as you progress (call it again with the new statuses). Use it at the start of any task with 3+ steps.',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Ordered steps with status: pending | in_progress | done | skipped.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'skipped'] },
            },
            required: ['title', 'status'],
          },
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'invoke_subagent',
    description: 'Delegate a focused subtask (codebase research, review, test analysis) to an isolated subagent and get a written report back.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Clear instruction of the subtask to execute.' },
        role: { type: 'string', description: 'Subagent specialization, e.g. "Research", "Tester", "Auditor", "Refactor".' },
        context_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional file paths to supply as context to the subagent.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'view_image',
    description: 'Look at a local image (PNG, JPG, WEBP, GIF, SVG): screenshots, mockups, design assets.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute path to the image file.' },
      },
      required: ['path'],
    },
  },
];

module.exports = {
  Tools,
  TOOL_DEFINITIONS,
  MAX_TOOL_OUTPUT,
  isCommandRisky,
  isCommandCatastrophic,
  previewChange,
  countLines,
};
