#!/usr/bin/env bash
# p07-run-both.sh — both arms, back to back, with nothing else on the box.
#
# The pair MUST run under the same machine conditions or the comparison
# measures the machine. The first attempt at this ran tsc and jest alongside
# the drill and produced a censored, unusable BEFORE arm.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export LOADTEST_REDIS_DRILL_DEADLINE_MS="${LOADTEST_REDIS_DRILL_DEADLINE_MS:-150000}"

echo "=== ARM: OFF (pre-2026-09-05 delivery) ==============================="
bash scripts/loadtest/p07-ab.sh arm off
LOADTEST_PHASES=redisdown bash scripts/loadtest/p07-ab.sh run before-raise-off

echo
echo "=== ARM: ON (the raise fast path) ===================================="
bash scripts/loadtest/p07-ab.sh arm on
LOADTEST_PHASES=redisdown,restart bash scripts/loadtest/p07-ab.sh run after-raise-on

echo
echo "=== DONE. Reports in scripts/loadtest/.out/ =========================="
