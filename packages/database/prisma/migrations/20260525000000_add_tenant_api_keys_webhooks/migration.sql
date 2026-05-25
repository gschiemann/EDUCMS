-- 2026-05-25 — Developer area: tenant-scoped REST API keys + outbound
-- webhooks. Operator (2026-05-25 settings bug-bash): "lets build out a
-- developer sections and add everything under that".
--
-- Both tables purely additive — no impact on existing rows or queries.
-- Cascade-delete on tenant removal so a wiped tenant doesn't leave
-- orphaned credentials.

-- ─── REST API keys ────────────────────────────────────────────────
--
-- Tenant-scoped bearer tokens. Token format at issue time:
--   vos_<32-hex-chars>
-- The `prefix` column stores the first 8 chars of the hex portion for
-- O(1) index lookup at request time. The `hashed_secret` column stores
-- a bcrypt hash of the FULL token (prefix + remaining 24 chars); the
-- plaintext is shown to the operator ONCE on creation and never again.
--
-- `role` is one of the AppRole strings (SUPER_ADMIN, DISTRICT_ADMIN,
-- SCHOOL_ADMIN, CONTRIBUTOR, RESTRICTED_VIEWER) — same enum the
-- existing JwtAuthGuard checks, so RBAC just works.
CREATE TABLE "tenant_api_keys" (
  "id"                  TEXT PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "prefix"              TEXT NOT NULL UNIQUE,
  "hashed_secret"       TEXT NOT NULL,
  "role"                TEXT NOT NULL,
  "expires_at"          TIMESTAMP,
  "last_used_at"        TIMESTAMP,
  "revoked_at"          TIMESTAMP,
  "created_at"          TIMESTAMP NOT NULL DEFAULT NOW(),
  "created_by_user_id"  TEXT,
  CONSTRAINT "tenant_api_keys_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "tenant_api_keys_tenant_id_idx" ON "tenant_api_keys"("tenant_id");

-- ─── Outbound webhooks ────────────────────────────────────────────
--
-- Tenant-scoped POST URLs that receive signed JSON payloads when
-- specific events fire (emergency.triggered, emergency.cleared,
-- screen.online, playlist.published, ...). The `events` column is
-- a JSON-encoded string array of subscribed event types; this dodges
-- a M2M table for what is effectively a small list per webhook.
--
-- `signing_secret` is the HMAC-SHA256 secret the receiver uses to
-- verify the X-VenueOS-Signature header on incoming POSTs. Returned
-- to the operator ONCE at creation; rotating is a delete-and-recreate.
CREATE TABLE "tenant_webhooks" (
  "id"                    TEXT PRIMARY KEY,
  "tenant_id"             TEXT NOT NULL,
  "name"                  TEXT NOT NULL,
  "url"                   TEXT NOT NULL,
  "events"                TEXT NOT NULL DEFAULT '[]',
  "signing_secret"        TEXT NOT NULL,
  "is_active"             BOOLEAN NOT NULL DEFAULT TRUE,
  "last_delivery_at"      TIMESTAMP,
  "last_delivery_status"  INTEGER,
  "last_delivery_error"   TEXT,
  "created_at"            TIMESTAMP NOT NULL DEFAULT NOW(),
  "created_by_user_id"    TEXT,
  CONSTRAINT "tenant_webhooks_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "tenant_webhooks_tenant_id_is_active_idx"
  ON "tenant_webhooks"("tenant_id", "is_active");
