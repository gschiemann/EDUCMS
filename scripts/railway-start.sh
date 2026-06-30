#!/bin/sh
# Railway boot script.
#
# 2026-05-04 — operator hit "tables don't exist on the DB yet" errors
# repeatedly because Railway's prior startCommand was `node apps/api/
# dist/main.js` with no migrate step. First fix attempt put `pnpm
# --filter @cms/database run db:deploy && node ...` directly in
# railway.json — that deploy went in_progress → inactive in 17 seconds
# (silent boot failure, no useful Railway log surface). Possible
# causes: pnpm not finding the workspace, DATABASE_URL not yet set,
# || semantics inside Railway's startCommand parser.
#
# This script is explicit + verbose. Each step echoes its status so
# Railway's runtime log shows EXACTLY where it died if it dies. Safe
# to re-run on every boot — `prisma migrate deploy` is idempotent.
#
# IMPORTANT: kept as POSIX sh (not bash) because Alpine's default
# shell is ash. No bashisms (no [[ ]], no ${var:-default}, etc).

set -e  # fail fast — we WANT a noisy boot crash if migrations fail

echo "[railway-start] step 1/3 — boot environment check"
echo "  node:          $(node --version 2>&1 || echo MISSING)"
echo "  database url:  $(if [ -n "$DATABASE_URL" ]; then echo set; else echo MISSING; fi)"
echo "  direct url:    $(if [ -n "$DIRECT_URL" ]; then echo set; else echo MISSING; fi)"
echo "  pwd:           $(pwd)"

# Fail fast with a clear message if DATABASE_URL is unset. Better
# than letting prisma emit its generic "no datasource" message.
if [ -z "$DATABASE_URL" ]; then
  echo "[railway-start] FATAL: DATABASE_URL env var is not set."
  echo "  Add it on Railway: Settings → Variables → DATABASE_URL"
  exit 1
fi

echo "[railway-start] step 2/3 — applying pending Prisma migrations"

# CI smoke test escape hatch. The deploy-reliability docker-build job
# boots this image with a FAKE DATABASE_URL pointing at 127.0.0.1
# (no postgres) just to verify the API binary loads + listens. We
# don't want to fail that test on a migrate-can't-connect — it's
# expected. Real Railway runs WITHOUT this var, so migrations apply
# normally there.
if [ "$SKIP_MIGRATE" = "true" ] || [ "$SKIP_MIGRATE" = "1" ]; then
  echo "[railway-start] SKIP_MIGRATE=$SKIP_MIGRATE set — skipping prisma migrate deploy"
else
  # 2026-05-05 — fixing crash loop on prod. Prior implementation
  # checked ./node_modules/.bin/prisma which doesn't exist with
  # pnpm's hoisted layout (binaries live under
  # node_modules/.pnpm/prisma@*/node_modules/.bin/prisma and pnpm
  # creates dispatcher shims at packages/database/node_modules/.bin/.
  # Then the npx fallback used `--no` which is invalid syntax (real
  # flag is `--no-install`), so it fell through to network resolution
  # and failed with `sh: prisma: not found` because npm/npx isn't
  # installed in the Alpine runner — corepack only sets up pnpm.
  #
  # Try paths in order, then the pnpm workspace invocation which
  # always works (matches what `pnpm db:deploy` does locally).
  #
  # 2026-06-30 — RESILIENCE: a transient Supabase pooler blip at boot
  # made `migrate deploy` fail P1001 ("can't reach database server");
  # with set -e + one attempt the container died and Railway exhausted
  # its 10 fast restarts inside the ~2-min outage window → the WHOLE
  # deploy went FAILED (operator saw "railway throwing an error") even
  # though the code + DB were fine. Now we RETRY with backoff (6 tries,
  # 15/30/45/60/75s ≈ 3.75 min budget) so a brief pooler outage is
  # survived, while a persistent failure still exits non-zero (loud)
  # after the budget. `migrate deploy` is idempotent, so re-running is
  # safe. set -e is toggled OFF only around each attempt so we can
  # capture the exit code instead of dying on the first failure.
  attempt=1
  max=6
  migrated=""
  while [ "$attempt" -le "$max" ]; do
    echo "[railway-start] migrate attempt $attempt/$max"
    set +e
    if [ -x "./packages/database/node_modules/.bin/prisma" ]; then
      ./packages/database/node_modules/.bin/prisma migrate deploy --schema=packages/database/prisma/schema.prisma
      rc=$?
    elif [ -x "./node_modules/.bin/prisma" ]; then
      ./node_modules/.bin/prisma migrate deploy --schema=packages/database/prisma/schema.prisma
      rc=$?
    elif [ -f "./node_modules/prisma/build/index.js" ]; then
      node ./node_modules/prisma/build/index.js migrate deploy --schema=packages/database/prisma/schema.prisma
      rc=$?
    else
      echo "[railway-start] direct prisma binary not found — using pnpm workspace runner"
      pnpm --filter @cms/database run db:deploy
      rc=$?
    fi
    set -e
    if [ "$rc" -eq 0 ]; then
      migrated=1
      break
    fi
    if [ "$attempt" -lt "$max" ]; then
      wait_s=$((attempt * 15))
      echo "[railway-start] migrate attempt $attempt failed (rc=$rc) — likely a transient DB blip; retrying in ${wait_s}s"
      sleep "$wait_s"
    fi
    attempt=$((attempt + 1))
  done
  if [ -z "$migrated" ]; then
    echo "[railway-start] FATAL: prisma migrate deploy failed after $max attempts"
    exit 1
  fi
  echo "[railway-start] migrations applied successfully"
fi

echo "[railway-start] step 3/3 — booting the API"
exec node apps/api/dist/main.js
