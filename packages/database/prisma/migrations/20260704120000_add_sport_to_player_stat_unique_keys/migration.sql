-- Add `sport` to the PlayerSeasonStat + PlayerCareerStat unique keys (2026-07-04).
--
-- A SportsPerson is ONE persistent athlete across ANY sport, and PLAYER_STATS
-- codes collide across sports (AST/PTS/G/A/BLK/TD/HR…). Without `sport` in the
-- unique key, a multi-sport athlete's same-code stats merged into a single row,
-- corrupting per-sport leaderboards + the record book.
--
-- Safety: adding a column to a unique key is strictly MORE permissive — any set
-- of rows unique under the old key stays unique under the new one — so these
-- CREATE UNIQUE INDEX statements CANNOT fail on existing data. Already-merged
-- historical rows are NOT un-merged here (a one-time re-finalize backfill is a
-- separate, optional data-repair task); this migration stops FUTURE merges.
-- Index names match Prisma's default derivation for the new keys, so a later
-- `migrate dev`/diff detects no drift.

-- PlayerSeasonStat: (person_id, season, stat_key) -> (person_id, season, stat_key, sport)
DROP INDEX "player_season_stats_person_id_season_stat_key_key";
CREATE UNIQUE INDEX "player_season_stats_person_id_season_stat_key_sport_key" ON "player_season_stats"("person_id", "season", "stat_key", "sport");

-- PlayerCareerStat: (person_id, stat_key) -> (person_id, stat_key, sport)
DROP INDEX "player_career_stats_person_id_stat_key_key";
CREATE UNIQUE INDEX "player_career_stats_person_id_stat_key_sport_key" ON "player_career_stats"("person_id", "stat_key", "sport");
