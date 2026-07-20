-- Efficiency audit 2026-07-20 — proof-of-play index right-sizing.
--
-- playback_samples had grown to 38% of the entire database, and its
-- playlistId/screenId composite indexes had 0–1 scans EVER in production
-- (pg_stat_user_indexes) while holding ~6 MB of the table's 16 MB
-- footprint. The (finally-built) report endpoint aggregates inside a
-- (tenant_id, sampled_at) window, which the surviving composite index
-- serves; the new plain sampled_at index serves the nightly 90-day
-- retention purge (ProofOfPlaySampler.purgeTick).
DROP INDEX IF EXISTS "playback_samples_playlist_id_sampled_at_idx";
DROP INDEX IF EXISTS "playback_samples_screen_id_sampled_at_idx";
CREATE INDEX IF NOT EXISTS "playback_samples_sampled_at_idx" ON "playback_samples"("sampled_at");
