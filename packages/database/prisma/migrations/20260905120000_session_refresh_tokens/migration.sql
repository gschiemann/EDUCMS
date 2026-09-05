-- SEC-010 — durable, rotating session refresh tokens (see schema.prisma).
CREATE TABLE "session_refresh_tokens" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "orig_iat" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,

    CONSTRAINT "session_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_refresh_tokens_token_hash_key" ON "session_refresh_tokens"("token_hash");
CREATE INDEX "session_refresh_tokens_family_id_idx" ON "session_refresh_tokens"("family_id");
CREATE INDEX "session_refresh_tokens_user_id_idx" ON "session_refresh_tokens"("user_id");
CREATE INDEX "session_refresh_tokens_expires_at_idx" ON "session_refresh_tokens"("expires_at");
