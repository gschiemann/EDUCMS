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

### Synthetic drill (`drill/`)

**What it is.** `drill/synthetic-drill.runner.ts` is an in-process, leader-leased (`LEASE.EMERGENCY_DRILL`) timer — no route, button, webhook, token or new privilege — that drills listed bench screens of **internal** organisations through this controller's own `triggerEmergency` / `clearEmergency` / `broadcastText` / `clearMessage`, resolved via `ModuleRef`. Per listed display and local slot, in series: a device-scoped OVERRIDE drill (`isDrill: true`, `expiresAt` ≤ +180 s), then a pushed TEXT_BROADCAST drill, then a district-copy drill where a bench district exists. It grades three links from the evidence the render-proof handler already records (paint by +5 s, a painted proof dated ≥ +60 s with no drop, release after the all-clear) and writes append-only `EMERGENCY_DRILL_STARTED` / `EMERGENCY_DRILL_RESULT` / `EMERGENCY_DRILL_SWEPT` rows, attributed to a login-disabled `drill-runner` service user per bench location (`EMERGENCY_DRILL_RUNNER_CREATED`). It changes nothing in the trigger, the manifest, the player, the APK or the HMAC gate. Design and build record: `docs/governance/decisions/2026-10-31-synthetic-emergency-drill-design.md`.

**The variables** (rows in `apps/api/src/config/env-schema.ts`, rendered in `docs/ENVIRONMENT.md`; every one only subtracts):
- `EMERGENCY_DRILL_CRON_DISABLED` — `1` / `true` / `yes` = off; beats everything. Fails closed: nothing dispatched.
- `EMERGENCY_DRILL_SCREENS` — bench screen UUIDs, at most 12, no wildcard. Unset = nothing runs. A bad token is ignored and logged; it never widens the list.
- `EMERGENCY_DRILL_MODE` — `shadow` (default: verdicts recorded, no email) · `alert` (owner emails: one per pass listing every FAIL / INCONCLUSIVE, plus a daily dead-man for a display with no PASS in 36 h) · `on` (also: a FAIL holds canary auto-promotion for that hardware class) · `off`. Unknown = `shadow` + an error log.
- `EMERGENCY_DRILL_SCHEDULE` — up to 4 `HH:MM` slots in **each screen's own time zone** (default `10:30` local). Invalid = no drills + an error log; the dead-man check reports the gap. A screen with no known zone is never drilled.

All of it is off under `NODE_ENV=test`; keep `EMERGENCY_DRILL_SCREENS` unset in every test and local run.

**Arming it on bench screens** (the owner's decision; never an agent's): confirm every listed screen's organisation root has `isInternal = true` and that no paying customer sits under that root; set `EMERGENCY_DRILL_SCREENS` to those ids with `EMERGENCY_DRILL_MODE=shadow`; restart. The first run is camera-witnessed on the glass. Disarm: `EMERGENCY_DRILL_CRON_DISABLED=1` or unset `EMERGENCY_DRILL_SCREENS`, restart.

**Reading a result.** Activity → All events (`?view=all`, SUPER_ADMIN), action `EMERGENCY_DRILL_RESULT`: `verdict` (PASS · FAIL · INCONCLUSIVE · SKIPPED · ABORTED), `reason`, `failedLink` (delivery · render · persistence · release), per-pane times and last hash. The trigger path's own `TRIGGER_EMERGENCY_DRILL`, `PLAYER_EMERGENCY_*` and `CLEAR_EMERGENCY_DRILL` rows sit beside it. The drill's own rows are not on the customer activity allowlist (`packages/api-types/src/customer-activity.ts`).

**Invariants — never weaken:**
1. **In doubt, never trigger.** Every guard (listed inside `runOnce`, organisation root internal read fresh, paired / checked in / not in intended downtime, nothing else on the glass with a fresh content proof, Redis up and no critical platform component) passes or the run is `SKIPPED` with nothing dispatched. No Redis = no drill.
2. **Always clear.** The all-clear (`isDrill: true`, which can only end drill state) runs in `finally` on every exit that may have put anything on glass; the payload's own `expiresAt` and the orphan sweep (one all-clear for a STARTED run without a RESULT) back it up. A run that cannot verify is `INCONCLUSIVE`, still cleared, and alerts the owner.
3. **A live alert aborts the drill.** A 409 from the live-alert refusal, or a live alert ending the drill mid-run, gives `ABORTED` and no email; a drill never hides or delays a live alert. Customer record copies are skipped only for ids this process minted with `isDrill`; nothing in `drill/` emails a customer — owner alerts go through `PlatformAlertMailer` only.

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
