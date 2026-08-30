-- 2026-08-30 player reliability program (audit P0-1/P0-5/P0-6).
-- Additive only; whole fleet keeps working untouched.
--   auth_state            server-stamped credential trust at register time
--                         ('PROVEN' | 'REPAIR_REQUIRED'); the dashboard's
--                         honest replacement for "heartbeat green = ONLINE".
--   auth_state_changed_at when it last flipped.
--   pending_refresh_at    durable REFRESH_WEB: manifest-delivered reload
--                         command that survives a dead push channel.
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "auth_state" TEXT;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "auth_state_changed_at" TIMESTAMP(3);
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "pending_refresh_at" TIMESTAMP(3);
