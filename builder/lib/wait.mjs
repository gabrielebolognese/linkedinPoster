// Sleep until a time, printing a countdown line every HEARTBEAT_SECONDS.
import { cfg, getState, saveState } from './state.mjs';
import { log, fmtClock } from './log.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sleeps in steps of at most 30 seconds (Ctrl+C stays responsive, and a laptop that slept
 * past the target returns at once). Records the wait in state.waits.
 * kind: "limit" (usage limit wait) or "retry" (transient error backoff).
 */
export async function waitUntil(date, { reason = 'usage limit', kind = 'limit', batchId = null, phase = '', bufferMin = null } = {}) {
  const target = +date;
  const from = Date.now();
  if (!(target > from)) return;
  const c = cfg();
  const state = getState();
  state.waits.push({ from: new Date(from).toISOString(), until: new Date(target).toISOString(), reason });
  saveState();

  const total = Math.max(1, Math.round((target - from) / 60000));
  const what = kind === 'limit' ? 'usage limit reset' : 'retry';
  const why = kind === 'limit' && bufferMin !== null ? `reset + ${bufferMin} min` : reason;
  const resumes = batchId ? `The batch resumes in phase ${phase}.` : `The run resumes in ${phase}.`;
  const paused = batchId ? `batch ${batchId} paused in phase ${phase}.` : `paused in ${phase}.`;
  log(`waiting until ${fmtClock(target)} (${why}), about ${total} min. ${resumes}`, 'yellow');

  const hbMs = Math.max(1000, c.heartbeatSeconds * 1000);
  let lastPrint = from;
  while (Date.now() < target) {
    await sleep(Math.max(50, Math.min(30000, hbMs, target - Date.now())));
    const now = Date.now();
    if (now >= target) break;
    if (now - lastPrint >= hbMs) {
      lastPrint = now;
      log(`waiting for ${what} (minute ${Math.floor((now - from) / 60000)} of ~${total}), resumes at ${fmtClock(target, false)}. ${paused}`, 'yellow');
    }
  }
  log(`${kind === 'limit' ? 'usage limit wait' : 'retry wait'} over, resuming ${batchId ? `${batchId} ` : ''}${phase}`, 'yellow');
}
