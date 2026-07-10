-- Durable revocation backstop (2026-07-10 — external-audit fix).
--
-- Finding: RedisService.sismember returns false when Redis is
-- unavailable (fail-OPEN), and the per-user "invalid-before" epoch
-- (P1-1) is Redis-only. During a Redis outage a previously-revoked
-- token (logout, role downgrade, user deletion) passes the revocation
-- check until Redis returns. In a life-safety product revocation must
-- survive dependency failure.
--
-- This table is the Postgres MIRROR of every revocation write:
--   kind = 'jti'                 → key = sha256 hex of the exact bearer
--                                  token (never the raw token — a DB
--                                  dump must not contain live
--                                  credentials), value unused.
--   kind = 'user_invalid_before' → key = userId, value = epoch seconds;
--                                  any user JWT with iat < value is
--                                  rejected.
--
-- Redis stays the PRIMARY hot-path store; this table is read ONLY on
-- the Redis-unavailable fallback path in RedisService. expires_at
-- mirrors the 30-day Redis TTL (rememberMe ceiling) — past it the JWT
-- itself has expired, so expired rows are inert and prunable.
--
-- Additive-only — new table, no existing column/row touched. Safe on
-- the live pilot database with zero backfill needed. `IF NOT EXISTS`
-- guards throughout so a re-apply is a no-op (house style, matching
-- 20260702120000_add_template_versions).

CREATE TABLE IF NOT EXISTS "revoked_credentials" (
  "id"         TEXT PRIMARY KEY,
  "kind"       TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "value"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3)
);

-- The fallback lookup is exactly (kind, key) → row; unique also makes
-- the dual-write an idempotent upsert.
CREATE UNIQUE INDEX IF NOT EXISTS "revoked_credentials_kind_key_key"
  ON "revoked_credentials"("kind", "key");

-- Opportunistic pruning of expired rows without a seq scan.
CREATE INDEX IF NOT EXISTS "revoked_credentials_expires_at_idx"
  ON "revoked_credentials"("expires_at");
