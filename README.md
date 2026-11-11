# linkedinPoster

A specification-driven project for an overnight LinkedIn post generator, plus the unattended build runner that is meant to build it. The planned product writes complete posts (one image and one caption each) with headless Claude Code sessions and shows them in a local review app, so the author can publish them on LinkedIn by hand. Nothing in the design talks to LinkedIn.

**What is in the repository today:** the full product specification (`spec.md`, about 2,900 lines) and a working, dependency-free build runner (`builder/`) that turns that specification into code batch by batch. The product itself (`src/`, `app/`, `runner/`, `package.json`) has not been built yet: `PROGRESS.md` has no batch entries.

It is a personal tool, written for one author's LinkedIn workflow on Windows 11 with Git Bash.

## Features

### Build runner (`builder/`, implemented)

- Reads `spec.md`, splits it into batches M01 to M14 by its markers, and builds them in order.
- For each batch: one headless Claude Code session writes the code, the batch's acceptance commands run, a review session judges the result, and a fix session applies corrections.
- Phases per batch: `start -> build -> verify -> review -> (fix -> verify) -> done`, with a failure loop of failure review, fix and verify up to `MAX_FIX_ROUNDS`, then a fail-stop.
- Verify step without any model: acceptance commands run through Git Bash with the batch timeout, then `npm run typecheck` and `npm test` if `package.json` defines them, then a guard that restores any change to `builder/`, `spec.md` or `PROMPT.md` and counts it as a failure.
- Tags each finished batch `build-<ID>` and writes a done marker with stats.
- Usage limits: parses the reset time from the session output, waits until reset plus a buffer with a countdown, then reruns the same phase. Transient API errors back off in steps.
- Stall and crash handling: a session with no stream output for `STALL_MINUTES` is killed and rerun, sessions have a hard time cap, and `build.sh` restarts a crashed orchestrator up to 5 times.
- Resumable: state is saved to `builder/state/state.json`, so the same command continues at the batch and phase where it stopped. A lock file prevents two runners at once.
- Live console output: a heartbeat line with the batch, minute, files changed, commits and the last tool call, plus per-session lines for commands, writes, edits and todos. Everything is also logged to `builder/logs/`.
- Self-test with a fake Claude (`builder/test/`), so the runner can be checked without real Claude calls.
- Node built-ins only: no npm dependencies and no dependency on the product's `package.json`.

### Planned product (specified in `spec.md`, not built yet)

- **Post pipeline** (TypeScript, `src/`): produces posts in a rotation of three formats, each a PNG plus a caption.
  - Hook card: one sentence in EB Garamond on warm paper with one highlighted phrase.
  - Editorial poster: a large numeral, a two-line title and 4 to 9 numbered items.
  - Notebook diagram: a system drawn as hand-drawn notes by code (rough.js shapes and a handwriting font). No image generation model is used.
  - Deterministic validators and render gates check every output, and failures go back to the model with the exact error list.
- **Night runner** (`runner/run.sh`, Git Bash): runs the pipeline unattended for N posts, waits out usage limits, and recovers from crashes with a review and fix cycle.
- **Review app** (Vite, React, TypeScript): one card per post with image and caption. A "Post this" button downloads the PNG and copies the caption to the clipboard. Cards can be marked posted, edited, rejected and regenerated.

## Getting started

### Prerequisites

- Git Bash (the runner is a Bash program and is designed for Git Bash on Windows)
- Node.js 20 or newer (checked by `builder/build.sh`)
- Git
- The Claude Code CLI (`claude`) on `PATH` and logged in. It is not needed for `--self-test`.

### Download

```bash
git clone https://github.com/gabrielebolognese/linkedinPoster.git
cd linkedinPoster
```

### Install

There is nothing to install for the build runner: it has no `package.json` and uses only Node built-ins. The product's dependencies will be installed by the build sessions once the batches run.

### Configuration

There are no required environment variables and no `.env` file. The runner's defaults live in `builder/config.sh`. Do not edit that file: create `builder/config.local.sh` (gitignored) or set the variables in the environment before starting. For example:

```bash
export BUILD_MODEL=opus
export REVIEW_MODEL=opus
export FIX_MODEL=sonnet
export BUILD_EFFORT=high
export REVIEW_EVERY_BATCH=0
export MAX_FIX_ROUNDS=4
```

