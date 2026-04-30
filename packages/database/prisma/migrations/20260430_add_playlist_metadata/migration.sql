ALTER TABLE "playlists"
  ADD COLUMN "created_by_user_id" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "playlists"
  ADD CONSTRAINT "playlists_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "playlists_tenant_id_updated_at_idx" ON "playlists"("tenant_id", "updated_at");
CREATE INDEX "playlists_tenant_id_created_at_idx" ON "playlists"("tenant_id", "created_at");
CREATE INDEX "playlists_created_by_user_id_idx" ON "playlists"("created_by_user_id");
