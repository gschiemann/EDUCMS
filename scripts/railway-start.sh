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
# Use the binary directly (avoids pnpm-workspace path quirks). The
# Dockerfile's runner stage copies node_modules from the builder, so
# this path is guaranteed to exist.
if [ -x "./node_modules/.bin/prisma" ]; then
  ./node_modules/.bin/prisma migrate deploy --schema=packages/database/prisma/schema.prisma
  echo "[railway-start] migrations applied successfully"
else
  echo "[railway-start] WARN: prisma binary not found at ./node_modules/.bin/prisma"
  echo "  Falling back to npx (network roundtrip)"
  npx --no prisma migrate deploy --schema=packages/database/prisma/schema.prisma
fi

echo "[railway-start] step 3/3 — booting the API"
exec node apps/api/dist/main.js
