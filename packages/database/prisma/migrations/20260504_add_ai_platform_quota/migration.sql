-- 2026-05-04 — Per-tenant monthly cap for platform-paid AI usage.
--
-- Operator chose the Canva/OptiSigns/Notion model: platform pays for
-- AI by default, capped at N generations per tenant per month, with
-- BYOK as a hidden "upgrade for unlimited" path admins can self-serve.
--
-- Two columns track the tenant's current month + count:
--
--   ai_platform_usage_month  — 'YYYY-MM' string. When the current
--                              UTC month doesn't match, the count is
--                              treated as 0 (auto-reset on month
--                              rollover, no cron needed).
--
--   ai_platform_usage_count  — Integer. Bumped atomically after each
--                              successful platform-paid call. Tenants
--                              on BYOK (ai_key_encrypted set) bypass
--                              both the cap check and the increment —
--                              their cost, their unlimited.
--
-- Cap value lives in AI_FREE_TIER_CAP env var (default 200). NOT
-- stored on the row so we can tune the global default without a
-- migration. Future per-tier caps would key off License.tier instead.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "ai_platform_usage_month" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_platform_usage_count" INTEGER NOT NULL DEFAULT 0;
