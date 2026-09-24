SET lock_timeout = '5s';
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "pending_media" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "pending_media_error" TEXT;
CREATE INDEX IF NOT EXISTS "schedules_pending_media_is_active_idx" ON "schedules"("pending_media", "is_active");
