// spec.md parser, checks, context file assembly, and CLI (--list, --check).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P, isDone, writeFileAtomic } from './state.mjs';

const DEFAULT_TIMEOUT_MINUTES = 20;

/** Parse spec text into { globals, batches, appendices, errors }. */
export function parseSpec(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const globals = [];
  const batches = [];
  const appendices = {};
  const appendixOrder = [];
  const errors = [];
  let open = null; // { kind, id, start, lines }

  const close = (lineNo) => {
    const body = open.lines.join('\n').replace(/^\n+|\n+$/g, '');
    if (open.kind === 'global') globals.push(body);
    else if (open.kind === 'appendix') {
      if (appendices[open.id] !== undefined) errors.push(`line ${lineNo}: duplicate appendix ${open.id}`);
      appendices[open.id] = body;
      appendixOrder.push(open.id);
    } else batches.push(parseBatch(open.id, open.lines, body, errors));
    open = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.trim().match(/^<!--\s*(global|batch:(M\d\d)|appendix:([A-Z])):(start|end)\s*-->$/);
    if (!m) {
      if (open) open.lines.push(line);
      continue;
    }
    const kind = m[1] === 'global' ? 'global' : m[2] ? 'batch' : 'appendix';
    const id = m[2] || m[3] || null;
    if (m[4] === 'start') {
      if (open) {
        errors.push(`line ${i + 1}: ${m[0]} opens inside an unclosed ${open.kind}${open.id ? ` ${open.id}` : ''} block (line ${open.start})`);
        close(i + 1);
      }
      open = { kind, id, start: i + 1, lines: [] };
    } else if (!open || open.kind !== kind || open.id !== id) {
      errors.push(`line ${i + 1}: ${m[0]} has no matching start marker`);
    } else {
      close(i + 1);
    }
  }
  if (open) errors.push(`line ${open.start}: ${open.kind}${open.id ? ` ${open.id}` : ''} block is never closed`);

  return { globals, batches, appendices, appendixOrder, errors };
}

