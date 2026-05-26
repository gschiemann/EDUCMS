-- 2026-05-26 P0-7 audit fix — Stripe webhook idempotency + out-of-order
-- protection.
--
-- Three concerns from the audit, addressed here:
--   1. Stripe retries on any 5xx and may re-deliver the same event.id.
--      The new `processed_stripe_events` table is an atomic dedup ledger
--      keyed on Stripe's event.id (evt_*). The webhook handler INSERTs
--      here BEFORE any side-effect; a duplicate delivery hits the unique
--      primary key and the handler short-circuits with a 200 ack.
--   2. Stripe events are NOT ordered — a stale `customer.subscription
--      .updated` (status=active) can arrive AFTER an
--      `invoice.payment_failed` (status=past_due) and flip the License
--      back to ACTIVE incorrectly. `licenses.stripe_last_event_created_at`
--      stores the UNIX-second creation timestamp of the most-recent
--      event that mutated this License; the handler rejects any
--      state-flipping event whose `event.created` is older.
--   3. Audit-log forensics on Stripe-driven License mutations land in
--      a separate code change (no schema work needed — `audit_logs`
--      already exists).
--
-- Both changes are purely additive — new table, new nullable column.
-- Safe to apply to the live pilot tenant without downtime; existing
-- queries are unaffected.

-- ─── Idempotency ledger ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "processed_stripe_events" (
  "id"           TEXT PRIMARY KEY,                     -- Stripe event.id (evt_*)
  "type"         TEXT NOT NULL,                        -- event.type for forensics
  "processed_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Cleanup query support — Stripe recommends pruning the ledger after
-- ~30 days; the recurring sweep filters on processed_at.
CREATE INDEX IF NOT EXISTS "processed_stripe_events_processed_at_idx"
  ON "processed_stripe_events"("processed_at");

-- ─── Out-of-order protection ──────────────────────────────────────
ALTER TABLE "licenses"
  ADD COLUMN IF NOT EXISTS "stripe_last_event_created_at" TIMESTAMP;
