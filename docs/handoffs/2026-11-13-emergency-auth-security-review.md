# Emergency + auth hardening — change record (2026-11-13 → 11-14)

**Why this file is short.** This repository is public (`docs/DEPLOY.md`, "Repository visibility"). A
report that maps a weakness belongs in the private standard repository (`AGENT-DISPATCH.md` rule 8),
not here. The detailed review — findings, threat model, evidence — is held privately by the owner,
pending transfer to `foundry-standard` `decisions/`. This file records what changed, how it was
validated, and how to roll it back.

## Scope reviewed (2026-11-13)

`RbacGuard` and `@AllowPanicBypass`; the ten bypass routes and their tenant scoping; the Redis fan-out
signature gate and WS/SSE forwarding; JWT verification; user-token revocation. Not part of that
review: MFA/passkeys, password reset and setup links, device pairing, tenancy outside the emergency
routes, rate limits, the dashboard, the APK, the renderer, sports feed credentials.

## What changed (PR #312)

| | Change | Where |
|---|---|---|
| Revocation continuity | A marker key (`revocation:continuity`, no TTL) is read in the same Redis pipeline as every revocation key. While it is present, Redis answers alone. While it is absent, revocation lookups use the Postgres mirror and one restore copies the mirror back into Redis; the marker is set only when that restore completes on an un-wiped Redis. Boot logs an ERROR for a `maxmemory-policy` other than `noeviction`. | `apps/api/src/realtime/redis.service.ts`; `docs/DEPLOY.md` |
| Per-screen trigger input | Zod schema on `POST emergency/screens/:screenId/trigger` and `bulk-trigger`; free text still truncated, never refused. | `apps/api/src/emergency/screen-emergency.controller.ts` |
| Floor references | `floorPlanId` / `floorZoneId` must belong to the targeted screens' tenant; `scenarioId` is a short label. | same |
| Fan-out envelope | WS and SSE receive only `{eventId, timestamp, type, payload, signature}`. | `redis.service.ts` |
| All-clear keyboard | Enter in the CLEAR field runs the same guarded all-clear as the button; ignored during IME composition. | `apps/web/src/components/layout/EmergencyOverlay.tsx` |

## Validation

- New specs: `redis-revocation-continuity.spec.ts`, `screen-emergency.input-and-refs.spec.ts`, a case in `redis.service.spec.ts`, five Enter cases in `EmergencyOverlay.targeting.test.tsx`. Each fix's tests fail with that fix removed.
- Revocation continuity run against a real local `redis-server`, including a wipe and a wipe mid-restore.
- Full API suite green except `assets-accept-containers.controller.spec.ts`, which fails identically on `master` on a machine with ffmpeg < 8.
- **Unverified:** the `Emergency path` e2e jobs (CI), a WebKit run of the CLEAR-field Enter, production Redis persistence and eviction policy, the on-glass drill.

## Rollback

Revert PR #312. No schema change, no migration. The keys it writes (`revocation:continuity`,
`revocation:restore_run`, `jwt_revoked_hashes`) are ignored by the previous build.
