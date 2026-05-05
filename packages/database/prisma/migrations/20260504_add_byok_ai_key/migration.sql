-- 2026-05-04 — BYOK (Bring Your Own Key) for AI integrations.
--
-- Operator: "can we make the AI integration more user friendly? let
-- the end user just type in their credentials of their AI of choice
-- and then use their account and that way we don't have to worry
-- about paying for anything"
--
-- Strict additive migration:
--   - 4 new optional columns on `tenants`. No existing column is
--     touched. Tenants without these set fall back to the platform
--     ANTHROPIC_API_KEY (current behavior preserved).
--
-- Columns:
--   ai_provider              — 'anthropic' | 'openai' for v1.
--                              null = use platform default key.
--   ai_key_encrypted         — base64 envelope-encrypted API key
--                              (AES-256-GCM with master key from
--                              DEVICE_SECRET_KEY). Same scheme as
--                              streaming/creds-cipher.ts. Never
--                              returned to clients.
--   ai_key_set_at            — when the key was last saved/replaced.
--                              UI shows "set 2 days ago" without
--                              exposing the key itself.
--   ai_key_set_by_user_id    — the admin user who saved it. Used
--                              by audit log + the "Set by ..." line
--                              in the settings UI.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-running on environments
-- that hand-applied this is a no-op.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "ai_provider"          TEXT,
  ADD COLUMN IF NOT EXISTS "ai_key_encrypted"     TEXT,
  ADD COLUMN IF NOT EXISTS "ai_key_set_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ai_key_set_by_user_id" TEXT;
