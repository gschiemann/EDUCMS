-- 2026-10-18 — Tracked APK pushes (unattended-updates program, piece 3).
--
-- An operator's "Send update" was fire-and-forget: the API answered `install`
-- on every update check for 24 hours, then cleared the push without a trace.
-- On 2026-10-15/16 an Android 9 panel that needs a person to tap Install
-- downloaded the same 1.1.29 APK 48 times that way (once per 30-minute check)
-- while the dashboard said "Updating…". These columns give a push its own
-- state, so the server can stop offering an install that cannot land
-- unattended and the dashboard can say why — and offer Cancel (logic:
-- apps/api/src/player-ota/push-tracking.ts).
--
-- Generated with `prisma migrate diff --from-schema-datamodel <old>
-- --to-schema-datamodel <new> --script`, then made idempotent by hand (dev
-- databases take the shape through `pnpm db:push` first).
--
-- Named 2026-10-18: the parked draft of this file used 20261017180000, which
-- is already 20261017180000_screen_file_playback_excluded_samples on master.
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   * six NULLABLE columns with no default, and one INTEGER NOT NULL DEFAULT 0.
--     A constant default is a catalogue-only change on Postgres 11+ — no table
--     rewrite at any row count — and every existing screen reads as "no push
--     state recorded", which is exactly today's behaviour.
--   * nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE takes a brief ACCESS EXCLUSIVE lock on "screens",
-- the table every manifest poll, heartbeat and register reads. If a long
-- transaction holds it, a waiting lock request queues the whole fleet behind
-- it. Five seconds, then fail — railway-start retries, and a failed migrate
-- never goes healthy, so Railway keeps the previous deployment serving.

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "force_apk_update_hold" TEXT,
  ADD COLUMN IF NOT EXISTS "force_apk_update_hold_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "force_apk_update_hold_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "force_apk_update_last_offer_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "force_apk_update_offer_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "force_apk_update_target_version" TEXT,
  ADD COLUMN IF NOT EXISTS "force_apk_update_target_version_code" INTEGER;
