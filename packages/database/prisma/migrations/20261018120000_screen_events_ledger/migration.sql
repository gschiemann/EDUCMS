-- 2026-10-18 — The interruption ledger (player rock-solid plan §4B / §7).
--
-- The launch gate reads "interruptions per launch screen, 72 h = 0 (emergency
-- drills excluded)". Each interruption of content on a screen — a page reload,
-- an app relaunch, a native video engine stop or swap, a rendition swap, a
-- demotion, an OTA step, an emergency — becomes one row in the EXISTING
-- per-screen timeline table `screen_events` (2026-08-31), with why it happened
-- (`cause`), who decided it (`source`), the native session it belongs to and
-- the Player build at the time. Vocabulary and writers:
-- apps/api/src/screens/events/screen-events.ts.
--
-- Generated with `prisma migrate diff --from-schema-datamodel <old>
-- --to-schema-datamodel <new> --script`, then made idempotent by hand (dev
-- databases take the shape through `pnpm db:push` first).
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   * four NULLABLE columns with no default — a catalogue-only change, no
--     table rewrite at any row count. Every existing row reads as a timeline
--     row with no ledger fields, which is exactly what it is.
--   * nothing is dropped, renamed or rewritten; no index is added (the
--     ledger reads ride the existing (screen_id, created_at) index).
--
-- `lock_timeout`: ALTER TABLE takes a brief ACCESS EXCLUSIVE lock. Five
-- seconds, then fail — railway-start retries, and a failed migrate never goes
-- healthy, so Railway keeps the previous deployment serving.

SET lock_timeout = '5s';

ALTER TABLE "screen_events"
  ADD COLUMN IF NOT EXISTS "cause" TEXT,
  ADD COLUMN IF NOT EXISTS "session_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT,
  ADD COLUMN IF NOT EXISTS "version_code" INTEGER;
