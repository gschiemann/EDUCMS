#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# hygiene-check.sh — one-command workspace health report. The early-warning
# guard so the accumulating-cruft failures we hit on 2026-06-02 (154 leftover
# worktrees / 83 GB; a 408 MB never-gc'd .git full of garbage; 8 stale remote
# branches; unscanned dependency CVEs) get caught EARLY instead of when they
# break git or leak.
#
# Read-only. Prints a status line per axis with ✅/⚠️ and what to run to fix.
#   scripts/hygiene-check.sh          # fast: git + worktree + tree hygiene
#   scripts/hygiene-check.sh --deps   # also run the (network) dependency audit
# Portable to macOS bash 3.2.
# ─────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repo"; exit 1; }
cd "$ROOT"
DEPS=0; [ "${1:-}" = "--deps" ] && DEPS=1
warn=0
echo "── VenueOS workspace hygiene ──────────────────────────────────"

# 1. Leftover agent/session worktrees (the 83 GB lesson).
wt=$(git worktree list | grep -c "/.claude/worktrees/" | xargs)
if [ "$wt" -gt 0 ]; then echo "⚠️  worktrees: $wt leftover  → pnpm worktrees:clean"; warn=1
else echo "✅ worktrees: only the main tree"; fi

# 2. .git object health (the 408 MB never-gc'd lesson).
loose=$(git count-objects -v | awk -F': ' '/^count:/{print $2}')
garbage=$(git count-objects -v | awk -F': ' '/^garbage:/{print $2}')
gitsz=$(du -sh .git 2>/dev/null | cut -f1)
if [ "${loose:-0}" -gt 5000 ] || [ "${garbage:-0}" -gt 0 ]; then
  echo "⚠️  .git: $gitsz, $loose loose, $garbage garbage objects  → git gc"; warn=1
else echo "✅ .git: $gitsz, $loose loose, $garbage garbage (healthy)"; fi

# 3. Dirty / untracked main tree.
dirty=$(git status --porcelain | grep -c . | xargs)
if [ "$dirty" -gt 0 ]; then echo "⚠️  working tree: $dirty uncommitted/untracked  → git status"; warn=1
else echo "✅ working tree: clean"; fi

# 4. Stale local branches (beyond master + a couple of feature branches).
lb=$(git branch | grep -c . | xargs)
[ "$lb" -gt 10 ] && { echo "⚠️  local branches: $lb (prune stale)"; warn=1; } || echo "✅ local branches: $lb"

# 5. Stale remote branches merged into master (leftover agent/session trees).
git fetch --prune origin >/dev/null 2>&1 || true
stale_remote=$(git branch -r --merged origin/master 2>/dev/null | grep -vE "origin/master|origin/HEAD" | grep -c . | xargs)
[ "${stale_remote:-0}" -gt 0 ] && { echo "⚠️  remote: $stale_remote merged stale branch(es) on origin  → git push origin --delete <b>"; warn=1; } || echo "✅ remote: no merged-stale branches"

# 6. Backup-tag clutter.
bk=$(git tag | grep -c '^backup/' | xargs)
[ "${bk:-0}" -gt 20 ] && echo "ℹ️  tags: $bk stale backup/* tags (prunable; release player-v* kept)" || echo "✅ tags: backup clutter low ($bk)"

# 7. Dependency vulnerabilities (network; opt-in).
if [ "$DEPS" -eq 1 ]; then
  crit=$(pnpm audit 2>/dev/null | grep -ciE "^│ critical" | xargs)
  high=$(pnpm audit 2>/dev/null | grep -ciE "^│ high" | xargs)
  if [ "${crit:-0}" -gt 0 ] || [ "${high:-0}" -gt 0 ]; then
    echo "⚠️  deps: $crit critical, $high high  → review pnpm audit (overrides / bump)"; warn=1
  else echo "✅ deps: no critical/high advisories"; fi
else
  echo "ℹ️  deps: skipped (run with --deps for the network vuln audit)"
fi

echo "───────────────────────────────────────────────────────────────"
[ "$warn" -eq 0 ] && echo "World-class. Nothing to clean." || echo "Some axes need attention (see ⚠️ above)."
exit 0
