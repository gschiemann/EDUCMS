-- Per-tenant AI brand voice (Slice 1b, 2026-06-16). Additive nullable
-- column; existing rows stay NULL (no brand voice → only the per-vertical
-- voice clause applies, identical to today). `IF NOT EXISTS` so a re-apply
-- on a DB that already has the column is a no-op.
ALTER TABLE "tenant_branding" ADD COLUMN IF NOT EXISTS "brand_voice" TEXT;
