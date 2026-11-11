// Usage-limit message detection and reset-time parsing. No dependencies, Intl only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DETECT = /usage limit|hit your (session |weekly )?limit|limit reached|out of extra usage|limit will reset/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MIN = 60 * 1000;

export function isLimitMessage(text) {
  return DETECT.test(String(text ?? ''));
}

export function systemTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of an instant in an IANA zone. */
function tzParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    y: +o.year, m: +o.month, d: +o.day,
    h: +o.hour % 24, min: +o.minute, s: +o.second,
    wd: DAYS.indexOf(String(o.weekday).toLowerCase().slice(0, 3)),
  };
}

function tzOffset(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock time in a zone -> UTC epoch ms. Guess, correct, and correct once more for DST edges. */
function zonedToUtc(y, m, d, h, min, tz) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz);
}

function kindOf(s) {
  if (/extra usage/i.test(s)) return 'extra';
  if (/weekly|\bweek\b|7.day/i.test(s)) return 'weekly';
  if (/session|5.hour/i.test(s)) return 'session';
  return 'unknown';
}

/**
 * Parse the reset time out of a usage-limit message.
 * Returns { resetAt: Date, matched, kind } or null when it is not a limit message or no time parses.
 */
export function parseLimit(text, now = new Date(), defaultTz = systemTz()) {
  const s = String(text ?? '');
  if (!isLimitMessage(s)) return null;
  const nowMs = +now;
  const kind = kindOf(s);
  const done = (ms, matched) => {
    // Always in the future. A time that just passed (clock skew) becomes now + 5 minutes.
    const at = ms <= nowMs ? nowMs + 5 * MIN : ms;
    return { resetAt: new Date(at), matched, kind };
  };

  const epoch = s.match(/\|\s*(\d{10,13})\b/);
  if (epoch) {
    const n = Number(epoch[1]);
    return done(epoch[1].length > 10 ? n : n * 1000, epoch[0]);
  }

  const idx = s.search(/\breset(s|ting)?\b/i);
  if (idx < 0) return null;
  const matched = s.slice(idx).split(/\r?\n/)[0].trim();
  let rest = matched;

  const relm = rest.match(/\bin\s+(?:(\d+)\s*h(?:ours?|rs?)?\b)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?\b)?/i);
  if (relm && (relm[1] || relm[2])) {
    return done(nowMs + (Number(relm[1] || 0) * 60 + Number(relm[2] || 0)) * MIN, matched);
  }

  let tz = defaultTz;
  const tzm = rest.match(/\(([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+|UTC|GMT)\)/);
  if (tzm) {
    if (validTz(tzm[1])) tz = tzm[1];
    rest = rest.replace(tzm[0], ' ');
  }
  if (!validTz(tz)) tz = 'UTC';

  let month = null;
  let day = null;
  const mm = rest.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*:|\s*[ap]\.?m)/i);
  if (mm) {
    month = MONTHS.indexOf(mm[1].toLowerCase()) + 1;
    day = Number(mm[2]);
    rest = rest.replace(mm[0], ' ');
  }

  let weekday = null;
  const wm = rest.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i);
  if (wm) {
    weekday = DAYS.indexOf(wm[1].toLowerCase());
    rest = rest.replace(wm[0], ' ');
  }

  let h = null;
  let min = 0;
  const t12 = rest.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i);
  if (t12) {
    h = Number(t12[1]) % 12;
    if (t12[3].toLowerCase() === 'p') h += 12;
    min = Number(t12[2] || 0);
  } else {
    const t24 = rest.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (t24) {
      h = Number(t24[1]);
      min = Number(t24[2]);
    }
  }
  if (h === null || h > 23 || min > 59) return null;

  const np = tzParts(nowMs, tz);
  const skew = 10 * MIN;
  let at;
  if (month !== null) {
    at = zonedToUtc(np.y, month, day, h, min, tz);
    if (at <= nowMs - skew) at = zonedToUtc(np.y + 1, month, day, h, min, tz);
  } else if (weekday !== null) {
    at = null;
    for (let k = 0; k <= 7; k++) {
      const cand = zonedToUtc(np.y, np.m, np.d + k, h, min, tz);
      if (tzParts(cand, tz).wd === weekday && cand > nowMs - skew) {
        at = cand;
        break;
      }
    }
    if (at === null) return null;
  } else {
    at = zonedToUtc(np.y, np.m, np.d, h, min, tz);
    if (at <= nowMs - skew) at = zonedToUtc(np.y, np.m, np.d + 1, h, min, tz);
  }
  return done(at, matched);
}

