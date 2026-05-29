-- Menu management at scale (2026-05-29).
-- See docs/research/2026-05-29-menu-mgmt-scale/.
--
-- Adds the design-once catalog + per-location override ("price book")
-- data model that unblocks a 50+-location customer with their own menus
-- and POS integration, self-serve:
--
--   menu_catalogs           — one "design once" menu per chain tenant.
--   menu_categories         — sections (optional daypart binding).
--   menu_items              — items with a DEFAULT price (the inherited base).
--   menu_location_overrides — the price-book row: per-(location, item)
--                             price override (null=inherit) + availability
--                             / 86 / sold-out-until / hidden flags.
--   pos_locations           — a POS-provider-side location (Square
--                             location_id) mapped to one of our child
--                             location tenants.
--   dayparts                — VenueOS-owned dayparting (Square has none).
--   menu_sync_cursors       — Square delta-sync watermark per connection.
--
-- Plus one nullable column on `screens` (`pos_location_id`) so a screen's
-- menu board resolves the right per-location prices, and a nullable
-- reverse relation on pos_provider_connections (via pos_locations).
--
-- PURELY ADDITIVE — new tables + one nullable column + nullable FKs. No
-- existing column changes, no data backfill, no query-pattern change.
-- Live-pilot-safe: a wiped catalog/item cascades cleanly; location
-- overrides are scoped by location_tenant_id with no FK on it (a location
-- tenant delete won't surprise-cascade the price book). Safe to apply to
-- the live pilot tenant without risk of data loss.

-- ── menu_catalogs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "menu_catalogs" (
  "id"            TEXT PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "connection_id" TEXT,
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "menu_catalogs_tenant_id_is_active_idx" ON "menu_catalogs" ("tenant_id", "is_active");
CREATE INDEX IF NOT EXISTS "menu_catalogs_connection_id_idx" ON "menu_catalogs" ("connection_id");

-- ── dayparts ─────────────────────────────────────────────────────────
-- (created before menu_categories so the FK target exists)
CREATE TABLE IF NOT EXISTS "dayparts" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "days_of_week" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  "time_start"   TEXT NOT NULL,
  "time_end"     TEXT NOT NULL,
  "timezone"     TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "dayparts_tenant_id_idx" ON "dayparts" ("tenant_id");

-- ── menu_categories ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "menu_categories" (
  "id"         TEXT PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "catalog_id" TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "daypart_id" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "menu_categories_catalog_id_sort_order_idx" ON "menu_categories" ("catalog_id", "sort_order");
CREATE INDEX IF NOT EXISTS "menu_categories_tenant_id_idx" ON "menu_categories" ("tenant_id");
CREATE INDEX IF NOT EXISTS "menu_categories_daypart_id_idx" ON "menu_categories" ("daypart_id");

-- ── menu_items ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "menu_items" (
  "id"                  TEXT PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "catalog_id"          TEXT NOT NULL,
  "category_id"         TEXT,
  "external_id"         TEXT,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "default_price_cents" INTEGER NOT NULL,
  "image_url"           TEXT,
  "allergens"           TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tags"                TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sort_order"          INTEGER NOT NULL DEFAULT 0,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "menu_items_catalog_id_external_id_key" ON "menu_items" ("catalog_id", "external_id");
CREATE INDEX IF NOT EXISTS "menu_items_tenant_id_idx" ON "menu_items" ("tenant_id");
CREATE INDEX IF NOT EXISTS "menu_items_catalog_id_sort_order_idx" ON "menu_items" ("catalog_id", "sort_order");
CREATE INDEX IF NOT EXISTS "menu_items_category_id_idx" ON "menu_items" ("category_id");
CREATE INDEX IF NOT EXISTS "menu_items_external_id_idx" ON "menu_items" ("external_id");

-- ── menu_location_overrides ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "menu_location_overrides" (
  "id"                 TEXT PRIMARY KEY,
  "tenant_id"          TEXT NOT NULL,
  "location_tenant_id" TEXT NOT NULL,
  "menu_item_id"       TEXT NOT NULL,
  "price_cents"        INTEGER,
  "is_available"       BOOLEAN NOT NULL DEFAULT true,
  "sold_out_until"     TIMESTAMP(3),
  "is_hidden"          BOOLEAN NOT NULL DEFAULT false,
  "source"             TEXT NOT NULL DEFAULT 'manual',
  "updated_at"         TIMESTAMP(3) NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "menu_location_overrides_location_tenant_id_menu_item_id_key" ON "menu_location_overrides" ("location_tenant_id", "menu_item_id");
CREATE INDEX IF NOT EXISTS "menu_location_overrides_tenant_id_idx" ON "menu_location_overrides" ("tenant_id");
CREATE INDEX IF NOT EXISTS "menu_location_overrides_menu_item_id_idx" ON "menu_location_overrides" ("menu_item_id");
CREATE INDEX IF NOT EXISTS "menu_location_overrides_location_tenant_id_idx" ON "menu_location_overrides" ("location_tenant_id");

-- ── pos_locations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pos_locations" (
  "id"                 TEXT PRIMARY KEY,
  "tenant_id"          TEXT NOT NULL,
  "connection_id"      TEXT NOT NULL,
  "external_id"        TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "address"            TEXT,
  "location_tenant_id" TEXT,
  "is_active"          BOOLEAN NOT NULL DEFAULT true,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "pos_locations_connection_id_external_id_key" ON "pos_locations" ("connection_id", "external_id");
CREATE INDEX IF NOT EXISTS "pos_locations_tenant_id_idx" ON "pos_locations" ("tenant_id");
CREATE INDEX IF NOT EXISTS "pos_locations_location_tenant_id_idx" ON "pos_locations" ("location_tenant_id");

-- ── menu_sync_cursors ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "menu_sync_cursors" (
  "connection_id"        TEXT PRIMARY KEY,
  "last_catalog_version" TEXT,
  "last_synced_at"       TIMESTAMP(3),
  "updated_at"           TIMESTAMP(3) NOT NULL
);

-- ── screens.pos_location_id (nullable, additive) ─────────────────────
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "pos_location_id" TEXT;

-- ── Foreign keys ─────────────────────────────────────────────────────
-- menu_categories → menu_catalogs (cascade) + dayparts (set null)
ALTER TABLE "menu_categories"
  ADD CONSTRAINT "menu_categories_catalog_id_fkey"
  FOREIGN KEY ("catalog_id") REFERENCES "menu_catalogs" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_categories"
  ADD CONSTRAINT "menu_categories_daypart_id_fkey"
  FOREIGN KEY ("daypart_id") REFERENCES "dayparts" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- menu_items → menu_catalogs (cascade) + menu_categories (set null)
ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_catalog_id_fkey"
  FOREIGN KEY ("catalog_id") REFERENCES "menu_catalogs" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "menu_categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- menu_location_overrides → menu_items (cascade)
ALTER TABLE "menu_location_overrides"
  ADD CONSTRAINT "menu_location_overrides_menu_item_id_fkey"
  FOREIGN KEY ("menu_item_id") REFERENCES "menu_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- pos_locations → pos_provider_connections (cascade)
ALTER TABLE "pos_locations"
  ADD CONSTRAINT "pos_locations_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "pos_provider_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- screens → pos_locations (set null on location delete)
ALTER TABLE "screens"
  ADD CONSTRAINT "screens_pos_location_id_fkey"
  FOREIGN KEY ("pos_location_id") REFERENCES "pos_locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
