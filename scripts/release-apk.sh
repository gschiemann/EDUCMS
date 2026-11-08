#!/usr/bin/env bash
#
# Atomic APK release: bump the version in apps/player/versions.properties,
# commit, and tag — in one step, so the version bump and the git tag can
# never drift apart. Drift is the #1 recurring OTA failure (a bumped version
# with no tag means CI never builds a GitHub Release and the whole fleet
# silently stays on the old build).
#
# ONE RELEASE UNIT (2026-11-08). The Player APK and the Manager APK it carries
# are released together under ONE tag, `player-v<x.y.z>`, from ONE file:
#
#   unit.version     the Player APK (the tag, the hardware-qualification row)
#   manager.version  the Manager APK bundled inside it — raised to the unit
#                    version only when apps/player/manager changed since the
#                    previous release, so an unchanged companion is never
#                    reinstalled on any screen (the Player installs it only
#                    when its versionCode is newer than the installed one).
#
# This script detects that change itself (git diff since the newest player-v*
# tag) and says what it decided; --bump-manager / --keep-manager override it.
# `manager-v*` tags are retired: there is no standalone Manager release.
#
# Usage:
#   scripts/release-apk.sh 1.1.30
#   scripts/release-apk.sh player 1.1.30                 # the old spelling still works
#   scripts/release-apk.sh 1.1.30 --unqualified-override # hotfix only
#   scripts/release-apk.sh 1.1.30 --bump-manager         # force manager.version=1.1.30
#   scripts/release-apk.sh 1.1.30 --keep-manager         # force the companion unchanged
#
# HARDWARE QUALIFICATION PREFLIGHT (2026-09-02, P0-4): this script refuses
# to tag a version that has not been qualified on the real hardware classes
# (apps/player/HARDWARE-QUALIFICATION.md, checked by
# scripts/check-hardware-qual.cjs). The same gate runs in CI on the tag, so
# tagging an unqualified version would only fail later, louder. Headless
# Chromium does not reproduce OEM cert stores, OEM DNS, memory pressure,
# broken WebView providers, remote-key firmware or storage corruption —
# two units bricked at install and an Android-9 panel sat on "Connecting…"
# with every check green. The `## Release: player <x.y.z>` section qualifies
# the whole unit — the checklist's cold-install / ota-push / boot-proof runs
# exercise the bundled companion on the same glass.
#
# After it runs: open the PR, let the Lead merge on the owner's go, then tag
# the MERGED commit (apps/player/CLAUDE.md rule 13). No model pushes master.
#
# The `apk-version-tag-sync` CI job (deploy-reliability.yml) is the
# safety net; this script is the thing that stops you needing it.
set -euo pipefail

app=""
vn=""
override=false
manager_mode="auto"

for arg in "$@"; do
  case "$arg" in
    --unqualified-override) override=true ;;
    --bump-manager) manager_mode="bump" ;;
    --keep-manager) manager_mode="keep" ;;
    -*) echo "unknown flag: $arg" >&2; exit 1 ;;
    *)
      if [ -z "$app" ] && [[ "$arg" =~ ^[a-z]+$ ]]; then app="$arg"
      elif [ -z "$vn" ]; then vn="$arg"
      else echo "unexpected argument: $arg" >&2; exit 1
      fi
      ;;
  esac
done

if [ -z "$app" ]; then app="player"; fi

if [ -z "$vn" ]; then
  echo "usage: scripts/release-apk.sh [player] <x.y.z> [--unqualified-override] [--bump-manager|--keep-manager]" >&2
  exit 1
fi

case "$app" in
  player) ;;
  manager)
    echo "REFUSING: there is no standalone Manager release any more (2026-11-08)." >&2
    echo "The Manager ships inside the Player APK and is versioned by manager.version in" >&2
    echo "apps/player/versions.properties. Release the unit:  scripts/release-apk.sh <x.y.z>" >&2
    exit 1
    ;;
  *) echo "first arg must be 'player' (got '$app')" >&2; exit 1 ;;
esac

if ! [[ "$vn" =~ ^[0-9]+\.[0-9]{1,2}\.[0-9]{1,2}$ ]]; then
  echo "version must be x.y.z with minor and patch of at most two digits (got '$vn')" >&2
  exit 1
fi

IFS=. read -r MA MI PA <<< "$vn"
vc=$(( MA * 10000 + MI * 100 + PA ))
versions="apps/player/versions.properties"
tag="player-v$vn"

[ -f "$versions" ] || { echo "missing $versions — run from the repo root" >&2; exit 1; }

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty — commit or stash first" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "tag $tag already exists — pick a new version" >&2
  exit 1
fi

