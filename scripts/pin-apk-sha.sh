#!/usr/bin/env bash
#
# Compute the out-of-band SHA-256 pin for a published APK release.
#
# The OTA release gate (apps/api/src/player-ota/release-policy.ts) can
# verify each advertised build against a digest recorded INDEPENDENTLY
# of the artifact — that is what turns the server-computed hash from
# transport integrity into provenance (finding OTA-03). The pin only
# means something if it is captured once, right after CI publishes the
# release, and committed like code. This script does the capture.
#
# Usage:
#   scripts/pin-apk-sha.sh player 1.1.1
#   scripts/pin-apk-sha.sh manager 1.1.0
#
# Requires: gh (authenticated — the repo is private), shasum.
set -euo pipefail

app="${1:-}"
vn="${2:-}"
repo="${PLAYER_APK_GITHUB_REPO:-gschiemann/EDUCMS}"

if [ -z "$app" ] || [ -z "$vn" ]; then
  echo "usage: scripts/pin-apk-sha.sh <player|manager> <x.y.z>" >&2
  exit 1
fi
case "$app" in
  player)  const_name="PLAYER_RELEASE_SHA_PINS";  env_name="PLAYER_APK_SHA_PINS" ;;
  manager) const_name="MANAGER_RELEASE_SHA_PINS"; env_name="MANAGER_APK_SHA_PINS" ;;
  *) echo "first arg must be 'player' or 'manager' (got '$app')" >&2; exit 1 ;;
esac
if ! [[ "$vn" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "version must be x.y.z (got '$vn')" >&2
  exit 1
fi

tag="$app-v$vn"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $tag APK from $repo (authenticated via gh)…"
gh release download "$tag" -R "$repo" -p '*.apk' -D "$tmp"

apk="$(find "$tmp" -name '*.apk' | head -1)"
if [ -z "$apk" ]; then
  echo "No .apk asset found on release $tag" >&2
  exit 1
fi

sha="$(shasum -a 256 "$apk" | awk '{print $1}')"
size="$(du -h "$apk" | awk '{print $1}')"

echo
echo "  $(basename "$apk")  ($size)"
echo "  sha256 = $sha"
echo
echo "Commit this pin into apps/api/src/player-ota/release-policy.ts:"
echo
echo "  export const ${const_name}: Readonly<Record<string, string>> = {"
echo "    '$vn': '$sha',"
echo "  };"
echo
echo "(or, for an incident where a deploy is too slow, set on Railway:)"
echo "  ${env_name}=$vn=$sha"
echo
echo "Then verify the fleet path serves the SAME bytes:"
echo "  curl -sL https://<api-host>/api/v1/player/$([ "$app" = manager ] && echo manager-apk || echo apk)/v/<versionCode> | shasum -a 256"
