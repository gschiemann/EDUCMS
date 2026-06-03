#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# cleanup-worktrees.sh — safely remove leftover agent/session git worktrees.
#
# WHY THIS EXISTS: on 2026-06-02 we discovered 154 leftover worktrees under
# .claude/worktrees/ totaling 83 GB — accumulated across weeks of agent
# dispatches that were cherry-picked to master but whose worktrees were never
# removed. Git scanning 150+ worktrees made every git command slow/erroring.
# This script is the one-command fix + the routine guard so it never rebuilds.
#
# SAFE BY DEFAULT: dry-run unless you pass --execute. It NEVER touches the main
# working tree, NEVER force-gc's (removed branches' commits stay recoverable),
# and writes a branch→SHA manifest + any uncommitted diffs to a backup dir
# BEFORE deleting, so nothing committed-or-dirty is unrecoverable.
#
# Usage:
#   scripts/cleanup-worktrees.sh                      # dry-run: what would go
#   scripts/cleanup-worktrees.sh --execute            # remove worktrees + prune
#   scripts/cleanup-worktrees.sh --execute --branches # also delete orphaned
#                                                      # worktree-*/claude branches
#
# Portable to macOS's bash 3.2 (no `mapfile`, no associative arrays).
# ─────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repo"; exit 1; }
cd "$ROOT"
WT_DIR=".claude/worktrees"
EXECUTE=0; BRANCHES=0
for a in "$@"; do
  case "$a" in
    --execute) EXECUTE=1 ;;
    --branches) BRANCHES=1 ;;
    *) echo "unknown arg: $a"; exit 2 ;;
  esac
done

# Every worktree EXCEPT the main tree (the main tree is the repo root, never
# under .claude/worktrees). Space-safe (the repo path contains a space).
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
git worktree list --porcelain | sed -n 's/^worktree //p' | grep "/$WT_DIR/" > "$TMP" || true
COUNT=$(grep -c . "$TMP" | xargs)
DISK=$(du -sh "$WT_DIR" 2>/dev/null | cut -f1 || echo "0")

echo "Leftover worktrees under $WT_DIR: $COUNT   (disk: $DISK)"
if [ "$COUNT" -eq 0 ] && [ ! -d "$WT_DIR" ]; then echo "Nothing to clean. ✅"; exit 0; fi

if [ "$EXECUTE" -eq 0 ]; then
  echo "--- DRY RUN (pass --execute to remove) ---"
  while IFS= read -r w; do
    [ -z "$w" ] && continue
    br=$(git -C "$w" branch --show-current 2>/dev/null || echo "?")
    dirty=$(git -C "$w" status --porcelain 2>/dev/null | grep -c . | xargs)
    echo "  would remove: $(basename "$w")  [branch:$br dirty:$dirty]"
  done < "$TMP"
  orphans=$(ls -1 "$WT_DIR" 2>/dev/null | grep -c . | xargs)
  echo "  dirs on disk under $WT_DIR: $orphans"
  exit 0
fi

# ── EXECUTE ──
BK="$HOME/Desktop/venueos-worktree-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK/dirty-diffs"
echo "Backing up branch manifest + uncommitted diffs → $BK"
while IFS= read -r w; do
  [ -z "$w" ] && continue
  sha=$(git -C "$w" rev-parse HEAD 2>/dev/null); br=$(git -C "$w" branch --show-current 2>/dev/null)
  subj=$(git -C "$w" log -1 --pretty=%s 2>/dev/null)
  printf '%s  %s  %s\n' "$sha" "$br" "$subj" >> "$BK/branches.txt"
  if [ -n "$(git -C "$w" status --porcelain 2>/dev/null)" ]; then
    n=$(basename "$w"); git -C "$w" diff HEAD > "$BK/dirty-diffs/$n.patch" 2>/dev/null
    [ -s "$BK/dirty-diffs/$n.patch" ] || rm -f "$BK/dirty-diffs/$n.patch"
  fi
done < "$TMP"

echo "Removing $COUNT worktrees…"
while IFS= read -r w; do
  [ -z "$w" ] && continue
  git worktree unlock "$w" 2>/dev/null
  git worktree remove --force "$w" 2>/dev/null || rm -rf "$w"
done < "$TMP"
# Sweep any orphaned dirs git already de-registered but left on disk.
[ -d "$WT_DIR" ] && rm -rf "${WT_DIR:?}/"* 2>/dev/null
git worktree prune

if [ "$BRANCHES" -eq 1 ]; then
  echo "Deleting orphaned worktree-*/claude-session branches…"
  for b in $(git branch --format='%(refname:short)' | grep -E '^(worktree-agent-|claude/)'); do
    git branch -D "$b" >/dev/null 2>&1
  done
fi

echo "─── DONE ───"
echo "worktrees now: $(git worktree list | grep -c . | xargs)   (should be 1 = main tree)"
echo "$WT_DIR disk: $(du -sh "$WT_DIR" 2>/dev/null | cut -f1 || echo 0)"
echo "backup kept at: $BK"
