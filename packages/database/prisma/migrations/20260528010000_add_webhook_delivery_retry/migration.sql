-- Audit P1-5 (2026-05-28): durable outbound-webhook delivery records + a
-- bounded exponential-backoff retry ledger.
--
-- Before this, WebhookDispatchService POSTed once and only stamped
-- last_delivery_* on the tenant_webhooks row — values that the very next
-- event clobbered, with NO retry. A receiver that was down for 8 seconds
-- during a lockdown lost `emergency.triggered` PERMANENTLY.
--
-- `webhook_deliveries` makes every delivery durable. Failed deliveries
-- (non-2xx / timeout / network error) are re-attempted by
-- WebhookRetryWorker on an exponential backoff (~5s / 30s / 120s, 3
-- retries) until they succeed or exhaust attempts (then status=FAILED).
--
-- Multi-replica safety: the worker claims due rows with an atomic
--   UPDATE ... WHERE id IN (SELECT id ... FOR UPDATE SKIP LOCKED) RETURNING
-- so two replicas never double-deliver the same row.
--
-- The original signed `body` + `signed_timestamp` are persisted so a
-- retry reproduces a byte-identical payload AND a byte-identical
-- HMAC-SHA256(secret, `${signed_timestamp}.${body}`) signature — a
-- receiver that dedups on the signature / delivery-id sees the retry as
-- the same logical event, not a new one.
--
-- Purely additive: one new table. Cascade-deletes with its parent
-- tenant_webhooks row (which in turn cascades from tenants), so a wiped
-- webhook / tenant leaves no orphaned delivery rows. Existing queries are
-- untouched.

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id"                TEXT PRIMARY KEY,
  "webhook_id"        TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "event"             TEXT NOT NULL,
  -- Exact JSON body that was (or will be) POSTed — replayed verbatim on retry.
  "body"              TEXT NOT NULL,
  -- UNIX-ms timestamp folded into the signature at first send; constant across retries.
  "signed_timestamp"  BIGINT NOT NULL,
  -- PENDING (queued / in-flight) | DELIVERED | FAILED (permanent, gave up).
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  -- Null once terminal; otherwise the earliest time a worker may claim this row.
  "next_retry_at"     TIMESTAMP,
  "last_status_code"  INTEGER,
  "last_error"        TEXT,
  "created_at"        TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMP NOT NULL,
  CONSTRAINT "webhook_deliveries_webhook_id_fkey"
    FOREIGN KEY ("webhook_id") REFERENCES "tenant_webhooks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Worker hot path: "every row due for retry right now."
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_next_retry_at_idx"
  ON "webhook_deliveries"("status", "next_retry_at");

-- Per-webhook delivery history lookups (operator UI, cleanup sweeps).
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_id_idx"
  ON "webhook_deliveries"("webhook_id");
