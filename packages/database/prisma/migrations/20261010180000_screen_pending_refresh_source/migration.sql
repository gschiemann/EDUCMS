-- Generated with prisma migrate diff; additive and safe to apply after db:push.
-- Who asked for a durable REFRESH_WEB ('operator' | 'system'), so a screen that
-- can prove it is painting declines a system-initiated reload instead of tearing
-- down live content (never-interrupt program, 2026-10-10).
SET lock_timeout = '5s';
ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "pending_refresh_source" TEXT;
