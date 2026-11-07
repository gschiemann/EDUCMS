**Scope:** this file governs `apps/api/src/emergency/` and carries the emergency-path rules wherever the old single-file `CLAUDE.md` kept them; `/CLAUDE.md` and `/AGENTS.md` are the core it refines — where they disagree, the core wins. The text below moved here verbatim on 2026-11-01 (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`).

# Emergency rulebook (life safety)

## Emergency System (Load-Bearing)

This system triggers immediate lockdown/weather/evacuation alerts across screens. Design is defensive against both technical failure and social engineering.

### Controller Endpoints
- **POST `/api/v1/emergency/trigger`** — Dispatch emergency alert
  - Body: `{ scopeType: 'tenant'|'group'|'device', scopeId, overridePayload: { type, severity, mediaUrl, textBlob, expiresAt, playlistId, ... } }`
  - Returns: `{ success: true, overrideId, message }`
  - Roles: SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN (`@RequireRoles`); `@AllowPanicBypass()` additionally admits any non-`RESTRICTED_VIEWER` user whose `canTriggerPanic` flag is true, without the role check (Key Safeguards 1)
  - Effects:
    - Updates Tenant.emergencyStatus and Tenant.emergencyPlaylistId
    - Creates immutable AuditLog entry
    - Signs message with WebsocketSignerService and publishes to Redis channel `${scopeType}:${scopeId}`
    - Falls back to HTTP polling if Redis unavailable

- **POST `/api/v1/emergency/:overrideId/all-clear`** — Cancel alert
  - Body: `{ scopeType, scopeId }`
  - Returns: `{ success: true, message }`
  - Effects: Clears emergencyStatus, logs action, publishes ALL_CLEAR message

### Key Safeguards
1. **@AllowPanicBypass Decorator** (`apps/api/src/auth/panic-bypass.decorator.ts`, read by `RbacGuard` in `apps/api/src/auth/rbac.guard.ts`) — it WIDENS access; it does not restrict it. On a route that carries it, a user whose `canTriggerPanic` flag is true is admitted without meeting the route's `@RequireRoles` — that is how a receptionist, security guard or nurse with a wall panic button can fire an alert without admin rights. An admin sets the flag per user; it rides in the JWT claim (`req.user.canTriggerPanic`), and removing it takes effect by rejecting that user's older tokens (`users.controller.ts` records a per-user invalid-before epoch, `jwt-auth.guard.ts` enforces it). `RESTRICTED_VIEWER` is never admitted this way, even with the flag set. The guard returns `true` at that point — before its role check and before its district/school scope check — so tenant scoping on these routes is the controller's job (`emergency.targeting.spec.ts` pins that a delegated staffer is confined to their own tenant). It is meant only for emergency routes and is applied today to ten handlers: in `emergency.controller.ts` `POST trigger`, `POST :overrideId/all-clear`, `POST broadcast`, `POST media-alert`, `POST messages/:messageId/all-clear`, `GET targets` and `GET active`; in `screen-emergency.controller.ts` `POST :screenId/trigger`, `POST :screenId/all-clear` and `POST bulk-trigger`.
2. **Immutable Audit Log** — Every trigger/clear is logged with userId, severity, overrideId, timestamp. No deletion or modification allowed.
3. **Signed WebSocket Messages** — every Redis fan-out is HMAC-verified at the broadcast gate (`apps/api/src/realtime/redis.service.ts` `verifyWsHmac`) before reaching the WS gateway or SSE fallback, so a forged channel message can't enter the broadcast bus. The player checks for the presence of a `signature` field as a smoke test; full per-tenant asymmetric verification on the player itself is a documented follow-up — the primary safeguard is the server-side gate, not the client check.
4. **HTTP Polling Fallback** — If Redis fails, screens fall back to polling their device-authenticated manifest at `/api/v1/screens/:id/manifest` (which carries the live `emergency` field — same `Tenant.emergencyStatus` source of truth).
5. **Hold-to-Trigger UX** — Mobile panic page requires 3-second hold on button to prevent accidental taps.

### WARNING: Emergency System Changes
Any modification to emergency endpoints, payload validation, auth bypass logic, or audit logging requires explicit code review and sign-off. Never weaken the @AllowPanicBypass decorator or skip AuditLog creation. Test trigger/clear flows end-to-end before merging.

## Emergency rules that lived elsewhere in the old rulebook

### Player Reliability rule 11 — emergency logic runs first; protective caches never clear on absence

11. **Emergency logic runs FIRST in `applyManifest`, and protective caches never clear on
    absence** (deep audit F11/F5/F4): the alert decision precedes every fallible preamble; an
    EMPTY emergency-assets payload is "no data", never "wipe the never-evict tier"; the
    emergency tier never revalidates null-hash assets (an unverifiable refetch must not be able
    to replace alert media); a cached manifest may RAISE an alert but never RELEASE one — and
    since F8 that includes the overlay, not just the native hold.

### Player Reliability rule 17 (f) — the emergency tier, large files only

(f) **the emergency tier, large files
only** (Greg signed off 2026-09-26): every emergency file below 8 MiB stays
byte-for-byte on `precacheEmergency`'s inline path; a file ≥ 8 MiB is
acked `pending` and the page drives it through the same chunk protocol
with `tier: 'emergency'` — its OWN staging namespace (`/__edu_stage_em__/`,
so `precachePlaylist`'s prune can never touch it and vice versa) and
`assembleStaged` writes into the tier named on the message (unknown tier =
refused, absent = playlist). The page re-sends the set afterwards and ONLY
that confirm pass — everything cached — writes the set-hash and returns
`ok`, so `lastEmergencySetHashRef` still commits on full success and
nothing less; an empty list is still "no data", a null-hash emergency file
already in the tier is still never revalidated, and a cached manifest still
raises but never releases (`emergencyInterlock.ts`, the F8 decision as a
pure tested function). `sw-emergency-large-assets.test.ts` holds one case
per guarantee against the real worker. The vm-loaded worker test
(`sw-large-asset-cache.test.ts`, node environment) is the regression gate:
keep it green, and never put a large fetch back inside a single message
event. Same wave: deletion of an asset or playlist now runs the shared
`emergency-content-use.ts` check (tenant panic defaults, per-screen
emergency playlists, live overrides and messages — not just `isProtected`)
inside the transaction, fail-closed; the media-publication sweep is
leader-leased and never re-activates a row stamped with an error.

### Never re-mux emergency content

See the `VIDEO_FASTSTART_REMUX_DISABLED` row of `docs/ENVIRONMENT.md`: its "Never re-muxed" list names emergency content first.

### Deleting content

See the "Deletion follow-up" paragraph under rule 16 in `apps/web/src/app/player/CLAUDE.md`.

### Never weaken emergency safeguards (item 3 of the old "For AI Assistants" list)

3. **Never weaken emergency safeguards** without the owner's written approval (`AGENTS.md`: changing the emergency path is a consequential change). Emergency system changes also require a review by a different vendor.
