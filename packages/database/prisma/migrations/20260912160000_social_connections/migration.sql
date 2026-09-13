-- 2026-09-12 — Instagram + Facebook Page connector (SocialProviderConnection,
-- SocialPost). Replaces the two "Coming soon" App-Library stubs with a real
-- connector that stays dormant until the Meta app keys exist.
--
-- ADDITIVE AND NON-DESTRUCTIVE: two brand-new tables. Nothing existing is
-- altered, so this cannot change the behaviour of any shipped surface — a
-- deploy without INSTAGRAM_APP_ID / META_APP_ID simply leaves them empty.
--
-- Every statement is IF NOT EXISTS so a database that already took this shape
-- from a `pnpm db:push` (this repo's dev flow is a schema diff, not migrate)
-- applies it as a no-op. The API also self-applies these identical statements
-- at boot — see the "Boot-time schema safety net" in apps/api/src/main.ts —
-- because Railway's start command never runs `prisma migrate deploy`.

CREATE TABLE IF NOT EXISTS "social_provider_connections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "display_name" TEXT,
    "encrypted_creds" TEXT NOT NULL,
    "encrypted_data_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "status_reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_sync_item_count" INTEGER,
    "scope" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT NOT NULL,
    CONSTRAINT "social_provider_connections_pkey" PRIMARY KEY ("id")
);

-- One row per (tenant, provider, provider-side account). A single Facebook
-- login can administer several Pages, and each Page is its own connection.
CREATE UNIQUE INDEX IF NOT EXISTS "social_provider_connections_tenant_id_provider_id_account_id_key"
    ON "social_provider_connections" ("tenant_id", "provider_id", "account_id");
CREATE INDEX IF NOT EXISTS "social_provider_connections_tenant_id_status_idx"
    ON "social_provider_connections" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "social_posts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "provider_post_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "media_url" TEXT,
    "thumbnail_url" TEXT,
    "permalink" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- The idempotency key the hourly sync upserts on: the same post fetched twice
-- is one row, never two.
CREATE UNIQUE INDEX IF NOT EXISTS "social_posts_connection_id_provider_post_id_key"
    ON "social_posts" ("connection_id", "provider_post_id");
-- The screen read: newest-first for one connection.
CREATE INDEX IF NOT EXISTS "social_posts_connection_id_posted_at_idx"
    ON "social_posts" ("connection_id", "posted_at");
-- The tenant-scoped read (`GET /integrations/social/posts`).
CREATE INDEX IF NOT EXISTS "social_posts_tenant_id_idx"
    ON "social_posts" ("tenant_id");

-- Deleting a connection takes its cached posts with it (the DELETE endpoint
-- marks REVOKED and keeps posts; this is the hard-delete path only).
DO $$
BEGIN
    ALTER TABLE "social_posts"
        ADD CONSTRAINT "social_posts_connection_id_fkey"
        FOREIGN KEY ("connection_id") REFERENCES "social_provider_connections"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
