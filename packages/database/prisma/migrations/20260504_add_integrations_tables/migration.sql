-- 2026-05-04 — CRITICAL FIX
-- The streaming / POS / ads integration models were added to
-- schema.prisma in commits b58294e / b01d496 / 87709d8 (sprint 8c+8d)
-- but no migration file was ever generated. dev environments stayed
-- in sync via `prisma db push`, but production Railway never created
-- these tables. Every call to /api/v1/sample-data/* and every
-- streaming / POS / ads endpoint was throwing 500 because the
-- underlying tables did not exist.
--
-- Operator was about to walk into a live demo:
--   "every single new item we added is a complete failure"
--
-- This migration is purely additive — 9 new tables + their indexes.
-- No backfill required (operators have not used these yet because
-- the API has been broken since deploy). Safe to run on a live
-- database with traffic.

-- ─── Streaming ────────────────────────────────────────────────────
CREATE TABLE "stream_provider_connections" (
    "id"                  TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL,
    "provider_id"         TEXT NOT NULL,
    "display_name"        TEXT,
    "encrypted_creds"     TEXT NOT NULL,
    "encrypted_data_key"  TEXT NOT NULL,
    "status"              TEXT NOT NULL DEFAULT 'PENDING',
    "status_reason"       TEXT,
    "last_verified_at"    TIMESTAMP(3),
    "expires_at"          TIMESTAMP(3),
    "scope"               TEXT,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,
    "created_by_user_id"  TEXT NOT NULL,
    CONSTRAINT "stream_provider_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stream_provider_connections_tenant_id_provider_id_key"
  ON "stream_provider_connections"("tenant_id", "provider_id");
CREATE INDEX "stream_provider_connections_tenant_id_status_idx"
  ON "stream_provider_connections"("tenant_id", "status");

CREATE TABLE "stream_channels" (
    "id"               TEXT NOT NULL,
    "tenant_id"        TEXT NOT NULL,
    "connection_id"    TEXT NOT NULL,
    "external_id"      TEXT NOT NULL,
    "kind"             TEXT NOT NULL,
    "title"            TEXT NOT NULL,
    "description"      TEXT,
    "thumbnail_url"    TEXT,
    "category"         TEXT,
    "playback_url"     TEXT,
    "playback_type"    TEXT,
    "allow_ad_overlay" BOOLEAN NOT NULL DEFAULT true,
    "config"           TEXT,
    "status"           TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,
    "last_played_at"   TIMESTAMP(3),
    CONSTRAINT "stream_channels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stream_channels_connection_id_external_id_key"
  ON "stream_channels"("connection_id", "external_id");
CREATE INDEX "stream_channels_tenant_id_status_idx"
  ON "stream_channels"("tenant_id", "status");
ALTER TABLE "stream_channels"
  ADD CONSTRAINT "stream_channels_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "stream_provider_connections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "stream_ad_slots" (
    "id"                  TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL,
    "name"                TEXT NOT NULL,
    "asset_id"            TEXT NOT NULL,
    "channel_id"          TEXT,
    "screen_group_id"     TEXT,
    "config"              TEXT NOT NULL,
    "is_active"           BOOLEAN NOT NULL DEFAULT true,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,
    "created_by_user_id"  TEXT NOT NULL,
    CONSTRAINT "stream_ad_slots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stream_ad_slots_tenant_id_is_active_idx"
  ON "stream_ad_slots"("tenant_id", "is_active");

-- ─── POS ──────────────────────────────────────────────────────────
CREATE TABLE "pos_provider_connections" (
    "id"                    TEXT NOT NULL,
    "tenant_id"             TEXT NOT NULL,
    "provider_id"           TEXT NOT NULL,
    "display_name"          TEXT,
    "encrypted_creds"       TEXT NOT NULL,
    "encrypted_data_key"    TEXT NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'PENDING',
    "status_reason"         TEXT,
    "last_synced_at"        TIMESTAMP(3),
    "last_sync_item_count"  INTEGER,
    "expires_at"            TIMESTAMP(3),
    "scope"                 TEXT,
    "location_map"          TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,
    "created_by_user_id"    TEXT NOT NULL,
    CONSTRAINT "pos_provider_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pos_provider_connections_tenant_id_provider_id_key"
  ON "pos_provider_connections"("tenant_id", "provider_id");
CREATE INDEX "pos_provider_connections_tenant_id_status_idx"
  ON "pos_provider_connections"("tenant_id", "status");

CREATE TABLE "pos_menu_items" (
    "id"                  TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL,
    "connection_id"       TEXT NOT NULL,
    "external_id"         TEXT NOT NULL,
    "name"                TEXT NOT NULL,
    "description"         TEXT,
    "price_cents"         INTEGER NOT NULL,
    "sale_price_cents"    INTEGER,
    "category"            TEXT,
    "image_url"           TEXT,
    "badges"              TEXT[] DEFAULT ARRAY[]::TEXT[],
    "available"           BOOLEAN NOT NULL DEFAULT true,
    "location_id"         TEXT,
    "external_updated_at" TIMESTAMP(3),
    "synced_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_menu_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pos_menu_items_connection_id_external_id_key"
  ON "pos_menu_items"("connection_id", "external_id");
CREATE INDEX "pos_menu_items_tenant_id_available_idx"
  ON "pos_menu_items"("tenant_id", "available");
CREATE INDEX "pos_menu_items_connection_id_category_idx"
  ON "pos_menu_items"("connection_id", "category");
ALTER TABLE "pos_menu_items"
  ADD CONSTRAINT "pos_menu_items_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "pos_provider_connections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "pos_categories" (
    "id"            TEXT NOT NULL,
    "tenant_id"     TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "external_id"   TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "sortOrder"     INTEGER NOT NULL DEFAULT 0,
    "synced_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pos_categories_connection_id_external_id_key"
  ON "pos_categories"("connection_id", "external_id");
CREATE INDEX "pos_categories_tenant_id_idx"
  ON "pos_categories"("tenant_id");
ALTER TABLE "pos_categories"
  ADD CONSTRAINT "pos_categories_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "pos_provider_connections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Ad networks ──────────────────────────────────────────────────
CREATE TABLE "ad_network_connections" (
    "id"                    TEXT NOT NULL,
    "tenant_id"             TEXT NOT NULL,
    "network_id"            TEXT NOT NULL,
    "encrypted_creds"       TEXT NOT NULL,
    "encrypted_data_key"    TEXT NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'PENDING',
    "status_reason"         TEXT,
    "content_controls"      TEXT NOT NULL,
    "take_rate_bps"         INTEGER,
    "impressions_total"     INTEGER NOT NULL DEFAULT 0,
    "gross_revenue_cents"   INTEGER NOT NULL DEFAULT 0,
    "fee_cents"             INTEGER NOT NULL DEFAULT 0,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,
    "created_by_user_id"    TEXT NOT NULL,
    CONSTRAINT "ad_network_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ad_network_connections_tenant_id_network_id_key"
  ON "ad_network_connections"("tenant_id", "network_id");
CREATE INDEX "ad_network_connections_tenant_id_status_idx"
  ON "ad_network_connections"("tenant_id", "status");

CREATE TABLE "ad_impressions" (
    "id"                   TEXT NOT NULL,
    "tenant_id"            TEXT NOT NULL,
    "connection_id"        TEXT NOT NULL,
    "screen_id"            TEXT NOT NULL,
    "external_creative_id" TEXT NOT NULL,
    "external_campaign_id" TEXT,
    "cpm_cents"            INTEGER NOT NULL,
    "revenue_cents"        INTEGER NOT NULL,
    "served_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ad_impressions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ad_impressions_tenant_id_served_at_idx"
  ON "ad_impressions"("tenant_id", "served_at");
CREATE INDEX "ad_impressions_connection_id_served_at_idx"
  ON "ad_impressions"("connection_id", "served_at");
CREATE INDEX "ad_impressions_screen_id_served_at_idx"
  ON "ad_impressions"("screen_id", "served_at");
ALTER TABLE "ad_impressions"
  ADD CONSTRAINT "ad_impressions_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "ad_network_connections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ad_revenue_daily" (
    "id"                   TEXT NOT NULL,
    "tenant_id"            TEXT NOT NULL,
    "connection_id"        TEXT NOT NULL,
    "date"                 DATE NOT NULL,
    "impressions"          INTEGER NOT NULL DEFAULT 0,
    "gross_revenue_cents"  INTEGER NOT NULL DEFAULT 0,
    "fee_cents"            INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ad_revenue_daily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ad_revenue_daily_connection_id_date_key"
  ON "ad_revenue_daily"("connection_id", "date");
CREATE INDEX "ad_revenue_daily_tenant_id_date_idx"
  ON "ad_revenue_daily"("tenant_id", "date");
ALTER TABLE "ad_revenue_daily"
  ADD CONSTRAINT "ad_revenue_daily_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "ad_network_connections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
