-- Playlists Operations v1 (2026-08-31): a deployment minted by a content
-- publish records WHICH playlist it carried, so the playlist workspace's
-- Delivery tab can show that playlist's own push history. Additive +
-- nullable — every existing row stays untouched (null = plain reload push
-- or pre-column row, honestly "not a playlist publish").
ALTER TABLE "deployments" ADD COLUMN "playlist_id" TEXT;

CREATE INDEX "deployments_tenant_id_playlist_id_created_at_idx"
  ON "deployments" ("tenant_id", "playlist_id", "created_at");
