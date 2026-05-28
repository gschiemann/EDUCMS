-- 2026-05-27 — T2-8: Possession arrow as a first-class field (additive).
--
-- Today Game.stats carries possession as a free-text 'home'/'away' string
-- the operator types into a generic stat field.  That approach has two
-- problems: (a) no tap-to-flip chip in the operator console, and
-- (b) basketball's alternating-possession-arrow rule has no proper home.
--
-- This migration adds a dedicated `possession` column to `games`:
--   - TEXT, nullable (existing rows stay NULL — no data loss)
--   - Values: 'home' | 'away' | NULL (no DB-level enum so future
--     sports with a different possession model stay additive)
--   - The API's setPossession service method validates and writes here
--   - Display surfaces (board, ribbon, scorebug) now read this column
--     first and fall back to stats.possession for backward compat
--
-- Additive-only.  Safe to apply on the live pilot tenant.
ALTER TABLE "games"
  ADD COLUMN "possession" TEXT;
