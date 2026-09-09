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
# working tree and NEVER force-gc's (removed branches' commits stay recoverable).
#
# ── WHAT IT PRESERVES, AND WHY THE OLD VERSION LOST WORK (fixed 2026-09-08) ──
# The backup used to be `git diff HEAD` ALONE. That diff structurally CANNOT see
# an UNTRACKED file, so a brand-new file an agent wrote but never committed —
# exactly what a fresh `*.spec.ts` is — produced a ZERO-BYTE patch, which the
# next line then DELETED as empty. The worktree was removed seconds later. The
# work vanished with no diff, no file and no error: silent, evidence-free loss.
# Reproduced in a sandbox, and nearly hit for real on 2026-09-08 (an untracked
# `push-health.spec.ts` survived only because a human inspected the tree first).
#
# It now preserves, per worktree, BEFORE anything is removed:
#   • branches.txt        — branch → SHA → subject (unchanged)
#   • dirty-diffs/N.patch — tracked edits, `--binary` so binary changes survive
#   • untracked/N.tar.gz  — every untracked file the diff cannot represent
#   • reports/N.tar.gz    — ignored-but-real work under docs/ (agent reports live
#                           in gitignored docs/research, so plain "untracked"
#                           misses them)
#   • status/N.txt        — the raw `git status --porcelain`, ALWAYS written, so
#                           there is a record even when every capture is empty
#   • orphans/            — directories git no longer has registered are ARCHIVED
#                           before the disk sweep, never deleted unseen
#
# It also REFUSES to remove a worktree touched in the last 20 minutes (a likely
# still-running agent) unless you pass --force-recent.
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
EXECUTE=0; BRANCHES=0; FORCE_RECENT=0
for a in "$@"; do
  case "$a" in
    --execute) EXECUTE=1 ;;
    --branches) BRANCHES=1 ;;
    --force-recent) FORCE_RECENT=1 ;;
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
    untr=$(git -C "$w" ls-files --others --exclude-standard 2>/dev/null | grep -c . | xargs)
    recent=""
    if [ -n "$(find "$w" -type f -mmin -20 -not -path '*/node_modules/*' -not -path '*/.git/*' -print -quit 2>/dev/null)" ]; then
      recent="  ⚠ ACTIVE<20min"
    fi
    echo "  would remove: $(basename "$w")  [branch:$br dirty:$dirty untracked:$untr]$recent"
  done < "$TMP"
  orphans=$(ls -1 "$WT_DIR" 2>/dev/null | grep -c . | xargs)
  echo "  dirs on disk under $WT_DIR: $orphans"
  exit 0
fi

# ── EXECUTE ──
BK="$HOME/Desktop/venueos-worktree-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK/dirty-diffs" "$BK/untracked" "$BK/reports" "$BK/status" "$BK/orphans"
echo "Backing up branch manifest + uncommitted diffs → $BK"
while IFS= read -r w; do
  [ -z "$w" ] && continue
  sha=$(git -C "$w" rev-parse HEAD 2>/dev/null); br=$(git -C "$w" branch --show-current 2>/dev/null)
  subj=$(git -C "$w" log -1 --pretty=%s 2>/dev/null)
  printf '%s  %s  %s\n' "$sha" "$br" "$subj" >> "$BK/branches.txt"
  n=$(basename "$w")
  # ALWAYS record status, even when empty — an empty record is evidence; a
  # missing one is indistinguishable from "we never looked".
  git -C "$w" status --porcelain > "$BK/status/$n.txt" 2>/dev/null

  # Tracked edits. --binary so a changed image/keystore is recoverable too.
  git -C "$w" diff HEAD --binary > "$BK/dirty-diffs/$n.patch" 2>/dev/null
  [ -s "$BK/dirty-diffs/$n.patch" ] || rm -f "$BK/dirty-diffs/$n.patch"

  # UNTRACKED files — the class `git diff HEAD` cannot see. This is the fix.
  u=$(git -C "$w" ls-files --others --exclude-standard 2>/dev/null | grep -c . | xargs)
  if [ "${u:-0}" -gt 0 ]; then
    ( cd "$w" && git ls-files --others --exclude-standard -z \
        | tar -czf "$BK/untracked/$n.tar.gz" --null -T - ) 2>/dev/null \
      && echo "  ↳ $n: preserved $u untracked file(s)" \
      || echo "  ⚠ $n: FAILED to archive $u untracked file(s) — NOT REMOVING"
  fi

  # Ignored-but-real work: agent reports are written under gitignored docs/.
  if [ -d "$w/docs" ]; then
    r=$(git -C "$w" ls-files --others --ignored --exclude-standard -- docs 2>/dev/null | grep -c . | xargs)
    if [ "${r:-0}" -gt 0 ]; then
      ( cd "$w" && git ls-files --others --ignored --exclude-standard -z -- docs \
          | tar -czf "$BK/reports/$n.tar.gz" --null -T - ) 2>/dev/null \
        && echo "  ↳ $n: preserved $r ignored doc/report file(s)"
    fi
  fi
