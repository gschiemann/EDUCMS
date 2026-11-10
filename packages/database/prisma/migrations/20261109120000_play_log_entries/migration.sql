-- Device play log (2026-11-09, player stability gap 7).
--
-- One row per playlist item the web player actually showed: start time (the
-- player's server-corrected clock), shown duration, completed flag. Written by
-- POST /api/v1/screens/:id/play-log (device-authenticated, tenant from the
-- credential's live screen row), read by GET /api/v1/analytics/play-log.
--
-- Purely additive: one new table, no existing table touched, no foreign keys.
-- Idempotent (IF NOT EXISTS) so a dev database that already took the shape via
-- `db:push` applies it cleanly. A new, empty table takes no lock anything else
-- waits on.
--
-- The primary key is the idempotency key: a retried batch inserts with
-- ON CONFLICT DO NOTHING. Retention: PLAY_LOG_RETENTION_DAYS (default 30),
-- swept hourly in chunks by PlayLogRetentionService against the BRIN index.

CREATE TABLE IF NOT EXISTS "play_log_entries" (
    "screen_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "playlist_item_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "playlist_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "shown_ms" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "play_log_entries_pkey" PRIMARY KEY ("screen_id","started_at","playlist_item_id")
);

CREATE INDEX IF NOT EXISTS "play_log_entries_tenant_id_asset_id_started_at_idx" ON "play_log_entries"("tenant_id", "asset_id", "started_at");

CREATE INDEX IF NOT EXISTS "play_log_entries_started_at_idx" ON "play_log_entries" USING BRIN ("started_at");
