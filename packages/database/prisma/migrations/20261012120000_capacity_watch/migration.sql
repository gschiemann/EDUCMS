-- 2026-10-12 — Capacity early-warning (owner request: upgrade plans before degradation).
--
-- Two NEW, tiny, platform-wide tables (no tenant data, no change to any existing table, so no
-- lock on a hot table). ADDITIVE and IDEMPOTENT (`IF NOT EXISTS`) because dev databases may
-- already have the shape via `pnpm db:push`.

CREATE TABLE IF NOT EXISTS "capacity_samples" (
  "id"         TEXT NOT NULL,
  "metric"     TEXT NOT NULL,
  "value"      DOUBLE PRECISION NOT NULL,
  "limit_value" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "capacity_samples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "capacity_samples_metric_created_at_idx"
  ON "capacity_samples" ("metric", "created_at");
CREATE INDEX IF NOT EXISTS "capacity_samples_created_at_idx"
  ON "capacity_samples" ("created_at");

CREATE TABLE IF NOT EXISTS "capacity_alert_state" (
  "metric"        TEXT NOT NULL,
  "level"         TEXT NOT NULL DEFAULT 'ok',
  "last_alert_at" TIMESTAMP(3),
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "capacity_alert_state_pkey" PRIMARY KEY ("metric")
);
