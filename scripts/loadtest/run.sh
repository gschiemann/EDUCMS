#!/usr/bin/env bash
# scripts/loadtest/run.sh — THE one command.
#
#   bash scripts/loadtest/run.sh            # full run: up, seed, measure, fail-modes, down
#   bash scripts/loadtest/run.sh --keep     # leave the stack running afterwards
#   LOADTEST_SCREENS=300 bash scripts/loadtest/run.sh
#
# Knobs (all optional, all read straight from the environment):
#   LOADTEST_SCREENS       fleet size to seed                     (default 1000)
#   LOADTEST_TENANTS       venues to spread it across            (default 40)
#   LOADTEST_RAMP          ramp rungs, comma separated           (default: /8 /4 /2 full)
#   LOADTEST_RUNG_SECONDS  seconds per rung                      (default 75)
#   LOADTEST_NAT_SIZES     screens-behind-one-IP sizes to probe  (default 50,75,100)
#   LOADTEST_MAX_SCREENS   drive a SUBSET of an already-seeded fleet (harness smoke tests)
#
# ⚠️ It never reads a repo `.env`. Every connection string is declared inline in
# docker-compose.loadtest.yml against container-local services, and the Node
# harness re-checks the resolved hosts before it does anything
# (scripts/loadtest/lib/env.mjs :: assertDisposableStack).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

KEEP=0
for arg in "$@"; do [ "$arg" = "--keep" ] && KEEP=1; done

# Throwaway secrets — one set per run. Written to .out/stack.env (gitignored)
# because `docker compose` re-interpolates the compose file on every subcommand
# and the harness itself issues `stop` / `start` / `restart` mid-run.
mkdir -p scripts/loadtest/.out
ENV_FILE=scripts/loadtest/.out/stack.env
export LOADTEST_ENV_FILE="$ENV_FILE"
export LOADTEST_API_IMAGE="${LOADTEST_API_IMAGE:-edu-cms:loadtest}"
{
  echo "LOADTEST_JWT_SECRET=${LOADTEST_JWT_SECRET:-$(openssl rand -hex 32)}"
  echo "LOADTEST_SESSION_SECRET=${LOADTEST_SESSION_SECRET:-$(openssl rand -hex 32)}"
  echo "LOADTEST_DEVICE_SECRET_KEY=${LOADTEST_DEVICE_SECRET_KEY:-$(openssl rand -hex 32)}"
  echo "LOADTEST_DEVICE_JWT_SECRET=${LOADTEST_DEVICE_JWT_SECRET:-$(openssl rand -hex 32)}"
  echo "LOADTEST_API_IMAGE=$LOADTEST_API_IMAGE"
  # P0-7 #2 A/B knob — `off` runs the BEFORE arm (manifest-bound delivery)
  # from the same image, so the two arms differ in exactly one variable.
  echo "LOADTEST_EMERGENCY_REV_RAISE=${LOADTEST_EMERGENCY_REV_RAISE:-on}"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.loadtest.yml -p venueos-loadtest)
export LOADTEST_API_URL="${LOADTEST_API_URL:-http://127.0.0.1:58080}"
export LOADTEST_DATABASE_URL="${LOADTEST_DATABASE_URL:-postgresql://venueos:loadtest_local_only@127.0.0.1:55432/venueos_loadtest}"

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo "[loadtest] --keep: leaving the stack up. Tear down with:"
    echo "           docker compose -f docker-compose.loadtest.yml -p venueos-loadtest down -v"
  else
    echo "[loadtest] tearing down the disposable stack…"
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! docker image inspect "$LOADTEST_API_IMAGE" >/dev/null 2>&1; then
  echo "[loadtest] building $LOADTEST_API_IMAGE from this repo's Dockerfile (first run only)…"
  docker build -t "$LOADTEST_API_IMAGE" -f Dockerfile .
fi

echo "[loadtest] starting postgres + redis (55432 / 56379)…"
"${COMPOSE[@]}" up -d --wait pg redis

# Schema. NOT `prisma migrate deploy` — see FINDING LT-1 in
# docker-compose.loadtest.yml: the committed migration chain cannot build this
# schema from an empty database. `db push` materialises schema.prisma directly,
# which is what the API's generated client expects anyway.
echo "[loadtest] provisioning the schema (prisma db push)…"
"${COMPOSE[@]}" run --rm --no-deps \
  --entrypoint /app/packages/database/node_modules/.bin/prisma \
  api db push --schema=packages/database/prisma/schema.prisma --accept-data-loss --skip-generate

echo "[loadtest] starting the API (58080)…"
"${COMPOSE[@]}" up -d --wait api

echo "[loadtest] seeding the fleet…"
node scripts/loadtest/seed.mjs

echo "[loadtest] running the measurement…"
node scripts/loadtest/loadtest.mjs
