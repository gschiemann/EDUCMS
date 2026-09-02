-- 2026-09-01 — server-side emergency enablement (handoff §19.5).
-- Replaces the browser-localStorage gate `emergencyEnabled:${tenantId}`.
--
-- NULLABLE with NO default and NO backfill on purpose: NULL means "never
-- stated, use the vertical default" (K12 on, every other vertical off) —
-- which is exactly what the old client-side gate defaulted to. Every
-- existing tenant therefore behaves exactly as it did before this shipped.
ALTER TABLE "tenants" ADD COLUMN "emergency_enabled" BOOLEAN;
