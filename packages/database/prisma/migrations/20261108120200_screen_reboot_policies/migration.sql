-- 2026-11-08 — SCHEDULED RESTART POLICY (manager deep-dive item #7).
--
-- WHY. An admin can opt a screen group into a nightly or weekly restart in its
-- off-hours. The policy is a row per group; each evaluated (screen, slot) is a
-- row in screen_reboot_runs, whose unique key is the claim that keeps a slot
-- from ever sending twice. Design: docs/handoffs/2026-11-08-manager-wave-4.md.
--
-- ADDITIVE AND NON-DESTRUCTIVE: two brand-new, empty tables, their indexes and
-- one foreign key to "screen_groups" (not a hot table; the new table is empty,
-- so validation is instant). NO foreign key to "screens" on purpose — it is the
-- hottest table in the schema and a run row is history. Nothing existing is
-- altered, so the previous build runs unchanged against this database. No row
-- = today's behaviour (no restart is ever sent).
--
-- IDEMPOTENT because dev databases take the shape via `pnpm db:push` first:
-- IF NOT EXISTS on every table and index, the FK behind a pg_constraint guard.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "screen_reboot_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "screen_group_id" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "day_of_week" INTEGER,
    "time" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screen_reboot_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "screen_reboot_policies_screen_group_id_key"
  ON "screen_reboot_policies"("screen_group_id");

CREATE INDEX IF NOT EXISTS "screen_reboot_policies_tenant_id_is_active_idx"
  ON "screen_reboot_policies"("tenant_id", "is_active");

CREATE TABLE IF NOT EXISTS "screen_reboot_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "slot_key" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "hardware_class" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "action_id" TEXT,
    "boot_before" INTEGER,
    "boot_after" INTEGER,
    "returned_at" TIMESTAMP(3),
    "restart_proven" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screen_reboot_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "screen_reboot_runs_screen_id_slot_key_key"
  ON "screen_reboot_runs"("screen_id", "slot_key");

CREATE INDEX IF NOT EXISTS "screen_reboot_runs_tenant_id_status_idx"
  ON "screen_reboot_runs"("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "screen_reboot_runs_policy_id_created_at_idx"
  ON "screen_reboot_runs"("policy_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'screen_reboot_policies_screen_group_id_fkey'
  ) THEN
    ALTER TABLE "screen_reboot_policies"
      ADD CONSTRAINT "screen_reboot_policies_screen_group_id_fkey"
      FOREIGN KEY ("screen_group_id") REFERENCES "screen_groups"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
