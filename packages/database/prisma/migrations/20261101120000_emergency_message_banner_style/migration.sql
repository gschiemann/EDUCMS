-- 2026-11-01 — Broadcast banner colour and scrolling options.
--
-- ADDITIVE: one nullable JSONB column on emergency_messages holding the
-- sender's banner choice ({ color, mode, speed }). Nullable with no default:
-- a catalogue-only change in Postgres (no table rewrite), and every existing
-- row reads as "no options" - exactly today's look.
--
-- The device poll reads this table every ~10 s per screen, so fail fast
-- instead of queueing the fleet behind a lock.
--
-- IDEMPOTENT (IF NOT EXISTS) because dev databases may already have the shape
-- from `pnpm db:push`.
SET lock_timeout = '5s';

ALTER TABLE "emergency_messages"
  ADD COLUMN IF NOT EXISTS "banner_style" JSONB;
