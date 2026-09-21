#!/usr/bin/env bash
#
# Atomic APK release: bump the version in build.gradle.kts, commit, and
# tag — in one step, so the version bump and the git tag can never
# drift apart. Drift is the #1 recurring OTA failure (a bumped version
# with no tag means CI never builds a GitHub Release and the whole
# fleet silently stays on the old build).
#
# Usage:
#   scripts/release-apk.sh player 1.0.65
#   scripts/release-apk.sh manager 1.0.22
#   scripts/release-apk.sh player 1.0.66 --unqualified-override   # hotfix only
#
# HARDWARE QUALIFICATION PREFLIGHT (2026-09-02, P0-4): this script refuses
# to tag a version that has not been qualified on the real hardware classes
# (apps/player/HARDWARE-QUALIFICATION.md, checked by
# scripts/check-hardware-qual.cjs). The same gate runs in CI on the tag, so
# tagging an unqualified version would only fail later, louder. Headless
# Chromium does not reproduce OEM cert stores, OEM DNS, memory pressure,
# broken WebView providers, remote-key firmware or storage corruption —
# two units bricked at install and an Android-9 panel sat on "Connecting…"
# with every check green.
#
# After it runs, push with:
#   git push origin master <tag>
#
# The `apk-version-tag-sync` CI job (deploy-reliability.yml) is the
# safety net; this script is the thing that stops you needing it.
set -euo pipefail

app=""
vn=""
override=false

for arg in "$@"; do
  case "$arg" in
    --unqualified-override) override=true ;;
    -*) echo "unknown flag: $arg" >&2; exit 1 ;;
    *)
      if [ -z "$app" ]; then app="$arg"
      elif [ -z "$vn" ]; then vn="$arg"
      else echo "unexpected argument: $arg" >&2; exit 1
      fi
      ;;
  esac
done

if [ -z "$app" ] || [ -z "$vn" ]; then
  echo "usage: scripts/release-apk.sh <player|manager> <x.y.z> [--unqualified-override]" >&2
  exit 1
fi

case "$app" in
  player)  dir=app ;;
  manager) dir=manager ;;
  *) echo "first arg must be 'player' or 'manager' (got '$app')" >&2; exit 1 ;;
esac

