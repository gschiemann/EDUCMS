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

## Fixes (2026-11-14) — owner's written go: "Ok fix everything"

Branch `claude/jolly-newton-on7lv4`. **Not merged. No PR opened.** Still needed before
merge: a review by a different vendor (auth + emergency are consequential), CI green on
the PR (the two `Emergency path` e2e jobs were not run locally), and, for F2–F4, an
on-glass drill on a bench screen.

| | Change | Where |
|---|---|---|
| F1 | Continuity marker `revocation:continuity` (no TTL) read in the same Redis pipeline as every revocation key. Marker present → Redis answers alone (one round trip, as before). Marker absent → a hit is still enforced, a miss is NOT trusted: the existing Postgres path answers and ONE restore copies every unexpired mirror row back (invalid-before markers via a never-lower Lua script; revoked tokens as sha256 into `jwt_revoked_hashes`, since the mirror never held raw tokens). The marker is set only if the run's own key survived (atomic Lua), so a wipe mid-restore leaves it absent. Also restores at boot (fire-and-forget) and logs an ERROR when `maxmemory-policy` is readable and not `noeviction`. Only a failed restore throttles the next attempt (30 s). | `apps/api/src/realtime/redis.service.ts`; `docs/DEPLOY.md` |
| F2 | Zod schema on `POST :screenId/trigger` and `POST bulk-trigger`. Free text stays lenient (still truncated, never refused); ids are bounded; null optionals still accepted. | `apps/api/src/emergency/screen-emergency.controller.ts` |
| F3 | `floorPlanId` / `floorZoneId` must belong to the tenant of every targeted screen (zone on the named plan); 404 before any write. `scenarioId` (no table yet) is held to `^[A-Za-z0-9_-]{1,64}$`. No current client sends any of the three. | same |
| F4 | The fan-out forwards only `{eventId, timestamp, type, payload, signature}` to WS and SSE. | `redis.service.ts` `handleRedisMessage` |

**Evidence.**
- New specs: `redis-revocation-continuity.spec.ts` (15), `screen-emergency.input-and-refs.spec.ts` (13), plus one F4 case in `redis.service.spec.ts`; `redis-revocation-durable.spec.ts` fake updated for the pipeline.
- Negative controls: with the old "trust the miss" logic put back, 6 continuity tests fail; with the F3 check and the F4 projection disabled, 5 tests fail. Fixes restored, all pass.
- Real Redis (local `redis-server` 7, throwaway spec, not committed): revoke a user + log out a token → `FLUSHALL` → both still revoked (Postgres answers) → restore runs → Redis answers alone with no DB read; the never-lower script and the wipe-mid-restore refusal both hold with the real Lua.
- Full API suite: 638 suites / 12,122 tests pass. The one failing suite, `assets-accept-containers.controller.spec.ts` (12 tests), fails identically on `master` with these changes stashed — the machine has ffmpeg 6.1 and those tests need ≥ 8.
- Gates: build typecheck, `check-tenant-isolation` (0 new), `check-env-declared`, `check-rulebook` pass. ESLint (not run by CI for the API) is at or below `master`'s count on both changed source files.

**Unverified.** The production Redis's persistence and `maxmemory-policy` (the boot log will say);
the `chromium/webkit · Emergency path` e2e jobs; the on-glass drill.

**Failure direction / kill switch.** No new environment variable. F1 fails toward Postgres: a
restore that fails leaves the marker absent and lookups keep using the Postgres mirror — the
Redis-outage path that already existed (SEC-012 posture if Postgres is down too). A kill switch
that turned the check off would re-open the hole, so none was added; flag it if you want one.
Cost: one more `EXISTS` (and, for tokens, one `SISMEMBER`) inside the same pipeline — same round
trips as before.

**Rollback.** Revert the commit. No schema change, no migration. The keys it writes
(`revocation:continuity`, `revocation:restore_run`, `jwt_revoked_hashes`) are ignored by the old
code and expire or can be deleted.