current_unit=$(sed -nE 's/^[[:space:]]*unit\.version[[:space:]]*=[[:space:]]*([^[:space:]]+).*$/\1/p' "$versions" | head -1)
current_manager=$(sed -nE 's/^[[:space:]]*manager\.version[[:space:]]*=[[:space:]]*([^[:space:]]+).*$/\1/p' "$versions" | head -1)
if [ -z "$current_unit" ] || [ -z "$current_manager" ]; then
  echo "$versions must carry unit.version and manager.version" >&2
  exit 1
fi

# ── Field-candidate collision (2026-10-10 review P1-1) ────────────────────
# A private field build x.y.z-field.N carries the SAME versionCode as stable
# x.y.z (the suffix is not encoded), and the device OTA worker refuses any
# offer whose versionCode is not GREATER than its own. So a stable x.y.z
# would never install on the screens that took the field build — they would
# be stranded on prerelease bytes. Release the next patch instead.
if grep -q "'$vn-field\." apps/api/src/player-ota/field-candidate-releases.ts 2>/dev/null; then
  echo "REFUSING TO TAG: a field candidate $vn-field.* exists with versionCode $vc." >&2
  echo "Screens that installed it would never accept stable $vn. Release $MA.$MI.$((PA + 1)) instead." >&2
  exit 1
fi

# ── Did the Manager change since the last release? ────────────────────────
# The newest player-v* tag is the previous unit. If apps/player/manager differs
# from it, the companion inside this release is new bytes and MUST take the
# unit version (new bytes under an old versionCode would never install).
# Otherwise manager.version stays where it is and no screen reinstalls it.
prev_tag=$(git tag -l 'player-v*' | sort -V | tail -1)
manager_changed=false
if [ -n "$prev_tag" ]; then
  if ! git diff --quiet "$prev_tag"..HEAD -- apps/player/manager; then manager_changed=true; fi
else
  manager_changed=true
fi
case "$manager_mode" in
  auto) bump_manager=$manager_changed ;;
  bump) bump_manager=true ;;
  keep)
    bump_manager=false
    if [ "$manager_changed" = true ]; then
      echo "REFUSING --keep-manager: apps/player/manager changed since $prev_tag; the companion must take" >&2
      echo "the unit version or the fleet runs new Manager bytes under an old versionCode." >&2
      exit 1
    fi
    ;;
esac
new_manager="$current_manager"
if [ "$bump_manager" = true ]; then new_manager="$vn"; fi
echo "unit: $current_unit → $vn   manager: $current_manager → $new_manager  (manager changed since ${prev_tag:-no previous tag}: $manager_changed, mode=$manager_mode)"

# ── Hardware qualification preflight ──────────────────────────────────────
# The same gate CI runs on the tag. Refuse to tag a version that has not been
# proven on the real hardware classes. See apps/player/HARDWARE-QUALIFICATION.md
# and docs/player/HARDWARE-QUAL-CHECKLIST.md.
qual_matrix="apps/player/HARDWARE-QUALIFICATION.md"
if node scripts/check-hardware-qual.cjs player "$vn"; then
  qualified=true
else
  qualified=false
fi

if [ "$qualified" != true ]; then
  if [ "$override" != true ]; then
    echo
    echo "REFUSING TO TAG: player v$vn is not hardware-qualified (see the missing cells above)." >&2
    echo "Run docs/player/HARDWARE-QUAL-CHECKLIST.md on the physical units and record the" >&2
    echo "results in $qual_matrix. CI enforces the same gate on the tag, so tagging now" >&2
    echo "would only fail later." >&2
    echo >&2
    echo "For a GENUINE hotfix that cannot wait for a hardware pass, re-run with:" >&2
    echo "    scripts/release-apk.sh $vn --unqualified-override" >&2
    exit 1
  fi

  # ── Override path. Loud, explicit, typed confirmation, recorded in git. ──
  echo
  echo "############################################################################"
  echo "#  UNQUALIFIED RELEASE OVERRIDE                                            #"
  echo "############################################################################"
  echo
  echo "You are about to tag player v$vn WITHOUT hardware qualification."
  echo "Every missing cell listed above is a real, untested failure mode on real"
  echo "displays: OEM cert stores, OEM DNS, memory pressure, broken WebView"
  echo "providers, remote-key-only firmware, storage corruption. Two units bricked"
  echo "at install and an Android-9 panel sat on 'Connecting…' while CI was green."
  echo
  echo "This is a HOTFIX escape hatch, not a workflow. The override is recorded in"
  echo "$qual_matrix and stays there until the cells are actually run on hardware."
  echo
  if [ ! -t 0 ]; then
    echo "refusing to override without an interactive terminal" >&2
    exit 1
  fi
  printf 'Type the exact version (%s) to proceed, anything else to abort: ' "$vn"
  read -r confirm
  if [ "$confirm" != "$vn" ]; then
    echo "Aborted — nothing was bumped or tagged."
    exit 1
  fi
  printf 'Your initials (2-4 letters) for the override record: '
  read -r ovr_initials
  ovr_initials=$(printf '%s' "$ovr_initials" | tr '[:lower:]' '[:upper:]')
  if ! [[ "$ovr_initials" =~ ^[A-Z]{2,4}$ ]]; then
    echo "initials must be 2-4 letters — aborted" >&2
    exit 1
  fi
  printf 'One-line reason this hotfix cannot wait for hardware qualification: '
  read -r ovr_reason
  if [ -z "$ovr_reason" ]; then
    echo "a reason is required — aborted" >&2
    exit 1
  fi

  node scripts/check-hardware-qual.cjs player "$vn" \
    --record-override --operator "$ovr_initials" --reason "$ovr_reason"
  node scripts/check-hardware-qual.cjs player "$vn" >/dev/null || {
    echo "override recording did not satisfy the gate — aborting (this is a bug)" >&2
    exit 1
  }
  echo "Override recorded in $qual_matrix — it will be committed with the version bump."
