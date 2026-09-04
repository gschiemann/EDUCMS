-- ═══════════════════════════════════════════════════════════════════════
-- DISASTER-RECOVERY REPAIR, part 2 (2026-09-04) — make the database the
-- history BUILDS equal the database `schema.prisma` DESCRIBES.
--
-- Part 1 (`20260422999999_repair_baseline_drift`) got `prisma migrate
-- deploy` to run to completion on an empty database. It ran, but what it
-- produced was not quite the schema the Prisma client is generated against:
-- production has been `db push`-ed for two years, so every object `db push`
-- created — and every referential action it corrected — exists on
-- production and in `schema.prisma` but nowhere in the migration history.
-- `prisma migrate diff --from-url <rebuilt> --to-schema-datamodel` listed
-- ~200 lines of it. A restore that comes up with the wrong column types and
-- the wrong ON DELETE behaviour is not a restore.
--
-- THE SHAPE OF THIS FILE. Every statement is CONDITIONAL on the object's
-- current state, which makes it exactly two different things:
--
--   • on a FROM-EMPTY rebuild it applies the missing tables, columns,
--     indexes, types and referential actions;
--   • on PRODUCTION (and on any database `db push` already reconciled) it
--     inspects the catalogue, finds everything already correct, and issues
--     NOTHING — no locks, no table rewrites, no FK re-validation scans.
--
-- That is why the foreign-key section compares `confdeltype`/`confupdtype`
-- instead of unconditionally dropping and re-adding: an unconditional
-- re-add would take an ACCESS EXCLUSIVE lock and re-validate every row of
-- `touch_events` on a live deploy to change nothing.
--
-- WHAT IS DELIBERATELY NOT HERE: `users_tenant_name_idx` and
-- `tenants_parent_id_archived_at_idx`. `migrate diff` wants them dropped
-- because `schema.prisma` did not declare them — but they were created by
-- real migrations, they exist on production, and they back live queries.
-- The fix is to declare them in `schema.prisma` (done, with `map:` to keep
-- the historical names), not to drop indexes out from under production.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Columns `db push` added and no migration ever did ────────────────
ALTER TABLE "playlist_items" ADD COLUMN IF NOT EXISTS "days_of_week" TEXT;
ALTER TABLE "playlist_items" ADD COLUMN IF NOT EXISTS "time_start" TEXT;
ALTER TABLE "playlist_items" ADD COLUMN IF NOT EXISTS "time_end" TEXT;
ALTER TABLE "playlist_items" ADD COLUMN IF NOT EXISTS "transition_type" TEXT DEFAULT 'FADE';

ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "template_id" TEXT;
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "source_playlist_id" TEXT;

ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "canvas_w" INTEGER;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "canvas_h" INTEGER;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "repeats" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "force_apk_update_override_window" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "bg_color" TEXT;
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "bg_gradient" TEXT;
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "bg_image" TEXT;

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "ota_window_start" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "ota_window_end" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "ota_window_timezone" TEXT;

-- `Template.vertical` is `String @default("K12")` in the schema. Part 1
-- created it nullable (that is all the index in `20260423_hot_path_indexes`
-- needed); tighten it here, backfilling first so the constraint can never
-- fail on a row that predates it.
UPDATE "templates" SET "vertical" = 'K12' WHERE "vertical" IS NULL;
ALTER TABLE "templates" ALTER COLUMN "vertical" SET DEFAULT 'K12';
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'templates' AND column_name = 'vertical' AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE "templates" ALTER COLUMN "vertical" SET NOT NULL;
    END IF;
END $$;

-- ── `@updatedAt` / `@default(now())` defaults ────────────────────────
-- Catalogue-only changes; setting a default that is already set is a no-op.
ALTER TABLE "custom_cues" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "games" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "roster_players" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sponsors" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "playback_rollup_state" ALTER COLUMN "updated_at" DROP DEFAULT;

-- ── Timestamp precision ──────────────────────────────────────────────
-- Prisma models `DateTime` as `timestamp(3)`. A handful of columns were
-- created by hand-written migrations at the Postgres default precision 6,
-- so a rebuilt database stored microseconds where the client expects
-- milliseconds. Guarded on the CURRENT precision: on production these are
-- already 3 and nothing runs, which matters because
-- `ALTER COLUMN … TYPE` takes an ACCESS EXCLUSIVE lock.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('licenses', 'stripe_last_event_created_at'),
            ('processed_stripe_events', 'processed_at'),
            ('tenant_api_keys', 'expires_at'),
            ('tenant_api_keys', 'last_used_at'),
            ('tenant_api_keys', 'revoked_at'),
            ('tenant_api_keys', 'created_at'),
            ('tenant_webhooks', 'last_delivery_at'),
            ('tenant_webhooks', 'created_at'),
            ('webhook_deliveries', 'next_retry_at'),
            ('webhook_deliveries', 'created_at'),
            ('webhook_deliveries', 'updated_at')
        ) AS t(tbl, col)
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_name = r.tbl
              AND c.column_name = r.col
              AND c.data_type = 'timestamp without time zone'
              AND c.datetime_precision IS DISTINCT FROM 3
        ) THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMP(3)', r.tbl, r.col);
        END IF;
    END LOOP;
