-- Sprint 4: Touch-Kiosk Interactive Widgets
-- Add touch-mode template toggle + per-zone touch actions

ALTER TABLE "templates"
  ADD COLUMN "is_touch_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "idle_reset_ms" INTEGER NOT NULL DEFAULT 60000;

ALTER TABLE "template_zones"
  ADD COLUMN "touch_action" JSONB;
