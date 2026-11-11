// Runs the acceptance commands of a batch plus the standard, guard, clean-tree and commit checks.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, P, cfg, rel, getState, writeFileAtomic } from './state.mjs';
import { log, initLog, short } from './log.mjs';
import { killTree } from './session.mjs';
import * as G from './gitstats.mjs';

const PROTECTED = ['builder', 'spec.md', 'PROMPT.md'];
const MAX_CAPTURE = 4 * 1024 * 1024;

let active = null;

export function killActiveVerify() {
  if (active) killTree(active);
}

/** Run one shell line through Git Bash. Resolves { code, output, seconds, timedOut }. */
function runCommand(line, timeoutMinutes) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(G.findBash(), ['-c', line], {
        cwd: REPO_ROOT,
        env: { ...process.env, CI: '1', npm_config_yes: 'true', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (e) {
      resolve({ code: 127, output: `could not start bash: ${e.message}`, seconds: 0, timedOut: false });
      return;
    }
    active = child;
    const take = (d) => {
      output += d;
      if (output.length > MAX_CAPTURE) output = output.slice(-MAX_CAPTURE / 2);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMinutes * 60000);
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (active === child) active = null;
      resolve({ code: timedOut ? 124 : code ?? 1, output, seconds: Math.round((Date.now() - started) / 1000), timedOut });
    };
    child.on('error', (e) => {
      take(`\ncould not run the command: ${e.message}\n`);
      done(127);
    });
    child.on('close', (code) => done(code));
  });
}

const tail = (text, n) => {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  return lines.slice(-n);
};

function packageScripts() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    return pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  } catch {
    return {};
  }
}

/** Protected paths changed since base (tracked changes plus new untracked files under builder/). */
function guardCheck(baseSha) {
  const changed = new Set(G.listLines(G.git(['diff', '--name-only', baseSha, '--', ...PROTECTED]).out));
  const untracked = G.listLines(G.git(['ls-files', '--others', '--exclude-standard', '--', 'builder']).out);
  for (const f of untracked) changed.add(f);
  return [...changed];
}

function guardRestore(id, baseSha, changed) {
  const notes = [];
  const touched = [];
  for (const f of changed) {
    const inBase = G.git(['cat-file', '-e', `${baseSha}:${f}`]).code === 0;
    if (inBase) {
      const r = G.git(['checkout', baseSha, '--', f]);
      if (r.code !== 0) notes.push(`could not restore ${f}: ${r.err}`);
      touched.push(f);
    } else {
      const tracked = G.git(['ls-files', '--error-unmatch', '--', f]).code === 0;
      if (tracked) {
        G.git(['rm', '-f', '-q', '--', f]);
        touched.push(f);
      } else {
        try { fs.rmSync(path.join(REPO_ROOT, f), { force: true }); } catch (e) { notes.push(`could not delete ${f}: ${e.message}`); }
      }
    }
  }
  if (touched.length && G.git(['diff', '--cached', '--quiet', 'HEAD', '--', ...touched]).code !== 0) {
    const r = G.git(['commit', '-q', '-m', `${id}: builder guard restore`, '--', ...touched]);
    if (r.code !== 0) notes.push(`guard restore commit failed: ${r.err || r.out}`);
  }
  return notes;
}

/**
 * Verify one batch. opts: { batch, baseSha, n, finalLine, heartbeat }.
 * Returns { pass, reportPath, failed: [short names] }.
 */
