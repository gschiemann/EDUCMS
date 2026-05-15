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
#
# After it runs, push with:
#   git push origin master <tag>
#
# The `apk-version-tag-sync` CI job (deploy-reliability.yml) is the
# safety net; this script is the thing that stops you needing it.
set -euo pipefail

app="${1:-}"
vn="${2:-}"

if [ -z "$app" ] || [ -z "$vn" ]; then
  echo "usage: scripts/release-apk.sh <player|manager> <x.y.z>" >&2
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

# macOS sed needs the '' arg; GNU sed does not. Detect.
if sed --version >/dev/null 2>&1; then SED=(sed -i); else SED=(sed -i ''); fi

"${SED[@]}" -E "s/versionCode = [0-9]+/versionCode = $vc/" "$gradle"
"${SED[@]}" -E "s/versionName = \"[^\"]+\"/versionName = \"$vn\"/" "$gradle"

git add "$gradle"
git commit -m "chore($app): release v$vn"
git tag "$tag"

echo
echo "Bumped $gradle to versionCode=$vc versionName=$vn and tagged $tag."
echo "Now push both:   git push origin master $tag"
