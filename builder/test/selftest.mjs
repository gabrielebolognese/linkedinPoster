// End-to-end self-test: runs the orchestrator against a fixture spec in a temp repo with a fake claude.
// Never calls the real claude.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.resolve(HERE, '..');
const FAKE = path.join(HERE, 'fake-claude.mjs');

const SCENARIOS = [
  { name: 'ok', expect: ['M01 build | write hello.txt', 'VERDICT: PASS', 'smoke test ok'] },
  { name: 'limit-once', expect: ['usage limit reached during M01 build', 'usage limit wait over, resuming M01 build'] },
  { name: 'verify-fail-once', expect: ['VERDICT: FIX', 'M01 verify | $ grep -q hello hello.txt ... FAILED', 'fix rounds: 1'] },
  { name: 'stall-once', env: { STALL_MINUTES: '0.05' }, expect: ['stall', 'attempt 2 of 2'] },
];

function sh(cmd, args, cwd, env) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', env: env || process.env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

function makeRepo(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `builder-selftest-${name}-`));
  fs.cpSync(BUILDER, path.join(dir, 'builder'), {
    recursive: true,
    filter: (src) => {
      const r = path.relative(BUILDER, src).split(path.sep)[0];
      return r !== 'state' && r !== 'logs' && r !== 'config.local.sh';
    },
  });
  fs.copyFileSync(path.join(HERE, 'fixture-spec.md'), path.join(dir, 'spec.md'));
  fs.writeFileSync(path.join(dir, 'PROMPT.md'), '');
  fs.writeFileSync(path.join(dir, 'PROGRESS.md'), '# Build progress\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'builder/state/\nbuilder/logs/\nbuilder/config.local.sh\n');
  fs.writeFileSync(path.join(dir, '.gitattributes'), '* text=auto eol=lf\n');
  const steps = [
    ['init', '-q'],
    ['config', 'core.autocrlf', 'false'],
    ['config', 'user.name', 'Builder Selftest'],
    ['config', 'user.email', 'selftest@localhost'],
    ['config', 'commit.gpgsign', 'false'],
    ['add', '-A'],
    ['commit', '-q', '-m', 'selftest: initial'],
  ];
  for (const a of steps) {
    const r = sh('git', a, dir);
    if (r.status !== 0) throw new Error(`git ${a.join(' ')} failed: ${r.stderr}`);
  }
  return dir;
}

function readLogs(dir) {
  const logs = path.join(dir, 'builder', 'logs');
  let text = '';
  try {
    for (const f of fs.readdirSync(logs)) {
      if (/^build-.*\.log$/.test(f)) text += fs.readFileSync(path.join(logs, f), 'utf8');
    }
  } catch { /* no logs */ }
  return text;
}

function runScenario(sc) {
  const dir = makeRepo(sc.name);
  const env = {
    ...process.env,
    CLAUDE_BIN: 'node',
    CLAUDE_PREFIX_ARGS: FAKE,
    FAKE_SCENARIO: sc.name,
    FAKE_STATE_FILE: path.join(dir, '..', `${path.basename(dir)}-fake-state.json`),
    HEARTBEAT_SECONDS: '1',
    LIMIT_BUFFER_MINUTES: '0',
    BUILD_MODEL: 'opus',
    REVIEW_MODEL: 'opus',
    FIX_MODEL: 'sonnet',
    REVIEW_EVERY_BATCH: '1',
    MAX_BUILD_ATTEMPTS: '2',
    MAX_FIX_ROUNDS: '3',
    MAX_QUALITY_ROUNDS: '1',
    STALL_MINUTES: '5',
    BUILD_EFFORT: '',
    REVIEW_EFFORT: '',
    FIX_EFFORT: '',
    NO_COLOR: '1',
    ...(sc.env || {}),
  };
  delete env.BUILDER_LOG_FILE;
  delete env.BUILDER_RUN_TOKEN;
  const started = Date.now();
  const r = sh(process.execPath, [path.join(dir, 'builder', 'lib', 'orchestrator.mjs')], dir, env);
  const log = readLogs(dir);
  const problems = [];
  if (r.status !== 0) problems.push(`exit code ${r.status}, expected 0`);
  for (const id of ['M01', 'M02']) {
    if (!fs.existsSync(path.join(dir, 'builder', 'state', 'done', `${id}.json`))) problems.push(`done marker of ${id} is missing`);
  }
  const content = (f) => {
    try { return fs.readFileSync(path.join(dir, f), 'utf8').trim(); } catch { return null; }
  };
  if (content('hello.txt') !== 'hello') problems.push(`hello.txt contains ${JSON.stringify(content('hello.txt'))}`);
  if (content('world.txt') !== 'world') problems.push(`world.txt contains ${JSON.stringify(content('world.txt'))}`);
  for (const needle of ['still building batch M01 (minute 0)', 'M02 done in', ...sc.expect]) {
    if (!log.includes(needle)) problems.push(`the log does not contain "${needle}"`);
  }
  const status = sh('git', ['status', '--porcelain'], dir).stdout.trim();
  if (status) problems.push(`the working tree is not clean: ${status}`);
  if (sh('git', ['tag', '-l', 'build-M02'], dir).stdout.trim() !== 'build-M02') problems.push('tag build-M02 is missing');

  const secs = Math.round((Date.now() - started) / 1000);
  if (problems.length) {
    console.log(`selftest: scenario ${sc.name} FAILED (${secs}s)`);
    for (const p of problems) console.log(`  - ${p}`);
    console.log(`  temp repo kept at: ${dir}`);
    console.log('  ---- orchestrator output (last 60 lines) ----');
    for (const l of `${r.stdout || ''}\n${r.stderr || ''}`.trim().split(/\r?\n/).slice(-60)) console.log(`  ${l}`);
    return false;
  }
  console.log(`selftest: scenario ${sc.name} passed (${secs}s)`);
  if (process.env.SELFTEST_KEEP === '1') {
    console.log(`  temp repo kept at: ${dir}`);
    return true;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.rmSync(env.FAKE_STATE_FILE, { force: true });
  } catch { /* leftovers in the temp folder are harmless */ }
  return true;
}

let passed = 0;
for (const sc of SCENARIOS) {
  if (runScenario(sc)) passed++;
}
if (passed === SCENARIOS.length) {
  console.log(`selftest: ${passed} scenarios passed`);
  process.exit(0);
}
console.log(`selftest: ${passed} of ${SCENARIOS.length} scenarios passed`);
process.exit(1);
