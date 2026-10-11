-- 2026-10-10 — Emergency DRILL content PER SCREEN.
--
-- Owner's rule: "we should have custom location content available for drills
-- too — just duplicate everything for live emergencies to drill ones." The
-- Sprint-8b per-screen emergency columns (`emergency_<type>[_portrait]_
-- {playlist_id,asset_url}`, 24 of them) get an exact DRILL mirror
-- (`drill_<type>[_portrait]_{playlist_id,asset_url}`). During a drill a
-- screen in location-based mode plays its own drill content for the type,
-- then the tenant's drill content, then the live precedence — always under
-- the DRILL banner.
--
-- SQL generated with:
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS) per CLAUDE.md, because dev databases
-- take the same shape through `pnpm db:push`.
--
-- ADDITIVE AND NON-DESTRUCTIVE: 24 NULLABLE text columns with no default —
-- catalogue-only in Postgres, instant at any row count. NULL = "no drill
-- content for this screen and type", which is what every existing screen
-- reads, so nothing a screen shows today changes. Nothing is dropped,
-- renamed or rewritten.
--
-- `lock_timeout`: `screens` is the table every manifest poll, heartbeat and
-- register reads. If a long transaction holds it, a waiting ALTER would queue
-- the fleet's polls behind it. Five seconds, then fail — railway-start
-- retries, and the previous deployment keeps serving until migrate succeeds.

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "drill_evacuate_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_evacuate_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_evacuate_portrait_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_evacuate_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_hold_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_hold_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_hold_portrait_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_hold_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_lockdown_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_lockdown_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_lockdown_portrait_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_lockdown_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_medical_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_medical_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_medical_portrait_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_medical_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_secure_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_secure_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_secure_portrait_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_secure_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_weather_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_weather_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_weather_portrait_asset_url" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_weather_portrait_playlist_id" TEXT;
