-- Standard Response Protocol (SRP) expansion. Most US K-12 districts
-- train on the I Love U Guys 5-action SRP framework. Lockdown,
-- Evacuate, and Shelter (= Weather here) were already in place; this
-- migration adds Hold + Secure (Lockout) plus a separate Medical
-- bucket for nurse / EMS events that don't fit any SRP action.
ALTER TABLE "tenants" ADD COLUMN "panic_hold_playlist_id"    TEXT;
ALTER TABLE "tenants" ADD COLUMN "panic_secure_playlist_id"  TEXT;
ALTER TABLE "tenants" ADD COLUMN "panic_medical_playlist_id" TEXT;
