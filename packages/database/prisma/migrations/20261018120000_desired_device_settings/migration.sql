-- 2026-10-18 — Basic Android settings without device owner.
--
-- An operator stores a desired value per screen for the everyday Android
-- settings (brightness, volume, screen timeout, rotation lock, automatic date &
-- time and time zone, time server, one Wi-Fi network); the native heartbeat
-- carries the set down and the unit's report back (logic:
-- apps/api/src/device-settings/). The desired values, the sealed Wi-Fi
-- passphrase and the unit's last report live in their OWN table — never JSON
-- on the hot "screens" row (the 2026-08-14 egress lesson). "screens" gets three
-- small markers the heartbeat reads off the row it already loads, so an
-- unchanged unit costs no extra query and no extra write.
--
-- Generated with `prisma migrate diff --from-schema-datamodel <old>
-- --to-schema-datamodel <new> --script`, then made idempotent by hand (dev
-- databases take the shape through `pnpm db:push` first).
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   * two NULLABLE columns with no default, and one INTEGER NOT NULL DEFAULT 0.
--     A constant default is a catalogue-only change on Postgres 11+ — no table
--     rewrite at any row count — and every existing screen reads as "no desired
--     settings stored", which is exactly today's behaviour.
--   * one new table, one index, one foreign key (cascade with its screen).
--   * nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE takes a brief ACCESS EXCLUSIVE lock on "screens",
-- the table every manifest poll, heartbeat and register reads. Five seconds,
-- then fail — railway-start retries, and a failed migrate never goes healthy,
-- so Railway keeps the previous deployment serving.

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "device_settings_report_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "device_settings_report_sig" TEXT,
  ADD COLUMN IF NOT EXISTS "device_settings_rev" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "desired_device_settings" (
    "screen_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "wifi_secret" TEXT,
    "report" JSONB,
    "report_changed_at" TIMESTAMP(3),
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desired_device_settings_pkey" PRIMARY KEY ("screen_id")
);

CREATE INDEX IF NOT EXISTS "desired_device_settings_tenant_id_idx"
    ON "desired_device_settings"("tenant_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'desired_device_settings_screen_id_fkey'
    ) THEN
        ALTER TABLE "desired_device_settings"
            ADD CONSTRAINT "desired_device_settings_screen_id_fkey"
            FOREIGN KEY ("screen_id") REFERENCES "screens"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
