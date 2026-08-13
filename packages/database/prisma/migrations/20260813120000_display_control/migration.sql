-- 2026-08-13 — display control (volume / brightness / blank-wake / reboot /
-- scheduled on-off) across Goodview, NovaStar Taurus, TCL and future Android
-- signage SoCs, WITHOUT holding a per-vendor SDK.
--
-- Three additions, all strictly additive (V1 pilot rule: master is a release
-- branch; no column is dropped, renamed, retyped or backfilled, and no
-- existing read changes shape):
--
--   1. screens.display_capabilities / _at — the player's read-only
--      DisplayCapabilityProbe verdict. This is the TRUTH GATE: the dashboard
--      renders only controls the verdict supports, and the control endpoint
--      409s on anything else. NULL on every already-paired screen, which
--      means "unknown" and disables every control — nothing is guessed.
--      Both columns are registered in SCREEN_TELEMETRY_ONLY_FIELDS
--      (apps/api/src/screens/manifest-hot-cache.ts) so a capability report
--      never invalidates a screen's cached manifest.
--
--   2. display_schedules — on/off windows that run ON DEVICE via
--      AlarmManager, sourced from the manifest. A screen with the network
--      cut must still blank at 22:00 and wake at 07:00. days_of_week is
--      0=Sunday..6=Saturday (Daypart's encoding, not Schedule's comma
--      string) and the timezone is explicit per row — an on-device alarm
--      has to resolve a real local instant, and the device default is not
--      trustworthy (a district spans timezones; a factory-reset box is UTC).
--
--   3. display_vendor_recipes — platform-owned (NO tenant_id: a recipe
--      describes a hardware SKU, not customer data) so supporting a new
--      vendor is a DB row rather than an APK release. The player matches
--      recipes against its own Build.* identity, which is what keeps the
--      manifest's display block identical fleet-wide.
--
-- No table is written by a high-frequency path, so nothing here changes the
-- Supabase egress profile.

ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "display_capabilities" JSONB;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "display_capabilities_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "display_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "screen_id" TEXT,
    "screen_group_id" TEXT,
    "name" TEXT,
    "days_of_week" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "on_time" TEXT NOT NULL,
    "off_time" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "display_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "display_schedules_tenant_id_is_active_idx"
    ON "display_schedules"("tenant_id", "is_active");
CREATE INDEX IF NOT EXISTS "display_schedules_screen_id_idx"
    ON "display_schedules"("screen_id");
CREATE INDEX IF NOT EXISTS "display_schedules_screen_group_id_idx"
    ON "display_schedules"("screen_group_id");

-- Cascade on the TARGET so deleting a screen/group cannot strand an orphan
-- schedule that a future screen reusing the id would inherit. The tenant FK
-- is RESTRICT (Prisma's default) to match every other tenant-owned table.
DO $$ BEGIN
    ALTER TABLE "display_schedules" ADD CONSTRAINT "display_schedules_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "display_schedules" ADD CONSTRAINT "display_schedules_screen_id_fkey"
        FOREIGN KEY ("screen_id") REFERENCES "screens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "display_schedules" ADD CONSTRAINT "display_schedules_screen_group_id_fkey"
        FOREIGN KEY ("screen_group_id") REFERENCES "screen_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "display_vendor_recipes" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recipe" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "display_vendor_recipes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "display_vendor_recipes_vendor_id_key"
    ON "display_vendor_recipes"("vendor_id");
CREATE INDEX IF NOT EXISTS "display_vendor_recipes_is_active_priority_idx"
    ON "display_vendor_recipes"("is_active", "priority");