done < "$TMP"

echo "Removing worktrees…"
SKIPPED=0; REMOVED=0
while IFS= read -r w; do
  [ -z "$w" ] && continue
  n=$(basename "$w")

  # A worktree touched minutes ago probably belongs to a RUNNING agent. The
  # harness locks every agent tree, so "locked" cannot distinguish live from
  # finished — recency can. Refuse rather than race it.
  if [ "$FORCE_RECENT" -eq 0 ] && \
     [ -n "$(find "$w" -type f -mmin -20 -not -path '*/node_modules/*' -not -path '*/.git/*' -print -quit 2>/dev/null)" ]; then
    echo "  SKIP $n — modified in the last 20 min (pass --force-recent to override)"
    SKIPPED=$((SKIPPED+1)); continue
  fi

  # Never delete a tree whose untracked work we failed to archive.
  u=$(git -C "$w" ls-files --others --exclude-standard 2>/dev/null | grep -c . | xargs)
  if [ "${u:-0}" -gt 0 ] && [ ! -s "$BK/untracked/$n.tar.gz" ]; then
    echo "  SKIP $n — $u untracked file(s) present but NOT archived; refusing to delete"
    SKIPPED=$((SKIPPED+1)); continue
  fi

  git worktree unlock "$w" 2>/dev/null
  git worktree remove --force "$w" 2>/dev/null || rm -rf "$w"
  REMOVED=$((REMOVED+1))
done < "$TMP"

# Orphaned dirs git no longer has registered. The old code `rm -rf`'d these
# WITHOUT backing them up — they never entered the backup loop, which only ever
# read from `git worktree list`. Archive first, delete second.
if [ -d "$WT_DIR" ]; then
  for d in "$WT_DIR"/*; do
    [ -e "$d" ] || continue
    dn=$(basename "$d")
    # Compare BASENAMES against a FRESHLY re-read worktree list. Comparing the
    # glob's relative path against git's absolute path silently matched nothing,
    # so a deliberately-SKIPPED live worktree was classed as an orphan and
    # deleted — caught by the sandbox test on 2026-09-08. Never path-compare here.
    still_registered=0
    while IFS= read -r reg; do
      [ "$(basename "$reg")" = "$dn" ] && still_registered=1
    done <<EOF
$(git worktree list --porcelain | sed -n 's/^worktree //p' | grep "/$WT_DIR/" || true)
EOF
    [ "$still_registered" -eq 1 ] && continue          # still a real worktree; leave it alone
    if [ -d "$d" ]; then
      tar -czf "$BK/orphans/$dn.tar.gz" -C "$WT_DIR" "$dn" 2>/dev/null \
        && echo "  archived orphan dir $dn → orphans/$dn.tar.gz" \
        || { echo "  ⚠ could not archive orphan $dn — LEAVING IT ON DISK"; continue; }
    fi
    rm -rf "$d" 2>/dev/null
  done
fi
git worktree prune

if [ "$BRANCHES" -eq 1 ] && [ "$SKIPPED" -gt 0 ]; then
  echo "Not deleting branches — $SKIPPED worktree(s) were skipped and still need theirs."
elif [ "$BRANCHES" -eq 1 ]; then
  echo "Deleting orphaned worktree-*/claude-session branches…"
  # Pattern must track the harness's ACTUAL branch naming. Subagents produce
  # `worktree-agent-<id>`; Workflow runs produce `worktree-wf_<runid>-<n>`. The
  # original regex only matched the former, so every workflow branch survived
  # its deleted worktree and accumulated invisibly — the same slow leak the
  # worktree pileup was. Verify with: git branch --list 'worktree-*'
  for b in $(git branch --format='%(refname:short)' | grep -E '^(worktree-|claude/)'); do
    git branch -D "$b" >/dev/null 2>&1
  done
fi

echo "─── DONE ───"
echo "removed: $REMOVED   skipped (preserved): $SKIPPED"
echo "worktrees now: $(git worktree list | grep -c . | xargs)   (should be 1 = main tree)"
echo "$WT_DIR disk: $(du -sh "$WT_DIR" 2>/dev/null | cut -f1 || echo 0)"
echo "backup kept at: $BK"
