// Runs one headless claude session: spawn, live stream view, heartbeat, stall and limit detection.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, P, cfg, rel } from './state.mjs';
import { log, initLog, short, fmtDuration, fmtClock } from './log.mjs';
import { isLimitMessage, parseLimit } from './limits.mjs';

const TRANSIENT = /overloaded|529|500|502|503|504|ECONNRESET|ETIMEDOUT|network|socket hang up|rate.?limit/i;
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'mythos'];
const REVIEW_TOOLS = 'Read,Grep,Glob,Write,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git status:*)';
const isWin = process.platform === 'win32';

let active = null;

/** Kill a child and everything it started. */
export function killTree(child) {
  if (!child || !child.pid) return;
  if (isWin) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, 5000).unref();
  }
}

/** Kill the running session, if any (used on Ctrl+C). */
export function killActive() {
  if (active) killTree(active);
}

let resolved = null;

/**
 * Resolve the claude binary: { cmd, shell }.
 * Windows: a native claude.exe is spawned directly. An npm shim (claude.cmd) is read to find the
 * claude.exe it launches. Only if that fails is the .cmd spawned through a shell.
 */
export function resolveBin() {
  if (resolved) return resolved;
  const bin = cfg().claudeBin;
  resolved = { cmd: bin, shell: false };
  if (!isWin) return resolved;
  let candidates = [bin];
  if (!/[\\/]/.test(bin) && !path.extname(bin)) {
    const r = spawnSync('where', [bin], { encoding: 'utf8', windowsHide: true });
    const found = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (found.length) candidates = found;
  }
  const exe = candidates.find((c) => /\.exe$/i.test(c));
  const script = candidates.find((c) => /\.(cmd|bat)$/i.test(c));
  // `where` lists matches in PATH order. Prefer whichever real launcher comes first.
  const first = candidates.find((c) => /\.(exe|cmd|bat)$/i.test(c));
  if (first && first === exe) {
    resolved = { cmd: exe, shell: false };
  } else if (script) {
    let target = null;
    try {
      const text = fs.readFileSync(script, 'utf8');
      const m = text.match(/"%(?:~dp0|dp0%)\\?([^"]+?\.exe)"/i);
      if (m) {
        const cand = path.join(path.dirname(script), m[1]);
        if (fs.existsSync(cand)) target = cand;
      }
    } catch { /* fall through to shell mode */ }
    resolved = target ? { cmd: target, shell: false } : { cmd: script, shell: true };
  } else if (exe) {
    resolved = { cmd: exe, shell: false };
  }
  return resolved;
}

let caps = null;

/** What the installed CLI supports, read once from `claude --help`. */
export function cliCaps() {
  if (caps) return caps;
  const { cmd, shell } = resolveBin();
  const args = [...cfg().claudePrefixArgs, '--help'];
  const r = shell
    ? spawnSync([quoteArg(cmd), ...args.map(quoteArg)].join(' '), { encoding: 'utf8', shell: true, windowsHide: true, timeout: 60000 })
    : spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const help = `${r.stdout || ''}\n${r.stderr || ''}`;
  caps = {
    helpOk: r.status === 0 && help.length > 50,
    effort: /--effort\b/.test(help),
    dontAsk: /dontAsk/.test(help),
    allowedTools: /--allowedTools\b|--allowed-tools\b/.test(help),
  };
  return caps;
}

function quoteArg(a) {
  return /[\s()&|<>^,;=*]/.test(a) ? `"${a}"` : a;
}

function familyOf(model) {
  const m = String(model || '').toLowerCase();
  return FAMILIES.find((f) => m.includes(f)) || null;
}

function showPath(p) {
  if (!p) return '(unknown)';
  let s = String(p);
  if (path.isAbsolute(s)) {
    const r = path.relative(REPO_ROOT, s);
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) s = r;
  }
  return s.split('\\').join('/');
}

const firstLine = (s) => String(s ?? '').split(/\r?\n/).find((l) => l.trim()) || '';

