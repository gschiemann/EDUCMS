-- 2026-08-25 — page-bundle provenance on the Screen row.
--
-- The player reports the commit SHA of the web bundle it is actually running
-- on the render-proof POST it already makes, so the dashboard can tell an
-- operator "this panel is still on an older page bundle" instead of leaving
-- freshly-fixed code looking like a dead button.
--
-- Additive-only per the V1 migration rule: two nullable columns, no default,
-- no backfill, no index (they are read from the already-selected Screen row
-- on the fleet list, never filtered on). Both are registered in
-- SCREEN_TELEMETRY_ONLY_FIELDS so the render-proof write that sets them
-- still does NOT bust the manifest hot cache.
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_bundle_sha" TEXT;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_bundle_sha_at" TIMESTAMP(3);
