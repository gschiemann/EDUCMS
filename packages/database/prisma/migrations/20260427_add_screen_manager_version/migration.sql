-- v1.0.13 — Manager APK version reported by Player's heartbeat.
-- Player queries PackageManager for com.educms.manager (or .debug)
-- and includes &mv=<versionName> on the heartbeat URL. Lets the
-- dashboard chip show both Player + Manager versions without
-- adding a second heartbeat path from Manager itself.
ALTER TABLE "screens" ADD COLUMN "manager_version" TEXT;
ALTER TABLE "screens" ADD COLUMN "manager_version_at" TIMESTAMP(3);
