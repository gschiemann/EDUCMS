#!/usr/bin/env bash
#
# SEC-006 — run the render-isolation proof INSIDE the shipped runtime image.
#
#   ./scripts/sec006-container-proof/run.sh [image-tag]
#
# Builds nothing by default: pass an already-built tag, or set
# SEC006_BUILD=1 to build one from the repo Dockerfile first.
#
# WHY A CONTAINER PROOF AT ALL. The Jest suite forks real processes, but on a
# developer Mac. It cannot speak to Alpine + musl, `USER node`, the container's
# seccomp profile, the image's own Chromium build, or whether the browser
# starts at all in the artifact that actually ships. Everything this script
# asserts is asserted against the image.
#
# WHAT IT STANDS UP
#   sec006-net      a docker network on 198.51.99.0/24 — a subnet OUTSIDE
#                   every range `isPrivateIp` rejects, so the shipped SSRF
#                   guard admits the origin without being weakened for the
#                   test and without needing internet.
#   sec006-origin   the image itself running scripts/.../origin.mjs on
#                   198.51.99.10:80.
#   the proof       the image itself running scripts/.../proof.mjs, started
#                   with every named secret set to a canary value.
#
# It also probes, in the same image, whether Chromium's own sandbox can be
# re-enabled — under the default seccomp profile and again unconfined, which
# is what separates "Alpine cannot" from "this container is not allowed to".
set -uo pipefail

IMAGE="${1:-educms-sec006-verify:latest}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
NET=sec006-net
ORIGIN_NAME=sec006-origin
SUBNET=198.51.99.0/24
ORIGIN_IP=198.51.99.10
FAIL=0

cleanup() {
  docker rm -f "$ORIGIN_NAME" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ "${SEC006_BUILD:-0}" = "1" ]; then
  echo "── building $IMAGE from $ROOT/Dockerfile"
  docker build -t "$IMAGE" "$ROOT" || exit 1
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "FATAL: image '$IMAGE' not found. Build it, or pass a tag."
  exit 1
fi

echo
echo "══════════════════════════════════════════════════════════════════"
echo " SEC-006 — render isolation, proved inside $IMAGE"
echo "══════════════════════════════════════════════════════════════════"
docker image inspect "$IMAGE" --format '  image: {{.Id}}
  arch:  {{.Architecture}}/{{.Os}}
  built: {{.Created}}'

# ── PART 1 — can Chromium's own sandbox be re-enabled in this image? ────────
# Three launches, each in the shipped image, each printing its own verdict.
# Then the same three with seccomp unconfined. If the second set succeeds
# where the first failed, the blocker is the container's seccomp profile
# (which denies clone/unshare with CLONE_NEW*), not Alpine and not the image.
echo
echo "── PART 1 — Chromium sandbox availability in this image ──────────────"
docker run --rm --entrypoint /bin/sh "$IMAGE" -c '
  echo "  user:      $(id)"
  echo "  CapEff:    $(grep ^CapEff /proc/self/status | awk "{print \$2}")"
  echo "  Seccomp:   $(grep ^Seccomp: /proc/self/status | awk "{print \$2}")"
  echo "  userns:    $(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo unreadable)"
  echo "  unpriv_userns: $(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo n/a)"
  ls -l /usr/lib/chromium/chrome-sandbox 2>/dev/null | sed "s/^/  suid:      /" || echo "  suid:      (no chrome-sandbox helper)"
'

probe() {
  local label="$1"; shift
  local secopt=("$@")
  for mode in "--no-sandbox" "" "--disable-setuid-sandbox"; do
    local name
    case "$mode" in
      "--no-sandbox")            name="A no-sandbox        " ;;
      "")                        name="B SUID sandbox      " ;;
      "--disable-setuid-sandbox") name="C userns sandbox    " ;;
    esac
    out=$(docker run --rm "${secopt[@]}" --entrypoint /usr/bin/chromium-browser "$IMAGE" \
            --headless=new --disable-gpu --disable-dev-shm-usage $mode \
            --dump-dom about:blank 2>&1)
    code=$?
    first=$(printf '%s' "$out" | grep -iE 'FATAL|ERROR|No usable sandbox|namespace' | head -1 | cut -c1-140)
    if [ $code -eq 0 ]; then
      echo "  [$label] $name exit=0   RENDERS"
    else
      echo "  [$label] $name exit=$code  ${first:-<no diagnostic>}"
    fi
  done
}
echo "  default seccomp (what Railway runs):"
probe "default"
echo "  seccomp=unconfined (isolating the cause):"
probe "unconf" --security-opt seccomp=unconfined

# ── PART 2 — the process-boundary proof ────────────────────────────────────
echo
echo "── PART 2 — process boundary, environment allowlist, kill containment ─"
cleanup
docker network create --subnet "$SUBNET" "$NET" >/dev/null || { echo "FATAL: could not create $NET"; exit 1; }
docker run -d --name "$ORIGIN_NAME" --network "$NET" --ip "$ORIGIN_IP" \
  -v "$HERE:/proof:ro" --entrypoint node "$IMAGE" /proof/origin.mjs >/dev/null || {
  echo "FATAL: origin container did not start"; exit 1; }

# Wait for the origin.
for _ in $(seq 1 30); do
  if docker run --rm --network "$NET" --entrypoint node "$IMAGE" \
       -e "fetch('http://$ORIGIN_IP/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
       >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker run --rm --network "$NET" \
  --env-file "$HERE/canary.env" \
  -e "SEC006_ORIGIN=http://$ORIGIN_IP" \
  -v "$HERE:/proof:ro" \
  --entrypoint node "$IMAGE" /proof/proof.mjs
PROOF_EXIT=$?
[ $PROOF_EXIT -ne 0 ] && FAIL=1

# ── PART 3 — the REAL API process, with a render killed under it ───────────
echo
echo "── PART 3 — the live API survives a render being killed under it ─────"
docker run --rm --network "$NET" \
  --env-file "$HERE/canary.env" \
  -e NODE_ENV=production \
  -e PORT=8080 \
  -e ALLOWED_ORIGINS=http://localhost:3000 \
  -e PROXY_SSR_ALLOW_ANONYMOUS=1 \
  -e "SEC006_ORIGIN=http://$ORIGIN_IP" \
  -v "$HERE:/proof:ro" \
  --entrypoint node "$IMAGE" /proof/api-proof.mjs
API_EXIT=$?
[ $API_EXIT -ne 0 ] && FAIL=1

echo
if [ $FAIL -eq 0 ]; then
  echo "══ SEC-006 in-container proof: ALL PARTS PASSED ══"
else
  echo "══ SEC-006 in-container proof: FAILURES ABOVE (proof=$PROOF_EXIT api=$API_EXIT) ══"
fi
exit $FAIL
