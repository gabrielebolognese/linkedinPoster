# Build runner

An unattended Git Bash program that builds `spec.md` batch by batch (M01 to M14). For each batch it runs one headless Claude Code session to write the code (Opus), runs the batch's acceptance commands, has Opus review the result, and has Sonnet apply fixes. It survives usage limits, stalls and crashes, and prints what it is doing the whole time.

Zero npm dependencies: Node built-ins only. It never depends on the product's `package.json` or `node_modules/`.

## Start

```
cd <this repo>
bash builder/build.sh
```

Run it in Git Bash. Stop it with Ctrl+C (state is saved). Start it again with the same command: it resumes at the batch and phase where it stopped.

## Flags

```
bash builder/build.sh                 # run all remaining batches
bash builder/build.sh --dry-run       # preflight (no claude call), print batch table and acceptance commands, exit
bash builder/build.sh --self-test     # limits self-test + end-to-end self-test with a fake claude, no real claude calls
bash builder/build.sh --status        # print state, done batches, last log file
bash builder/build.sh --only M05      # run only M05 (if M05 is already done, combine with --redo M05)
bash builder/build.sh --from M05      # start at M05 (earlier batches must be done)
bash builder/build.sh --until M08     # stop after M08
bash builder/build.sh --redo M05      # forget M05's done marker, then run from there
bash builder/build.sh --redo M05 --from M05   # forget M05 and every later batch, then run from M05
bash builder/build.sh --no-review     # skip quality reviews (failure reviews still run)
```

Exit codes: 0 finished, 1 gave up after 5 orchestrator crashes, 2 fail-stop, 3 preflight failed, 4 another runner holds the lock, 130 Ctrl+C.

## Phases of one batch

```
start -> build -> verify -+-> (pass) -> review -+-> PASS -> done
                          |                      +-> FIX  -> fix -> verify -> done (or failure loop)
                          +-> (fail) -> failure review -> fix -> verify -> (up to MAX_FIX_ROUNDS) -> fail-stop
```

- **start**: records the base commit, writes `builder/state/context/<ID>.md` (global rules, the batch, its appendices, a batch map).
- **build** (`BUILD_MODEL`): one session with `--dangerously-skip-permissions`. A stall, timeout or error reruns the build with a resume note, up to `MAX_BUILD_ATTEMPTS`. After that verify runs anyway.
- **verify** (no model): every acceptance command through Git Bash with the batch timeout, then `npm run typecheck` and `npm test` if `package.json` defines them (skipped when the identical command was already an acceptance command), then the guard (nothing under `builder/`, nor `spec.md` or `PROMPT.md`, may change: changes are restored and count as a failure), then leftovers are auto-committed (warning only), then at least one commit must exist since the base.
- **review** (`REVIEW_MODEL`): quality mode after a passing verify. `VERDICT: PASS` finishes the batch. `VERDICT: FIX` runs one fix, then verify again. At most `MAX_QUALITY_ROUNDS` quality reviews per batch.
- **failure loop**: failure review (writes a fix plan), fix (`FIX_MODEL`), verify. Up to `MAX_FIX_ROUNDS` rounds, then fail-stop.
- **done**: tags `build-<ID>`, writes `builder/state/done/<ID>.json`.

After the last batch the runner prints a summary table and the `NEXT:` lines of the last batch.

## Files

| Path | What |
| --- | --- |
| `builder/logs/build-<YYYYMMDD-HHMM>.log` | Everything printed to the console, without colors |
| `builder/logs/sessions/<ID>-<phase>-<n>.jsonl` | Raw stream-json of each session (`.stderr.txt` next to it if there was stderr) |
| `builder/state/state.json` | Current batch, phase, attempt, rounds, recorded waits |
| `builder/state/done/<ID>.json` | Done marker with stats |
| `builder/state/context/<ID>.md` | Context file given to the sessions |
| `builder/state/prompts/` | The rendered prompt of every session |
| `builder/state/reviews/<ID>-review-<round>.md` | Quality reviews |
| `builder/state/fixes/<ID>-fix-<k>.md` | Failure reviews (the fix plans) |
| `builder/state/failures/<ID>-verify-<n>.md` | Failure reports: output of each failing command (last 300 lines) |
| `builder/state/build.lock` | Lock of the running build |

`builder/state/` and `builder/logs/` are gitignored.

## Reading the console

```
[23:15:12] still building batch M05 (minute 14), files changed: 9, commits: 2. last: $ npm test -- tests/diagram
```

