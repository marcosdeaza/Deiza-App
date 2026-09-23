#!/usr/bin/env node
/**
 * Copies the Deiza Code engine modules (the same ones the terminal agent runs) into
 * src/engine/vendor. They are used unmodified; the desktop loop in src/engine/worker.js
 * replaces the terminal rendering with structured events.
 *
 *   DEIZA_CODE_DIR=/path/to/deiza-code node scripts/sync-engine.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const candidates = [
  process.env.DEIZA_CODE_DIR,
  path.join(os.homedir(), 'Documents/deiza-code'),
  path.join(__dirname, '../../deiza-code'),
].filter(Boolean);

const src = candidates.find(d => fs.existsSync(path.join(d, 'src/tools.js')));
if (!src) {
  console.error('deiza-code not found. Set DEIZA_CODE_DIR.');
  process.exit(1);
}

const MODULES = ['config.js', 'ui.js', 'tools.js', 'context.js', 'prompt.js', 'session.js', 'agent.js'];
const out = path.join(__dirname, '../src/engine/vendor');
fs.mkdirSync(out, { recursive: true });
for (const m of MODULES) fs.copyFileSync(path.join(src, 'src', m), path.join(out, m));
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'VERSION'), `${pkg.version}\n`);
console.log(`engine ${pkg.version} synced from ${src}`);
