-- 2026-09-01 — Settings Command Center, Brand & appearance.
-- "Application appearance": 'branded' (the tenant palette paints dashboard
-- chrome) vs 'neutral' (brand identity stays — logo, name, favicon, fonts —
-- but the chrome color overrides are not injected).
--
-- Additive + nullable on purpose: NULL is a real value meaning 'branded', so
-- every existing row renders exactly as it did before and no backfill runs.
ALTER TABLE "tenant_branding" ADD COLUMN "appearance_mode" TEXT;
