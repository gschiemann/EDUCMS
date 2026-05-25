-- Add address + lat/lng to tenants for Sprint 8's fleet map view.
-- Purely additive: every column is nullable, existing rows continue
-- to load with NULL meaning "no address provided yet."

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
