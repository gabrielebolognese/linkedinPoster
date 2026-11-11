#!/usr/bin/env bash
# Build runner entry point (Git Bash). See builder/README.md.
# Exit codes: 0 finished, 1 too many crashes, 2 fail-stop, 3 preflight failed, 4 locked, 130 Ctrl+C.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 3

# shellcheck source=/dev/null
source "builder/config.sh"
if [ -f "builder/config.local.sh" ]; then
  # shellcheck source=/dev/null
  source "builder/config.local.sh"
fi

say() { echo "[$(date +%H:%M:%S)] $*"; }

MODE="run"
for arg in "$@"; do
  case "$arg" in
    --self-test) MODE="selftest" ;;
    --status) [ "$MODE" = "run" ] && MODE="status" ;;
    --dry-run) [ "$MODE" = "run" ] && MODE="dryrun" ;;
  esac
done

# --- tool checks
for tool in node git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    say "preflight: $tool is not on PATH"
    exit 3
  fi
done
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  say "preflight: Node.js 20 or newer is required, found $(node -v 2>/dev/null || echo none)"
  exit 3
fi
if [ "$MODE" != "selftest" ] && ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  say "preflight: the Claude Code CLI ($CLAUDE_BIN) is not on PATH"
  exit 3
fi

# The Git Bash executable, for running acceptance commands from Node.
if command -v cygpath >/dev/null 2>&1; then
  BUILDER_BASH="$(cygpath -w "$BASH" 2>/dev/null || echo "$BASH")"
  case "$BUILDER_BASH" in *.exe) ;; *) BUILDER_BASH="${BUILDER_BASH}.exe" ;; esac
  [ -f "$BUILDER_BASH" ] || BUILDER_BASH=""
else
  BUILDER_BASH="$BASH"
fi
export BUILDER_BASH
if [ -t 1 ]; then export BUILDER_COLOR=1; fi

mkdir -p "builder/state" "builder/logs"

if [ "$MODE" = "selftest" ]; then
  node "builder/lib/limits.mjs" --self-test || exit 1
  node "builder/test/selftest.mjs"
  exit $?
fi

if [ "$MODE" = "status" ] || [ "$MODE" = "dryrun" ]; then
  node "builder/lib/orchestrator.mjs" "$@"
  exit $?
fi

# --- lock
LOCK="builder/state/build.lock"
if [ -f "$LOCK" ]; then
  read -r LOCK_PID LOCK_WINPID LOCK_START < "$LOCK" || true
  LOCK_PID="${LOCK_PID:-0}"; LOCK_WINPID="${LOCK_WINPID:-0}"; LOCK_START="${LOCK_START:-0}"
  case "$LOCK_PID$LOCK_WINPID$LOCK_START" in *[!0-9]*) LOCK_PID=0; LOCK_WINPID=0; LOCK_START=0 ;; esac
  NOW="$(date +%s)"
  AGE=$(( NOW - LOCK_START ))
  ALIVE=0
  if [ "$LOCK_PID" -gt 0 ] && kill -0 "$LOCK_PID" 2>/dev/null; then ALIVE=1; fi
  if [ "$ALIVE" = "0" ] && [ "$LOCK_WINPID" -gt 0 ] && command -v tasklist >/dev/null 2>&1; then
    if tasklist //FI "PID eq $LOCK_WINPID" //FI "IMAGENAME eq bash.exe" 2>/dev/null | grep -q "bash.exe"; then ALIVE=1; fi
  fi
  if [ "$ALIVE" = "1" ] && [ "$AGE" -lt 86400 ]; then
    say "another build runner is running (pid $LOCK_PID, started $(( AGE / 60 )) min ago). lock: $LOCK"
    say "if you are sure it is not running, delete $LOCK and start again"
    exit 4
  fi
  say "removing a stale lock (pid $LOCK_PID)"
  rm -f "$LOCK"
fi
WINPID="$(cat "/proc/$$/winpid" 2>/dev/null || echo 0)"
echo "$$ $WINPID $(date +%s)" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT
trap 'exit 130' INT TERM

BUILDER_RUN_TOKEN="$(date +%Y%m%d-%H%M%S)-$$"
export BUILDER_RUN_TOKEN

last_log() { ls -t builder/logs/build-*.log 2>/dev/null | head -n 1; }
say_log() {
  say "$*"
  local f
  f="$(last_log)"
  if [ -n "$f" ]; then echo "[$(date +%H:%M:%S)] $*" >> "$f"; fi
}

# --- outer restart loop
CRASHES=0
while true; do
  node "builder/lib/orchestrator.mjs" "$@"
  CODE=$?
  case "$CODE" in
    0)
      say_log "build runner finished"
      exit 0
      ;;
    2|3|4|130)
      exit "$CODE"
      ;;
    *)
      CRASHES=$(( CRASHES + 1 ))
      if [ "$CRASHES" -ge 5 ]; then
        say_log "orchestrator crashed (exit $CODE), crash $CRASHES of 5. giving up"
        exit 1
      fi
      say_log "orchestrator crashed (exit $CODE), restarting in 30s (crash $CRASHES of 5)"
      sleep 30
      ;;
  esac
done
