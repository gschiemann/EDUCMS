-- Hot-path indexes (2026-04-23 customer-readiness audit).
--
-- Every index below is CREATE INDEX IF NOT EXISTS so the migration is
-- idempotent + safe to rerun. All concurrent-safe in Postgres; no
-- locks on the underlying table during create (vs CREATE INDEX which
-- would block writes for the duration of the build).
--
-- Written as raw DDL instead of letting Prisma generate the migration
-- because prisma-migrate wraps everything in a transaction which
-- prevents CREATE INDEX CONCURRENTLY. The @@index declarations in
-- schema.prisma stay the source of truth — we reconcile with
-- `prisma migrate resolve` after this ships.

-- ── Screens ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "screens_tenant_id_status_idx"
    ON "screens" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "screens_tenant_id_last_ping_at_idx"
    ON "screens" ("tenant_id", "last_ping_at");

CREATE INDEX IF NOT EXISTS "screens_screen_group_id_idx"
    ON "screens" ("screen_group_id");

-- ── Assets ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "assets_tenant_id_created_at_idx"
    ON "assets" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "assets_tenant_id_status_idx"
    ON "assets" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "assets_tenant_id_folder_id_idx"
    ON "assets" ("tenant_id", "folder_id");

-- ── PlaylistItem ─────────────────────────────────────────────────────
-- Most-read relation in the app: every player manifest fetch walks
-- playlist_items by playlist_id in sequence order.
CREATE INDEX IF NOT EXISTS "playlist_items_playlist_id_sequence_order_idx"
    ON "playlist_items" ("playlist_id", "sequence_order");

-- ── Schedules ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "schedules_tenant_id_is_active_start_time_idx"
    ON "schedules" ("tenant_id", "is_active", "start_time");

CREATE INDEX IF NOT EXISTS "schedules_screen_id_idx"
    ON "schedules" ("screen_id");

CREATE INDEX IF NOT EXISTS "schedules_screen_group_id_idx"
    ON "schedules" ("screen_group_id");

CREATE INDEX IF NOT EXISTS "schedules_playlist_id_idx"
    ON "schedules" ("playlist_id");

-- ── AuditLog ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_created_at_idx"
    ON "audit_logs" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_action_idx"
    ON "audit_logs" ("tenant_id", "action");

-- ── Templates ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "templates_tenant_id_status_idx"
    ON "templates" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "templates_is_system_status_vertical_updated_at_idx"
    ON "templates" ("is_system", "status", "vertical", "updated_at");
