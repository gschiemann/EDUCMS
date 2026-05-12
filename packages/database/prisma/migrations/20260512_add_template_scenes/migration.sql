-- 2026-05-12 — Phase D2 multi-scene model for the touch builder.
--
-- Operator wanted a Canva/Figma-style builder where one template can
-- contain many scenes (Figma "frames"). Pre-D2, a template was one
-- canvas; multi-scene flows required separate Template rows linked
-- by goto-template. That worked but split the operator's mental
-- model and made the gallery cluttered.
--
-- Strategy:
--   1. Create `template_scenes` table
--   2. Add `scene_id` to `template_zones` (nullable for legacy reads)
--   3. Backfill: every existing template gets one "Default" scene,
--      all of its zones get pointed at that scene
--   4. Index for the hot render-path query (zones WHERE template_id
--      = X AND scene_id = Y)
--
-- Forward-compat:
--   - Single-scene templates keep working unchanged — the migration
--     leaves them with one default scene + every zone pointed at it
--   - Touch action `goto-scene` (new in D2) takes a scene_id target
--   - Existing `goto-template` still works for cross-template nav
--
-- Reversible-ish: zones can be unhooked from scenes by NULLing
-- scene_id (the FK is ON DELETE SET NULL). Dropping the table is
-- safe iff no operator has created additional scenes — the migration
-- only adds rows, doesn't modify existing zone data beyond the
-- scene_id pointer.

CREATE TABLE IF NOT EXISTS "template_scenes" (
  "id"           TEXT PRIMARY KEY,
  "template_id"  TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "sort_order"   INTEGER NOT NULL DEFAULT 0,
  "is_default"   BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "template_scenes_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "template_scenes_template_id_name_key"
  ON "template_scenes"("template_id", "name");

CREATE INDEX IF NOT EXISTS "template_scenes_template_id_sort_order_idx"
  ON "template_scenes"("template_id", "sort_order");

ALTER TABLE "template_zones"
  ADD COLUMN IF NOT EXISTS "scene_id" TEXT;

-- Index supports the hot render-path query: "give me all zones for
-- (templateId, sceneId)". Pre-D2 the player queried by templateId
-- alone and got every zone; this lets us filter at the SQL layer.
CREATE INDEX IF NOT EXISTS "template_zones_template_id_scene_id_idx"
  ON "template_zones"("template_id", "scene_id");

-- FK with SET NULL on delete so deleting a scene unhooks its zones
-- (they'd float to the default scene via the controller logic).
-- Wrapped in a DO block so re-applying the migration is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'template_zones_scene_id_fkey'
  ) THEN
    ALTER TABLE "template_zones"
      ADD CONSTRAINT "template_zones_scene_id_fkey"
      FOREIGN KEY ("scene_id") REFERENCES "template_scenes"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill: every template gets one Default scene with is_default = true.
-- gen_random_uuid() requires pgcrypto in older Postgres, but Supabase
-- ships it by default. Idempotent — only INSERTs for templates that
-- don't yet have any scenes.
INSERT INTO "template_scenes" ("id", "template_id", "name", "sort_order", "is_default", "created_at")
SELECT gen_random_uuid()::text, t."id", 'Default', 0, TRUE, NOW()
FROM "templates" t
WHERE NOT EXISTS (
  SELECT 1 FROM "template_scenes" s WHERE s."template_id" = t."id"
);

-- Point every existing zone at its template's default scene.
-- Limits to scene_id IS NULL so re-running doesn't clobber operator
-- changes to a non-default scene.
UPDATE "template_zones" z
SET "scene_id" = (
  SELECT s."id" FROM "template_scenes" s
  WHERE s."template_id" = z."template_id" AND s."is_default" = TRUE
  LIMIT 1
)
WHERE z."scene_id" IS NULL;
