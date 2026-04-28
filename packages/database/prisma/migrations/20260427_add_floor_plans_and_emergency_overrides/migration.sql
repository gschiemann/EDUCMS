-- Sprint 8b — Indoor floor plans + per-screen emergency targeting.
--
-- Three new tables:
--   floor_plans              — uploaded PNG map of a building floor
--   floor_zones              — named polygon regions on a floor plan
--   screen_emergency_overrides — per-screen alert row (player checks
--                               this FIRST; tenant-wide status is
--                               the fallback if no row exists)
--
-- New columns on screens:
--   floor_plan_id / floor_x / floor_y   — placement on floor plan (px coords)
--   force_apk_update_pending_at          — manual-push OTA opt-in window
--   emergency_*_playlist_id (6 types)   — per-screen emergency playlist overrides
--   emergency_*_asset_url   (6 types)   — per-screen single-asset emergency URLs
--   emergency_*_portrait_playlist_id    — portrait variants (12 more)
--   emergency_*_portrait_asset_url      — portrait single-asset variants (6 more)
--
-- New columns on tenants:
--   location_based_emergency_enabled    — gates Sprint 8b per-screen features
--   auto_update_player_enabled          — opt-in for autonomous APK OTA
--
-- Migration is purely ADDITIVE (memory: "additive only" for v1 pilot).
-- No existing columns are altered or dropped.
-- All new columns are nullable / have defaults so existing rows are
-- unaffected and the deploy is zero-downtime.
--
-- Operator action after deploy:
--   Run `pnpm db:push` (or `prisma migrate deploy`) against production
--   BEFORE the first request reaches FloorPlansController or
--   ScreenEmergencyController — those controllers are already registered
--   and will Prisma-error on boot if the tables are absent.

-- ─── floor_plans ─────────────────────────────────────────────────────────────

CREATE TABLE "floor_plans" (
    "id"                      TEXT NOT NULL,
    "tenant_id"               TEXT NOT NULL,
    "name"                    TEXT NOT NULL,
    "building_label"          TEXT,
    "floor_label"             TEXT,
    "image_url"               TEXT NOT NULL,
    "width_px"                INTEGER NOT NULL,
    "height_px"               INTEGER NOT NULL,
    "default_scenario_config" JSONB,
    "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "floor_plans_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "floor_plans_tenant_id_idx"
    ON "floor_plans" ("tenant_id");

-- ─── floor_zones ─────────────────────────────────────────────────────────────

CREATE TABLE "floor_zones" (
    "id"             TEXT NOT NULL,
    "floor_plan_id"  TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "color"          TEXT NOT NULL DEFAULT '#6366f1',
    "shape"          JSONB NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floor_zones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "floor_zones_floor_plan_id_fkey"
        FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "floor_zones_floor_plan_id_idx"
    ON "floor_zones" ("floor_plan_id");

-- ─── screen_emergency_overrides ──────────────────────────────────────────────

CREATE TABLE "screen_emergency_overrides" (
    "id"                  TEXT NOT NULL,
    "screen_id"           TEXT NOT NULL,
    "tenant_id"           TEXT NOT NULL,
    "type"                TEXT NOT NULL,
    "severity"            TEXT NOT NULL DEFAULT 'HIGH',
    "scope_note"          TEXT,
    "playlist_id"         TEXT,
    "text_blob"           TEXT,
    "media_url"           TEXT,
    "floor_plan_id"       TEXT,
    "floor_zone_id"       TEXT,
    "scenario_id"         TEXT,
    "triggered_by_user_id" TEXT NOT NULL,
    "triggered_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"          TIMESTAMP(3),

    CONSTRAINT "screen_emergency_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screen_emergency_overrides_screen_id_key" UNIQUE ("screen_id")
);

CREATE INDEX IF NOT EXISTS "screen_emergency_overrides_tenant_id_triggered_at_idx"
    ON "screen_emergency_overrides" ("tenant_id", "triggered_at");

-- ─── screens — floor plan positioning ────────────────────────────────────────

ALTER TABLE "screens" ADD COLUMN "floor_plan_id" TEXT;
ALTER TABLE "screens" ADD COLUMN "floor_x"       DOUBLE PRECISION;
ALTER TABLE "screens" ADD COLUMN "floor_y"       DOUBLE PRECISION;

ALTER TABLE "screens"
    ADD CONSTRAINT "screens_floor_plan_id_fkey"
    FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── screens — manual APK push window ────────────────────────────────────────

ALTER TABLE "screens" ADD COLUMN "force_apk_update_pending_at" TIMESTAMP(3);

-- ─── screens — per-screen emergency playlist overrides (6 landscape types) ───

ALTER TABLE "screens" ADD COLUMN "emergency_lockdown_playlist_id" TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_evacuate_playlist_id" TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_weather_playlist_id"  TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_hold_playlist_id"     TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_secure_playlist_id"   TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_medical_playlist_id"  TEXT;

-- ─── screens — per-screen emergency single-asset URLs (6 landscape types) ────

ALTER TABLE "screens" ADD COLUMN "emergency_lockdown_asset_url" TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_evacuate_asset_url" TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_weather_asset_url"  TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_hold_asset_url"     TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_secure_asset_url"   TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_medical_asset_url"  TEXT;

-- ─── screens — per-screen emergency portrait playlist overrides ───────────────

ALTER TABLE "screens" ADD COLUMN "emergency_lockdown_portrait_playlist_id" TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_evacuate_portrait_playlist_id" TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_weather_portrait_playlist_id"  TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_hold_portrait_playlist_id"     TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_secure_portrait_playlist_id"   TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_medical_portrait_playlist_id"  TEXT;

-- ─── screens — per-screen emergency portrait single-asset URLs ────────────────

ALTER TABLE "screens" ADD COLUMN "emergency_lockdown_portrait_asset_url" TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_evacuate_portrait_asset_url" TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_weather_portrait_asset_url"  TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_hold_portrait_asset_url"     TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_secure_portrait_asset_url"   TEXT;
ALTER TABLE "screens" ADD COLUMN "emergency_medical_portrait_asset_url"  TEXT;

-- ─── tenants — Sprint 8b feature flag + OTA opt-in ───────────────────────────

ALTER TABLE "tenants"
    ADD COLUMN "location_based_emergency_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "tenants"
    ADD COLUMN "auto_update_player_enabled" BOOLEAN NOT NULL DEFAULT false;
