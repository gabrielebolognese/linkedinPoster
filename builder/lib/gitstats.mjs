// Small git helpers: stats since a base commit, HEAD sha, clean tree check.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './state.mjs';

export function git(args, { cwd = REPO_ROOT } = {}) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: r.status === null ? 1 : r.status,
    out: (r.stdout || '').replace(/\s+$/, ''),
    err: (r.stderr || '').trim(),
  };
}

const lines = (s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function isRepo() {
  return git(['rev-parse', '--is-inside-work-tree']).out === 'true';
}

export function headSha() {
  const r = git(['rev-parse', 'HEAD']);
  return r.code === 0 ? r.out : null;
}

export function short(sha) {
  return sha ? String(sha).slice(0, 7) : '(none)';
}

/** Distinct paths changed since base: committed + uncommitted tracked changes, plus untracked files. */
export function changedFiles(baseSha) {
  const set = new Set();
  if (baseSha) for (const f of lines(git(['diff', '--name-only', baseSha]).out)) set.add(f);
  for (const f of lines(git(['ls-files', '--others', '--exclude-standard']).out)) set.add(f);
  return [...set];
}

export function filesChangedCount(baseSha) {
  return changedFiles(baseSha).length;
}

export function commitsSince(baseSha) {
  if (!baseSha) return 0;
  const r = git(['rev-list', '--count', `${baseSha}..HEAD`]);
  return r.code === 0 ? parseInt(r.out, 10) || 0 : 0;
}

export function porcelain() {
  return git(['status', '--porcelain']).out;
}

export function isClean() {
  return porcelain() === '';
}

export function committedFilesCount(baseSha) {
  if (!baseSha) return 0;
  return lines(git(['diff', '--name-only', baseSha, 'HEAD']).out).length;
}

export function listLines(s) {
  return lines(s);
}

let bashPath = null;

/** The Git Bash executable. build.sh exports BUILDER_BASH; otherwise derive it from the git install. */
export function findBash() {
  if (bashPath) return bashPath;
  if (process.env.BUILDER_BASH && fs.existsSync(process.env.BUILDER_BASH)) {
    bashPath = process.env.BUILDER_BASH;
    return bashPath;
  }
  if (process.platform === 'win32') {
    const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true });
    const execPath = (r.stdout || '').trim();
    if (execPath) {
      // <Git>/mingw64/libexec/git-core -> <Git>
      const root = path.resolve(execPath, '..', '..', '..');
      for (const cand of [path.join(root, 'bin', 'bash.exe'), path.join(root, 'usr', 'bin', 'bash.exe')]) {
        if (fs.existsSync(cand)) {
          bashPath = cand;
          return bashPath;
        }
      }
    }
  }
  bashPath = 'bash';
  return bashPath;
}
