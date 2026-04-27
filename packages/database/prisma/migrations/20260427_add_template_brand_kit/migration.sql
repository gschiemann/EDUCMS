-- AlterTable: add per-template brand kit (palette, logo, fonts).
-- Distinct from tenant-wide TenantBranding (which themes the CMS
-- dashboard chrome). Operators paste a school URL inside the
-- template builder; the result lands here, NOT in TenantBranding.
ALTER TABLE "templates" ADD COLUMN "brand_kit" JSONB;
