-- Additive (V1 pilot rule): push-channel health stamp.
-- 2026-07-31 incident: a kiosk ran poll-only for an entire day (WS + SSE both
-- dead on its network) and nothing surfaced it — push commands (refresh-web,
-- instant all-clear) silently no-oped while the wedge detector spam-retried.
-- Stamped by the WS gateway on AUTH_OK + heartbeats and by the SSE service on
-- connect + keepalive ticks (debounced server-side).
ALTER TABLE "screens" ADD COLUMN "last_push_connected_at" TIMESTAMP(3);
