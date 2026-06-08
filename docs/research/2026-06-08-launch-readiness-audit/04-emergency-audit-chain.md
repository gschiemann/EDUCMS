# Emergency System + Forensic Audit-Trail Security Audit — VenueOS (EDU CMS)

**Date:** 2026-06-08 · Read-only · Life-safety focus · Agent: ae4a8acac30645f9f

## Summary

The emergency chain is **genuinely sound for a real lockdown** — no longer theater. Every link traces to real callers:
- **Signing gate is REAL.** `WebsocketSignerService.signMessage()` is called on every emergency publish (trigger, all-clear, SOS, broadcast, media-alert, clear-message), and `verifyWsHmac()` is genuinely invoked at `redis.service.ts:137` on **every** `pmessage`/fan-out before either the WS gateway or SSE service receives it. A forged Redis publish is dropped at the gate. The old `verifyMessage()` zero-caller method was removed entirely.
- **Audit-log immutability is REAL at the DB layer** (Postgres triggers), not just code convention. 119 `auditLog.create` sites across 44 files; login (success+failure), templates, sponsors, billing, AI-key changes all write real rows.
- **Fallback tiers are closed.** Manifest carries live emergency state under device-JWT auth; the device-authed `GET /emergency/messages` poll exists and `EmergencyOverlay` uses it with the device Bearer token; SSE has real `broadcastToScope` handlers.

**No life-safety P0.** One real **P1** (a migration-ordering bug that can break user deletion — NOT the emergency path) plus P2/P3 hardening. The emergency path will deliver and clear a lockdown correctly across WS, SSE, and HTTP-poll tiers.

## Signing chain trace

| Link | Function → caller | Verdict |
|---|---|---|
| Sign on publish | `signMessage()` → `emergency.controller.ts:568` (OVERRIDE), `:664` (ALL_CLEAR), `:907` (SOS), `:989` (TEXT_BROADCAST), `:1075` (MEDIA_ALERT), `:1149` (clear-message) | **PROVEN** |
| Canonical string single-source | `wsCanonicalString()`/`wsHmacHex()` `ws-signature.ts:28/32`, imported by both | **PROVEN** — no drift |
| Server fan-out gate | `verifyWsHmac()` → `redis.service.ts:137` inside `handleRedisMessage`, before `gateway.broadcastToScope` (`:148`) + `sse.broadcastToScope` (`:149`) | **PROVEN** — both transports downstream |
| Freshness/replay window | `ws-signature.ts:71-73`, `maxAgeMs=120_000`, units **ms** both ends | **PROVEN** — no s/ms mismatch |
| Constant-time compare | `crypto.timingSafeEqual` + length pre-check `ws-signature.ts:85-88` | **PROVEN** |
| Redis-down path | `redis.service.ts:162` `publish()` fallback routes through the **same** `handleRedisMessage` → HMAC gate still applies | **PROVEN** — no gate-bypass |
| SSE consume | `sse.service.ts:121` only called from `redis.service.ts:149` (after gate) | **PROVEN** |
| Player verify | `player/page.tsx:3875-3901` — checks signature FIELD + freshness (30s) + per-eventId dedup, no HMAC (server-only secret) | **PARTIAL (by design)** — matches documented gap; Ed25519 player verify is the follow-up |

`SENSITIVE_TYPES` on the player (`page.tsx:3867`) now includes `OVERRIDE, TENANT_CHANGED, SOS, TEXT_BROADCAST, MEDIA_ALERT, ALL_CLEAR_MESSAGE` (closes a prior P0). `ALL_CLEAR` is intentionally excluded from the strict gate (fail-open is safer for clearing) and the authenticated manifest is the sole arbiter of clearing (`page.tsx:3902-3916`), so a forged ALL_CLEAR cannot drop a real alert.

