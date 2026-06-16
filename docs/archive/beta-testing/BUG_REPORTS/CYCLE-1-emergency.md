# Cycle 1 — Emergency / Floor Plans / Panic Flow

Static review of the life-safety code paths. Files audited:
`apps/api/src/emergency/{emergency,screen-emergency}.controller.ts`,
`apps/api/src/floor-plans/floor-plans.controller.ts`,
`apps/web/src/app/panic/page.tsx`,
`apps/web/src/actions/trigger-emergency.ts`,
`apps/web/public/sw-player.js`, `apps/web/src/app/player/page.tsx`,
`apps/api/src/security/websocket-signer.service.ts`,
`apps/api/src/auth/{rbac.guard,panic-bypass.decorator}.ts`,
`packages/ws-events/src/index.ts`.

---

## P0 — Could break demo / life-safety

### P0-1. Hold-to-trigger is 1.5 s, not the 3 s documented in CLAUDE.md
`apps/web/src/app/panic/page.tsx:11` — `const HOLD_DURATION_MS = 1500;`
plus the in-page copy at line 238 ("Press and hold any button for 1.5
seconds"). CLAUDE.md "Key Safeguards #5" documents a 3-second hold to
prevent accidental taps. The implementation halves that window. Either
the doc is stale or the code is. On a phone in a pocket pressing a
panic button accidentally for 1.5 s is plausible; 3 s much less so. Pick
one source of truth and align — life-safety UX cannot disagree with
the spec it's audited against.

### P0-2. Mobile panic page bypasses `triggerEmergency` and loses `canTriggerPanic` capability data through the action layer
`apps/web/src/actions/trigger-emergency.ts:13-27` posts to
`/emergency/trigger` with the user's bearer token but the all-clear
function (line 41) hard-codes `overrideId='global_clear'` into the
URL: `${API_URL}/emergency/global_clear/all-clear`. The audit row for
the clear is therefore written with `overrideId: 'global_clear'`, not
the real overrideId from the trigger. Forensic reconstruction of an
incident now cannot pair a trigger with its matching clear. Audit-log
chain-of-custody is one of the contracted Sprint-1 deliverables.

### P0-3. Per-screen `screenEmergencyOverride` is NOT cleared when admin runs `/emergency/:overrideId/all-clear` on `device` scope
`emergency.controller.ts:520-531` — the `else` branch (non-tenant
scope) writes the audit row and publishes ALL_CLEAR over WS, but never
deletes the corresponding `screenEmergencyOverride` row. Tenant-scope
all-clear correctly issues `screenEmergencyOverride.deleteMany`
(line 506). If the player is offline at the moment of the all-clear,
on next reboot it polls
`/api/v1/emergency/screens/:screenId/override` (Sprint 8b) and gets
the stale row back — screen stays in lockdown forever from the
player's POV. Add a `deleteMany({ where: { screenId: scopeId } })` to
the device-scope branch (and `screenGroupId` filter for group-scope).

### P0-4. `screen-emergency.controller.ts` resolves caller tenant via `req.user.tenantId` only — DISTRICT_ADMIN tokens with only `districtId` populated will fall through
Lines 268, 283, 332, 359 use `req.user.tenantId` directly. The main
controller carefully falls back: `user.schoolId || user.tenantId ||
user.districtId` (line 586). For a DISTRICT_ADMIN whose `tenantId` is
the district id but whose JWT also carries `districtId`, this works.
But `bulkTrigger` line 361 does `where: { id: { in: ... }, tenantId:
callerTenantId }`. If `callerTenantId` is `undefined` (token shape
drift), Prisma silently treats `undefined` as "no filter on tenantId"
— a SUPER_ADMIN-ish accidental cross-tenant bulk-trigger. Validate
non-null before the query, or use the same fallback chain as the main
controller.

---

## P1 — UX rough / forensic gaps

### P1-1. Client-side WS verification only checks signature presence, not validity
`apps/web/src/app/player/page.tsx:1934-1945` — comment explicitly says
the client trusts presence of `msg.signature` rather than verifying
the HMAC: "we don't verify it here, but its absence means the message
didn't even pass through the signer service." A man-in-the-middle on
the WS channel (e.g., a compromised CDN proxy or a malicious browser
extension on a kiosk that's also being used as a workstation) could
inject `signature: 'lol'` and the player would render the override.
Real signature verification needs an asymmetric key per tenant — the
follow-up is acknowledged in code comments (line 1938) but not yet
queued. For a PUBLIC repo selling K-12 safety, this gap should be
ranked higher than "Sprint 9 polish."

### P1-2. `screen-emergency.controller.ts` swallows audit-log failure silently
Lines 235-236 and 308 — both `try { auditLog.create } catch { /* swallow */ }`.
If the audit insert fails (DB partition / FK violation / quota), the
emergency override still fires, the WS broadcast still goes out, but
no immutable record exists. The tenant-wide controller wraps audit
inside a `$transaction` so audit failure rolls back the trigger. Make
the per-screen controller match — atomic create+audit, or fail the
request. CLAUDE.md "Key Safeguards #2" calls audit logging
non-skippable.

### P1-3. SOS endpoint accepts a CONTRIBUTOR token but doesn't validate the location string for length / control chars
`emergency.controller.ts:579-661`. `body.location` is interpolated
into the audit details and the WS payload (line 595). Zod schema
caps it but is a CONTRIBUTOR-triggerable surface. If the schema does
not strictly bound `location` length and reject newlines, log
injection is possible (newlines into Sentry / Railway logs).
Verify `SosInputSchema` in `packages/api-types/src/emergency.ts`.

### P1-4. Floor plan upload allows arbitrary `widthPx`/`heightPx` from the client
`floor-plans.controller.ts:244-257`. Operator must supply the image
dimensions in the body — they're not extracted from the image
itself. If the operator (or a malicious script) lies and says a
1000 px image is 10000 px, every screen-position drag-drop on that
plan will be miscalibrated. Worse, the operator can't *correct* the
dimension after upload (no PUT field). Either probe the image
server-side with `image-size` (cheap, no decode) or store the field
as an editable hint and probe lazily on first render.

### P1-5. `ScreenEmergencyController.allClear` is not `@AllowPanicBypass`-decorated, but `trigger` is
Line 280 vs line 261. Asymmetric: an operator with `canTriggerPanic`
(non-admin staff) can fire a per-screen lockdown but cannot clear it.
If the on-site admin is at lunch when the receptionist hits the
button, the override stays until an admin signs in. Either add
`@AllowPanicBypass` to `allClear` (consistent with the main
controller pattern) or add a UI rollback path documented in the help
center.

### P1-6. Player does NOT subscribe to `device:<screenId>` WS channel — Sprint 8b broadcasts go nowhere except HTTP polling
Searched player page for device-channel subscription — no match.
`screen-emergency.controller.ts:252` publishes to `device:<screenId>`,
but the player only opens a tenant-scoped WS. So per-screen overrides
ride the 10 s HTTP polling fallback even when Redis is healthy. CLAUDE.md
"Sprint 8b pub/sub" claims "zero protocol change — player already
subscribes to its own device channel." It does not. Either wire the
subscription or remove the misleading comment.

---

## P2 — Polish

### P2-1. `clearEmergency` for non-tenant scope skips `invalidateTenantState`
`emergency.controller.ts:535` only calls invalidate when
`scopeType==='tenant'`. Group/device clears leave the manifest hot
cache stale for up to 2 s (the documented TTL). For an all-clear that
2 s window is the difference between a screen returning to normal
content and continuing to render the lockdown. Cheap fix: invalidate
on every clear regardless of scope.

### P2-2. WebsocketSigner replay window is 10 s but client tolerance is 30 s
`websocket-signer.service.ts:40` (`REPLAY_WINDOW_MS = 10_000`) vs
`player/page.tsx:1949` (`> 30_000`). A signed message that is
re-published by Redis after a network hiccup at second 25 will be
rejected by the API verifier (if it ever calls verify) but accepted
by the player. Pick one window.

### P2-3. Signer's local-fallback nonce eviction can drop unexpired keys under load
`websocket-signer.service.ts:141-144`. Once `LOCAL_SEEN_CAP` is hit,
oldest insertion is evicted whether expired or not. Under a sustained
nonce burst this re-opens the replay window for evicted ids. Fine for
now (10 k cap) but worth a warning log when the cap is hit.

---

## GREEN — looked good

- `resolveScopeTenant` in `emergency.controller.ts` is solid: every
  write path goes through it, scope→tenant lookup is type-safe, 403
  on cross-tenant.
- Tenant-wide trigger + audit + override upsert wrapped in
  `$transaction` (line 389-418) — atomic.
- Redis publish failure does not fail the trigger (Sentry breadcrumb
  + console warn). HTTP-polling fallback is the contract.
- Floor plan upload path is `${tenantId}/floor-plans/...` — tenant
  scoping correct (line 262).
- `RbacGuard` honors `RESTRICTED_VIEWER` defense-in-depth even if
  `canTriggerPanic=true` (line 69-73).
- Emergency module is verticality-agnostic — Tenant emergency fields
  exist for non-K12 tenants, no K12-only code path. VenueOS pivot
  did not regress this surface.
