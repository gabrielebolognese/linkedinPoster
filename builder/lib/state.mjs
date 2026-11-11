// Paths, config (from env, same defaults as builder/config.sh) and atomic JSON state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
const B = path.join(REPO_ROOT, 'builder');

export const P = {
  builder: B,
  spec: path.join(REPO_ROOT, 'spec.md'),
  templates: path.join(B, 'prompts'),
  state: path.join(B, 'state'),
  stateFile: path.join(B, 'state', 'state.json'),
  doneDir: path.join(B, 'state', 'done'),
  contextDir: path.join(B, 'state', 'context'),
  promptsOut: path.join(B, 'state', 'prompts'),
  reviews: path.join(B, 'state', 'reviews'),
  fixes: path.join(B, 'state', 'fixes'),
  failures: path.join(B, 'state', 'failures'),
  logs: path.join(B, 'logs'),
  sessions: path.join(B, 'logs', 'sessions'),
  done: (id) => path.join(B, 'state', 'done', `${id}.json`),
  context: (id) => path.join(B, 'state', 'context', `${id}.md`),
};

/** Path relative to the repo root, with forward slashes. */
export function rel(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

function num(name, def) {
  const v = parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) ? v : def;
}
function str(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

export function cfg() {
  return {
    buildModel: str('BUILD_MODEL', 'opus'),
    reviewModel: str('REVIEW_MODEL', 'opus'),
    fixModel: str('FIX_MODEL', 'sonnet'),
    buildEffort: str('BUILD_EFFORT', ''),
    reviewEffort: str('REVIEW_EFFORT', ''),
    fixEffort: str('FIX_EFFORT', ''),
    reviewEveryBatch: str('REVIEW_EVERY_BATCH', '1') === '1',
    maxBuildAttempts: num('MAX_BUILD_ATTEMPTS', 2),
    maxFixRounds: num('MAX_FIX_ROUNDS', 3),
    maxQualityRounds: num('MAX_QUALITY_ROUNDS', 1),
    buildMaxTurns: num('BUILD_MAX_TURNS', 300),
    reviewMaxTurns: num('REVIEW_MAX_TURNS', 80),
    fixMaxTurns: num('FIX_MAX_TURNS', 150),
    heartbeatSeconds: num('HEARTBEAT_SECONDS', 120),
    stallMinutes: num('STALL_MINUTES', 20),
    sessionMaxMinutes: num('SESSION_MAX_MINUTES', 150),
    limitBufferMinutes: num('LIMIT_BUFFER_MINUTES', 2),
    limitFallbackMinutes: num('LIMIT_FALLBACK_MINUTES', 30),
    transientBackoffMinutes: str('TRANSIENT_BACKOFF_MINUTES', '1 2 5 10 20')
      .split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0),
    showReads: str('SHOW_READS', '0') === '1',
    showText: str('SHOW_TEXT', '1') === '1',
    claudeBin: str('CLAUDE_BIN', 'claude'),
    claudePrefixArgs: str('CLAUDE_PREFIX_ARGS', '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
  };
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Write a temp file, then rename over the target. Retries the rename (Windows file locks). */
export function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  let lastErr = null;
  for (let i = 0; i < 10; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      sleepSync(100 * (i + 1));
    }
  }
  try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  throw lastErr;
}

export function writeJsonAtomic(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n');
}

let cached = null;

/** The run state singleton: { runId, current, waits }. */
export function getState() {
  if (!cached) {
    const s = readJson(P.stateFile, null) || {};
    cached = {
      runId: s.runId || null,
      redoToken: s.redoToken || null,
      current: s.current || null,
      waits: Array.isArray(s.waits) ? s.waits : [],
    };
  }
  return cached;
}

export function saveState() {
  writeJsonAtomic(P.stateFile, getState());
}

export function isDone(id) {
  return fs.existsSync(P.done(id));
}
