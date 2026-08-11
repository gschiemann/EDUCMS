#!/usr/bin/env bash
# Build entrypoint (local, CI, and Vercel).
# On Vercel only: print which DB env vars exist, then best-effort apply the
# Prisma schema (preferring a non-pooled connection — DDL through PgBouncer
# is unreliable). The schema push is non-fatal so the site can boot for
# diagnostics even while database wiring is being sorted out.
set -e

prisma generate

if [ -n "$VERCEL" ]; then
  echo "=== twin-oaks build diagnostics ==="
  echo "Database-related env vars present (names only):"
  node -e "const k=Object.keys(process.env).filter(k=>/DATABASE|POSTGRES|NEON|^PG/.test(k)).sort(); console.log(k.length? k.join('\n') : '(none found)')"
  echo "==================================="

  PUSH_URL="${DATABASE_URL_UNPOOLED:-${DATABASE_URL_NON_POOLING:-$DATABASE_URL}}"
  if [ -z "$PUSH_URL" ]; then
    echo "WARN: no database URL found — skipping schema push. Pages that need the DB will error until the Neon store is connected with prefix DATABASE."
  else
    DATABASE_URL="$PUSH_URL" prisma db push || \
      echo "WARN: prisma db push failed — continuing the build so the site can boot; see error above."
  fi
fi

next build
