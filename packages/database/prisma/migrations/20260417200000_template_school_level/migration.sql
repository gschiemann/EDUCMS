-- Add school_level column to templates so /templates can filter by
-- Elementary / Middle / High. Defaults to UNIVERSAL for every
-- pre-existing row so nothing disappears from the gallery.

ALTER TABLE "templates"
  ADD COLUMN IF NOT EXISTS "school_level" TEXT NOT NULL DEFAULT 'UNIVERSAL';