export async function runVerify({ batch, baseSha, n = 1, finalLine = '', heartbeat = null }) {
  const c = cfg();
  const id = batch.id;
  const tag = `${id} verify |`;
  const failures = []; // { name, body }
  const notes = [];
  let current = '(starting)';

  const hbTimer = setInterval(() => {
    let head;
    try {
      head = heartbeat ? heartbeat() : `still verifying batch ${id}.`;
    } catch (e) {
      head = `still verifying batch ${id} (stats unavailable: ${e.message}).`;
    }
    log(`${head} last: ${short(current, 100)}`);
  }, Math.max(1000, c.heartbeatSeconds * 1000));

  const run = async (line, timeoutMinutes) => {
    current = `$ ${line}`;
    const r = await runCommand(line, timeoutMinutes);
    if (r.code === 0) {
      log(`${tag} $ ${line} ... ok (${r.seconds}s)`, 'green');
      return true;
    }
    const why = r.timedOut ? `timed out after ${timeoutMinutes} min` : `exit ${r.code}`;
    log(`${tag} $ ${line} ... FAILED (${why}, ${r.seconds}s)`, 'red');
    log(`${tag}   (last 40 lines of output follow, indented)`, 'dim');
    for (const l of tail(r.output, 40)) log(`${tag}     ${l}`, 'dim');
    failures.push({
      name: `$ ${line}`,
      body: `Result: ${why}, after ${r.seconds}s.\n\nOutput (last 300 lines):\n\n~~~~\n${tail(r.output, 300).join('\n')}\n~~~~`,
    });
    return false;
  };

  try {
    // 1. Acceptance commands.
    for (const line of batch.acceptance) await run(line, batch.timeoutMinutes);

    // 2. Standard checks (skipped when the same command already ran as an acceptance command).
    const scripts = packageScripts();
    for (const [script, line] of [['typecheck', 'npm run typecheck'], ['test', 'npm test']]) {
      if (!scripts[script]) continue;
      if (batch.acceptance.includes(line)) continue;
      await run(line, batch.timeoutMinutes);
    }

    // 3. Guard: protected files must be untouched.
    current = 'guard checks';
    const changed = guardCheck(baseSha);
    if (changed.length) {
      const restoreNotes = guardRestore(id, baseSha, changed);
      const msg = `batch modified protected files: ${changed.join(', ')}`;
      log(`${tag} ${msg} (restored)`, 'red');
      failures.push({
        name: msg,
        body: `These paths are protected (builder/, spec.md, PROMPT.md) and were restored to their state at the base commit.\n${restoreNotes.join('\n')}`,
      });
    } else {
      notes.push('Guard: no protected file was modified.');
    }

    // 4. Clean tree: commit leftovers (a warning, not a failure).
    const dirty = G.porcelain();
    if (dirty) {
      G.git(['add', '-A']);
      const r = G.git(['commit', '-q', '-m', `${id}: builder auto-commit leftovers`]);
      const count = G.listLines(dirty).length;
      if (r.code === 0) {
        log(`${tag} warning: the working tree was not clean, committed ${count} leftover path${count === 1 ? '' : 's'}`, 'yellow');
        notes.push(`Clean tree: ${count} leftover path(s) were committed by the builder.`);
      } else {
        log(`${tag} warning: could not commit leftovers: ${short(r.err || r.out, 200)}`, 'yellow');
        notes.push(`Clean tree: leftovers could not be committed: ${r.err || r.out}`);
      }
    } else {
      notes.push('Clean tree: yes.');
    }

    // 5. At least one commit since the base.
    const commits = G.commitsSince(baseSha);
    if (commits < 1) {
      log(`${tag} no commits were made since ${G.short(baseSha)}`, 'red');
      failures.push({ name: 'no commits were made', body: `git rev-list --count ${baseSha}..HEAD returned 0.` });
    } else {
      notes.push(`Commits since base: ${commits}.`);
    }
  } finally {
    clearInterval(hbTimer);
  }

  const pass = failures.length === 0;
  let reportPath = null;
  if (!pass) {
    const file = path.join(P.failures, `${id}-verify-${n}.md`);
    const parts = [
      `# Verify failure report: ${id}. ${batch.title} (verify run ${n})`,
      `Base commit: ${baseSha}\nHEAD: ${G.headSha()}`,
      `## Failing checks\n\n${failures.map((f, i) => `${i + 1}. ${f.name}`).join('\n')}`,
      ...failures.map((f) => `## ${f.name}\n\n${f.body}`),
      `## Other checks\n\n${notes.map((x) => `- ${x}`).join('\n') || '- (none)'}`,
      `## Final line of the last session\n\n${finalLine ? finalLine : '(none)'}`,
    ];
    writeFileAtomic(file, parts.join('\n\n') + '\n');
    reportPath = rel(file);
    log(`${tag} FAILED (${failures.length} check${failures.length === 1 ? '' : 's'}), report: ${reportPath}`, 'red');
  } else {
    log(`${tag} all checks passed`, 'green');
  }
  return { pass, reportPath, failed: failures.map((f) => f.name) };
}

// CLI: node builder/lib/verify.mjs <ID> [--base <sha>]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const id = argv.find((a) => /^M\d\d$/.test(a));
  const bi = argv.indexOf('--base');
  const { loadSpec } = await import('./spec.mjs');
  const spec = loadSpec();
  const batch = spec.batches.find((b) => b.id === id);
  if (!batch) {
    console.error('usage: node builder/lib/verify.mjs <ID> [--base <sha>]');
    process.exit(1);
  }
  const st = getState();
  let baseSha = bi >= 0 ? argv[bi + 1] : null;
  if (!baseSha && st.current && st.current.id === id) baseSha = st.current.baseSha;
  if (!baseSha) {
    const r = G.git(['rev-parse', 'HEAD~1']);
    baseSha = r.code === 0 ? r.out : G.headSha();
    console.log(`no --base given and ${id} is not the current batch: using ${G.short(baseSha)} as the base commit`);
  }
  initLog();
  const res = await runVerify({ batch, baseSha, n: 'manual' });
  process.exit(res.pass ? 0 : 1);
}
