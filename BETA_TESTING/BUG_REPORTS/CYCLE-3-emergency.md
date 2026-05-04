# CYCLE-3 emergency — retest report

Scope: verify cycle 1+2 fixes for emergency-001, 002, 003, 004, 007, 009; sweep for new bugs.

## Cycle 1+2 fix verification

| ID | Verdict | Evidence |
|---|---|---|
| emergency-001 | FIXED | `apps/web/src/app/panic/page.tsx:15` — `HOLD_DURATION_MS = 3000`. Comment cites cycle 1 BUG-001. |
| emergency-002 | FIXED | `apps/web/src/actions/trigger-emergency.ts:63-66` — falls back to `clear_${crypto.randomUUID()}` when no overrideId; otherwise passes the real id. |
| emergency-003 | FIXED | `apps/api/src/emergency/emergency.controller.ts:520-541` — device branch wraps `screenEmergencyOverride.deleteMany({where:{screenId, tenantId}})` inside `$transaction([...])` with the AuditLog write. deleteMany is safe for the no-row case. |
| emergency-004 | FIXED | `apps/api/src/emergency/screen-emergency.controller.ts:165-171` — `requireTenantId` throws ForbiddenException on missing tenantId; called at top of trigger (line 294), allClear (318), getOverride (369), bulkTrigger (394). `resolveScreen` also defends-in-depth at line 174-179. |
| emergency-007 | FIXED | `apps/api/src/emergency/emergency.controller.ts:626-628` — `safeLocation = body.location.replace(/[\r\n\t]/g, ' ').trim().slice(0, 500)`. Used in textBlob, AuditLog details, AND the signed payload. |
| emergency-009 | FIXED | `apps/api/src/emergency/screen-emergency.controller.ts:308` — `@AllowPanicBypass()` on allClear. Decorator parity with trigger restored. |

All six cycle-1/2 fixes land cleanly.

## NEW BUGS

### P0: emergency-011 — Device JWT carries no `deviceId`/`tenantId`, so per-screen WS push is silently broken in production

`apps/api/src/screens/screens.controller.ts:213-217` mints the device JWT as
`jwt.sign({ sub: screenId, kind: 'device', fp: body.deviceFingerprint }, ...)`. **No `deviceId`. No `tenantId`.**

`apps/api/src/realtime/realtime.gateway.ts:122-126`:
```ts
decoded = jwt.verify(token, jwtSecret) as any;
ctx.deviceId = decoded.deviceId;   // undefined in prod
ctx.tenantId = decoded.tenantId;   // undefined in prod
```

`broadcastToScope` at line 214-216 matches by `ctx.tenantId === id` and `ctx.deviceId === id`. With both fields undefined, EVERY signed emergency message published to `tenant:<id>` and `device:<screenId>` is dropped on the WS side. Players only get emergencies via the 10-second HTTP polling fallback.

This is the worst kind of life-safety regression: it works on a dev machine (DEV_WS_ALLOW=true uses the legacy `dev_<screenId>_<tenantId>` token format which DOES populate ctx fields), but Production (proper JWTs) silently routes nothing. The Sprint 8b per-screen override pub/sub `device:<screenId>` ALSO fails for the same reason. Cycle 1 emergency-010 is unfixed and arguably worse than reported — it isn't just per-screen, it's the entire WebSocket fanout.

**Fix:** add `deviceId: screenId, tenantId: <tenant>` to the JWT payload at `screens.controller.ts:213`. Also keep `sub` for back-compat. The gateway should fall back to `decoded.sub` if `deviceId` missing.

### P0: emergency-012 — ScreenEmergencyController blocks SUPER_ADMIN cross-tenant flows

The cycle-2 `requireTenantId` + `resolveScreen` filter `where: { id, tenantId: callerTenantId }` is correct for normal admins, but SUPER_ADMIN tokens DO carry their home tenantId (auth.service.ts:114). Result: a SUPER_ADMIN cannot trigger a per-screen emergency on a screen outside their own tenant — the resolve returns 404. The sibling `EmergencyController.resolveScopeTenant` at `emergency.controller.ts:198, 234` correctly uses `isSuper = req.user?.role === SUPER_ADMIN` to bypass the tenant check. ScreenEmergencyController has no such bypass.

For the active-shooter "fire on any screen" district-wide scenario, SUPER_ADMIN is exactly the role that needs this. Mirror the `isSuper` check in `resolveScreen` and `bulkTrigger`'s findMany.

### P1: emergency-006 still NOT fixed — per-screen audit failures silently swallowed

`apps/api/src/emergency/screen-emergency.controller.ts:241-260` and `333-344` both wrap `auditLog.create` in `try { ... } catch { /* swallow */ }`. The override mutation already happened — if the audit write fails (FK constraint, DB blip), there is NO forensic trail for who fired what on which screen. At minimum capture to Sentry. Better: include audit in the same `$transaction` as the upsert (matches the tenant-scope path).

### P2: emergency-013 — Stale UI string on panic page

`apps/web/src/app/panic/page.tsx:242` reads "Press and hold any button for 1.5 seconds to broadcast." The actual hold is 3000ms (cycle-1 fix). Trivial copy mismatch but it's instruction text staff trust during an emergency.

### P2: emergency-014 — Outdated test expectation for emergency-002

`apps/api/src/emergency/emergency.controller.spec.ts` was not re-read but if any test still asserts the old `'global_clear'` literal it will fail or — worse — pass against a stub. Worth a sweep.

## Floor-plan + per-screen flow

`floor-plans.controller.ts` reads `req.user.tenantId` directly (lines 118, 152, 241, 313, 334, 379). Same SUPER_ADMIN cross-tenant gap as emergency-012 — pre-existing, not new. `emergency-011` is the bigger blocker for the device branch since the WS path is broken for everyone.