elif [ "$override" = true ]; then
  echo "note: --unqualified-override given but player v$vn is already qualified — ignoring it."
fi

# macOS sed needs the '' arg; GNU sed does not. Detect.
if sed --version >/dev/null 2>&1; then SED=(sed -i); else SED=(sed -i ''); fi

"${SED[@]}" -E "s/^([[:space:]]*unit\.version[[:space:]]*=[[:space:]]*).*$/\1$vn/" "$versions"
"${SED[@]}" -E "s/^([[:space:]]*manager\.version[[:space:]]*=[[:space:]]*).*$/\1$new_manager/" "$versions"

# The guard CI runs on every build — refuse here first, before anything is committed.
node scripts/check-apk-versions.cjs || {
  git checkout -- "$versions"
  echo "versions guard refused the bump — nothing was committed or tagged" >&2
  exit 1
}

git add "$versions"
# An override rewrote the matrix; it ships in the same commit as the bump so the
# wave-through is impossible to separate from the release it waved through.
if [ -n "$(git status --porcelain -- "$qual_matrix")" ]; then
  git add "$qual_matrix"
fi
# 2026-09-04 — a bump that ALREADY LANDED is not an error.
#
# A security or reliability wave can legitimately bump the version in the
# commit that needs it, precisely so the hardware-qualification section can be
# written against it and the gate can start blocking. When the operator later
# runs this script for that same version, both seds are no-ops, nothing is
# staged, and `git commit` would abort with "nothing to commit" — leaving the
# release UNTAGGED for a reason that is not a problem. Tag the commit that
# already carries the bump instead.
if git diff --cached --quiet; then
  echo "note: $versions already reads unit.version=$vn manager.version=$new_manager and nothing"
  echo "      else is staged — tagging the existing commit rather than making an empty one."
else
  git commit -m "chore(player): release v$vn (manager $new_manager)"
fi
git tag "$tag"

echo
echo "Bumped $versions to unit.version=$vn (versionCode $vc), manager.version=$new_manager, and tagged $tag."
echo "Push the tag only after the release PR is merged:   git push origin $tag"
echo
echo "── Post-tag checklist ─────────────────────────────────────────────"
echo " 1. Watch 'Android Player APK' CI to green (it builds + attaches BOTH"
echo "    APKs to the release; the debuggable + unsigned guards block bad ones):"
echo "      gh run watch \$(gh run list --workflow android-player-apk.yml -L 1 --json databaseId -q '.[0].databaseId') --exit-status"
echo " 2. Pin the artifact digests (provenance, OTA-03) and commit them:"
echo "      scripts/pin-apk-sha.sh player $vn"
if [ "$bump_manager" = true ]; then
echo "      scripts/pin-apk-sha.sh manager $new_manager   # the companion changed in this release"
fi
echo " 2b. Confirm both APKs reached object storage. CI publishes delivery"
echo "    copies to the private 'apks' bucket, but that step is NON-BLOCKING"
echo "    (a storage outage must never leave a tagged release with no APK)."
echo "    Its absence is silent — the fleet just keeps downloading through"
echo "    the API byte proxy and Railway keeps paying the egress. Verify,"
echo "    and re-publish if the CI step warned:"
echo "      node scripts/upload-apks-to-storage.mjs --from-releases --kind player --limit 2 --dry-run"
echo "    Then watch the fleet flip in the Railway logs — 'apk-delivery'"
echo "    lines carry served=redirect (storage) or served=proxy (+ reason)."
echo " 3. The fleet takes it through the ladder (field window → tracked push →"
echo "    canary → fleet); a screen installs the companion from the new Player's"
echo "    assets only when manager.version is newer than what it runs."
echo "    Verify the API advertises it:"
echo "      curl -s https://<api-host>/api/v1/player/latest-version-public"
echo " 4. If this release replaces a build being retired for a SECURITY"
echo "    reason: raise MIN_SUPPORTED_*_VERSION and/or add the bad build"
echo "    to the quarantine list in release-policy.ts."
