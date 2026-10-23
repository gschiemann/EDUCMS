-- 2026-10-23 — Customer alert emails (apps/api/src/notifications/customer-alerts).
--
-- Generated with `prisma migrate diff --from-schema-datamodel <old>
-- --to-schema-datamodel <new> --script`, then made idempotent by hand
-- (CLAUDE.md "a schema change ships a MIGRATION FILE", rule 2): dev databases
-- that already took this shape through `pnpm db:push` apply it as a no-op.
--
-- ADDITIVE ONLY:
--   * users: two columns. `alert_emails_enabled` is NOT NULL DEFAULT true —
--     a catalogue-only change since Postgres 11 (no table rewrite), and every
--     existing admin reads as "on", which is the shipped default. The locale
--     column is nullable with no default.
--   * two NEW tables with no foreign keys and their indexes.
--   * nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE "users" takes a brief ACCESS EXCLUSIVE lock and
-- every sign-in reads that table. Five seconds, then fail — railway-start
-- retries and the previous deployment keeps serving.

SET lock_timeout = '5s';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "alert_email_locale" TEXT,
  ADD COLUMN IF NOT EXISTS "alert_emails_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "screen_alert_incidents" (
    "id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "emailed_mode" TEXT,
    "screen_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recovering_since" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "last_emailed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screen_alert_incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customer_alert_sends" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL,
    "recipient_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_alert_sends_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "screen_alert_incidents_open_idx" ON "screen_alert_incidents"("open");

CREATE INDEX IF NOT EXISTS "screen_alert_incidents_tenant_id_idx" ON "screen_alert_incidents"("tenant_id");

CREATE UNIQUE INDEX IF NOT EXISTS "screen_alert_incidents_screen_id_kind_key" ON "screen_alert_incidents"("screen_id", "kind");

CREATE INDEX IF NOT EXISTS "customer_alert_sends_org_id_created_at_idx" ON "customer_alert_sends"("org_id", "created_at");
