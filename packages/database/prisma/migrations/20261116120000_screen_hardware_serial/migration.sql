-- 2026-11-16 — the panel's hardware serial number, as the APK could read it.
--
-- Screen.hardwareSerial / hardwareSerialSource: a best-effort read on the
-- device (no device owner, no runtime permission), carried on the Player's
-- DEVICE-AUTHENTICATED native heartbeat (`x-venueos-hardware-serial`,
-- apps/api/src/screens/hardware-serial.ts) and shown on the screen's settings
-- (Device details). Both are telemetry-only (SCREEN_TELEMETRY_ONLY_FIELDS) —
-- they never bust the manifest cache and no manifest branch reads them.
--
-- ADDITIVE AND NON-DESTRUCTIVE: two NULLABLE text columns with no default, a
-- catalogue-only change at any row count; every existing screen reads NULL
-- ("Not available"), which is today's behaviour. Nothing is dropped, renamed
-- or rewritten.
--
-- `lock_timeout`: ALTER TABLE needs a brief ACCESS EXCLUSIVE lock on the hot
-- "screens" table; fail after five seconds instead of queueing the fleet's
-- polls behind a long transaction (pattern: 20260919120000_screen_faces).
--
-- IDEMPOTENT (`IF NOT EXISTS`) because dev databases take the shape via
-- `pnpm db:push` first.

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "hardware_serial" TEXT,
  ADD COLUMN IF NOT EXISTS "hardware_serial_source" TEXT;
