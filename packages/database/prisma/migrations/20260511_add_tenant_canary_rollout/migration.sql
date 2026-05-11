-- 2026-05-11 — Phase B canary rollout.
--
-- Adds 4 columns to tenants for staged APK rollouts. Default
-- canary_fleet_percent=100 means existing tenants get the SAME
-- behavior as before (full rollout, no canary). Operators opt into
-- canary by lowering the percent.
--
-- Why this matters: today, hitting "Push update" on a tenant fans the
-- new APK to 100% of the fleet at once. If the build is bad (Goodview
-- ROM incompatibility, BAL regression, signature mismatch) ALL kiosks
-- brick in one push. Staged rollout means at most `canary_fleet_percent`
-- of screens hit the bad build before the soak timer + INSTALL-ERROR
-- detection halts the promotion.
--
-- All columns nullable / defaulted so existing rows pick up the new
-- behavior cleanly without a backfill step.
--
--   canary_fleet_percent  Int     default 100  — 0..100 cohort %
--   canary_set_at         Time              — when % was last lowered
--                                              (starts the soak window)
--   canary_auto_promote   Bool    default TRUE — auto-promote after soak
--   canary_soak_hours     Int     default 24   — how long to soak

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "canary_fleet_percent" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "canary_set_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "canary_auto_promote" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "canary_soak_hours" INTEGER NOT NULL DEFAULT 24;

-- Bound canary_fleet_percent to [0,100] so a runaway client can't
-- write 250 or -5 and break the hash-cohort math downstream.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_canary_fleet_percent_range'
  ) THEN
    ALTER TABLE "tenants"
      ADD CONSTRAINT "tenants_canary_fleet_percent_range"
      CHECK ("canary_fleet_percent" >= 0 AND "canary_fleet_percent" <= 100);
  END IF;
END $$;

-- canary_soak_hours bounded too — 1 hour minimum (anything shorter
-- defeats the purpose), 720 hours max (30 days, generous for slow
-- districts that want to soak through a school break).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_canary_soak_hours_range'
  ) THEN
    ALTER TABLE "tenants"
      ADD CONSTRAINT "tenants_canary_soak_hours_range"
      CHECK ("canary_soak_hours" >= 1 AND "canary_soak_hours" <= 720);
  END IF;
END $$;
