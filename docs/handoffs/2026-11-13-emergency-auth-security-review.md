# Emergency + auth path — defensive security review (2026-11-13)

Owner-requested review of VenueOS's own code. Read-only: no code changed, nothing
run against any live system. Base: `master` @ `d50a13d`.

**Covered:** `RbacGuard` + `@AllowPanicBypass`; all ten bypass routes
(`emergency.controller.ts`, `screen-emergency.controller.ts`) and their tenant
scoping (`resolveScopeTenant`, `resolveScreen`, `isDescendantTenant`); the Redis
fan-out signature gate (`security/ws-signature.ts`, `realtime/redis.service.ts`),
WS and SSE forwarding, the player's SSE gate; JWT algorithm pinning; user-token
revocation (`jwt-auth.guard.ts`, `redis.service.ts`).

**Not covered (say so before anyone calls this an audit):** MFA / TOTP / passkey
flows, password reset and setup links, device pairing and credential renewal,
tenant isolation outside the emergency routes, rate limits, dashboard XSS/CSRF,
the APK, the renderer, sports feed credentials. Not mapped against all sections of
`docs/governance/AUDIT-SURFACE.md`.

## Findings

### F1 — MEDIUM — A Redis key loss silently un-revokes sessions
`realtime/redis.service.ts` `checkUserInvalidBefore` (line 731) treats a Redis
**miss** as "confirmed: not revoked". The Postgres mirror is consulted only when
Redis **errors**. `checkTokenRevoked` (line 493, the logout list) has the same shape.
No code reloads the mirror into Redis. So if Redis loses keys (restart without
persistence, `FLUSHALL`, failover to an empty replica, or an eviction policy that
evicts keys with a TTL), every role downgrade, `canTriggerPanic` removal and
logout made before that point stops being enforced until the token expires
(access token 1 h; refresh re-reads the live row, per `auth.service.ts`).
Concretely: a staffer whose panic permission was just removed could still trigger
an alert for up to an hour after a Redis restart.
Unverified: whether the production Redis persists data and its `maxmemory-policy`.
**Fix options:** (a) on a miss, consult the durable store through the existing
per-replica fallback cache; or (b) reload revocation rows into Redis on every
(re)connect, and refuse "confirmed" until the reload finishes; plus (c) document
`noeviction` + persistence as a Redis requirement. Auth class → consequential (owner
approval, different-vendor review).

### F2 — LOW — `POST /screen-emergency/bulk-trigger` has no schema validation
`screen-emergency.controller.ts` ~line 562 takes `@Body() body: { screenIds; override }`
with no `ZodValidationPipe`, unlike `/emergency/trigger`. A missing `override` throws
a TypeError (500, not 400). `screenIds` entries are not type-checked (non-strings
reach Prisma). No authorization impact found: tenant filter and media-URL allowlist
still apply. **Fix:** a Zod schema matching `TriggerEmergencyInputSchema`.

### F3 — LOW (latent) — Floor-plan / zone / scenario ids are not tenant-checked
`validateOverride` (`screen-emergency.controller.ts` ~lines 165-167) stores
`floorPlanId`, `floorZoneId` and `scenarioId` from the request and broadcasts them,
without the ownership check `playlistId` gets. Today nothing resolves these ids into
data (`alert-stack.ts` only echoes them; the floor-plans controller scopes by tenant),
so there is no leak. If a future change renders "the floor plan named in the alert",
it would expose another school's floor plan. **Fix:** check ownership exactly like
`playlistId` (`findFirst({ where: { id, tenantId: screen.tenantId } })`).

### F4 — LOW — SSE forwards unsigned envelope fields; WS does not
`redis.service.ts` line 278 passes the whole parsed Redis message to
`sse.service.ts` `broadcastToScope` (line 222). The signature covers only
`eventId/timestamp/type/payload` (+ channel). The WS gateway forwards only those
fields plus `signature`; SSE forwards any extra top-level fields too. Exploiting this
needs Redis PUBLISH plus a fresh, validly signed envelope, and the player reads
`payload`. **Fix:** forward
`{ eventId, timestamp, type, payload, signature }` on SSE too.

## Verified sound (with the evidence)
- **Panic bypass + scoping.** `RbacGuard` returns before its scope check for bypass
  routes (`rbac.guard.ts` 69-75) — by design. All 10 bypass handlers scope on their own:
  the 4 scope writes via `resolveScopeTenant` (403 unless own tenant, DISTRICT_ADMIN
  downward via a cycle-guarded `isDescendantTenant`); `clearMessage`, `targets` and
  `active` by caller tenant / subtree; screen routes via `requireTenantId` +
  `resolveScreen` (`findFirst` with `tenantId`) and a `tenantId` filter on bulk.
  `RESTRICTED_VIEWER` never passes the bypass. SUPER_ADMIN cross-tenant needs
  `assertSupportReach` (customer-approved grant).
- **Signature gate.** HMAC-SHA256, constant-time compare, ±120 s freshness, signature
  bound to the channel (legacy unbound form disabled), channel must be exactly
  `type:id`, key ring for rotation, publish never mints a signature for unsigned data.
  The player SSE path runs the same freshness + eventId-dedup gate as WS.
- **JWT.** `algorithms: ['HS256']` pinned on verify; revocation lookups where Redis
  and Postgres are both down fail closed except the documented device-GET grace.

## Threat model (emergency path)
| Threat | Defence | Status |
|---|---|---|
| Non-admin triggers an alert | `@RequireRoles` / `canTriggerPanic` + audit | OK; see F1 for revoked staff |
| Cross-tenant trigger/clear | per-route resolvers | OK |
| Forged push via Redis | server HMAC gate, channel-bound | OK |
| Replay to another tenant | channel binding | OK |
| Replay within 120 s | player eventId dedup; manifest reconciles | Accepted, documented |
| Forged push past the server (on-path to the player) | player checks only that a signature is present; TLS | Known gap — asymmetric signing is the planned design |
| Suppress via forced SSE + replayed ALL_CLEAR | SSE gate (R-04) + manifest backstop | OK |
| Cross-tenant data via alert payload ids | — | F3 (latent) |

## Next steps
F1 first (auth class: owner's written go + different-vendor review). F2–F4 are small
emergency-path changes, so they are CHANGE class too: ≤L1, different-vendor review,
an on-glass drill before merge. Then the uncovered areas above.
