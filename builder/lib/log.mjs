// Timestamped console output (ANSI colors) mirrored to a plain-text log file.
import fs from 'node:fs';
import path from 'node:path';
import { P } from './state.mjs';

const COLORS = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};
const RESET = '\x1b[0m';
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.BUILDER_COLOR === '1');

let logFile = null;

const pad = (n) => String(n).padStart(2, '0');

export function ts(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Open (or reuse) the log file builder/logs/build-<YYYYMMDD-HHMM>.log. */
export function initLog() {
  if (logFile) return logFile;
  fs.mkdirSync(P.logs, { recursive: true });
  if (process.env.BUILDER_LOG_FILE) {
    logFile = path.resolve(process.env.BUILDER_LOG_FILE);
  } else {
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    logFile = path.join(P.logs, `build-${stamp}.log`);
  }
  return logFile;
}

export function currentLogFile() {
  return logFile;
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Print one or more lines, each prefixed with [HH:MM:SS], and append them to the log file. */
export function log(msg = '', color = null) {
  const stamp = ts();
  const lines = String(msg).split(/\r?\n/);
  let fileText = '';
  for (const l of lines) {
    const line = `[${stamp}] ${l}`;
    if (useColor && color && COLORS[color]) process.stdout.write(`${COLORS[color]}${line}${RESET}\n`);
    else process.stdout.write(`${line}\n`);
    fileText += `${stripAnsi(line)}\n`;
  }
  if (logFile) {
    try {
      fs.appendFileSync(logFile, fileText);
    } catch { /* never let logging kill the run */ }
  }
}

export function short(s, max) {
  const t = String(s ?? '');
  return t.length > max ? `${t.slice(0, Math.max(0, max - 3))}...` : t;
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** HH:MM:SS, with the date in front when it is not today. */
export function fmtClock(ms, seconds = true) {
  const d = new Date(ms);
  const now = new Date();
  const t = seconds ? ts(d) : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return t;
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${t}`;
}
