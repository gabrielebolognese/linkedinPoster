You are building one batch of the LinkedIn Poster project, unattended. There is no human to answer questions.

BATCH: {{BATCH_ID}}. {{BATCH_TITLE}}
BATCH NUMBER: {{BATCH_INDEX}} of {{BATCH_TOTAL}}
ATTEMPT: {{ATTEMPT}}
BASE COMMIT (repo state before this batch): {{BASE_SHA}}

Read these first, in this order:
1. {{CONTEXT_FILE}}: global rules, this batch's specification, and the appendices it needs. This is your source of truth. The full spec is spec.md if you need to look something up, but build only this batch.
2. PROGRESS.md: what earlier batches built, their decisions and known issues.
3. CLAUDE.md.

{{RESUME_NOTE}}
{{FAILURE_NOTE}}

How to work:
- Implement everything this batch specifies, completely. No stubs, no TODOs for in-scope work, no placeholder logic.
- Do not implement later batches. If something from a later batch is needed to test this one, build the minimum and note it in PROGRESS.md.
- Never modify anything in builder/, spec.md or PROMPT.md. Never run git push or add remotes. Never install global packages. Never touch files outside this repository. Never rewrite git history (no rebase, no reset of earlier commits).
- Use only the dependencies allowed by the global rules.
- Long commands: give the Bash tool a longer timeout (up to 10 minutes) for installs and test runs. Run anything longer in the background with output to a log file, and poll the log. Never let 10 minutes pass without a tool call: the build runner kills a session after 20 silent minutes.
- If the spec is ambiguous, choose the simplest reading that satisfies the acceptance commands and the spirit of the spec, and record the decision in PROGRESS.md.
- Before finishing, run every acceptance command of this batch exactly as written, from the repo root, in Git Bash:
{{ACCEPTANCE_LIST}}
  Also run npm run typecheck and npm test once they exist. Iterate until all pass.
- Never write the em dash character (Unicode U+2014) in any file.
- Append a section to PROGRESS.md, under 40 lines:
  ## {{BATCH_ID}}. {{BATCH_TITLE}}
  - Built:
  - Key files:
  - Decisions:
  - Deviations from spec: (or none)
  - Known issues: (or none)
- Commit with git add -A and git commit -m "{{BATCH_ID}}: {{BATCH_TITLE}}". Several commits are fine. When you finish, git status must show a clean working tree.

Your final message must be exactly one line:
BATCH {{BATCH_ID}} COMPLETE: <one sentence on what was built>
or, only if something outside the repository makes progress impossible (missing system tool, no network for npm):
BATCH {{BATCH_ID}} BLOCKED: <reason>
