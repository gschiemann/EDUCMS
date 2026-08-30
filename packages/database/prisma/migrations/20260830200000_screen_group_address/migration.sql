-- 2026-08-30 — group-level address for the fleet map (operator request).
-- Additive-only: three nullable columns, zero behavior change until set.
ALTER TABLE "screen_groups" ADD COLUMN "address" TEXT;
ALTER TABLE "screen_groups" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "screen_groups" ADD COLUMN "longitude" DOUBLE PRECISION;
