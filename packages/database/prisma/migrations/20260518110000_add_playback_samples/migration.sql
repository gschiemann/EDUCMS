-- Proof-of-play analytics — append-only playback samples.
--
-- A background sampler writes one row per online screen every ~10 min
-- capturing the playlist effectively scheduled to it, so the dashboard
-- can report content / sponsor display time. No foreign keys: the
-- history must survive a later playlist / screen delete. Purely
-- additive — a new table only, no existing table is altered, so this
-- is safe to apply to the live pilot.

CREATE TABLE "playback_samples" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "screen_id" TEXT NOT NULL,
  "playlist_id" TEXT NOT NULL,
  "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "playback_samples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "playback_samples_tenant_id_sampled_at_idx" ON "playback_samples"("tenant_id", "sampled_at");
CREATE INDEX "playback_samples_playlist_id_sampled_at_idx" ON "playback_samples"("playlist_id", "sampled_at");
CREATE INDEX "playback_samples_screen_id_sampled_at_idx" ON "playback_samples"("screen_id", "sampled_at");
