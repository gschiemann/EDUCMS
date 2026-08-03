-- 2026-08-03 — ACC-06 follow-up: make API-key actions forensically
-- attributable, and give a key a real least-privilege grant.
--
-- ADDITIVE ONLY (V1 pilot rule): two nullable columns + one index. No drop, no
-- rename, no type change, no NOT NULL, no backfill. Every existing row stays
-- valid as-is and every existing query keeps working unchanged.
--
-- WHY EACH ONE
--
-- audit_logs.api_key_id — an action driven by a tenant API key has no human
--   principal, so `user_id` is NULL on every row it produces. Until now that
--   made the row anonymous: "which key deleted that playlist?" could only be
--   ANSWERED BY INFERENCE, correlating the anonymous action row against a
--   separate API_KEY_REQUEST row by (tenant_id, timestamp) — which is a guess,
--   and a wrong one the moment two keys are active at once. The writer now
--   stamps the key id on the action row itself.
--
--   Deliberately NOT a foreign key. tenant_api_keys cascade-deletes with its
--   tenant; a FK here would make that cascade attempt a DELETE/SET NULL against
--   audit_logs, which the §16 append-only trigger (20260531000000 /
--   20260717120000) refuses — converting an unrelated cleanup into a hard
--   failure. Key rows are soft-revoked (revoked_at), never deleted, so the id
--   remains resolvable without the constraint.
--
-- tenant_api_keys.scopes — JSON-encoded string array of scope ids
--   (see apps/api/src/api-keys/api-key-scopes.ts). NULL is meaningful and is
--   NOT the same as '[]':
--     NULL → minted before scopes existed, or explicitly minted unrestricted.
--            No scope narrowing; role + the guard's denied-path list still
--            apply. This is what makes the column additive: every key already
--            in the table keeps working exactly as it did.
--     '[]' → an explicit grant of nothing; every route refused.
--   Emergency routes are NOT expressible as a scope and stay denied to machine
--   credentials either way (JwtAuthGuard API_KEY_DENIED_PATH_PREFIXES).
--
-- The index serves the incident-response query — "everything key X ever did,
-- newest first" — which would otherwise be a full scan of one of the largest
-- tables in the product.

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "api_key_id" TEXT;

CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_api_key_id_created_at_idx"
  ON "audit_logs"("tenant_id", "api_key_id", "created_at");

ALTER TABLE "tenant_api_keys" ADD COLUMN IF NOT EXISTS "scopes" TEXT;
