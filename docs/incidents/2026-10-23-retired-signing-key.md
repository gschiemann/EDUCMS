# The retired-key outage: 14 screens dark for 16 hours (2026-10-23)

**Date:** 2026-10-23

## What happened

Born from the 2026-10-23 retired-key outage: a device-secret rotation finished with an API restart, 14 paired screens at 5 organisations went dark a minute later, every refusal was logged and nobody noticed for 16 h — the customer alert emails could not have caught it (they ignore screens silent > 6 h, and were deployed 12 h into the outage, so `screen_alert_incidents` stayed empty).

## Root cause

The `CHANGELOG.md` entry for the fix records it:

> Earlier the same day — retired signing key: screens that had not re-registered inside a `DEVICE_JWT_SECRET` rotation window were refused (`401 SCREEN_TOKEN_MISMATCH`) on every re-register after it closed and stayed dark; a prior token naming the screen that no current key verifies is now graded `unverifiable` and gets the same 1-hour credential + `requiresRePair` as no token at all (`isUnverifiableDeviceTokenForScreen`, `screens.register-retired-key.spec.ts`); token-issue audit rows carry a non-secret `mintKeyId`, and `scripts/railway-rotation.mjs finish` refuses to close a window while a live screen has no token on the new key (`DEVICE_*_PREVIOUS` row, `docs/SECRET-ROTATION.md` A-4/A-5).

## The rule it produced

`docs/ENVIRONMENT.md` → `DEVICE_SECRET_KEY_PREVIOUS` / `DEVICE_JWT_SECRET_PREVIOUS` (rotation windows; a rotation is closed by Resync) and `POST_RESTART_FLEET_CHECK_DISABLED` / `DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED` (the owner fleet alarms). Runbook: `docs/SECRET-ROTATION.md`.

## Evidence

- `docs/research/2026-10-23-rotation-strand/01-agent-report.md` and `docs/research/2026-10-23-rotation-strand/02-fleet-alarms-agent-report.md`.
- `CHANGELOG.md`, entries of 2026-10-23.
