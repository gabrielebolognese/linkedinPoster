// Fake claude CLI for the self-test. Emits stream-json and does the work for real (files, commits).
// Scenarios (FAKE_SCENARIO, comma-separated): ok, limit-once, verify-fail-once, stall-once, blocked.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log('fake claude. Options: -p, --model, --output-format, --verbose, --max-turns, --effort <level>,');
  console.log('--dangerously-skip-permissions, --permission-mode (choices: "dontAsk"), --allowedTools');
  process.exit(0);
}

const arg = (name, def = '') => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const instruction = arg('-p');
const model = arg('--model', 'opus');
const scenarios = (process.env.FAKE_SCENARIO || 'ok').split(',').map((s) => s.trim());
const stateFile = process.env.FAKE_STATE_FILE || path.join(process.cwd(), '..', 'fake-claude-state.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
let turns = 0;

function once(key) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* first call */ }
  if (st[key]) return false;
  st[key] = true;
  fs.writeFileSync(stateFile, JSON.stringify(st));
  return true;
}

const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const init = () => emit({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: 'fake', model, tools: ['Bash', 'Write', 'Read'], permissionMode: 'default' });
const assistant = (content, extra = {}) => {
  turns++;
  emit({ type: 'assistant', message: { model, role: 'assistant', content }, ...extra });
};
const tool = (name, input) => assistant([{ type: 'tool_use', id: `tu_${turns}`, name, input }]);
const say = (text) => assistant([{ type: 'text', text }]);
const result = (text, { subtype = 'success', isError = false } = {}) => emit({
  type: 'result', subtype, is_error: isError, result: text, num_turns: turns, duration_ms: Date.now() - started, session_id: 'fake',
});
const git = (...args) => spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });

function writeFile(file, content) {
  tool('Write', { file_path: path.join(process.cwd(), file), content });
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, content);
}

function commit(message) {
  tool('Bash', { command: `git add -A && git commit -m "${message}"` });
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

const FILES = { M01: ['hello.txt', 'hello\n'], M02: ['world.txt', 'world\n'] };

async function main() {
  const m = instruction.match(/Read the file (\S+) and follow/);
  if (!m) {
    // Not a build, review or fix prompt (the preflight smoke test).
    init();
    say('OK');
    result('OK');
    return 0;
  }
  const prompt = fs.readFileSync(m[1], 'utf8');
  const id = (prompt.match(/^BATCH: (M\d\d)\./m) || [])[1] || 'M01';
  const phase = prompt.startsWith('You are building one batch') ? 'build'
    : prompt.startsWith('You are a strict senior reviewer') ? 'review'
      : prompt.startsWith('You apply a fix plan') ? 'fix' : 'other';

  if (phase === 'other') {
    init();
    say('OK');
    result('OK');
    return 0;
  }

  if (phase === 'build') {
    if (scenarios.includes('stall-once') && once('stall')) {
      init();
      await sleep(30000);
      return 0;
    }
    if (scenarios.includes('limit-once') && once('limit')) {
      init();
      const text = `Claude AI usage limit reached|${Math.floor(Date.now() / 1000) + 4}`;
      turns++;
      emit({ type: 'assistant', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] }, error: 'rate_limit' });
      result(text, { isError: true });
      return 1;
    }
    init();
    say(`Reading the context for ${id}.`);
    tool('Read', { file_path: path.join(process.cwd(), 'PROGRESS.md') });
    if (scenarios.includes('blocked')) {
      result(`BATCH ${id} BLOCKED: the fake build was told to give up`);
      return 0;
    }
    const [file, content] = FILES[id] || [`${id}.txt`, `${id}\n`];
    const wrong = id === 'M01' && scenarios.includes('verify-fail-once') && once('verify-fail');
    writeFile(file, wrong ? 'wrong content\n' : content);
    tool('TodoWrite', { todos: [{ content: 'write the file', status: 'completed' }, { content: 'commit the work', status: 'in_progress' }] });
    await sleep(1600); // long enough for one heartbeat at HEARTBEAT_SECONDS=1
    commit(`${id}: fake build`);
    result(`BATCH ${id} COMPLETE: wrote ${file}`);
    return 0;
  }

  if (phase === 'review') {
    init();
    const out = (prompt.match(/You write exactly one file: (\S+?)\. /) || [])[1];
    const mode = (prompt.match(/^MODE: (\w+)/m) || [])[1] || 'quality';
    tool('Bash', { command: 'git diff --stat' });
    const verdict = mode === 'failure' ? 'FIX' : 'PASS';
    const [file] = FILES[id] || [`${id}.txt`];
    const body = verdict === 'FIX'
      ? `VERDICT: FIX\n\n## Summary\nThe file ${file} has the wrong content.\n\n## Issues\n1. [blocker] ${file}:1. The content does not match the spec.\n\n## Fix plan\n1. Rewrite ${file} with the content from the spec.\n\n## Verify\ntest -f ${file}\n`
      : 'VERDICT: PASS\n\n## Summary\nThe batch matches the spec.\n\n## Issues\n1. [minor] none worth fixing.\n\n## Fix plan\nNothing to do.\n\n## Verify\nThe acceptance commands.\n';
    writeFile(out, body);
    result(verdict === 'FIX' ? `REVIEW ${id}: FIX (1)` : `REVIEW ${id}: PASS`);
    return 0;
  }

  // fix
  init();
  const round = (prompt.match(/^FIX ROUND: (\S+)/m) || [])[1] || '1';
  const [file, content] = FILES[id] || [`${id}.txt`, `${id}\n`];
  writeFile(file, content);
  commit(`${id} fix ${round}: fake fix`);
  result(`FIX ${id}/${round} APPLIED: rewrote ${file}`);
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}, (e) => {
  console.error(`fake-claude crashed: ${e.stack || e}`);
  process.exitCode = 3;
});
