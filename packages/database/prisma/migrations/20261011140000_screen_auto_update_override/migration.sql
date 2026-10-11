-- 2026-10-11 — per-screen automatic Player-update switch (owner decision).
--
-- Automatic APK updates are OPT-IN: off unless enabled for an organisation
-- (Tenant.autoUpdatePlayerEnabled, unchanged) or for one screen (this column).
-- NULL = inherit the organisation; TRUE / FALSE override it for this screen.
-- Every existing row reads NULL = inherit = exactly today's behaviour.
--
-- ADDITIVE: one NULLABLE column, no default — catalogue-only in Postgres,
-- instant at any row count. Generated with `prisma migrate diff`.
-- IDEMPOTENT (`IF NOT EXISTS`) because dev databases take the shape via
-- `pnpm db:push` first. `lock_timeout` because "screens" is the hot table every
-- manifest poll reads: fail fast and retry rather than queue the fleet.

SET lock_timeout = '5s';

ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "auto_update_player_override" BOOLEAN;