### @AllowPanicBypass / canTriggerPanic
- Trigger endpoint guarded by `JwtAuthGuard + RbacGuard`, `@RequireRoles(SUPER/DISTRICT/SCHOOL_ADMIN)` + `@AllowPanicBypass()` (`emergency.controller.ts:352-354`).
- `RbacGuard` (`rbac.guard.ts:69-75`): bypass grants only when `canTriggerPanic && role !== RESTRICTED_VIEWER`. RESTRICTED_VIEWER hard-blocked even with flag. **Sound.**
- **canTriggerPanic read from JWT claim** (`jwt-auth.guard.ts:154`), **not re-checked against the live DB row.** Mitigated by mass-revocation: toggling true→false calls `revokeUserTokens` → `markUserTokensInvalid` (`users.controller.ts:434-435`) stamping a per-user `jwt_invalid_before` epoch in Redis; guard rejects `iat` < epoch (`jwt-auth.guard.ts:113-118`), fails **closed** on Redis read error. Revocation works — but see P2-1 for the no-Redis window.

## Audit-log coverage table

| Privileged action | Writes AuditLog? | file:line | Awaited / atomic? |
|---|---|---|---|
| Emergency TRIGGER | Yes | emergency.controller.ts:497/547 | **Yes — `$transaction`** |
| Emergency ALL_CLEAR | Yes | :685/707/733 | **Yes — `$transaction`** |
| SOS / TEXT_BROADCAST / MEDIA_ALERT / clear | Yes | :887/977/1058/1136 | Yes — `$transaction` |
| Login success | Yes (`AUTH_LOGIN_SUCCESS`) | auth.controller.ts:63/131 | Best-effort (try/catch, never blocks login) |
| Login failure | Yes (`AUTH_LOGIN_FAILED`) | auth.controller.ts:51/131 | Best-effort; **unknown-email via SYSTEM_TENANT sentinel** (:114-118) |
| Logout | Yes | auth.controller.ts:190 | Best-effort |
| canTriggerPanic change | Yes | users.controller.ts:411 | **Yes — `$transaction`** |
| Template CRUD/import | Yes | templates.controller.ts:56 | awaited |
| Sponsor CRUD | Yes | sports/sponsors.service.ts:61 | awaited |
| AI key set/clear/test-fail | Yes | ai/ai-key.controller.ts:238/267/305 | awaited |
| Billing / Stripe webhook | Yes | billing/stripe.service.ts | awaited |
| Branding/playlists/schedules/screens/devices/floor-plans/imports/SSO/Clever/POS/webhooks/API-keys | Yes | 44 files, 119 sites | awaited |

The prior "AuditInterceptor was theater (stdout only)" finding is **resolved**: `request-log.interceptor.ts` now explicitly demotes itself to stdout structured log and its comment (`:26`) points to the real coverage.

## Audit-log immutability
**DB trigger PRESENT — real, not code-only.** Two migrations:
- `20260526010000_audit_log_immutability/migration.sql` — `audit_log_immutable_no_update` + `_no_delete` (blanket BEFORE UPDATE/DELETE → RAISE EXCEPTION).
- `20260531000000_audit_logs_immutable/migration.sql` — `audit_logs_immutable` (blocks DELETE + content-UPDATE but **permits FK `user_id → NULL` anonymization** so user hard-deletes still work).

FK `ON DELETE SET NULL` (`20260415193743_init:218`); app hard-deletes users (`users.controller.ts:473`). **See P1-1 — the two migrations conflict.**

## Fallback-tier delivery verdict
**PROVEN closed across all three tiers** (prior P0 fixed):
- **Manifest** carries live emergency state — `emergencyActiveForThisScreen = !!activeScreenOverride || tenant.emergencyStatus !== 'INACTIVE'` (`screens.controller.ts:2593-2595`), under **device-JWT auth** (`verifyDeviceForScreen`, `:80`).
- **Group/device-scoped** triggers persist per-screen `ScreenEmergencyOverride` rows (`emergency.controller.ts:534-564`) so a poll-only kiosk sees a group/device lockdown; all-clear deletes them symmetrically (`:696-748`).
- **Device poll** `GET /emergency/messages` (`:1282`) requires `kind==='device'`, resolves tenant from the **live Screen row**, scope-filters per device.
- **Player** `EmergencyOverlay.tsx:98` polls `/emergency/messages` with the device Bearer token, falling back to `/status` only when no device token.
- **SSE** has real handlers (`sse.service.ts:121`) downstream of the HMAC gate.

## Findings ranked