END $$;

-- ── Tables `db push` created and no migration ever did ───────────────
CREATE TABLE IF NOT EXISTS "processed_pos_events" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_pos_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "processed_pos_events_processed_at_idx" ON "processed_pos_events"("processed_at");
CREATE INDEX IF NOT EXISTS "processed_pos_events_provider_id_idx" ON "processed_pos_events"("provider_id");

CREATE TABLE IF NOT EXISTS "bugs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "description" TEXT,
    "screenshot_url" TEXT,
    "captured_context" JSONB NOT NULL,
    "server_context" JSONB,
    "ai_analysis" JSONB,
    "ai_analyzed_at" TIMESTAMP(3),
    "ai_provider" TEXT,
    "ai_model" TEXT,
    "ai_cost_usd" DOUBLE PRECISION,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "fix_branch_name" TEXT,
    "fix_pr_number" INTEGER,
    "fix_commit_sha" TEXT,
    "shipped_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bugs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "bugs_tenant_id_created_at_idx" ON "bugs"("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "bugs_status_created_at_idx" ON "bugs"("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "bugs_user_id_created_at_idx" ON "bugs"("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "playlists_tenant_id_source_playlist_id_idx"
    ON "playlists"("tenant_id", "source_playlist_id");

-- ── Referential actions ──────────────────────────────────────────────
-- The historical migrations wrote several foreign keys with different
-- ON DELETE / ON UPDATE behaviour than `schema.prisma` declares — most
-- consequentially `touch_events_tenant_id_fkey`, which the history created
-- as ON DELETE CASCADE where the schema says RESTRICT.
--
-- `confdeltype` / `confupdtype` codes: a = NO ACTION, r = RESTRICT,
-- c = CASCADE, n = SET NULL, d = SET DEFAULT.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('submissions', 'submissions_tenant_id_fkey', 'r', 'c',
             'ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE'),
            ('submissions', 'submissions_submitted_by_user_id_fkey', 'r', 'c',
             'ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE'),
            ('submissions', 'submissions_decided_by_user_id_fkey', 'n', 'c',
             'ALTER TABLE "submissions" ADD CONSTRAINT "submissions_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
            ('template_scenes', 'template_scenes_template_id_fkey', 'c', 'c',
             'ALTER TABLE "template_scenes" ADD CONSTRAINT "template_scenes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
            ('template_versions', 'template_versions_template_id_fkey', 'c', 'c',
             'ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
            ('template_versions', 'template_versions_tenant_id_fkey', 'c', 'c',
             'ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
            ('template_versions', 'template_versions_by_user_id_fkey', 'n', 'c',
             'ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_by_user_id_fkey" FOREIGN KEY ("by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
            ('template_zones', 'template_zones_scene_id_fkey', 'n', 'c',
             'ALTER TABLE "template_zones" ADD CONSTRAINT "template_zones_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "template_scenes"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
            ('tenant_api_keys', 'tenant_api_keys_tenant_id_fkey', 'c', 'c',
             'ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
            ('tenant_webhooks', 'tenant_webhooks_tenant_id_fkey', 'c', 'c',
             'ALTER TABLE "tenant_webhooks" ADD CONSTRAINT "tenant_webhooks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
            ('touch_events', 'touch_events_tenant_id_fkey', 'r', 'c',
             'ALTER TABLE "touch_events" ADD CONSTRAINT "touch_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE'),
            ('playlists', 'playlists_template_id_fkey', 'n', 'c',
             'ALTER TABLE "playlists" ADD CONSTRAINT "playlists_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
            ('bugs', 'bugs_tenant_id_fkey', 'n', 'c',
             'ALTER TABLE "bugs" ADD CONSTRAINT "bugs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
            ('bugs', 'bugs_user_id_fkey', 'n', 'c',
             'ALTER TABLE "bugs" ADD CONSTRAINT "bugs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
            ('bugs', 'bugs_approved_by_id_fkey', 'n', 'c',
             'ALTER TABLE "bugs" ADD CONSTRAINT "bugs_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE')
        ) AS t(tbl, con, want_del, want_upd, add_sql)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = r.con
              AND contype = 'f'
              AND confdeltype = r.want_del
              AND confupdtype = r.want_upd
        ) THEN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.con);
            EXECUTE r.add_sql;
        END IF;
    END LOOP;
END $$;
