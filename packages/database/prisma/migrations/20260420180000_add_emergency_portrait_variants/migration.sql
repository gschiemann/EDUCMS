-- Per-orientation emergency content. A tenant with both portrait and
-- landscape displays (e.g. a 4K vertical Nova wall in the lobby +
-- standard 1920x1080 hallway TVs) can now configure one playlist per
-- orientation for each panic type. The manifest controller parses the
-- screen's stored resolution and picks the matching variant, falling
-- back to the original *_playlist_id (treated as the landscape default)
-- when the portrait slot is empty, so no existing tenant regresses.
--
-- 7 new columns — one per panic type + a runtime 'currently active'
-- portrait bucket that mirrors emergency_playlist_id.
ALTER TABLE "tenants" ADD COLUMN "emergency_portrait_playlist_id"       TEXT;
ALTER TABLE "tenants" ADD COLUMN "panic_evacuate_portrait_playlist_id"  TEXT;
ALTER TABLE "tenants" ADD COLUMN "panic_lockdown_portrait_playlist_id"  TEXT;
ALTER TABLE "tenants" ADD COLUMN "panic_weather_portrait_playlist_id"   TEXT;
ALTER TABLE "tenants" ADD COLUMN "panic_hold_portrait_playlist_id"      TEXT;
ALTER TABLE "tenants" ADD COLUMN "panic_secure_portrait_playlist_id"    TEXT;
ALTER TABLE "tenants" ADD COLUMN "panic_medical_portrait_playlist_id"   TEXT;
