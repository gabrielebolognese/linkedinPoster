// Renders builder/prompts/*.md templates. Placeholders are {{NAME}}.
import fs from 'node:fs';
import path from 'node:path';
import { P } from './state.mjs';

const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** Replace placeholders in a string. Throws on a placeholder without a value. */
export function renderString(template, vars, name = 'template') {
  return template.replace(PLACEHOLDER, (whole, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key) || vars[key] === undefined || vars[key] === null) {
      throw new Error(`${name}: unknown placeholder {{${key}}}`);
    }
    return String(vars[key]);
  });
}

/**
 * Render builder/prompts/<name>.md. Throws on an unknown placeholder and on a value
 * that still carries an unreplaced placeholder (render nested notes before inserting them).
 */
export function render(name, vars) {
  const file = path.join(P.templates, `${name}.md`);
  const template = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  for (const [key, value] of Object.entries(vars)) {
    if (key === 'ACCEPTANCE_LIST') continue; // shell commands, taken literally
    const m = String(value ?? '').match(PLACEHOLDER);
    if (m) throw new Error(`${name}.md: value of ${key} contains an unreplaced placeholder ${m[0]}`);
  }
  return renderString(template, vars, `${name}.md`);
}

export const RESUME_NOTE_TEMPLATE = 'NOTE: a previous session on this batch was interrupted (usage limit, stall or crash). The working tree may contain its partial work. Run git status and git diff {{BASE_SHA}} --stat, keep what is correct, and continue from there.';

export function resumeNote(baseSha) {
  return renderString(RESUME_NOTE_TEMPLATE, { BASE_SHA: baseSha }, 'resume note');
}

export function failureNote(failureFile) {
  return `NOTE: a previous attempt ended without passing. Read ${failureFile} first and fix the root cause.`;
}

export function acceptanceList(commands) {
  return commands.map((c) => `    ${c}`).join('\n');
}
