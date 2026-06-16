# CYCLE-4 Fix Log

## auth-BUG-011 — SUPER_ADMIN can demote another SUPER_ADMIN

**Severity:** High (privilege escalation / lockout vector — a single
compromised SUPER_ADMIN account could strip every peer admin in the
tenant before anyone could push back).

**Bug:** `PUT /api/v1/users/:id/role` validated the new role string
against the assignable allowlist but did not check whether the
*target* was already a SUPER_ADMIN. A caller riding a SUPER_ADMIN
session could demote any other SUPER_ADMIN to RESTRICTED_VIEWER in
one request.

**Fix:** Added a guard that runs after the tenant-scoped `findFirst`.
When the target user is a SUPER_ADMIN, the target id is not the
caller's own id, AND the new role is not SUPER_ADMIN, throw 403. Self-
demotion stays allowed (the caller is consenting). Promoting a non-
SUPER user to SUPER stays allowed (existing allowlist gate covers
that).

**Files changed:** `apps/api/src/users/users.controller.ts:1`,
`apps/api/src/users/users.controller.ts:107-148`

**Acceptance test:** As SUPER_ADMIN A, call
`PUT /users/{B-super-id}/role` with `{ role: 'RESTRICTED_VIEWER' }`
where B is another SUPER_ADMIN in the same tenant. Expect 403
"SUPER_ADMIN accounts cannot demote another SUPER_ADMIN." Then call
`PUT /users/{A-self-id}/role` with the same body — expect 200, role
flips. Then call `PUT /users/{C-contributor-id}/role` with
`{ role: 'SCHOOL_ADMIN' }` — expect 200 (unaffected by the new
guard).

---

## auth-BUG-012 — `PUT /schedules/:id` body silently drops `playlistId`

**Severity:** Medium (UX bug — operators trying to re-target a
schedule onto a different playlist saw no error, no change, just a
silent no-op. Forced users to delete + re-create the schedule).

**Bug:** The PUT handler's body type interface omitted `playlistId`,
so even though Prisma supports updating it, the request body was
narrowed to `{ screenGroupId?, screenId?, daysOfWeek?, ... }` and
the property was dropped before reaching the update payload.

**Fix:** Added `playlistId?: string` to the body type. Mirrored the
cycle-2 auth-003 cross-tenant validation pattern: when `playlistId`
is present, `findFirst({ where: { id, tenantId } })` confirms the
new playlist belongs to the caller's tenant before writing.

**Files changed:** `apps/api/src/schedules/schedules.controller.ts:163-176`,
`apps/api/src/schedules/schedules.controller.ts:184-194`,
`apps/api/src/schedules/schedules.controller.ts:218-219`

**Acceptance test:** Create schedule S1 pointing at playlist P1.
`PUT /schedules/{S1.id}` with body `{ playlistId: 'P2' }` (P2 in
same tenant) — expect 200 and S1.playlistId === P2.id. Then PUT with
`{ playlistId: 'P-other-tenant' }` — expect 404 "Playlist not
found." Then PUT with `{ priority: 5 }` (no playlistId) — expect
200, S1.playlistId unchanged.

---

## auth-BUG-013 — `DELETE /users/:id` returns HTTP 200 + `{error}`

**Severity:** Low (developer-experience / API hygiene — clients
relying on status-code-only checks would silently swallow self-
deletion attempts and not-found responses).

**Bug:** The DELETE handler returned `{ error: '...' }` with the
default 200 OK on two failure branches (self-delete and not-found),
breaking the convention used by every other endpoint.

**Fix:** Replaced both `return { error: ... }` paths with explicit
`throw new HttpException(...)`. Self-delete → 400. Not found → 404.
Imports updated to bring in `HttpException` and `HttpStatus`.

**Files changed:** `apps/api/src/users/users.controller.ts:1`,
`apps/api/src/users/users.controller.ts:152-176`

**Acceptance test:** As SUPER_ADMIN, call `DELETE /users/{self-id}`
— expect 400 "Cannot delete your own account." Call `DELETE
/users/{nonexistent-id}` — expect 404 "User not found." Call
`DELETE /users/{valid-other-user-id}` — expect 200 `{ deleted:
true }`.

---

## integrations-BUG-007 — Streaming `oauth2` not rejected server-side

**Severity:** Medium (asymmetric with POS, which got the same fix in
cycle-2 — a determined caller could create empty PENDING
StreamProviderConnection rows by POSTing directly to the API, polluting
the connections list with stuck rows nobody can complete).

