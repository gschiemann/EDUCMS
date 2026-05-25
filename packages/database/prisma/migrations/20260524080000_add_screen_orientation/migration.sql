-- 2026-05-24 — Add per-screen orientation lock.
--
-- Stationary signage hardware (Goodview, NovaStar Taurus, BrightSign,
-- random no-name Android-box panels mounted on a wall) doesn't have a
-- meaningful accelerometer — Android's SCREEN_ORIENTATION_FULL_SENSOR
-- mode falls back to whatever the firmware was last told, which means
-- portrait-mounted panels frequently render landscape content sideways.
--
-- Adding an operator-controllable orientation lock on each Screen so
-- the dashboard can flip a kiosk between LANDSCAPE / PORTRAIT / AUTO
-- without anybody climbing a ladder. Default LANDSCAPE preserves the
-- current behavior for every already-paired kiosk (the existing
-- SCREEN_ORIENTATION_FULL_SENSOR mostly resolved to landscape anyway).
--
-- Additive, non-breaking. No backfill needed.
ALTER TABLE "screens"
  ADD COLUMN "orientation" TEXT NOT NULL DEFAULT 'LANDSCAPE';
