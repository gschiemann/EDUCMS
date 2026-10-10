-- 2026-10-10 — Emergency DRILLS: drill content per incident type, and a flag
-- on the two places an active alert lives.
--
-- A drill plays DIFFERENT content from a live alert of the same type and the
-- screen paints a "DRILL — THIS IS A DRILL" banner over it. Content is one
-- protected playlist per incident type per orientation on the tenant
-- (`drill_*_playlist_id`, the mirror of `panic_*_playlist_id`); the flag says
-- whether the ACTIVE alert is a drill — `tenants.emergency_is_drill` for the
-- tenant-wide alert, `screen_emergency_overrides.is_drill` for a group /
-- one-screen alert — and the manifest carries it as `isDrill`.
--
-- SQL generated with:
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS) per CLAUDE.md, because dev databases
-- take the same shape through `pnpm db:push`.
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   * twelve NULLABLE text columns with no default — catalogue-only in
--     Postgres, instant at any row count. NULL = no drill content for that
--     type; a drill then plays the type's LIVE content (and still shows the
--     drill banner);
--   * two BOOLEAN NOT NULL DEFAULT false columns. Every existing row reads
--     false = "a live alert", which is exactly what every alert before this
--     migration was. Postgres ≥ 11 adds a constant default without a table
--     rewrite, so this is catalogue-only too;
--   * nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: `tenants` is read by every manifest poll and
-- `screen_emergency_overrides` by every emergency branch. If a long
-- transaction holds either, a waiting ALTER would queue the fleet's polls
-- behind it. Five seconds, then fail — railway-start retries, and the
-- previous deployment keeps serving until migrate succeeds.

SET lock_timeout = '5s';

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "drill_evacuate_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_evacuate_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_hold_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_hold_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_lockdown_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_lockdown_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_medical_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_medical_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_secure_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_secure_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_weather_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "drill_weather_portrait_playlist_id" TEXT,
  ADD COLUMN IF NOT EXISTS "emergency_is_drill" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "screen_emergency_overrides"
  ADD COLUMN IF NOT EXISTS "is_drill" BOOLEAN NOT NULL DEFAULT false;