**Bug:** `streaming.service.ts createConnection` validated `apiKey`,
`license`, and `customHls` auth shapes but did not reject `oauth2`
providers. The frontend disables the Connect button, but a curl /
Postman caller could still hit the endpoint.

**Fix:** Added an `if (provider.auth === 'oauth2')` early-throw with
the same `BadRequestException` message used in `pos.service.ts`
("OAuth flow not yet implemented for this provider. Contact sales
for activation.").

**Files changed:** `apps/api/src/streaming/streaming.service.ts:108-117`

**Acceptance test:** `POST /streaming/connections` with
`{ providerId: 'soundtrack', credentials: {} }` (Soundtrack is
oauth2) — expect 400 "OAuth flow not yet implemented for this
provider. Contact sales for activation." Same call against
`providerId: 'public-broadcasters'` (auth === 'none') — expect 200,
connection saved with status ACTIVE.

---

## integrations-BUG-008 — Music Quick Start opens disabled Connect modal

**Severity:** Medium (dead-end UX — clicking the "Background music"
Quick Start card landed the operator on a modal where the Connect
button was permanently disabled, with no explanation of how to
proceed).

**Bug:** The Soundtrack provider has `auth === 'oauth2'`, which the
ConnectModal recognizes and disables the submit button for. The
Quick Start card's onClick called
`setConnectModalProvider(soundtrack)` regardless, dropping the user
into that disabled modal.

**Fix:** Added a `showSoundtrackComingSoon` state flag and a new
`SoundtrackComingSoonModal` component. The card's onClick now opens
that modal instead. The modal explains OAuth is pending partner
approval, points the operator at sales@venueos.com for manual
activation, and includes a `mailto:` Contact sales button. Card
badge changed from "OAUTH · ~$35/MO" to "COMING SOON" and CTA
changed from "Connect Soundtrack" to "Coming soon — contact sales"
to set expectations before the click.

**Files changed:** `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:96-104`,
`apps/web/src/app/[schoolId]/settings/streaming/page.tsx:208-219`,
`apps/web/src/app/[schoolId]/settings/streaming/page.tsx:362-365`,
`apps/web/src/app/[schoolId]/settings/streaming/page.tsx:1153-1206`

**Acceptance test:** Open `/[schoolId]/settings/streaming`. Click
"Background music" Quick Start card — expect SoundtrackComingSoon
modal (not the regular ConnectModal). Verify the mailto Contact
sales button works. Confirm Soundtrack is no longer reachable from
this card.

---

## TypeScript verification

`apps/api`: `npx tsc --noEmit` — no errors after fixes (filtered
spec.ts).
`apps/web`: `npx tsc --noEmit` — no errors after fixes (filtered
test).

---

## emergency-BUG-006 — Per-screen audit failures silently swallowed

**Severity:** High (forensic gap — life-safety adjacent. A failed
audit-write could leave a screen-emergency override active with NO
record of who fired it, who was meant to be notified, or which
playbook was used. CLAUDE.md "Key Safeguards #2: Immutable Audit
Log" requires every trigger / clear be logged).

**Bug:** `apps/api/src/emergency/screen-emergency.controller.ts` had
two independent write pairs (override upsert + audit log; override
delete + audit log) where the audit-log call was wrapped in
`try { ... } catch { /* swallow */ }`. If the audit write failed,
the operator-visible response still said "ok" but the forensic
record was missing. No Sentry capture, no logger warning.

**Fix:** Wrapped the override-write and audit-write in a single
Prisma `$transaction([...])` for both the per-screen trigger
(`createOverrideAndBroadcast`) and the per-screen all-clear
(`allClear`). Pattern matches cycle-1 emergency-003 in
`emergency.controller.ts:520-555`. On transaction failure: capture
to Sentry with screen / tenant / override metadata, log via Logger,
re-throw as `HttpException(500, ...)` so the operator sees a real
error and can re-fire. A failed-audit trigger is a worse state than
no-trigger — surfacing the failure is correct.

**Files changed:** `apps/api/src/emergency/screen-emergency.controller.ts`
(imports + Logger field + trigger transaction at ~239-321 + all-
clear transaction at ~370-420).

**Acceptance test:** Trigger a per-screen override against a real
screen — expect 200 + AuditLog row with action
`TRIGGER_SCREEN_EMERGENCY`. Force the AuditLog table to fail (e.g.
revoke insert grant temporarily, or swap with a mocked Prisma
client returning a Prisma error) and re-trigger — expect 500 with
"Failed to record per-screen emergency override (audit write
failed). Trigger aborted." and confirm no
`ScreenEmergencyOverride` row was created. Same shape for
all-clear: 200 deletes the override + writes audit, induced
audit-failure rolls both back and returns 500.

---

## emergency-BUG-008 — Floor plan dimensions trusted from client

**Severity:** Medium (calibration-integrity bug — Screen.floorX/Y
are clamped against plan.widthPx/heightPx; lying about those means
pins land off-image, get refused at legitimate locations, or any
later geo-scoped emergency trigger reasons over the wrong bounds).

**Bug:** `floor-plans.controller.ts` `create()` accepted `widthPx`
and `heightPx` from the multipart form body and only checked sign
and a 10000px ceiling. No verification against the actual image.

**Fix:** Added a self-contained `probeImageDimensions(buf)` parser
that reads PNG IHDR / JPEG SOFn / WEBP VP8|VP8L|VP8X header bytes
(no new dependency — apps/api has no image-size library and we
only allow those three MIME types per `ALLOWED_FLOOR_PLAN_MIMES`).
After multer hands us `file.buffer`, we probe; if client width or
height differs from probed by more than 5%, we override with
probed values and log a warning. If the parser cannot determine
dimensions (exotic-but-valid format), we trust the client value
but log a warning when client values look implausible (<16px or
>16384px in either dimension).

**Files changed:** `apps/api/src/floor-plans/floor-plans.controller.ts`
(new `probeImageDimensions` helper at ~66-180; probe wired into
`create()` at ~245-300).

**Acceptance test:** Upload a valid 4000x3000 PNG with form
fields `widthPx=4000, heightPx=3000` — expect 200, plan row has
4000x3000. Upload the same PNG with `widthPx=8000, heightPx=6000`
(off by 100%) — expect 200 with logged warning "Client
widthPx/heightPx (8000x6000) differ from probed dimensions
(4000x3000) by more than 5%. Overriding with probed values." and
DB row has 4000x3000. Repeat with JPEG and WEBP fixtures. Upload
a TIFF served as `image/png` (rejected by mimefilter) — expect
400 file-type error before probing.

---

## emergency-BUG-013 — Panic page UI says "1.5 seconds"

**Severity:** Low (UX honesty — the on-screen instruction
contradicted the actual 3-second hold timer set in cycle-1
emergency-BUG-001).

**Bug:** `apps/web/src/app/panic/page.tsx:242` read "Press and
hold any button for 1.5 seconds to broadcast." while
`HOLD_DURATION_MS = 3000` and the progress ring matched the
3-second timer.

**Fix:** Updated the copy to "Press and hold any button for 3
seconds to broadcast." with a comment explaining the cycle-1 fix
chain.

**Files changed:** `apps/web/src/app/panic/page.tsx` (line 242
copy update).

**Acceptance test:** Open `/panic` on a paired device. Confirm
the instruction reads "3 seconds." Press and hold any panic
button — confirm the ring fills over ~3s and fires only when
held for the full duration.

---

## editor-BUG-extend-bar — Bar widgets had no editor with posSync OFF

**Severity:** Medium (UX gap — operators with posSync disabled
literally could not edit `taps[]` or `cocktails[]` from the
PropertiesPanel; same JSON-only Advanced fall-through as cycle-3
editor-BUG-004).

**Bug:** `PropertiesPanel.tsx` cases for `BAR_TAP_LIST` and
`BAR_COCKTAIL_MENU` only exposed title + posSync + columns. With
posSync OFF the array fields were unreachable.

**Fix:** Extended both cases.
- `BAR_TAP_LIST`: added `subtitle`, `accentColor` color picker,
  `taps[]` JSON editor (safe-parse pattern from cycle-2
  editor-BUG-003) shown only when posSync is OFF. Field shapes
  confirmed against `TapListConfig`/`BarTap` in
  `apps/web/src/components/widgets/bar/TapListWidget.tsx`.
- `BAR_COCKTAIL_MENU`: added `subtitle`, `footer`, `columns`
  (1-2), `cocktails[]` JSON editor with same safe-parse pattern.
  Field shapes confirmed against `CocktailMenuConfig`/`BarCocktail`
  in `apps/web/src/components/widgets/bar/CocktailMenuWidget.tsx`.

**Files changed:** `apps/web/src/components/template-builder/PropertiesPanel.tsx`
(BAR_TAP_LIST case at ~2330-2354; BAR_COCKTAIL_MENU case at
~2356-2378).

**Acceptance test:** Open the template builder, drop a
`BAR_TAP_LIST` widget, leave posSync OFF — confirm the
properties panel shows Title / Subtitle / Accent / Columns / Taps
JSON. Edit the JSON to a 3-tap array, save, confirm widget
re-renders with the new taps. Toggle posSync ON — confirm Taps
JSON disappears and PosCategoryPicker appears. Repeat for
`BAR_COCKTAIL_MENU` (Title / Subtitle / Footer / Columns /
Cocktails JSON).

---

## ai-imports-BUG-005 — Imports dropzone keyboard-inaccessible

**Severity:** Medium (a11y — keyboard-only and screen-reader
users could not trigger the file picker on
`/[schoolId]/settings/imports`. Sprint 1 axe-core goal).

**Bug:** The dropzone div had no `role`, no `tabIndex`, no
keyboard handler, no `aria-label`. Click-to-open file picker only
worked with a mouse.

**Fix:** Added `role="button"`, `tabIndex={0}`, `aria-label`
("Click or drag a file to import a design (PDF, PowerPoint, or
image)"), `aria-disabled` while uploading, an `onKeyDown`
handler that fires the file picker on Enter or Space (with
`preventDefault` so Space doesn't scroll the page), and
`focus-visible` ring classes for visible focus state.

**Files changed:** `apps/web/src/app/[schoolId]/settings/imports/page.tsx`
(dropzone div at ~111-141).

**Acceptance test:** Open `/[schoolId]/settings/imports`. Tab
through the page — confirm the dropzone receives focus with a
visible emerald ring. Press Enter — confirm the OS file picker
opens. Press Space — confirm the picker opens and the page does
not scroll. Run axe-core against the page — confirm no
"interactive element must have an accessible name" violation on
the dropzone.

---

## player-BUG-005 — SW precachePlaylist evicts entries by raw URL; Supabase signed URLs rotate

**Severity:** Medium (perf + bandwidth — every Supabase token rotation
(~hourly) caused the SW to wipe and re-download the entire playlist
cache, defeating the offline-first cache tier and burning both kiosk
LTE and Supabase egress quota).

**Bug:** `precachePlaylist` built `liveUrls` from the raw asset URL
(including the `?token=...` query) and compared against the cached
Request URL the same way. When Supabase rotated the signed token
(every hour by default) every entry in the cache looked "no longer
referenced," got deleted, and the next loop re-fetched everything.

**Fix:** Introduced `stableKey(url)` that strips query + hash from any
URL. `normalizeUrl` is now an alias of `stableKey`, so `liveUrls`,
`SIZE_BY_URL`, `metaKey`, and `sizeMetaKey` all dedupe on the stable
form. Cache lookups in `fetchAndStore` and `precacheEmergency`'s
verify pass added `{ ignoreSearch: true }` so a freshly-arrived
rotated URL still matches the previously-cached entry. The actual
network fetch + `cache.put` keep the full signed URL so authorized
Supabase fetches still succeed. Bumped SW VERSION `v3` -> `v4` so
existing kiosks pick up the fix on next activate.

**Files changed:** `apps/web/public/sw-player.js` (VERSION block,
`fetchAndStore`, `precacheEmergency` verify, `metaKey`, `sizeMetaKey`,
`stableKey`, `normalizeUrl`, `stripQuery`).

**Acceptance test:** Pair a kiosk to a tenant with at least 5 playlist
assets. Wait for SW activate (v4). Confirm `caches.open(...)` keys
contain the assets after first sync. Force a Supabase token rotation
(re-issue manifest with fresh URLs). Trigger another precache run.
Expect zero `cache.delete()` for live assets, zero re-downloads of
the same SHA — confirmed by inspecting `PRECACHE_PLAYLIST_DONE` byte
total stays equal across runs.

---

## player-BUG-006 — `ALL_CLEAR` in SENSITIVE_TYPES drops on clock-skewed kiosks

**Severity:** High (life-safety — losing ALL_CLEAR after a real
emergency leaves screens stuck on lockdown messaging until the next
manifest poll catches up; on a kiosk with NTP-skewed clock the
sensitive-event freshness check could drop ALL_CLEAR even when the
emergency was genuinely cleared seconds earlier).

**Bug:** `SENSITIVE_TYPES` in the player WS handler included
`ALL_CLEAR` alongside `OVERRIDE` and `TENANT_CHANGED`. SENSITIVE_TYPES
events are dropped if (a) they arrive before AUTH_OK has captured the
server clock offset, or (b) the timestamp is more than 30 s from the
adjusted local time. ALL_CLEAR is the safest message a screen can
receive — failing closed has worse outcomes than a brief acceptance
window.

**Fix:** Removed `ALL_CLEAR` from SENSITIVE_TYPES. Added inline
comment block documenting the rationale ("trust + verify"). The
existing 10 s emergency-status HTTP poll re-confirms the cleared
state shortly after, so a forged ALL_CLEAR cannot keep a real
emergency hidden.

**Files changed:** `apps/web/src/app/player/page.tsx` (SENSITIVE_TYPES
declaration around line 1950).

**Acceptance test:** With kiosk clock manually skewed +5 minutes
ahead of server, trigger a tenant emergency, then trigger ALL_CLEAR.
Before the fix the WS log shows "dropped stale/future event:
ALL_CLEAR"; after the fix the ALL_CLEAR is processed,
`setActiveEmergency(null)` and `cacheEmergency(null)` fire, and the
screen returns to normal playback within 1 s. OVERRIDE events with
the same skew remain dropped (signed-events sanity gate is intact).

---

## player-BUG-007 — WS HELLO falls back to unsigned `dev_` tokens silently

**Severity:** Medium (operational visibility — in production with
DEV_WS_ALLOW unset the server rejects `dev_*` tokens and real-time
silently degrades to 5–10 s HTTP polling. Operators had no signal
that re-pairing was required).

**Bug:** When `getDeviceToken()` returned null, the HELLO send fell
through to `dev_${screenId}_${tenantId|unknown}` regardless of
environment. In prod the server rejects the token, the player
reconnects in a loop, and life-safety realtime is offline without
operator awareness.

**Fix:** Added `unsignedWsTokenWarning` state. When
`process.env.NEXT_PUBLIC_DEV_WS_ALLOW !== 'true'` AND
`getDeviceToken()` is null, the player still sends the dev token
(server rejects but HTTP polling covers life-safety) AND surfaces a
fixed bottom-right amber banner: "Real-time disabled — kiosk needs
re-pairing — no signed device token available." Banner mounted in
all four render branches (registering / pairing / playing-template /
playing-non-template). Auto-clears once a signed token is acquired.

**Files changed:** `apps/web/src/app/player/page.tsx` (state +
detection in `ws.onopen`, JSX `unsignedWsBanner` after
`connectivityToast`, banner mounted in 4 render branches).

**Acceptance test:** In a prod build (DEV_WS_ALLOW unset), clear
`localStorage.edu_device_token` while the player is mid-session and
trigger a WS reconnect. Expect amber banner bottom-right with the
re-pairing message. Set DEV_WS_ALLOW=true and reload — banner does
not appear (dev mode is acceptable). Re-pair the kiosk so a fresh
signed JWT lands in localStorage; on next reconnect the banner
clears.

---

## player-BUG-009 — Pairing code 11th collision returns 500

**Severity:** Low (theoretical, but a real DoS vector if attacker
or test seeding pre-claims the small visible 6-char namespace).

**Bug:** `screens.controller.ts register()` retried pairing-code
generation 10 times against a unique-index. On the 11th collision
the loop exited with the still-duplicate code and the
`prisma.screen.create` threw a P2002 unique constraint, surfacing as
HTTP 500 to the client.

**Fix:** Bumped retry budget from 10 to 100. After 50 collisions at
length 6, escalates to length 8 (alphabet 32 chars; 32^8 ≈ 1.1
trillion namespace) for the remaining attempts. `generatePairingCode`
now takes an optional `length` param defaulting to 6. Practical
failure probability is now mathematically negligible.

**Files changed:** `apps/api/src/screens/screens.controller.ts`
(`generatePairingCode` signature, retry loop in `register`).

**Acceptance test:** In an integration test, mock
`prisma.screen.findUnique` to return an existing row 60 times then
null — expect the code returned to be 8 chars (length escalation
fired at attempt 50). With a fresh DB the standard 6-char flow
returns a 6-char code on first attempt as before. No call to
`POST /screens/register` should ever return 500 from collision.
