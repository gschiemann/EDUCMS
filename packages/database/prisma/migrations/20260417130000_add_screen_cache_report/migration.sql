-- Per-screen offline-cache status report. The player POSTs this every ~30s
-- with { playlist: { count, bytes }, emergency: { count, bytes } } so the
-- admin dashboard can show which screens have actually pre-cached every
-- emergency asset (vs. those that would have to hit the network at the
-- moment of an alert).
ALTER TABLE "screens" ADD COLUMN "last_cache_report" JSONB;
ALTER TABLE "screens" ADD COLUMN "last_cache_report_at" TIMESTAMP(3);