/** Table tests against a fixed now. Returns { passed, failed: [messages] }. */
export function selfTest() {
  const TZ = 'Europe/Berlin';
  const now = new Date('2026-11-12T01:12:00+01:00'); // a Thursday
  const late = new Date('2026-11-12T23:30:00+01:00');
  const futureEpoch = Math.floor(+now / 1000) + 7200;
  const plus5 = new Date(+now + 5 * MIN).toISOString();
  const cases = [
    { t: `Claude AI usage limit reached|${futureEpoch}`, at: new Date(futureEpoch * 1000).toISOString() },
    { t: 'Claude AI usage limit reached|1762912800', at: plus5, note: 'epoch in the past' },
    { t: "You've hit your session limit · resets 3:45pm", at: '2026-11-12T14:45:00.000Z', kind: 'session' },
    { t: "You've hit your weekly limit · resets Mon 12:00am", at: '2026-11-15T23:00:00.000Z', kind: 'weekly' },
    { t: 'Claude usage limit reached. Your limit will reset at 3pm (America/Santiago).', at: '2026-11-12T18:00:00.000Z', kind: 'unknown', note: 'explicit timezone' },
    { t: "You're out of extra usage · resets 6:40pm (America/New_York)", at: '2026-11-12T23:40:00.000Z', kind: 'extra' },
    { t: '5-hour limit reached ∙ resets 2am', at: '2026-11-12T01:00:00.000Z', kind: 'session' },
    { t: 'Weekly limit reached · resets Thu, Nov 13, 3:00 PM', at: '2026-11-13T14:00:00.000Z', kind: 'weekly' },
    { t: 'Opus weekly limit reached · resets Nov 14, 9am (Europe/Rome)', at: '2026-11-14T08:00:00.000Z', kind: 'weekly' },
    { t: "You've hit your session limit · resets 1:15am", now: late, at: '2026-11-13T00:15:00.000Z', note: 'pm to am across midnight' },
    { t: "You've hit your session limit · resets 11:45pm", now: late, at: '2026-11-12T22:45:00.000Z', note: 'same evening' },
    { t: "You've hit your weekly limit · resets Thu 12:30am", at: '2026-11-18T23:30:00.000Z', note: 'weekday is today but earlier: next week' },
    { t: "You've hit your weekly limit · resets Thu 9am", at: '2026-11-12T08:00:00.000Z', note: 'weekday is today, later' },
    { t: "You've hit your session limit · resets 1:10am", at: plus5, note: 'clock skew: 2 minutes in the past' },
    { t: "You've hit your session limit · resets 03:45", at: '2026-11-12T02:45:00.000Z', note: '24h time' },
    { t: 'Weekly limit reached · resets Nov 10, 9am', at: '2027-11-10T08:00:00.000Z', note: 'date already past: next year' },
    { t: 'Claude usage limit reached. Please try again later.', at: null, detect: true, note: 'unparseable' },
    { t: 'Reached the max turns limit', at: null, detect: false, note: 'not a limit message' },
    { t: 'BATCH M09 COMPLETE: built the rate limiter', at: null, detect: false },
  ];
  let passed = 0;
  const failed = [];
  for (const c of cases) {
    const errs = [];
    const detect = isLimitMessage(c.t);
    const wantDetect = c.detect ?? true;
    if (detect !== wantDetect) errs.push(`detection ${detect}, expected ${wantDetect}`);
    const r = parseLimit(c.t, c.now || now, TZ);
    const got = r ? r.resetAt.toISOString() : null;
    if (got !== c.at) errs.push(`resetAt ${got}, expected ${c.at}`);
    if (r && c.kind && r.kind !== c.kind) errs.push(`kind ${r.kind}, expected ${c.kind}`);
    if (r && +r.resetAt <= +(c.now || now)) errs.push('resetAt is not in the future');
    if (errs.length) failed.push(`"${c.t}"${c.note ? ` (${c.note})` : ''}: ${errs.join('; ')}`);
    else passed++;
  }
  return { passed, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const r = selfTest();
    for (const f of r.failed) console.log(`limits self-test FAILED: ${f}`);
    console.log(`limits self-test: ${r.passed} passed${r.failed.length ? `, ${r.failed.length} failed` : ''}`);
    process.exit(r.failed.length ? 1 : 0);
  } else {
    const text = process.argv.slice(2).join(' ');
    const r = parseLimit(text);
    console.log(JSON.stringify({ isLimit: isLimitMessage(text), parsed: r }, null, 2));
  }
}
