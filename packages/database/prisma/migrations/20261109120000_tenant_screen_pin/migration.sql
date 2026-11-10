-- 2026-11-09 — SCREEN PIN FOR AN ON-DEVICE UNPAIR (player stability gap 6).
--
-- WHY. Somebody at a screen with a USB keyboard can open the player's menu and
-- choose Unpair, which takes that screen off the emergency alert channel. A
-- tenant may now set an optional 4-8 digit PIN; the device-initiated unpair
-- route refuses without it. Report:
-- docs/handoffs/2026-11-09-player-stability/05-screen-pin.md
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   * one nullable column on "tenants" with no default: a catalog-only
--     change, no table rewrite, no backfill;
--   * one brand-new, empty table holding the Argon2id hash, with no foreign
--     key, so no lock is taken on "tenants" beyond the column add.
-- Nothing existing is altered; the previous build runs unchanged against this
-- database. Every existing tenant reads NULL / no row = no PIN = today's
-- behaviour on every screen.
--
-- IDEMPOTENT because dev databases take the shape via `pnpm db:push` first.

SET lock_timeout = '5s';

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "screen_pin_set_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "tenant_screen_pins" (
    "tenant_id" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "set_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_screen_pins_pkey" PRIMARY KEY ("tenant_id")
);