function parseBatch(id, lines, body, errors) {
  let title = '';
  let needs = [];
  const acceptance = [];
  let timeoutMinutes = DEFAULT_TIMEOUT_MINUTES;
  let acceptanceBlocks = 0;
  const nextLines = [];
  let inAcc = false;
  let headingSeen = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (inAcc) {
      if (line === '```') {
        inAcc = false;
        continue;
      }
      const cmd = line.trim();
      if (!cmd) continue;
      if (cmd.startsWith('#')) {
        const tm = cmd.match(/^#\s*timeout-minutes:\s*(\d+(?:\.\d+)?)\s*$/);
        if (tm) timeoutMinutes = Number(tm[1]);
        continue;
      }
      acceptance.push(cmd);
      continue;
    }
    if (line === '```acceptance') {
      inAcc = true;
      acceptanceBlocks++;
      continue;
    }
    if (!headingSeen && /^#{1,6}\s/.test(line)) {
      headingSeen = true;
      const hm = line.match(/^##\s+(M\d\d)\.\s+(.+)$/);
      if (hm && hm[1] === id) title = hm[2].trim();
      else errors.push(`batch ${id}: first heading must be "## ${id}. <Title>", found "${line}"`);
      continue;
    }
    const nm = line.trim().match(/^<!--\s*needs:\s*(.*?)\s*-->$/);
    if (nm) {
      needs = nm[1].split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (line.startsWith('NEXT:')) nextLines.push(line);
  }
  if (inAcc) errors.push(`batch ${id}: acceptance block is never closed`);
  return { id, title, needs, acceptance, timeoutMinutes, acceptanceBlocks, nextLines, body };
}

/** Returns a list of error strings (empty = ok). */
export function checkSpec(spec) {
  const errors = [...spec.errors];
  if (spec.batches.length === 0) errors.push('no batches found');
  if (spec.globals.length === 0 || spec.globals.every((g) => !g.trim())) errors.push('the global section is missing or empty');
  const seen = new Set();
  let prev = '';
  for (const b of spec.batches) {
    if (seen.has(b.id)) errors.push(`batch ${b.id}: duplicate id`);
    seen.add(b.id);
    if (prev && b.id <= prev) errors.push(`batch ${b.id}: ids must be ascending (comes after ${prev})`);
    prev = b.id;
    if (!b.title) errors.push(`batch ${b.id}: no title`);
    if (b.acceptanceBlocks !== 1) errors.push(`batch ${b.id}: expected exactly one acceptance block, found ${b.acceptanceBlocks}`);
    else if (b.acceptance.length === 0) errors.push(`batch ${b.id}: the acceptance block has no commands`);
    if (!(b.timeoutMinutes > 0)) errors.push(`batch ${b.id}: invalid timeout-minutes`);
    for (const n of b.needs) {
      if (spec.appendices[n] === undefined) errors.push(`batch ${b.id}: needs appendix ${n}, which does not exist`);
    }
  }
  return [...new Set(errors)];
}

export function loadSpec(file = P.spec) {
  return parseSpec(fs.readFileSync(file, 'utf8'));
}

/** Build the context text for one batch. doneIds is a Set of finished batch ids. */
export function buildContext(spec, batch, doneIds) {
  const parts = [];
  parts.push(`# Context for batch ${batch.id}. ${batch.title}`);
  parts.push('Generated by the build runner from spec.md. Global rules, this batch, and the appendices it needs.');
  for (const g of spec.globals) parts.push(g);
  parts.push(batch.body);
  for (const n of batch.needs) {
    if (spec.appendices[n] !== undefined) parts.push(spec.appendices[n]);
  }
  const map = spec.batches.map((b) => {
    const tag = b.id === batch.id ? 'CURRENT' : doneIds.has(b.id) ? 'done' : 'later';
    return `${b.id}. ${b.title} [${tag}]`;
  });
  parts.push(`# Batch map\n\n${map.join('\n')}`);
  return parts.join('\n\n') + '\n';
}

export function writeContext(spec, batch) {
  const doneIds = new Set(spec.batches.filter((b) => isDone(b.id)).map((b) => b.id));
  const file = P.context(batch.id);
  writeFileAtomic(file, buildContext(spec, batch, doneIds));
  return file;
}

/** Table lines: id, title, needs, number of acceptance commands, timeout. */
export function listTable(spec) {
  const rows = spec.batches.map((b) => [
    b.id, b.title, b.needs.join(',') || '-', String(b.acceptance.length), `${b.timeoutMinutes} min`,
  ]);
  const head = ['id', 'title', 'needs', 'cmds', 'timeout'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [fmt(head), fmt(widths.map((w) => '-'.repeat(w))), ...rows.map(fmt)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const si = argv.indexOf('--spec');
  const file = si >= 0 && argv[si + 1] ? path.resolve(argv[si + 1]) : P.spec;
  let spec;
  try {
    spec = loadSpec(file);
  } catch (e) {
    console.error(`spec check: cannot read ${file}: ${e.message}`);
    process.exit(1);
  }
  const errors = checkSpec(spec);
  if (argv.includes('--list')) {
    for (const l of listTable(spec)) console.log(l);
    if (errors.length) {
      for (const e of errors) console.error(`spec error: ${e}`);
      process.exit(1);
    }
  } else if (argv.includes('--check')) {
    if (errors.length) {
      for (const e of errors) console.error(`spec error: ${e}`);
      console.error(`spec check: FAILED (${errors.length} error${errors.length === 1 ? '' : 's'})`);
      process.exit(1);
    }
    console.log(`spec check: ok, ${spec.batches.length} batches, ${spec.appendixOrder.length} appendices, ${spec.globals.length} global block${spec.globals.length === 1 ? '' : 's'}`);
  } else {
    console.log('usage: node builder/lib/spec.mjs --check | --list [--spec <file>]');
    process.exit(1);
  }
}