### P1-1 — Migration ordering: the 2026-05-26 immutability triggers are never dropped → will block user deletion
**Severity: P1** (operational breakage + forensic foot-gun; NOT an emergency-path hole).
**Evidence:** `20260526010000_audit_log_immutability/migration.sql:38-49` creates `audit_log_immutable_no_update`/`_no_delete` (blanket block on ALL updates). `20260531000000_audit_logs_immutable/migration.sql:55` only drops/recreates the **differently-named** `audit_logs_immutable`. No migration ever drops the 0526-named triggers (grep across all 60+ migrations confirms only the 0526 file references those names).
**Blast radius:** On any DB that ran the 0526 migration (any env migrated between 2026-05-26 and 2026-05-31, **including production if it deployed in that window**), both trigger sets coexist. The 0526 `_no_update` trigger blocks the FK-null anonymization the 0531 trigger was written to permit. Result: `tx.user.delete()` (`users.controller.ts:473`) fires `UPDATE audit_logs SET user_id=NULL` → hits the 0526 trigger → `RAISE EXCEPTION` → **every SUPER_ADMIN user-deletion 500s and rolls back.** Likely never caught because a fresh `db:push` applies only the latest schema state, not historical triggers.
**Concrete fix (recommendation):** new migration `DROP TRIGGER IF EXISTS audit_log_immutable_no_update ON audit_logs; DROP TRIGGER IF EXISTS audit_log_immutable_no_delete ON audit_logs; DROP FUNCTION IF EXISTS audit_log_immutable();` leaving only the 0531 trigger. Verify on a prod clone: `SELECT tgname FROM pg_trigger WHERE tgrelid='audit_logs'::regclass;` — exactly one app-defined trigger. Do **not** weaken the 0531 trigger. **NEEDS GREG'S APPROVAL (Prisma migration).**

### P2-1 — canTriggerPanic revocation is a silent no-op on Redis-less deploys
**Severity: P2.** `revokeUserTokens` (`users.controller.ts:88-97`) is best-effort and swallows Redis failure; `getTokenInvalidBefore` (`redis.service.ts:240-247`) returns null when no Redis is configured. On a deploy with `REDIS_URL` unset (CLAUDE.md documents this as a supported HTTP-polling-fallback config), a true→false revocation never takes; the user keeps panic capability in their existing JWT for up to 30 days. Narrow blast radius (requires Redis-less prod + a revoked-but-live-token user; DB row source-of-truth is still updated). *Fix:* WARN at boot when `REDIS_URL` unset that "JWT mass-revocation is disabled," and/or re-check `canTriggerPanic` against the live DB row inside the `@AllowPanicBypass` branch (one indexed read on the emergency path).

### P2-2 — `resolveAuditTenantId` fallback can misattribute audit rows (dead path, latent)
**Severity: P2.** `emergency.controller.ts:325-350` — the `@deprecated` `resolveAuditTenantId` falls back to `reqUser.tenantId || ... || scopeId` on lookup failure. Not currently reachable (write paths use `resolveScopeTenant`, which throws), but a future refactor could reintroduce cross-tenant audit misattribution. *Fix:* delete the deprecated method or have it throw.

### P3-1 — Player does not cryptographically verify emergency signatures (documented follow-up)
**Severity: P3.** `player/page.tsx:3837-3846` checks the signature FIELD + freshness + dedup, not HMAC (secret is server-only). Server-side gate already drops forged messages before any player, so residual risk is only direct attacker-to-player injection bypassing the server. *Fix:* ship the documented Ed25519 player verification (per-tenant public key at pair time). Do not weaken the server gate.

### P3-2 — 120s server freshness vs 30s player window asymmetry
**Severity: P3 (informational).** Server accepts ±120s (`ws-signature.ts:60`), player ±30s (`page.tsx:3883`). Intentional and benign (stale OVERRIDE re-asserts; 10s manifest poll reconciles). Noted so a future change doesn't "fix" it by loosening the player.

---

**Files of record:** `redis.service.ts:137` (gate), `ws-signature.ts:51-91` (verify), `websocket-signer.service.ts:63` (signer), `emergency.controller.ts` (all trigger/clear), `rbac.guard.ts:69-75` + `jwt-auth.guard.ts:113-118,154`, `users.controller.ts:434-435,473`, `auth.controller.ts:86-147`, the two immutability migrations, `screens.controller.ts:80-111,2459,2593`, `EmergencyOverlay.tsx:98`, `sse.service.ts:121`.
