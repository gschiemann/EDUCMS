-- Protected playlists for emergency content. Hidden from /playlists,
-- cannot be deleted by admin. Used by Tenant.panicLockdownPlaylistId
-- etc. so an accidental delete can never break a lockdown alert.
ALTER TABLE "playlists" ADD COLUMN "is_protected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "playlists" ADD COLUMN "protected_kind" TEXT;
CREATE INDEX "playlists_tenant_id_is_protected_idx" ON "playlists"("tenant_id", "is_protected");
