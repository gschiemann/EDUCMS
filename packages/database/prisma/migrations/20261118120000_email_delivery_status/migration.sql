-- 2026-11-18 - what the mail provider reported after it accepted a message.
--
-- EmailLog.providerId / deliveryStatus / deliveryCheckedAt. Until now a row's
-- `status` only ever meant "handed to the provider". Two invitations were
-- recorded SENT, were accepted by the recipients' own mail server and were
-- never seen by the people they were for; nothing in the database could tell
-- "delivered" from "bounced". `provider_id` is the provider's id for the
-- message (Resend: the `id` of its 2xx answer), so its last delivery event can
-- be read back on demand (apps/api/src/email/email.service.ts,
-- `inviteDelivery`). `delivery_status` holds that event in our own words;
-- `delivery_checked_at` is when it was last read.
--
-- ADDITIVE AND NON-DESTRUCTIVE: three NULLABLE columns with no default, a
-- catalogue-only change at any row count. Every existing row reads NULL
-- ("not checked"), which is today's behaviour. Nothing is dropped, renamed or
-- rewritten, so the previous build keeps running against this shape.
--
-- "email_logs" is not a hot table (a few hundred rows, written once per mail),
-- but the ALTER still takes a brief ACCESS EXCLUSIVE lock, so it fails after
-- five seconds instead of queueing behind a long transaction.
--
-- IDEMPOTENT (`IF NOT EXISTS`) because dev databases take the shape via
-- `pnpm db:push` first.

SET lock_timeout = '5s';

ALTER TABLE "email_logs"
  ADD COLUMN IF NOT EXISTS "provider_id" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_status" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_checked_at" TIMESTAMP(3);
