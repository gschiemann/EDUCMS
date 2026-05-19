-- 2026-05-19 — Sprint 13 scoreboard builder. Each Game can pick an
-- operator-customized Template for its three surfaces:
--   * scoreboard_template_id → /board/[gameId]    (LED video wall)
--   * ribbon_template_id     → /ribbon/[gameId]   (perimeter ribbon)
--   * scorebug_template_id   → /scorebug/[gameId] (OBS broadcast bug)
--
-- All three are NULLABLE: a NULL value falls back to the legacy
-- hardcoded layout in apps/web/src/app/board|ribbon|scorebug. This
-- lets every existing Game in production keep working unchanged
-- while customers progressively opt into custom layouts.
--
-- ON DELETE SET NULL so deleting a Template never wipes a Game row.
-- This is the most defensive choice: a tenant that nukes a template
-- by mistake doesn't take their live scoreboards down with it; they
-- just fall back to the default layout.
--
-- Purely additive — safe to ship to live pilot tenants without any
-- data migration or backfill step.

ALTER TABLE "games" ADD COLUMN "scoreboard_template_id" TEXT;
ALTER TABLE "games" ADD COLUMN "ribbon_template_id" TEXT;
ALTER TABLE "games" ADD COLUMN "scorebug_template_id" TEXT;

CREATE INDEX "games_scoreboard_template_id_idx" ON "games"("scoreboard_template_id");
CREATE INDEX "games_ribbon_template_id_idx" ON "games"("ribbon_template_id");
CREATE INDEX "games_scorebug_template_id_idx" ON "games"("scorebug_template_id");

ALTER TABLE "games"
  ADD CONSTRAINT "games_scoreboard_template_id_fkey"
  FOREIGN KEY ("scoreboard_template_id") REFERENCES "templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "games"
  ADD CONSTRAINT "games_ribbon_template_id_fkey"
  FOREIGN KEY ("ribbon_template_id") REFERENCES "templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "games"
  ADD CONSTRAINT "games_scorebug_template_id_fkey"
  FOREIGN KEY ("scorebug_template_id") REFERENCES "templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