if ! [[ "$vn" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "version must be x.y.z (got '$vn')" >&2
  exit 1
fi

IFS=. read -r MA MI PA <<< "$vn"
vc=$(( MA * 10000 + MI * 100 + PA ))
gradle="apps/player/$dir/build.gradle.kts"
tag="$app-v$vn"

[ -f "$gradle" ] || { echo "missing $gradle — run from the repo root" >&2; exit 1; }

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty — commit or stash first" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "tag $tag already exists — pick a new version" >&2
  exit 1
fi

# ── Hardware qualification preflight ──────────────────────────────────────
# The same gate CI runs on the tag. Refuse to tag a version that has not been
# proven on the real hardware classes. See apps/player/HARDWARE-QUALIFICATION.md
# and docs/player/HARDWARE-QUAL-CHECKLIST.md.
qual_matrix="apps/player/HARDWARE-QUALIFICATION.md"
if node scripts/check-hardware-qual.cjs "$app" "$vn"; then
  qualified=true
else
  qualified=false
fi

if [ "$qualified" != true ]; then
  if [ "$override" != true ]; then
    echo
    echo "REFUSING TO TAG: $app v$vn is not hardware-qualified (see the missing cells above)." >&2
    echo "Run docs/player/HARDWARE-QUAL-CHECKLIST.md on the physical units and record the" >&2
    echo "results in $qual_matrix. CI enforces the same gate on the tag, so tagging now" >&2
    echo "would only fail later." >&2
    echo >&2
    echo "For a GENUINE hotfix that cannot wait for a hardware pass, re-run with:" >&2
    echo "    scripts/release-apk.sh $app $vn --unqualified-override" >&2
    exit 1
  fi

  # ── Override path. Loud, explicit, typed confirmation, recorded in git. ──
  echo
  echo "############################################################################"
  echo "#  UNQUALIFIED RELEASE OVERRIDE                                            #"
  echo "############################################################################"
  echo
  echo "You are about to tag $app v$vn WITHOUT hardware qualification."
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

  node scripts/check-hardware-qual.cjs "$app" "$vn" \
    --record-override --operator "$ovr_initials" --reason "$ovr_reason"
  node scripts/check-hardware-qual.cjs "$app" "$vn" >/dev/null || {
    echo "override recording did not satisfy the gate — aborting (this is a bug)" >&2
    exit 1
  }
  echo "Override recorded in $qual_matrix — it will be committed with the version bump."
elif [ "$override" = true ]; then
  echo "note: --unqualified-override given but $app v$vn is already qualified — ignoring it."
fi

# macOS sed needs the '' arg; GNU sed does not. Detect.
if sed --version >/dev/null 2>&1; then SED=(sed -i); else SED=(sed -i ''); fi

"${SED[@]}" -E "s/versionCode = [0-9]+/versionCode = $vc/" "$gradle"
"${SED[@]}" -E "s/versionName = \"[^\"]+\"/versionName = \"$vn\"/" "$gradle"

git add "$gradle"
# An override rewrote the matrix; it ships in the same commit as the bump so the
# wave-through is impossible to separate from the release it waved through.
if [ -n "$(git status --porcelain -- "$qual_matrix")" ]; then
  git add "$qual_matrix"
fi
# 2026-09-04 — a bump that ALREADY LANDED is not an error.
#
# A security or reliability wave can legitimately bump build.gradle.kts in the
# commit that needs the new version, precisely so the hardware-qualification
# section can be written against it and the gate can start blocking. When the
# operator later runs this script for that same version, both seds are no-ops,
# nothing is staged, and `git commit` would abort with "nothing to commit" —
# leaving the release UNTAGGED for a reason that is not a problem. Tag the
# commit that already carries the bump instead.
if git diff --cached --quiet; then
  echo "note: $gradle already reads versionCode=$vc versionName=$vn and nothing else is"
  echo "      staged — tagging the existing commit rather than making an empty one."
else
  git commit -m "chore($app): release v$vn"
fi
git tag "$tag"

echo
echo "Bumped $gradle to versionCode=$vc versionName=$vn and tagged $tag."
echo "Now push both:   git push origin master $tag"
echo
echo "── Post-tag checklist ─────────────────────────────────────────────"
echo " 1. Watch 'Android Player APK' CI to green (it builds + attaches the"
echo "    release asset; the debuggable + unsigned guards block bad ones):"
echo "      gh run watch \$(gh run list --workflow android-player-apk.yml -L 1 --json databaseId -q '.[0].databaseId') --exit-status"
echo " 2. Pin the artifact digest (provenance, OTA-03) and commit it:"
echo "      scripts/pin-apk-sha.sh $app $vn"
echo " 2b. Confirm the APK reached object storage. CI publishes a delivery"
echo "    copy to the private 'apks' bucket, but that step is NON-BLOCKING"
echo "    (a storage outage must never leave a tagged release with no APK)."
echo "    Its absence is silent — the fleet just keeps downloading through"
echo "    the API byte proxy and Railway keeps paying the egress. Verify,"
echo "    and re-publish if the CI step warned:"
echo "      node scripts/upload-apks-to-storage.mjs --from-releases --kind $app --limit 2 --dry-run"
echo "    Then watch the fleet flip in the Railway logs — 'apk-delivery'"
echo "    lines carry served=redirect (storage) or served=proxy (+ reason)."
echo " 3. Fleet picks it up within 6h (or push now from the dashboard)."
echo "    Verify the API advertises it:"
echo "      curl -s https://<api-host>/api/v1/player/latest-version-public"
echo " 4. If this release replaces a build being retired for a SECURITY"
echo "    reason: raise MIN_SUPPORTED_*_VERSION and/or add the bad build"
echo "    to the quarantine list in release-policy.ts."
