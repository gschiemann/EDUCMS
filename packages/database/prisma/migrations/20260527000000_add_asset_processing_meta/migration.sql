-- Audit P0-5 (2026-05-27): forensic + ops metadata for the upload-time
-- image optimizer. Captures original vs processed size + dimensions per
-- asset so we can answer "why is this 4 MB?" or chart "X GB saved this
-- month" without re-reading every file.
--
-- Purely additive (nullable JSONB column). Every existing row stays
-- untouched; legacy assets simply have processing_meta = NULL.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "processing_meta" JSONB;
