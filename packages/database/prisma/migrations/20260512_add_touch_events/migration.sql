-- 2026-05-12 — Phase D5 touch analytics.
--
-- Adds `touch_events` for the player's edu:touch-action telemetry. One
-- row per visitor tap; aggregated by zone in the builder's Layers
-- panel and (future) dashboard heatmap.
--
-- Independent of Template / TemplateZone — no FK by design. Two reasons:
--   1. Forensics + retention: events must outlive a deleted template
--      so we can answer "how was this template used before it was
--      replaced?" historically.
--   2. Write-path isolation: a buggy Template delete cascade can't
--      delete months of analytics by accident.
--
-- Indices target the two real access patterns:
--   - aggregateForTemplate: (tenantId, templateId, createdAt) DESC scan
--   - rankZonesForTemplate: GROUP BY zoneId WHERE templateId=...
--
-- Forward-compat: no actionTarget scheme allowlist at the DB level —
-- the controller validates the string before insert. Adding constraints
-- here would lock in v1 assumptions.

CREATE TABLE IF NOT EXISTS "touch_events" (
  "id"            TEXT PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "screen_id"     TEXT,
  "template_id"   TEXT NOT NULL,
  "zone_id"       TEXT,
  "scene_id"      TEXT,
  "action_type"   TEXT,
  "action_target" TEXT,
  "client_ts"     TIMESTAMP(3) NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "touch_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- Hot path: "show me taps for THIS template over the last 30 days"
CREATE INDEX IF NOT EXISTS "touch_events_tenant_id_template_id_created_at_idx"
  ON "touch_events"("tenant_id", "template_id", "created_at");

-- Per-zone aggregation: "rank zones by tap count for this template"
CREATE INDEX IF NOT EXISTS "touch_events_template_id_zone_id_idx"
  ON "touch_events"("template_id", "zone_id");
