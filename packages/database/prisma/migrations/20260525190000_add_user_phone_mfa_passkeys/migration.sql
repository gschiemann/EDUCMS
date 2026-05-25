-- Add phone + MFA fields to users + passkeys table.
-- Purely additive: every new column is nullable / defaulted, existing
-- rows continue to load unchanged. Safe to apply to live pilot.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "mfa_totp_secret" TEXT,
  ADD COLUMN IF NOT EXISTS "mfa_totp_verified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mfa_backup_codes" JSONB,
  ADD COLUMN IF NOT EXISTS "mfa_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "passkeys" (
  "id"             TEXT NOT NULL,
  "user_id"        TEXT NOT NULL,
  "credential_id"  TEXT NOT NULL,
  "public_key"     BYTEA NOT NULL,
  "counter"        BIGINT NOT NULL DEFAULT 0,
  "transports"     TEXT[] NOT NULL DEFAULT '{}',
  "device_label"   TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at"   TIMESTAMP(3),
  CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "passkeys_credential_id_key" ON "passkeys"("credential_id");
CREATE INDEX IF NOT EXISTS "passkeys_user_id_idx" ON "passkeys"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'passkeys_user_id_fkey'
  ) THEN
    ALTER TABLE "passkeys"
      ADD CONSTRAINT "passkeys_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