Printed every `HEARTBEAT_SECONDS` (120). `minute` counts from the start of the batch. `files changed` is every path that differs from the base commit, committed or not, plus new untracked files. `commits` is the number of commits since the base commit. `last:` is the most recent tool call of the session (during verify, the command that is running). If `last:` does not change for many heartbeats, the session is on one long command. After `STALL_MINUTES` (20) without any stream output the session is killed and rerun.

Session lines look like `M05 build | $ npm install ...`, `write <path>`, `edit <path>`, `todo 3/8: ...`, `says: ...`. Set `SHOW_READS=1` to also see reads and searches, `SHOW_TEXT=0` to hide `says:` lines.

## Usage limits

When a session reports a usage limit, the runner prints the message, parses the reset time (and date for weekly limits), waits until reset + `LIMIT_BUFFER_MINUTES` (2) with a countdown line every heartbeat, then reruns the same phase. If no time can be parsed it waits `LIMIT_FALLBACK_MINUTES` (30) and tries again. A session that silently starts on a different model family than requested is treated the same way. Transient API errors back off with `TRANSIENT_BACKOFF_MINUTES` (1 2 5 10 20), then fall back to the limit wait.

## After a fail-stop

The console block names the batch, the failing checks, the failure report and the last fix plan. Then either:

1. Run `bash builder/build.sh` again. It re-runs verify for that batch and, if it still fails, starts a fresh set of fix rounds.
2. Fix it yourself, commit, and run `bash builder/build.sh`. Verify runs first, so a manual fix is picked up.
3. Start the batch over on top of the current code: `bash builder/build.sh --redo M05`.

To check a batch by hand: `node builder/lib/verify.mjs M05` (add `--base <sha>` if it is not the current batch).

## Changing models and other settings

Defaults are in `builder/config.sh`. Do not edit it: create `builder/config.local.sh` (gitignored), for example:

```bash
export BUILD_MODEL=opus
export REVIEW_MODEL=opus
export FIX_MODEL=sonnet
export BUILD_EFFORT=high        # passed as --effort when set
export REVIEW_EVERY_BATCH=0     # same as --no-review
export MAX_FIX_ROUNDS=4
```

A model can be an alias (`opus`, `sonnet`) or a full model id. Environment variables set before the command also work: `FIX_MODEL=opus bash builder/build.sh`.

## Other commands

```
node builder/lib/spec.mjs --check          # validate the markers in spec.md
node builder/lib/spec.mjs --list           # batch table
node builder/lib/limits.mjs --self-test    # usage-limit parser tests
node builder/lib/limits.mjs "You've hit your session limit, resets 3:45pm"   # parse one message
node builder/lib/session.mjs --smoke       # one real headless call: "Reply with exactly: OK"
```

## Troubleshooting

- **`another build runner is running`**: a build holds `builder/state/build.lock`. If you are sure none is running, delete the file.
- **Preflight smoke test fails (exit 3)**: the raw output is printed. Check `claude` works in this shell (`claude -p "hi"`), and that you are logged in.
- **A session seems stuck**: watch `last:` in the heartbeat. The stall timer (20 minutes without stream output) and the hard cap (`SESSION_MAX_MINUTES`, 150) end it automatically.
- **`bash\r: No such file`**: a script got CRLF line endings. `.gitattributes` forces LF. Run `git add --renormalize .`.
- **The orchestrator crashes**: `build.sh` restarts it after 30 seconds, up to 5 times, and it resumes from `state.json`.
- **The laptop went to sleep**: waits end as soon as the machine wakes after the target time. A session that was cut off is detected as a stall or an error and rerun.

## Adaptations to the installed CLI (Claude Code 2.1.322)

- `--max-turns` is not listed in `claude --help` in this version, but it is accepted and works (checked with a real call). The runner passes it as designed.
- `where claude` returns an extensionless shell shim first and `claude.cmd` second. The runner skips the extensionless file, reads `claude.cmd`, and spawns the native `claude.exe` it points to directly (no shell, so no quoting issues and a clean process-tree kill). Only if that exe cannot be found is the `.cmd` spawned with `shell: true`.
- The stream contains `rate_limit_event` lines with the reset time as an epoch. When a limit is hit and the message text has no parseable time, that epoch is used before the 30-minute fallback.
- A usage-limit phrase only counts when it comes from a synthetic or error message, an error result, or stderr. The text of a successful session never triggers a wait, because later batches of this spec legitimately write about usage limits.
- `--permission-mode dontAsk`, `--allowedTools` and `--effort` exist in this version and are used as designed.