Available settings: `BUILD_MODEL`, `REVIEW_MODEL`, `FIX_MODEL`, `BUILD_EFFORT`, `REVIEW_EFFORT`, `FIX_EFFORT`, `REVIEW_EVERY_BATCH`, `MAX_BUILD_ATTEMPTS`, `MAX_FIX_ROUNDS`, `MAX_QUALITY_ROUNDS`, `BUILD_MAX_TURNS`, `REVIEW_MAX_TURNS`, `FIX_MAX_TURNS`, `HEARTBEAT_SECONDS`, `STALL_MINUTES`, `SESSION_MAX_MINUTES`, `LIMIT_BUFFER_MINUTES`, `LIMIT_FALLBACK_MINUTES`, `TRANSIENT_BACKOFF_MINUTES`, `SHOW_READS`, `SHOW_TEXT`, `CLAUDE_BIN`, `CLAUDE_PREFIX_ARGS`.

### Check the setup without calling Claude

```bash
bash builder/build.sh --self-test   # usage-limit parser tests and an end-to-end run with a fake claude
bash builder/build.sh --dry-run     # preflight, batch table and acceptance commands, then exit
```

## Building the product

```bash
bash builder/build.sh
```

Run it in Git Bash from the repository root. Be aware of what it does: build sessions run the Claude Code CLI with `--dangerously-skip-permissions`, use your Claude usage allowance, and commit to this repository. Stop it with Ctrl+C (state is saved) and start it again with the same command to resume.

Exit codes: `0` finished, `1` gave up after 5 orchestrator crashes, `2` fail-stop, `3` preflight failed, `4` another runner holds the lock, `130` Ctrl+C.

## Usage

### Runner flags

| Command | What it does |
| --- | --- |
| `bash builder/build.sh` | Run all remaining batches |
| `bash builder/build.sh --dry-run` | Preflight without a Claude call, print the batch table and acceptance commands, exit |
| `bash builder/build.sh --self-test` | Limits self-test and end-to-end self-test with a fake Claude |
| `bash builder/build.sh --status` | Print state, done batches and the last log file |
| `bash builder/build.sh --only M05` | Run only M05 (combine with `--redo M05` if it is already done) |
| `bash builder/build.sh --from M05` | Start at M05 (earlier batches must be done) |
| `bash builder/build.sh --until M08` | Stop after M08 |
| `bash builder/build.sh --redo M05` | Forget M05's done marker, then run from there |
| `bash builder/build.sh --no-review` | Skip quality reviews (failure reviews still run) |

### Helper commands

| Command | What it does |
| --- | --- |
| `node builder/lib/spec.mjs --check` | Validate the markers in `spec.md` |
| `node builder/lib/spec.mjs --list` | Print the batch table |
| `node builder/lib/limits.mjs --self-test` | Run the usage-limit parser tests |
| `node builder/lib/session.mjs --smoke` | One real headless Claude call as a smoke test |
| `node builder/lib/verify.mjs M05` | Run the verify step for one batch by hand |

### After a fail-stop

The console names the batch, the failing checks, the failure report and the last fix plan. Then either run `bash builder/build.sh` again (verify runs first, then a fresh set of fix rounds), fix the problem yourself, commit and rerun, or restart the batch with `--redo <ID>`.

## Project structure

| Path | Contents |
| --- | --- |
| `spec.md` | Complete product specification: global rules, batches M01 to M14 with acceptance commands, appendices A to L |
| `builder/build.sh` | Runner entry point: tool checks, lock, restart loop |
| `builder/config.sh` | Default settings (override in `builder/config.local.sh`) |
| `builder/lib/` | Orchestrator, session handling, spec parser, verify step, usage-limit parser, state, logging, git stats, waits |
| `builder/prompts/` | Prompt templates for build, review and fix sessions |
| `builder/test/` | Fake Claude, fixture spec and the end-to-end self-test |
| `CLAUDE.md` | Instructions for the Claude Code sessions that work in this repository |
| `PROGRESS.md` | Build log that each batch appends to (no entries yet) |
| `builder/state/`, `builder/logs/` | Runtime state and logs, gitignored |

## Tech stack

- Build runner: Bash (Git Bash) and Node.js 20+ ES modules using only built-ins, driving the Claude Code CLI in headless mode.
- Planned product, as allowed by the specification: TypeScript run with tsx, zod, Playwright with Chromium for rendering, rough.js, esbuild, Vite and React for the review app, vitest for tests, and bundled Fontsource fonts.

## Further documentation

- [`spec.md`](spec.md): the full product specification
- [`builder/README.md`](builder/README.md): build runner reference, console output, usage limits and troubleshooting
- [`CLAUDE.md`](CLAUDE.md): rules for build sessions
- [`PROGRESS.md`](PROGRESS.md): build progress log

## Status

Work in progress. The specification and the build runner are complete enough to start a build, but no product batch has been built or committed, so there is no post generator or review app to run yet. `spec.md` and `CLAUDE.md` refer to a `PROMPT.md` file that is not in the repository. This is a personal tool and is not packaged for general use.
