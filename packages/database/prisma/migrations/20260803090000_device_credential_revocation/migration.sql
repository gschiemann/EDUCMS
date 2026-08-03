-- Additive only (V1 pilot rule): every column is nullable or carries a
-- default that reproduces today's behaviour for every already-paired
-- screen. No backfill, no data migration, zero fleet impact on deploy.
--
-- 2026-08-03 — device-token revocation + OTA failure-signal hardening.
-- See docs/research/2026-08-01-player-security-audit/05-DEVICE-TOKEN-AUTH.md
-- (DT-01, DT-02) and 06-OTA-SERVER-AUTHZ.md (OTA-02).

-- DT-01/DT-02 — the device-credential revocation store.
--   credential_epoch defaults to 0, and a device token minted before this
--   migration carries no `ep` claim, which the verifier reads as 0. The
--   two therefore MATCH for the entire deployed fleet: no screen loses
--   its credential at deploy time. Bumping the counter (unpair, re-pair
--   to a different tenant, explicit operator revoke, or rotation on the
--   screen's next /screens/register) is what retires an old token.
ALTER TABLE "screens" ADD COLUMN "credential_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "screens" ADD COLUMN "credential_epoch_rotated_at" TIMESTAMP(3);
ALTER TABLE "screens" ADD COLUMN "credential_revoked_at" TIMESTAMP(3);

-- OTA-02 — sticky OTA failure signal. The canary auto-promote gate used
-- to read `last_ota_state`, a last-writer-wins column that the player's
-- own "CHECKING" report (sent at the head of every OTA cycle) erased —
-- and that any anonymous caller could erase on purpose. These columns are
-- write-once-until-resolved: only a confirmed install or an operator
-- action clears them.
ALTER TABLE "screens" ADD COLUMN "last_ota_error_at" TIMESTAMP(3);
ALTER TABLE "screens" ADD COLUMN "last_ota_error_message" TEXT;
ALTER TABLE "screens" ADD COLUMN "last_ota_error_authenticated" BOOLEAN NOT NULL DEFAULT false;
