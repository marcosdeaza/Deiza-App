/**
 * DEIZA CODE — Project Context Detector
 * Automatically inspects the current workspace: git status, project structure, rules files.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GIT_OPTS = { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 4000 };

function gitOut(args) {
  // stderr is discarded through stdio, never through a shell redirection: CMD has no
  // /dev/null and prints "El sistema no puede encontrar la ruta especificada".
  return execFileSync('git', args, GIT_OPTS).trim();
}

function getGitContext() {
  try {
    const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
    const status = gitOut(['status', '--short']);
    const remotes = gitOut(['remote', '-v']);
    return {
      isGit: true,
      branch,
      status: status || 'Clean working tree',
      remotes,
    };
  } catch {
    return { isGit: false };
  }
}

function getProjectFiles(dir = process.cwd(), depth = 2) {
  const ignore = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'target']);
  const files = [];

  function scan(currentDir, currentDepth) {
    if (currentDepth > depth || files.length >= 60) return;
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignore.has(entry.name) || entry.name.startsWith('.')) continue;
        const full = path.join(currentDir, entry.name);
        const rel = path.relative(dir, full);
        if (entry.isDirectory()) {
          scan(full, currentDepth + 1);
        } else {
          files.push(rel);
        }
      }
    } catch {}
  }

  scan(dir, 1);
  return files;
}

function getProjectRules(dir = process.cwd()) {
  const ruleFiles = ['.deizarules', 'CLAUDE.md', 'AGENTS.md', '.cursorrules'];
  for (const file of ruleFiles) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) {
      try {
        return { file, content: fs.readFileSync(p, 'utf-8') };
      } catch {}
    }
  }
  return null;
}

function detectProjectType(dir = process.cwd()) {
  if (fs.existsSync(path.join(dir, 'package.json'))) return 'Node.js / JavaScript / TypeScript';
  if (fs.existsSync(path.join(dir, 'Cargo.toml'))) return 'Rust';
  if (fs.existsSync(path.join(dir, 'requirements.txt')) || fs.existsSync(path.join(dir, 'pyproject.toml'))) return 'Python';
  if (fs.existsSync(path.join(dir, 'go.mod'))) return 'Go';
  if (fs.existsSync(path.join(dir, 'pom.xml')) || fs.existsSync(path.join(dir, 'build.gradle'))) return 'Java / Kotlin';
  return 'General Codebase';
}

function buildContextSummary() {
  const git = getGitContext();
  const files = getProjectFiles();
  const rules = getProjectRules();
  const projectType = detectProjectType();

  let summary = `Current Directory: ${process.cwd()}\nProject Type: ${projectType}\n`;
  if (git.isGit) {
    summary += `Git Branch: ${git.branch}\nGit Status:\n${git.status}\n`;
  }
  if (files.length > 0) {
    summary += `Workspace Files:\n${files.slice(0, 40).map(f => '  - ' + f).join('\n')}\n`;
  }
  if (rules) {
    summary += `Custom Project Rules (${rules.file}):\n${rules.content}\n`;
  }

  return summary;
}

module.exports = {
  getGitContext,
  getProjectFiles,
  getProjectRules,
  detectProjectType,
  buildContextSummary,
};
