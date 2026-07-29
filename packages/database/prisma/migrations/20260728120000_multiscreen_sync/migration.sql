-- 2026-07-28 — frame-locked multi-screen sync.
--
-- Feature: screens in a ScreenGroup with sync_mode='locked' play their shared
-- schedule on a deterministic epoch-anchored timeline against a shared server
-- clock, so content flips land within a frame of each other across screens.
-- Design + research: docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md
--
-- Strictly additive + nullable (V1 pilot rules): every existing screen/group
-- keeps byte-for-byte current behavior until an operator flips a group to
-- 'locked'. No backfill, no defaults that change reads.
ALTER TABLE "screen_groups" ADD COLUMN IF NOT EXISTS "sync_mode" TEXT;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "sync_offset_ms" INTEGER;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_sync_report" JSONB;
ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_sync_report_at" TIMESTAMP(3);
