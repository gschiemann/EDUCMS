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
  # New approach: try paths in order, then the pnpm workspace
  # invocation which always works (matches what `pnpm db:deploy`
  # does locally). Set -e fails fast if every path fails.
  MIGRATED=""
  for candidate in \
    "./packages/database/node_modules/.bin/prisma" \
    "./node_modules/.bin/prisma" \
    "./node_modules/prisma/build/index.js"; do
    if [ -x "$candidate" ] || [ -f "$candidate" ]; then
      echo "[railway-start] running migrations via $candidate"
      if [ "$candidate" = "./node_modules/prisma/build/index.js" ]; then
        node "$candidate" migrate deploy --schema=packages/database/prisma/schema.prisma
      else
        "$candidate" migrate deploy --schema=packages/database/prisma/schema.prisma
      fi
      MIGRATED=1
      break
    fi
  done
  if [ -z "$MIGRATED" ]; then
    echo "[railway-start] direct prisma binary not found — using pnpm workspace runner"
    # corepack sets up pnpm in the runner stage; this is the same
    # invocation `pnpm db:deploy` uses locally.
    pnpm --filter @cms/database run db:deploy
  fi
  echo "[railway-start] migrations applied successfully"
fi

echo "[railway-start] step 3/3 — booting the API"
exec node apps/api/dist/main.js
