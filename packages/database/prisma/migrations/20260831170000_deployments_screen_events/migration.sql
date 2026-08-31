-- 2026-08-31 Fleet Command Phase 2.
-- Additive only: two NEW tables, nothing existing is altered, so the whole
-- fleet keeps working untouched and a rollback is a plain DROP.
--
--   deployments    one row per operator "push update" fan-out. `value` is
--                  the exact Screen.pending_refresh_at instant stamped on
--                  every target — the ack identity the player echoes back.
--                  Convergence is NEVER stored; it is derived live from the
--                  target screens on read.
--   screen_events  append-only per-screen operational timeline
--                  ('refresh-requested' | 'auto-refresh-requested' |
--                   'refresh-acked' | 'repair-required' |
--                   'credential-restored').
--
-- No foreign keys, matching the schema models: both tables are operational
-- records with their own retention sweep (30 d events / 90 d deployments in
-- the wedge cron), and they must not add cascade-delete edges that would let
-- deleting a user or a screen rewrite history.
CREATE TABLE IF NOT EXISTS "deployments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "label" TEXT NOT NULL,
    "value" TIMESTAMP(3) NOT NULL,
    "target_ids" JSONB NOT NULL,
    "target_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "screen_events" (
    "id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screen_events_pkey" PRIMARY KEY ("id")
);

-- Reads are always "newest N for this scope" — the list endpoint and the
-- retention sweep both ride these.
CREATE INDEX IF NOT EXISTS "deployments_tenant_id_created_at_idx" ON "deployments"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "screen_events_screen_id_created_at_idx" ON "screen_events"("screen_id", "created_at");
CREATE INDEX IF NOT EXISTS "screen_events_tenant_id_created_at_idx" ON "screen_events"("tenant_id", "created_at");
