-- ═══════════════════════════════════════════════════════════════════════
-- DISASTER-RECOVERY REPAIR (2026-09-04) — make the history buildable from
-- an EMPTY database.
--
-- THE BUG. `prisma migrate deploy` against a fresh Postgres died on
-- `20260423_hot_path_indexes`:
--
--     ERROR: column "folder_id" does not exist
--
-- and more statements in later migrations are the same shape. The objects
-- those migrations index / alter were never created by a migration at all:
-- production was `db push`-ed and then `migrate resolve`-d, so the history
-- has been unrunnable from zero since 2026-04-23 and nobody hit it because
-- nobody has ever restored from scratch. A backup you cannot restore is not
-- a backup.
--
-- WHY A NEW MIGRATION INSTEAD OF EDITING THE OLD ONE. Editing an applied
-- migration changes its checksum, which `migrate deploy` reports against
-- the recorded `_prisma_migrations` row on the very next production deploy
-- and would need a manual `migrate resolve` on a live database to clear.
-- This file is purely ADDITIVE and its name sorts BEFORE
-- `20260423_hot_path_indexes`, so:
--
--   • on an EMPTY database it runs first and the historical migration then
--     finds what it expects;
--   • on PRODUCTION every statement is a guarded no-op (the objects have
--     existed since the `db push`), so applying it changes nothing and
--     needs no operator action.
--
-- Every statement is `IF NOT EXISTS` / catalogue-guarded and therefore
-- re-runnable. The definitions mirror `schema.prisma` exactly, so the
-- database this history builds is the database the client expects.
-- ═══════════════════════════════════════════════════════════════════════

-- ── AssetFolder + Asset.folder_id ────────────────────────────────────
-- `20260423_hot_path_indexes` creates assets_tenant_id_folder_id_idx.
CREATE TABLE IF NOT EXISTS "asset_folders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_folders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "folder_id" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_folders_tenant_id_fkey') THEN
        ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_tenant_id_fkey"
            FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_folders_parent_id_fkey') THEN
        ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_parent_id_fkey"
            FOREIGN KEY ("parent_id") REFERENCES "asset_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_folder_id_fkey') THEN
        ALTER TABLE "assets" ADD CONSTRAINT "assets_folder_id_fkey"
            FOREIGN KEY ("folder_id") REFERENCES "asset_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- ── Template.vertical ────────────────────────────────────────────────
-- `20260423_hot_path_indexes` creates
-- templates_is_system_status_vertical_updated_at_idx.
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "vertical" TEXT;

-- ── Tenant.slug ──────────────────────────────────────────────────────
-- `20260504_chardon_seat_bump` and `20260504_bump_all_pilot_seats` look a
-- tenant up BY SLUG. NOT NULL is safe: on an empty database there are no
-- rows to violate it, and on production the column already exists.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "slug" TEXT NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants"("slug");

-- ── TenantBranding ───────────────────────────────────────────────────
-- `20260620000000_add_brand_voice` and
-- `20260902090000_tenant_branding_appearance_mode` ALTER this table; nothing
-- ever created it. Deliberately WITHOUT `brand_voice` / `appearance_mode` —
-- those two are what the later migrations add, and one of them is a bare
-- `ADD COLUMN` that would fail on a duplicate.
CREATE TABLE IF NOT EXISTS "tenant_branding" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "display_name" TEXT,
    "tagline" TEXT,
    "logo_url" TEXT,
    "logo_svg_inline" TEXT,
    "favicon_url" TEXT,
    "og_image_url" TEXT,
    "palette" JSONB,
    "font_heading" TEXT,
    "font_body" TEXT,
    "font_heading_url" TEXT,
    "font_body_url" TEXT,
    "hero_images" JSONB,
    "source_url" TEXT,
    "scraped_at" TIMESTAMP(3),
    "confidence_scores" JSONB,
    "raw_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_branding_tenant_id_key" ON "tenant_branding"("tenant_id");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_branding_tenant_id_fkey') THEN
        ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_fkey"
            FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
