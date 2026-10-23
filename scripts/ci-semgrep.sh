#!/bin/sh
# Semgrep SAST for CI (2026-10-22, go-private: replaces CodeQL default setup,
# which is free only on public repos). Runs inside the semgrep/semgrep image.
#
#   sh scripts/ci-semgrep.sh diff   # PR / push: only findings the change ADDS
#                                   # (--baseline-commit $BASE_SHA)
#   sh scripts/ci-semgrep.sh full   # nightly: the whole tree (the backlog)
#
# REPORT-ONLY unless SEMGREP_BLOCKING=true (a repository variable): then a
# NEW finding in `diff` mode fails the job. `full` mode never fails — it is the
# inventory of existing findings, which is what a baseline exists to tolerate.
#
# Rules: Semgrep's public OSS registry packs, fetched anonymously, metrics off.
# No account, no token, no code leaves the runner (the registry is only asked
# for rules). Paths excluded from scanning: .semgrepignore.
set -u
MODE="${1:-diff}"
git config --global --add safe.directory "$(pwd)" 2>/dev/null || true
# The image expects code mounted at /src unless it detects GitHub Actions;
# scan the checkout in place everywhere instead.
unset SEMGREP_IN_DOCKER

set -- --config p/default --config p/typescript --config p/javascript \
  --config p/nodejs --config p/react --config p/github-actions \
  --metrics=off --timeout 30 --jobs 2 \
  --json-output=semgrep.json --sarif-output=semgrep.sarif

if [ "$MODE" = "diff" ]; then
  if [ -n "${BASE_SHA:-}" ] && git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
    set -- "$@" --baseline-commit "$BASE_SHA"
    echo "semgrep: diff-aware against ${BASE_SHA} — only NEW findings are reported"
  else
    echo "semgrep: base '${BASE_SHA:-}' unresolvable — scanning the whole tree (report-only for this run)"
    MODE=full
  fi
fi

semgrep scan "$@"
CODE=$?

COUNT=$(python3 -c 'import json;print(len(json.load(open("semgrep.json")).get("results",[])))' 2>/dev/null || echo "?")
ERRS=$(python3 -c 'import json;print(len(json.load(open("semgrep.json")).get("errors",[])))' 2>/dev/null || echo "?")
{
  echo "### Semgrep ($MODE)"
  echo ""
  echo "Findings: **$COUNT** · scan errors: $ERRS · semgrep exit: $CODE · blocking: ${SEMGREP_BLOCKING:-false}"
  echo ""
  python3 - <<'PY' 2>/dev/null || true
import json
r = json.load(open("semgrep.json")).get("results", [])
if r:
    print("| Rule | File | Line |")
    print("|---|---|---|")
    for x in r[:60]:
        print(f"| `{x['check_id'].split('.')[-1]}` | `{x['path']}` | {x['start']['line']} |")
    if len(r) > 60:
        print(f"\n…and {len(r) - 60} more (see the SARIF artifact).")
PY
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

echo "semgrep: $COUNT finding(s), exit $CODE, mode $MODE"
if [ "$MODE" = "diff" ] && [ "${SEMGREP_BLOCKING:-}" = "true" ] && [ "$COUNT" != "0" ] && [ "$COUNT" != "?" ]; then
  echo "::error::Semgrep found $COUNT NEW finding(s) and SEMGREP_BLOCKING=true. Fix them, or add a reviewed '// nosemgrep: <rule-id>' with a reason."
  exit 1
fi
exit 0
