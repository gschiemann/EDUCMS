-- 2026-10-31 — Broadcast to a hand-picked set of screens.
--
-- ADDITIVE: one new column on emergency_messages holding the screen ids of a
-- `scope_type = 'devices'` send. NOT NULL with a constant empty-array default:
-- a catalogue-only change in Postgres 11+ (no table rewrite), and every
-- existing row reads as "no screen set" — today's behaviour.
--
-- Small table, but the device poll reads it every ~10 s per screen, so fail
-- fast instead of queueing the fleet behind a lock.
--
-- IDEMPOTENT (IF NOT EXISTS) because dev databases may already have the shape
-- from `pnpm db:push`.
SET lock_timeout = '5s';

ALTER TABLE "emergency_messages"
  ADD COLUMN IF NOT EXISTS "screen_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
