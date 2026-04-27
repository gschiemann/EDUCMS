-- Phase 2 — last crash from Player or Manager APK. Captured by an
-- UncaughtExceptionHandler in each app and POSTed to
-- /api/v1/screens/status/:fp/crash-report. The source column
-- attributes which APK threw (player|manager).
ALTER TABLE "screens" ADD COLUMN "last_crash_at" TIMESTAMP(3);
ALTER TABLE "screens" ADD COLUMN "last_crash_version" TEXT;
ALTER TABLE "screens" ADD COLUMN "last_crash_source" TEXT;
ALTER TABLE "screens" ADD COLUMN "last_crash_message" TEXT;
ALTER TABLE "screens" ADD COLUMN "last_crash_stack" TEXT;