/** Compact event lines for one assistant content block. Returns a string or null. */
function describeBlock(block, c) {
  if (!block || typeof block !== 'object') return null;
  if (block.type === 'text') {
    const t = firstLine(block.text).trim();
    return c.showText && t ? `says: ${short(t, 160)}` : null;
  }
  if (block.type !== 'tool_use') return null;
  const input = block.input || {};
  switch (block.name) {
    case 'Bash':
    case 'PowerShell':
      return `$ ${short(firstLine(input.command).trim(), 160)}`;
    case 'Write':
      return `write ${showPath(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `edit ${showPath(input.file_path || input.notebook_path)}`;
    case 'Read':
      return c.showReads ? `read ${showPath(input.file_path)}` : null;
    case 'Grep':
      return c.showReads ? `grep ${short(String(input.pattern ?? ''), 80)}` : null;
    case 'Glob':
      return c.showReads ? `glob ${short(String(input.pattern ?? ''), 80)}` : null;
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      const done = todos.filter((t) => t.status === 'completed').length;
      const cur = todos.find((t) => t.status === 'in_progress');
      return `todo ${done}/${todos.length}: ${short(cur ? cur.content || cur.activeForm || '' : '(none in progress)', 120)}`;
    }
    default:
      return `tool ${block.name}`;
  }
}

function nextRawLog(batchId, phase) {
  fs.mkdirSync(P.sessions, { recursive: true });
  const base = `${batchId || 'preflight'}-${phase}`;
  for (let n = 1; ; n++) {
    const f = path.join(P.sessions, `${base}-${n}.jsonl`);
    if (!fs.existsSync(f)) return f;
  }
}

/**
 * Run one headless session. See builder/README.md for the options.
 * Returns { outcome, finalText, resetAt, limitMessage, exitCode, turns, durationMs, rawLog, model, stderr }.
 */
export async function runSession(opts) {
  const c = cfg();
  const label = `${opts.batchId || 'preflight'} ${opts.phase}`;
  const instruction = opts.instruction
    || `Read the file ${String(opts.promptFile).split('\\').join('/')} and follow its instructions exactly.`;
  const maxTurns = opts.maxTurns ?? 50;
  const stallMs = (opts.stallMinutes ?? c.stallMinutes) * 60000;
  const maxMs = (opts.maxMinutes ?? c.sessionMaxMinutes) * 60000;
  const reqFamily = familyOf(opts.model);

  const args = [...c.claudePrefixArgs, '-p', instruction, '--model', opts.model,
    '--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns)];
  if (opts.permission === 'skip') {
    args.push('--dangerously-skip-permissions');
  } else if (opts.permission === 'review') {
    const k = cliCaps();
    if (!k.helpOk || k.dontAsk) args.push('--permission-mode', 'dontAsk', '--allowedTools', REVIEW_TOOLS);
    else args.push('--dangerously-skip-permissions');
  }
  if (opts.effort && cliCaps().effort) args.push('--effort', opts.effort);

  const rawLog = nextRawLog(opts.batchId, opts.phase);
  const rawStream = fs.createWriteStream(rawLog);
  const { cmd, shell } = resolveBin();
  const started = Date.now();

  return await new Promise((resolve) => {
    let child;
    const spawnOpts = {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DISABLE_AUTOUPDATER: '1' },
      windowsHide: true,
      detached: !isWin,
    };
    try {
      child = shell
        ? spawn([quoteArg(cmd), ...args.map(quoteArg)].join(' '), { ...spawnOpts, shell: true })
        : spawn(cmd, args, spawnOpts);
    } catch (e) {
      rawStream.end();
      resolve({ outcome: 'error', finalText: `spawn failed: ${e.message}`, resetAt: null, limitMessage: '', exitCode: null, turns: 0, durationMs: 0, rawLog: rel(rawLog), model: null, stderr: String(e.message) });
      return;
    }
    active = child;

    let lastLineAt = Date.now();
    let lastEvent = '(session starting)';
    let killedAs = null;
    let limitMsg = '';
    let transientMsg = '';
    let rejectedReset = null;
    let familyMismatch = '';
    let resultEvt = null;
    let initModel = null;
    let lastAssistantText = '';
    let stderr = '';
    const plain = [];
    let exitCode = null;
    let spawnErr = null;
    let finished = false;
    let resultTimer = null;

    const emit = (text, color = 'dim') => {
      lastEvent = text;
      log(`${label} | ${text}`, color);
    };

    const handle = (evt) => {
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'system' && evt.subtype === 'init') {
        initModel = evt.model || null;
        if (reqFamily && initModel && !String(initModel).toLowerCase().includes(reqFamily)) {
          familyMismatch = `model fallback: requested ${opts.model}, the session started on ${initModel}`;
          emit(familyMismatch, 'yellow');
          killTree(child);
        }
        return;
      }
      if (evt.type === 'rate_limit_event') {
        const info = evt.rate_limit_info || {};
        if (info.status === 'rejected' && Number(info.resetsAt) > 0) rejectedReset = Number(info.resetsAt) * 1000;
        return;
      }
      if (evt.type === 'assistant') {
        const msg = evt.message || {};
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
        const synthetic = msg.model === '<synthetic>' || Boolean(evt.error) || Boolean(msg.error)
          || evt.apiErrorStatus === 429 || evt.isApiErrorMessage === true;
        if (synthetic) {
          if (isLimitMessage(text) || (evt.error === 'rate_limit' && /reset/i.test(text))) {
            if (!limitMsg) limitMsg = text.trim();
          } else if (!transientMsg && (TRANSIENT.test(text) || evt.error)) {
            transientMsg = text.trim() || String(evt.error);
          }
        }
        if (text.trim()) lastAssistantText = text.trim();
        for (const b of blocks) {
          const line = describeBlock(b, c);
          if (line) emit(line);
        }
        return;
      }
      if (evt.type === 'result') {
        resultEvt = evt;
        const text = typeof evt.result === 'string' ? evt.result : '';
        const bad = evt.is_error === true || evt.subtype !== 'success' || evt.api_error_status === 429;
        if (bad && isLimitMessage(text) && !limitMsg) limitMsg = text.trim();
        const dur = evt.duration_ms ? fmtDuration(evt.duration_ms) : fmtDuration(Date.now() - started);
        emit(`session finished: ${evt.subtype || 'unknown'}${evt.is_error ? ' (error)' : ''} in ${dur}, ${evt.num_turns ?? '?'} turns`, bad ? 'yellow' : 'green');
        // The CLI normally exits right after the result. If something keeps it alive, end it.
        resultTimer = setTimeout(() => killTree(child), 60000);
        resultTimer.unref();
      }
    };

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      lastLineAt = Date.now();
      rawStream.write(`${line}\n`);
      if (!line.trim()) return;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        plain.push(line);
        emit(`raw: ${short(line, 200)}`);
        return;
      }
      try {
        handle(evt);
      } catch (e) {
        log(`${label} | (could not display an event: ${e.message})`, 'dim');
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      if (stderr.length < 200000) stderr += d;
    });

    const hbTimer = setInterval(() => {
      let head;
      try {
        head = opts.heartbeat ? opts.heartbeat() : `still running ${label}.`;
      } catch (e) {
        head = `still running ${label} (stats unavailable: ${e.message}).`;
      }
      log(`${head} last: ${short(lastEvent, 100)}`);
    }, Math.max(1000, c.heartbeatSeconds * 1000));

    const watchdog = setInterval(() => {
      if (killedAs || finished) return;
      const now = Date.now();
      if (now - started > maxMs) {
        killedAs = 'timeout';
        emit(`timeout: session exceeded ${opts.maxMinutes ?? c.sessionMaxMinutes} minutes, killing it`, 'red');
        killTree(child);
      } else if (!resultEvt && now - lastLineAt > stallMs) {
        killedAs = 'stall';
        emit(`stall: no output for ${fmtDuration(now - lastLineAt)}, killing the session`, 'red');
        killTree(child);
      }
    }, Math.max(250, Math.min(30000, stallMs / 4)));

    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(hbTimer);
      clearInterval(watchdog);
      if (resultTimer) clearTimeout(resultTimer);
      if (active === child) active = null;
      rawStream.end();
      if (stderr.trim()) {
        try { fs.writeFileSync(rawLog.replace(/\.jsonl$/, '.stderr.txt'), stderr); } catch { /* ignore */ }
      }

      const durationMs = Date.now() - started;
      const resultOk = Boolean(resultEvt) && resultEvt.subtype === 'success' && resultEvt.is_error !== true;
      const resultText = resultEvt && typeof resultEvt.result === 'string' ? resultEvt.result : '';
      const finalText = (resultText || lastAssistantText || '').trim();
      // Text that may explain a failure. Never the text of a successful result.
      const errText = [
        resultEvt && !resultOk ? resultText : '',
        !resultEvt ? stderr : '',
        !resultEvt ? plain.join('\n') : '',
        spawnErr ? String(spawnErr.message) : '',
      ].filter(Boolean).join('\n');
      if (!limitMsg && !resultOk) {
        const hit = errText.split(/\r?\n/).find((l) => isLimitMessage(l));
        if (hit) limitMsg = hit.trim();
      }

      let outcome;
      let resetAt = null;
      let limitMessage = '';
      const fallback = Date.now() + c.limitFallbackMinutes * 60000;
      if (limitMsg || (rejectedReset && !resultOk && !killedAs)) {
        outcome = 'limit';
        limitMessage = limitMsg || 'the usage limit was rejected by the API (no message text)';
        const parsed = limitMsg ? parseLimit(limitMsg, new Date()) : null;
        if (parsed) resetAt = +parsed.resetAt;
        else if (rejectedReset && rejectedReset > Date.now()) resetAt = rejectedReset;
        else resetAt = fallback;
      } else if (familyMismatch) {
        outcome = 'limit';
        limitMessage = familyMismatch;
        resetAt = fallback;
      } else if (killedAs) {
        outcome = killedAs;
      } else if (resultOk) {
        outcome = 'ok';
      } else if (resultEvt && resultEvt.subtype === 'error_max_turns') {
        outcome = 'error';
      } else if (transientMsg || TRANSIENT.test(errText)) {
        outcome = 'transient';
      } else {
        outcome = 'error';
      }

      resolve({
        outcome,
        finalText,
        resetAt,
        limitMessage,
        exitCode,
        turns: resultEvt ? resultEvt.num_turns ?? 0 : 0,
        durationMs,
        rawLog: rel(rawLog),
        model: initModel,
        stderr: stderr.trim(),
        detail: (transientMsg || errText || '').trim(),
        subtype: resultEvt ? resultEvt.subtype : null,
      });
    };

    let rlClosed = false;
    let procClosed = false;
    const maybeFinish = () => {
      if (rlClosed && procClosed) finish();
    };
    rl.on('close', () => {
      rlClosed = true;
      maybeFinish();
    });
    child.on('error', (e) => {
      spawnErr = e;
      finish();
    });
    child.on('close', (code) => {
      exitCode = code;
      procClosed = true;
      // readline closes on stream end. Give it a moment, then finish regardless.
      setTimeout(finish, 2000).unref();
      maybeFinish();
    });
  });
}

function effortFor(phase) {
  const c = cfg();
  return phase === 'review' ? c.reviewEffort : phase === 'fix' ? c.fixEffort : c.buildEffort;
}
export { effortFor };

// CLI: node builder/lib/session.mjs --smoke [--model <m>]
//      node builder/lib/session.mjs --prompt-file <rel path> --model <m> [--phase build] [--batch M01] [--max-turns n] [--review]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const val = (name, def = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  const c = cfg();
  initLog();
  let res;
  if (argv.includes('--smoke')) {
    const model = val('--model', c.buildModel);
    log(`smoke test: one headless session, model ${model}, prompt "Reply with exactly: OK"`, 'cyan');
    res = await runSession({
      batchId: null, phase: 'smoke', attempt: 1, model,
      instruction: 'Reply with exactly: OK', permission: 'none', maxTurns: 1,
      heartbeat: () => 'smoke test still running.',
    });
  } else if (val('--prompt-file')) {
    const phase = val('--phase', 'build');
    res = await runSession({
      batchId: val('--batch'), phase, attempt: 1, model: val('--model', c.buildModel),
      promptFile: val('--prompt-file'), permission: argv.includes('--review') ? 'review' : 'skip',
      maxTurns: Number(val('--max-turns', '50')), effort: effortFor(phase),
      heartbeat: () => `still running ${phase}.`,
    });
  } else {
    console.log('usage: node builder/lib/session.mjs --smoke [--model <m>]');
    process.exit(1);
  }
  log(`outcome: ${res.outcome} | model: ${res.model || '(none reported)'} | turns: ${res.turns} | ${fmtDuration(res.durationMs)}`, res.outcome === 'ok' ? 'green' : 'yellow');
  log(`final text: ${short(res.finalText || '(empty)', 300)}`);
  if (res.outcome === 'limit') {
    log(`usage limit: "${res.limitMessage}"`, 'yellow');
    log(`resets at ${fmtClock(res.resetAt)} (not waiting)`, 'yellow');
  } else if (res.outcome !== 'ok') {
    if (res.detail) log(`detail: ${short(res.detail, 1000)}`, 'red');
    if (res.stderr) log(`stderr: ${short(res.stderr, 1000)}`, 'red');
  }
  log(`raw stream: ${res.rawLog}`, 'dim');
  process.exit(res.outcome === 'ok' ? 0 : 1);
}
