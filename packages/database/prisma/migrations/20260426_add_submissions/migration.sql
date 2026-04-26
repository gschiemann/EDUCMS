-- Sprint 1.5 — submit-for-review workflow.
--
-- Additive migration: new `submissions` table only. No schema change
-- to existing tables — bundled-content ids are stored as CSV strings
-- so historical submissions stay queryable even after their linked
-- assets/playlists/schedules are later edited or removed.

CREATE TABLE "submissions" (
    "id"                   TEXT NOT NULL PRIMARY KEY,
    "tenant_id"            TEXT NOT NULL,
    "submitted_by_user_id" TEXT NOT NULL,
    "status"               TEXT NOT NULL DEFAULT 'PENDING',
    "note"                 TEXT,
    "reviewer_note"        TEXT,
    "notify_user_ids"      TEXT NOT NULL DEFAULT '',
    "asset_ids"            TEXT NOT NULL DEFAULT '',
    "playlist_ids"         TEXT NOT NULL DEFAULT '',
    "schedule_ids"         TEXT NOT NULL DEFAULT '',
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at"           TIMESTAMP(3),
    "decided_by_user_id"   TEXT,

    CONSTRAINT "submissions_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "submissions_submitted_by_user_id_fkey"
        FOREIGN KEY ("submitted_by_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "submissions_decided_by_user_id_fkey"
        FOREIGN KEY ("decided_by_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE INDEX "submissions_tenant_id_status_created_at_idx"
    ON "submissions" ("tenant_id", "status", "created_at");

CREATE INDEX "submissions_submitted_by_user_id_created_at_idx"
    ON "submissions" ("submitted_by_user_id", "created_at");
