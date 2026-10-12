-- 2026-10-11 — Video guarantee, steps 1–4 (behavior-neutral): per-screen
-- playback evidence + the WebView's declared decode capability.
-- Design: docs/research/2026-10-11-launch-readiness/02-video-guarantee.md §4.4.
--
-- Generated with `prisma migrate diff` (old schema → new schema), then made
-- idempotent by hand, because this repo's dev flow is `pnpm db:push`: a database
-- that already took this shape must apply the file as a no-op.
--
-- ADDITIVE ONLY: two new tables, three indexes, two foreign keys to "screens".
-- Nothing on "screens" itself changes — no column, no default, no rewrite.
-- Neither table is manifest-fed (MANIFEST_FED_MODELS): telemetry writes them,
-- the dashboard reads them on demand.
--
-- `lock_timeout`: adding a foreign key that REFERENCES "screens" takes a brief
-- SHARE ROW EXCLUSIVE lock on it — the table every manifest poll and heartbeat
-- touches. Five seconds, then fail (railway-start retries; a failed migrate
-- never goes healthy, so the previous deployment keeps serving) rather than
-- queue the fleet behind a long transaction.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "screen_file_playback" (
    "screen_id" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_class" TEXT,
    "file_url" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "samples" INTEGER NOT NULL DEFAULT 0,
    "settled_samples" INTEGER NOT NULL DEFAULT 0,
    "frames" BIGINT NOT NULL DEFAULT 0,
    "dropped" BIGINT NOT NULL DEFAULT 0,
    "stalls" INTEGER NOT NULL DEFAULT 0,
    "stalled_ms" BIGINT NOT NULL DEFAULT 0,
    "consecutive_good" INTEGER NOT NULL DEFAULT 0,
    "consecutive_bad" INTEGER NOT NULL DEFAULT 0,
    "worst_pct" DOUBLE PRECISION,
    "last_pct" DOUBLE PRECISION,
    "last_grade" TEXT,
    "last_settled" BOOLEAN NOT NULL DEFAULT false,
    "engine" TEXT,
    "concurrent_max" INTEGER NOT NULL DEFAULT 1,
    "unit_concurrent_max" INTEGER NOT NULL DEFAULT 1,
    "player_version_code" INTEGER,
    "webview_major" INTEGER,
    "verdict" TEXT NOT NULL DEFAULT 'insufficient',
    "first_at" TIMESTAMP(3) NOT NULL,
    "last_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screen_file_playback_pkey" PRIMARY KEY ("screen_id","file_sha256")
);

CREATE TABLE IF NOT EXISTS "screen_media_capabilities" (
    "screen_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "webview_major" INTEGER,
    "report" JSONB NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screen_media_capabilities_pkey" PRIMARY KEY ("screen_id")
);

CREATE INDEX IF NOT EXISTS "screen_file_playback_tenant_id_last_at_idx"
    ON "screen_file_playback"("tenant_id", "last_at");

CREATE INDEX IF NOT EXISTS "screen_file_playback_device_class_idx"
    ON "screen_file_playback"("device_class");

CREATE INDEX IF NOT EXISTS "screen_media_capabilities_tenant_id_idx"
    ON "screen_media_capabilities"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'screen_file_playback_screen_id_fkey'
  ) THEN
    ALTER TABLE "screen_file_playback"
      ADD CONSTRAINT "screen_file_playback_screen_id_fkey"
      FOREIGN KEY ("screen_id") REFERENCES "screens"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'screen_media_capabilities_screen_id_fkey'
  ) THEN
    ALTER TABLE "screen_media_capabilities"
      ADD CONSTRAINT "screen_media_capabilities_screen_id_fkey"
      FOREIGN KEY ("screen_id") REFERENCES "screens"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
