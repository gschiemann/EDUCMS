-- P0-2 (2026-09-02) — boot + registration diagnostic reported by the APK.
--
-- ADDITIVE AND NULLABLE ONLY. No default, no backfill, no index: every
-- existing row stays valid, and an API deployed before this migration is
-- applied simply logs its write failure (the endpoint catches) rather than
-- 500-ing. Rollback is three DROP COLUMNs.
--
-- All three columns are listed in SCREEN_TELEMETRY_ONLY_FIELDS in
-- apps/api/src/screens/manifest-hot-cache.ts, so writing them does NOT bump
-- the process-wide manifest content rev.
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_boot_diag_at" TIMESTAMP(3);
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_boot_diag_reason" TEXT;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_boot_diag_detail" TEXT;
