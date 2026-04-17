-- CreateTable: EmergencyMessage
-- Sprint 5: Emergency System Expansion
-- Stores SOS, text broadcasts, and media-rich alerts.
-- Immutable by convention except for clearedAt / clearedByUserId when an all-clear is issued.
CREATE TABLE "emergency_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "triggered_by_user_id" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'CRITICAL',
    "text_blob" TEXT,
    "media_urls" TEXT,
    "audio_url" TEXT,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMP(3),
    "cleared_by_user_id" TEXT,

    CONSTRAINT "emergency_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emergency_messages_tenant_created_idx" ON "emergency_messages"("tenant_id", "created_at" DESC);
