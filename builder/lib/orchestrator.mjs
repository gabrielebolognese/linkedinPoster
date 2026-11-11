// Main batch loop and phase state machine of the build runner.
// Exit codes: 0 finished, 2 fail-stop, 3 preflight failed, 130 interrupted, anything else = crash.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, P, cfg, rel, readJson, writeJsonAtomic, writeFileAtomic, getState, saveState, isDone } from './state.mjs';
import { log, initLog, currentLogFile, short, fmtClock } from './log.mjs';
import { loadSpec, checkSpec, writeContext, listTable } from './spec.mjs';
import { selfTest as limitsSelfTest } from './limits.mjs';
import { runSession, killActive, effortFor } from './session.mjs';
import { runVerify, killActiveVerify } from './verify.mjs';
import { waitUntil } from './wait.mjs';
import { render, resumeNote, failureNote, acceptanceList } from './prompts.mjs';
import * as G from './gitstats.mjs';

const VERB = { build: 'building', verify: 'verifying', review: 'reviewing', fix: 'fixing' };
const c = cfg();
const state = getState();

class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function parseArgs(argv) {
  const a = { dryRun: false, status: false, only: null, from: null, until: null, redo: null, noReview: false };
  const need = (i, flag) => {
    const v = argv[i + 1];
    if (!v || !/^M\d\d$/.test(v)) {
      console.error(`${flag} needs a batch id such as M05`);
      process.exit(3);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--dry-run') a.dryRun = true;
    else if (f === '--status') a.status = true;
    else if (f === '--no-review') a.noReview = true;
    else if (f === '--only') a.only = need(i++, f);
    else if (f === '--from') a.from = need(i++, f);
    else if (f === '--until') a.until = need(i++, f);
    else if (f === '--redo') a.redo = need(i++, f);
    else {
      console.error(`unknown argument: ${f} (see builder/README.md)`);
      process.exit(3);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const reviewEnabled = c.reviewEveryBatch && !args.noReview;

function save() {
  saveState();
}

function fail(code, lines) {
  for (const l of [].concat(lines)) log(l, 'red');
  throw new Exit(code);
}

// ---------------------------------------------------------------- status

function printStatus() {
  const spec = loadSpec();
  console.log(`repo: ${REPO_ROOT}`);
  const cur = state.current;
  if (cur) {
    console.log(`current batch: ${cur.id}, phase ${cur.phase}${cur.reviewMode ? ` (${cur.reviewMode})` : ''}, build attempt ${cur.attempt}, fix round ${cur.fixRound}, quality round ${cur.qualityRound}, sessions ${cur.sessionCount}`);
    console.log(`  base commit ${G.short(cur.baseSha)}, started ${cur.startedAt}`);
    if (cur.lastFailure) console.log(`  last failure report: ${cur.lastFailure}`);
  } else {
    console.log('current batch: none');
  }
  console.log('batches:');
  for (const b of spec.batches) {
    const d = readJson(P.done(b.id), null);
    if (d) console.log(`  ${b.id}  done   ${G.short(d.sha)}  ${String(d.minutes).padStart(4)} min  review ${d.review}  fix rounds ${d.fixRounds}  ${b.title}`);
    else console.log(`  ${b.id}  ${cur && cur.id === b.id ? 'active' : 'todo  '}  ${b.title}`);
  }
  const waitMs = state.waits.reduce((s, w) => s + Math.max(0, Date.parse(w.until) - Date.parse(w.from)), 0);
  console.log(`waits recorded: ${state.waits.length} (${Math.round(waitMs / 60000)} min)`);
  const lock = path.join(P.state, 'build.lock');
  console.log(`lock file: ${fs.existsSync(lock) ? `present (${fs.readFileSync(lock, 'utf8').trim()})` : 'none'}`);
  let last = null;
  try {
    const files = fs.readdirSync(P.logs).filter((f) => /^build-.*\.log$/.test(f)).sort();
    if (files.length) last = files[files.length - 1];
  } catch { /* no logs yet */ }
  console.log(`last log file: ${last ? `builder/logs/${last}` : 'none'}`);
}

// ---------------------------------------------------------------- sessions with limit handling

/**
 * Run a session and handle usage limits and transient errors by waiting and rerunning the same phase.
 * opts.makePrompt(resume) returns the prompt file for this run. Returns the final runSession result
 * with outcome ok, stall, timeout or error (or transient when retryTransient is false).
 */
async function sessionLoop(opts) {
  const what = opts.batchId ? `${opts.batchId} ${opts.phase}` : opts.phase;
  const waitPhase = opts.batchId ? opts.phase : 'preflight';
  let resume = Boolean(opts.resume);
  let transientIdx = 0;
  for (;;) {
    const cur = state.current;
    if (cur && opts.batchId) {
      cur.sessionCount = (cur.sessionCount || 0) + 1;
      save();
    }
    const promptFile = opts.makePrompt ? opts.makePrompt(resume) : undefined;
    const res = await runSession({ ...opts, promptFile });
    if (res.outcome === 'limit') {
      log(`usage limit reached during ${what}: "${res.limitMessage}"`, 'yellow');
      const target = (res.resetAt || Date.now() + c.limitFallbackMinutes * 60000) + c.limitBufferMinutes * 60000;
      await waitUntil(new Date(target), { reason: 'usage limit', kind: 'limit', batchId: opts.batchId, phase: waitPhase, bufferMin: c.limitBufferMinutes });
      resume = true;
      transientIdx = 0;
      continue;
    }
    if (res.outcome === 'transient' && opts.retryTransient !== false) {
      const list = c.transientBackoffMinutes;
      const detail = short((res.detail || res.finalText || 'no detail').replace(/\s+/g, ' '), 200);
      if (transientIdx < list.length) {
        const mins = list[transientIdx++];
        log(`transient API error during ${what} (${detail}). retry ${transientIdx} of ${list.length} in ${mins} min`, 'yellow');
        await waitUntil(new Date(Date.now() + mins * 60000), { reason: 'transient error backoff', kind: 'retry', batchId: opts.batchId, phase: waitPhase });
      } else {
        log(`transient API errors persist during ${what} (${detail}). treating it as a usage limit, waiting ${c.limitFallbackMinutes} min`, 'yellow');
        await waitUntil(new Date(Date.now() + c.limitFallbackMinutes * 60000), { reason: 'usage limit (fallback wait)', kind: 'limit', batchId: opts.batchId, phase: waitPhase });
        transientIdx = 0;
      }
      resume = true;
      continue;
    }
    return res;
  }
}

function lastLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function writePrompt(name, text) {
  const file = path.join(P.promptsOut, name);
  writeFileAtomic(file, text);
  return rel(file);
}

// ---------------------------------------------------------------- reviews

function section(text, title) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${title}`.toLowerCase());
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    if (lines[i].trim()) out.push(lines[i].replace(/\s+$/, ''));
  }
  return out;
}

function readReview(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const m = first.trim().match(/^VERDICT:\s*(PASS|FIX)\s*$/);
  if (!m) return null;
  const issues = section(text, 'Issues');
  const count = (k) => issues.filter((l) => l.toLowerCase().includes(`[${k}]`)).length;
  return {
    verdict: m[1],
    issues,
    summary: section(text, 'Summary'),
    counts: `${count('blocker')} blocker, ${count('major')} major, ${count('minor')} minor`,
  };
}

/** Run a review session (quality or failure mode). Returns the parsed review or null. */
async function doReview(batch, cur, mode, spec) {
  const id = batch.id;
  const round = mode === 'quality' ? cur.qualityRound : cur.fixRound;
  const outAbs = mode === 'quality'
    ? path.join(P.reviews, `${id}-review-${round}.md`)
    : path.join(P.fixes, `${id}-fix-${round}.md`);
  const outRel = rel(outAbs);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const tag = `${id} review |`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    fs.rmSync(outAbs, { force: true });
    const text = render('review', {
      OUTPUT_FILE: outRel,
      MODE: mode,
      BATCH_ID: id,
      BATCH_TITLE: batch.title,
      BASE_SHA: cur.baseSha,
      CONTEXT_FILE: rel(P.context(id)),
      FAILURE_INPUT: mode === 'failure'
        ? `Failure report with the output of the failing commands: ${cur.lastFailure}. Read it first.`
        : 'No failure report: verify passed.',
    });
    const promptFile = writePrompt(`${id}-${mode === 'quality' ? 'review' : 'freview'}-${round}.md`, text);
    log(`${tag} starting ${mode} review (${c.reviewModel}), round ${round}${attempt > 1 ? ', second try' : ''}`, 'cyan');
    const res = await sessionLoop({
      batchId: id, phase: 'review', attempt, model: c.reviewModel, effort: effortFor('review'),
      permission: 'review', maxTurns: c.reviewMaxTurns,
      makePrompt: () => promptFile, heartbeat: heartbeatFor(cur, 'review'),
    });
    const review = readReview(outAbs);
    if (review) {
      if (mode === 'failure') review.verdict = 'FIX';
      log(`${tag} VERDICT: ${review.verdict} (${mode === 'failure' ? `failure review, round ${round}, ` : ''}${review.counts})`, review.verdict === 'PASS' ? 'green' : 'yellow');
      if (mode === 'failure') for (const l of review.summary.slice(0, 8)) log(`${tag}   ${short(l, 220)}`);
      for (const l of review.issues.slice(0, 15)) log(`${tag}   ${short(l, 220)}`);
      if (review.issues.length > 15) log(`${tag}   ...`);
      log(`${tag} full review: ${outRel}`);
      return { ...review, file: outRel };
    }
    log(`${tag} the review file ${outRel} is missing or malformed (session outcome: ${res.outcome}, try ${attempt} of 2)`, 'yellow');
  }
  return null;
}

// ---------------------------------------------------------------- batch

function heartbeatFor(cur, phase) {
  return () => {
    const minute = Math.max(0, Math.floor((Date.now() - Date.parse(cur.startedAt)) / 60000));
    return `still ${VERB[phase]} batch ${cur.id} (minute ${minute}), files changed: ${G.filesChangedCount(cur.baseSha)}, commits: ${G.commitsSince(cur.baseSha)}.`;
  };
}

function setPhase(cur, phase, extra = {}) {
  Object.assign(cur, extra, { phase });
  save();
}

async function runBatch(spec, batch, index) {
  const id = batch.id;
  const total = spec.batches.length;
  let cur = state.current && state.current.id === id ? state.current : null;

  if (cur) {
    log(`==== ${id}. ${batch.title} (batch ${index + 1}/${total}) ====`, 'cyan');
    log(`resuming in phase ${cur.phase}${cur.phase === 'review' ? ` (${cur.reviewMode})` : ''}, base commit ${G.short(cur.baseSha)}, context ${rel(P.context(id))}`, 'cyan');
    if (cur.phase === 'build') cur.resume = true;
  } else {
    cur = {
      id, phase: 'build', attempt: 1, fixRound: 0, qualityRound: 0,
      baseSha: G.headSha(), startedAt: new Date().toISOString(), sessionCount: 0,
      verifyCount: 0, review: 'SKIPPED', reviewMode: null, fixKind: null, fixFile: null,
      lastFailure: null, lastFailed: [], finalLine: '', resume: false,
    };
    state.current = cur;
    log(`==== ${id}. ${batch.title} (batch ${index + 1}/${total}) ====`, 'cyan');
    log(`base commit ${G.short(cur.baseSha)}, context ${rel(P.context(id))}`, 'cyan');
  }
  writeContext(spec, batch);
  save();

  for (;;) {
    if (cur.phase === 'build') {
      const makePrompt = (resume) => writePrompt(`${id}-build-${cur.attempt}.md`, render('build', {
        BATCH_ID: id,
        BATCH_TITLE: batch.title,
        BATCH_INDEX: index + 1,
        BATCH_TOTAL: total,
        ATTEMPT: cur.attempt,
        BASE_SHA: cur.baseSha,
        CONTEXT_FILE: rel(P.context(id)),
        RESUME_NOTE: resume ? resumeNote(cur.baseSha) : '',
        FAILURE_NOTE: cur.lastFailure ? failureNote(cur.lastFailure) : '',
        ACCEPTANCE_LIST: acceptanceList(batch.acceptance),
      }));
      log(`${id} build | starting build session (${c.buildModel}), attempt ${cur.attempt} of ${c.maxBuildAttempts}`, 'cyan');
      const res = await sessionLoop({
        batchId: id, phase: 'build', attempt: cur.attempt, model: c.buildModel, effort: effortFor('build'),
        permission: 'skip', maxTurns: c.buildMaxTurns, resume: cur.resume,
        makePrompt, heartbeat: heartbeatFor(cur, 'build'),
      });
      cur.finalLine = lastLine(res.finalText);
      if (res.outcome === 'ok') {
        if (/\bBLOCKED\b/.test(cur.finalLine)) log(`${id} build | the session reported: ${short(cur.finalLine, 200)} (verify decides)`, 'yellow');
        setPhase(cur, 'verify');
      } else if (cur.attempt < c.maxBuildAttempts) {
        log(`${id} build | session ended with ${res.outcome}${res.subtype ? ` (${res.subtype})` : ''}, rerunning the build (attempt ${cur.attempt + 1} of ${c.maxBuildAttempts})`, 'yellow');
        setPhase(cur, 'build', { attempt: cur.attempt + 1, resume: true });
      } else {
        log(`${id} build | session ended with ${res.outcome}${res.subtype ? ` (${res.subtype})` : ''}, no build attempts left. running verify on the partial work`, 'yellow');
        setPhase(cur, 'verify');
      }
      continue;
    }

    if (cur.phase === 'verify') {
      cur.verifyCount = (cur.verifyCount || 0) + 1;
      save();
      const v = await runVerify({ batch, baseSha: cur.baseSha, n: cur.verifyCount, finalLine: cur.finalLine, heartbeat: heartbeatFor(cur, 'verify') });
      if (v.pass) {
        const wantReview = reviewEnabled && cur.fixRound === 0 && cur.qualityRound < c.maxQualityRounds;
        if (wantReview) {
          setPhase(cur, 'review', { reviewMode: 'quality', qualityRound: cur.qualityRound + 1 });
          continue;
        }
        return finishBatch(batch, cur);
      }
      cur.lastFailure = v.reportPath;
      cur.lastFailed = v.failed;
      if (cur.fixRound >= c.maxFixRounds) return failStop(batch, cur);
      setPhase(cur, 'review', { reviewMode: 'failure', fixRound: cur.fixRound + 1 });
      continue;
    }

    if (cur.phase === 'review') {
      const mode = cur.reviewMode === 'failure' ? 'failure' : 'quality';
      const review = await doReview(batch, cur, mode, spec);
      if (mode === 'quality') {
        if (!review) {
          log(`${id} review | no usable review after two tries. verify already passed, treating it as PASS`, 'yellow');
          cur.review = 'PASS';
          save();
          return finishBatch(batch, cur);
        }
        cur.review = review.verdict;
        if (review.verdict === 'PASS') {
          save();
          return finishBatch(batch, cur);
        }
        setPhase(cur, 'fix', { fixKind: 'quality', fixFile: review.file });
      } else {
        let file = review ? review.file : null;
        if (!file) {
          const abs = path.join(P.fixes, `${id}-fix-${cur.fixRound}.md`);
          writeFileAtomic(abs, [
            'VERDICT: FIX', '',
            '## Summary', 'The failure review did not produce a usable file. Work directly from the failure report.', '',
            '## Issues', `1. [blocker] See ${cur.lastFailure}: ${cur.lastFailed.join('; ')}`, '',
            '## Fix plan', `1. Read ${cur.lastFailure} completely. Find the root cause of every failing check and fix it.`, '',
            '## Verify', ...batch.acceptance, '',
          ].join('\n'));
          file = rel(abs);
          log(`${id} review | no usable failure review after two tries, using a fallback fix plan: ${file}`, 'yellow');
        }
        setPhase(cur, 'fix', { fixKind: 'failure', fixFile: file });
      }
      continue;
    }

    if (cur.phase === 'fix') {
      const round = cur.fixKind === 'quality' ? `Q${cur.qualityRound}` : String(cur.fixRound);
      const text = render('fix', {
        BATCH_ID: id,
        BATCH_TITLE: batch.title,
        ROUND: round,
        FIX_FILE: cur.fixFile,
        CONTEXT_FILE: rel(P.context(id)),
        ACCEPTANCE_LIST: acceptanceList(batch.acceptance),
      });
      const promptFile = writePrompt(`${id}-fix-${round}.md`, text);
      log(`${id} fix | starting fix session (${c.fixModel}), round ${round}, plan ${cur.fixFile}`, 'cyan');
      const res = await sessionLoop({
        batchId: id, phase: 'fix', attempt: 1, model: c.fixModel, effort: effortFor('fix'),
        permission: 'skip', maxTurns: c.fixMaxTurns,
        makePrompt: () => promptFile, heartbeat: heartbeatFor(cur, 'fix'),
      });
      cur.finalLine = lastLine(res.finalText);
      if (res.outcome !== 'ok') log(`${id} fix | session ended with ${res.outcome}, verify decides`, 'yellow');
      setPhase(cur, 'verify');
      continue;
    }

    throw new Error(`unknown phase "${cur.phase}" in state for ${id}`);
  }
}

function finishBatch(batch, cur) {
  const id = batch.id;
  const sha = G.headSha();
  G.git(['tag', '-f', `build-${id}`]);
  const finishedAt = new Date().toISOString();
  const minutes = Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(cur.startedAt)) / 60000));
  const done = {
    id, title: batch.title, sha,
    startedAt: cur.startedAt, finishedAt, minutes,
    commits: G.commitsSince(cur.baseSha),
    filesChanged: G.committedFilesCount(cur.baseSha),
    review: cur.review || 'SKIPPED',
    fixRounds: cur.fixRound || 0,
  };
  writeJsonAtomic(P.done(id), done);
  state.current = null;
  save();
  log(`==== ${id} done in ${minutes} min | files changed: ${done.filesChanged} | commits: ${done.commits} | review: ${done.review} | fix rounds: ${done.fixRounds} ====`, 'green');
  return done;
}

function failStop(batch, cur) {
  const id = batch.id;
  const lastFix = cur.fixRound > 0 ? rel(path.join(P.fixes, `${id}-fix-${cur.fixRound}.md`)) : '(none)';
  const lines = [
    `==== FAIL-STOP at ${id}. ${batch.title} ====`,
    `verify still fails after ${cur.fixRound} fix round${cur.fixRound === 1 ? '' : 's'}. Failing checks:`,
    ...cur.lastFailed.map((f) => `  ${f}`),
    `failure report: ${cur.lastFailure}`,
    `last review / fix plan: ${lastFix}`,
    `log file: ${currentLogFile() ? rel(currentLogFile()) : '(none)'}`,
    `to resume: bash builder/build.sh   (re-runs verify for ${id}, then a fresh set of fix rounds)`,
    `or:        bash builder/build.sh --only ${id}`,
  ];
  // The next start re-verifies first (you may have fixed it by hand) and gets fresh fix rounds.
  setPhase(cur, 'verify', { fixRound: 0 });
  fail(2, lines);
}

// ---------------------------------------------------------------- preflight

function preflightStatic() {
  let spec;
  try {
    spec = loadSpec();
  } catch (e) {
    fail(3, `preflight: cannot read spec.md: ${e.message}`);
  }
  const errors = checkSpec(spec);
  if (errors.length) fail(3, [...errors.map((e) => `spec error: ${e}`), 'preflight: spec.md check failed']);
  log(`preflight: spec.md ok (${spec.batches.length} batches, ${spec.appendixOrder.length} appendices)`);

  const lt = limitsSelfTest();
  if (lt.failed.length) fail(3, [...lt.failed.map((f) => `limits self-test FAILED: ${f}`), 'preflight: limits self-test failed']);
  log(`preflight: limits self-test ok (${lt.passed} passed)`);

  if (!G.isRepo()) fail(3, 'preflight: this folder is not a git repository (run git init)');
  if (!G.headSha()) fail(3, 'preflight: the git repository has no commits yet');
  if (!G.git(['config', 'user.name']).out) fail(3, 'preflight: git user.name is not set (git config user.name "Your Name")');
  log(`preflight: git ok (HEAD ${G.short(G.headSha())})`);
  return spec;
}

async function smokeTest() {
  log(`preflight: smoke test, one headless session with model ${c.buildModel}`);
  const res = await sessionLoop({
    batchId: null, phase: 'smoke', attempt: 1, model: c.buildModel,
    instruction: 'Reply with exactly: OK', permission: 'none', maxTurns: 1, retryTransient: false,
    heartbeat: () => 'preflight smoke test still running.',
  });
  if (res.outcome !== 'ok') {
    const lines = [`preflight: smoke test failed (outcome ${res.outcome}, exit code ${res.exitCode})`];
    if (res.finalText) lines.push(`final text: ${short(res.finalText, 2000)}`);
    if (res.detail) lines.push(`detail: ${short(res.detail, 2000)}`);
    if (res.stderr) lines.push(`stderr: ${short(res.stderr, 2000)}`);
    try {
      const raw = fs.readFileSync(path.join(REPO_ROOT, res.rawLog), 'utf8').trim();
      if (raw) lines.push('raw output:', ...raw.split('\n').slice(-20).map((l) => `  ${short(l, 400)}`));
    } catch { /* no raw log */ }
    lines.push(`raw stream file: ${res.rawLog}`);
    fail(3, lines);
  }
  log(`preflight: smoke test ok (model ${res.model || 'not reported'})`, 'green');
}

// ---------------------------------------------------------------- summary

function printSummary(spec) {
  const done = spec.batches.map((b) => readJson(P.done(b.id), null)).filter(Boolean);
  if (!done.length) return;
  log('==== summary ====', 'cyan');
  const rows = done.map((d) => [d.id, `${d.minutes} min`, String(d.commits), String(d.filesChanged), d.review, String(d.fixRounds)]);
  const head = ['id', 'time', 'commits', 'files', 'review', 'fix rounds'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((x, i) => x.padEnd(w[i])).join('  ').trimEnd();
  log(fmt(head));
  for (const r of rows) log(fmt(r));
  const totalMin = done.reduce((s, d) => s + (d.minutes || 0), 0);
  const waitMs = state.waits.reduce((s, x) => s + Math.max(0, Date.parse(x.until) - Date.parse(x.from)), 0);
  log(`total time: ${Math.floor(totalMin / 60)}h ${totalMin % 60}m over ${done.length} of ${spec.batches.length} batches`);
  log(`usage limit and retry waits: ${state.waits.length} (${Math.round(waitMs / 60000)} min)`);
  const last = spec.batches[spec.batches.length - 1];
  if (done.length === spec.batches.length && last.nextLines.length) {
    log('==== next steps ====', 'cyan');
    for (const l of last.nextLines) log(l);
  }
}

// ---------------------------------------------------------------- main

async function main() {
  if (args.status) {
    printStatus();
    return 0;
  }
  initLog();
  const runId = process.env.BUILDER_RUN_TOKEN || `run-${Date.now()}`;
  state.runId = runId;
  log(`build runner starting in ${REPO_ROOT}${args.dryRun ? ' (dry run)' : ''}`, 'cyan');
  log(`log file: ${rel(currentLogFile())}`, 'dim');

  const spec = preflightStatic();
  const ids = spec.batches.map((b) => b.id);
  const idx = (id, flag) => {
    const i = ids.indexOf(id);
    if (i < 0) fail(3, `${flag}: unknown batch ${id}`);
    return i;
  };

  let start = 0;
  let end = ids.length - 1;
  if (args.only) {
    start = end = idx(args.only, '--only');
  } else {
    if (args.from) start = idx(args.from, '--from');
    if (args.redo) start = Math.min(args.from ? start : Infinity, idx(args.redo, '--redo'));
    if (args.until) end = idx(args.until, '--until');
  }
  if (args.redo) idx(args.redo, '--redo');
  if (end < start) fail(3, 'nothing to run: --until is before the start batch');

  if (args.dryRun) {
    const dirty = G.porcelain();
    if (dirty) {
      log('warning: the working tree is not clean (a real run would commit these as "builder: pre-run snapshot" unless a batch is being resumed):', 'yellow');
      for (const l of dirty.split('\n').slice(0, 30)) log(`  ${l}`, 'yellow');
    }
    log('batches:', 'cyan');
    for (const l of listTable(spec)) log(`  ${l}`);
    for (const b of spec.batches) {
      const mark = isDone(b.id) ? ' [done]' : state.current && state.current.id === b.id ? ` [in progress, phase ${state.current.phase}]` : '';
      log(`${b.id}. ${b.title}${mark} (timeout ${b.timeoutMinutes} min per command)`, 'cyan');
      for (const cmd of b.acceptance) log(`    $ ${cmd}`);
    }
    log(`models: build ${c.buildModel}, review ${c.reviewModel}${reviewEnabled ? '' : ' (quality reviews off)'}, fix ${c.fixModel}`);
    log(`would run: ${ids.slice(start, end + 1).filter((id) => !isDone(id) || id === args.redo).join(' ') || '(nothing, all done)'}`);
    log('dry run ok: preflight passed, no claude call was made', 'green');
    return 0;
  }

  // --redo: forget done markers (once per build.sh invocation, not again after a crash restart).
  if (args.redo && state.redoToken !== runId) {
    const from = idx(args.redo, '--redo');
    const forget = args.from ? ids.slice(from) : [args.redo];
    for (const id of forget) {
      if (isDone(id)) {
        fs.rmSync(P.done(id), { force: true });
        log(`--redo: forgot the done marker of ${id}`, 'yellow');
      }
    }
    if (state.current && forget.includes(state.current.id)) state.current = null;
    state.redoToken = runId;
    save();
  }

  if (args.from) {
    const missing = ids.slice(0, start).filter((id) => !isDone(id));
    if (missing.length) fail(3, `--from ${args.from}: earlier batches are not done yet: ${missing.join(' ')}`);
  }

  const selection = spec.batches.slice(start, end + 1);
  const firstPending = selection.find((b) => !isDone(b.id));

  if (state.current && isDone(state.current.id)) state.current = null;
  const resuming = Boolean(state.current && firstPending && state.current.id === firstPending.id);
  if (state.current && !resuming) {
    log(`note: saved progress of ${state.current.id} (phase ${state.current.phase}) is dropped because this run starts elsewhere`, 'yellow');
    state.current = null;
  }
  if (!G.isClean()) {
    if (resuming) {
      log(`the working tree has uncommitted changes: they belong to ${state.current.id}, which is being resumed`, 'yellow');
    } else {
      G.git(['add', '-A']);
      const r = G.git(['commit', '-q', '-m', 'builder: pre-run snapshot']);
      if (r.code !== 0) fail(3, `preflight: could not commit the dirty working tree: ${r.err || r.out}`);
      log('warning: the working tree was dirty, committed it as "builder: pre-run snapshot"', 'yellow');
    }
  }
  save();

  await smokeTest();

  for (const batch of selection) {
    const d = readJson(P.done(batch.id), null);
    if (d) {
      log(`${batch.id} already done (commit ${G.short(d.sha)}), skipping`, 'dim');
      continue;
    }
    await runBatch(spec, batch, ids.indexOf(batch.id));
  }

  printSummary(spec);
  return 0;
}

let interrupted = false;
function onSignal() {
  if (interrupted) return;
  interrupted = true;
  try { killActive(); } catch { /* ignore */ }
  try { killActiveVerify(); } catch { /* ignore */ }
  try { save(); } catch { /* ignore */ }
  try { log('interrupted (Ctrl+C). state saved, run bash builder/build.sh to resume', 'yellow'); } catch { /* ignore */ }
  process.exit(130);
}
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

main().then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof Exit) process.exit(e.code);
    try {
      log(`orchestrator crashed: ${e && e.stack ? e.stack : e}`, 'red');
      save();
    } catch { /* ignore */ }
    process.exit(1);
  },
);
