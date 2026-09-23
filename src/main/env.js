/**
 * Apps opened from Finder/Dock inherit launchd's minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin),
 * so node, npm, git from Homebrew, pyenv, nvm... would be "command not found" for the agent.
 * Read the PATH the user's login shell builds, once, and hand it to every Code worker.
 */
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');

let resolved = null;

function fallbackPath() {
  const extra = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', path.join(os.homedir(), '.local/bin'),
    path.join(os.homedir(), '.cargo/bin'), path.join(os.homedir(), '.bun/bin')];
  const cur = (process.env.PATH || '').split(':').filter(Boolean);
  return [...new Set([...cur, ...extra])].join(':');
}

function resolveShellEnv() {
  if (resolved) return resolved;
  resolved = new Promise((resolve) => {
    if (process.platform === 'win32') return resolve({ ...process.env });
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    const mark = '__DEIZA_ENV__';
    execFile(shell, ['-ilc', `printf '${mark}%s${mark}' "$PATH"`], {
      timeout: 5000,
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTARTED: 'true' },
    }, (err, stdout) => {
      const m = !err && new RegExp(`${mark}([^]*?)${mark}`).exec(stdout || '');
      const PATH = m && m[1].trim() ? m[1].trim() : fallbackPath();
      resolve({ ...process.env, PATH });
    });
  });
  return resolved;
}

module.exports = { resolveShellEnv };
