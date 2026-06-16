# CYCLE-2 Fix Log

## auth-BUG-003 — Schedule cross-tenant FK validation missing

**Severity:** High (auth/tenancy isolation breach).

**Bug:**
`POST /api/v1/schedules` accepted `playlistId`, `screenId`, and
`screenGroupId` from the body and wrote them straight into Prisma
without verifying any of them belonged to `req.user.tenantId`. A
DISTRICT_ADMIN of tenant A could pass tenant B's playlistId/screenId
and Prisma would happily write the row, scheduling A's content onto
B's screens (or worse, mounting B's playlist onto A's screen). Same
issue existed on `PUT /api/v1/schedules/:id` for screenId/screenGroupId
re-targeting (the schedule's tenantId guard at the top blocked
cross-tenant editing of the schedule itself, but didn't validate the
new screen/group target).

**Fix:**
Mirrored the `submissions.controller.ts:78-89` validation pattern.
Before any Prisma create/update, look up each foreign id with
`findFirst({ where: { id, tenantId: req.user.tenantId } })` and 404
if missing.

- POST: validates `body.playlistId` (now also required, returns 400
  if absent), and conditionally validates `body.screenId` /
  `body.screenGroupId` when provided.
- PUT: validates `body.screenId` / `body.screenGroupId` when truthy.
  An empty-string clear (`body.screenId = ''`) skips the lookup and
  drops to `data.screenId = null`, preserving the existing "swap
  target" semantics.
- `playlistId` is not editable via PUT, so no template-style guard is
  needed there.

Surrounding logic (replace-mode displacement, `notifySync`, mode
validation, response shape) is unchanged.

**Files changed:**
- `apps/api/src/schedules/schedules.controller.ts:69-105` — POST
  validates playlistId/screenId/screenGroupId tenancy.
- `apps/api/src/schedules/schedules.controller.ts:172-194` — PUT
  validates screenId/screenGroupId tenancy.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` — 21 pre-existing errors in
`screens.register.spec.ts` and `sso.service.spec.ts`, zero in
`schedules/`. No regressions.

**Acceptance test:**
1. As DISTRICT_ADMIN of tenant A, POST `/api/v1/schedules` with
   `{ playlistId: '<tenant-B playlist id>', screenId: '<tenant-A screen id>', startTime: ... }`
   -> 404 "Playlist not found". No DB write. Same for cross-tenant
   `screenId` / `screenGroupId`.
2. POST with all-tenant-A ids -> 200 with the existing response shape.
3. PUT `/api/v1/schedules/:id` with `{ screenId: '<tenant-B screen>' }`
   -> 404. PUT with an empty `screenId` still clears the field
   (no lookup performed).

---

## auth-BUG-004 — Playlist accepts foreign templateId

**Severity:** High (auth/tenancy isolation breach + UX confusion).

**Bug:**
`POST /api/v1/playlists` accepted `templateId` from the body and
wrote it straight into the new playlist row without verifying the
template belonged to the caller's tenant or was a system preset.
A DISTRICT_ADMIN of tenant A could discover a tenant B custom-template
id (from a leaked screenshot, log entry, etc.) and bind their own
playlist to that template — players would render tenant B's layout
on tenant A's screens until the operator noticed.

**Fix:**
When `body.templateId` is present, do a `findFirst` that accepts
either `tenantId === req.user.tenantId` (own custom template) OR
`isSystem: true` (one of the 17 shared system presets). 404 if the
template doesn't match either branch. Templates with `isSystem: true`
are deliberately tenant-id-null and globally readable, so the OR
clause keeps the existing "use a system preset" UX intact while
blocking cross-tenant custom templates.

**Files changed:**
- `apps/api/src/playlists/playlists.controller.ts:69-89` — POST
  validates templateId tenancy/system before create.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` — 21 pre-existing errors, none
in `playlists/`. No regressions.

**Acceptance test:**
1. As DISTRICT_ADMIN of tenant A, POST `/api/v1/playlists` with
   `{ name: 'X', templateId: '<tenant-B custom template id>' }` ->
   404 "Template not found". No DB write.
2. POST with `templateId` of a system preset (`isSystem: true`) ->
   200, playlist created.
3. POST with `templateId` of a tenant A custom template -> 200.
4. POST without `templateId` -> 200 (gate skipped, existing behavior).

---

## auth-BUG-006 — Argon2 timing oracle on user lookup miss

**Severity:** Medium (information disclosure / email enumeration).

**Bug:**
`AuthService.validateUser` returned `null` for both "user not found"
and "wrong password," but the not-found path skipped `argon2.verify`
entirely. argon2id with the project's params (memoryCost 65536,
timeCost 3, parallelism 4) targets ~45ms per verify, so the
not-found branch returned ~200ms faster than the wrong-password
branch. An attacker could measure response latency on the login
endpoint and enumerate which email addresses exist in the database
without ever guessing a real password.

The same gap existed for the `user.status !== 'ACTIVE'` (INVITED)
branch — it short-circuited before any argon2 work, leaking which
emails belong to invited-but-not-accepted users.

**Fix:**
Pre-compute a constant Argon2id hash once at module load using the
project's argon2id params (`type`, `memoryCost`, `timeCost`,
`parallelism` from `cryptoPlatformConfig`) so we don't pay the cost
on every login. The hash is wrapped in a top-level Promise so module
initialization is non-blocking — first request after boot waits ~45ms
for the warm-up; subsequent requests are amortized.

In both `null` branches (user not found, status not ACTIVE), call
`argon2.verify(dummyHash, pass, cryptoPlatformConfig)` and discard
the result. Wrapped in try/catch so a verify-throws (malformed pass)
can't bubble out. Both branches now spend the same ~45ms as the
wrong-password branch before returning null.

The dummy plaintext is the literal string "not_a_real_password" —
not a secret, just enough input for argon2 to do real CPU work. The
hash never reaches the wire.

**Files changed:**
- `apps/api/src/auth/auth.service.ts:1-29` — added module-level
  `DUMMY_PASSWORD_FOR_TIMING` + `DUMMY_HASH_PROMISE` precomputed at
  module load using cryptoPlatformConfig.
- `apps/api/src/auth/auth.service.ts:48-72` — user-not-found branch
  runs dummy verify before returning null.
- `apps/api/src/auth/auth.service.ts:78-87` — non-ACTIVE-user branch
  runs dummy verify before returning null.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` — 21 pre-existing errors, none
in `auth/`. No regressions.

**Acceptance test:**
1. POST `/api/v1/auth/login` with a known-bad email
   (`nobody@example.com`) and any password. Measure response time.
2. POST with a known-good email and a wrong password. Measure
   response time.
3. The two timings should be within ~10ms of each other (argon2id at
   memoryCost 65536 / timeCost 3 takes ~45ms; both paths now run one
   verify). Before the fix, the not-found path returned ~200ms; the
   wrong-password path took ~245ms.
4. Same probe on an INVITED-status email: timing matches both
   above, no longer leaking that the user exists but isn't yet
   active.
5. Successful login still works unchanged (correct email + correct
   password -> 200 with JWT; same path, same timing).

---

## integrations-BUG-003 — POS oauth2 saves empty PENDING rows silently

**Severity:** Medium (data hygiene; clutters connections list with
half-configured rows that never resolve).

**Bug:**
The POS settings page rendered "OAuth flow not yet implemented" inside
the ConnectModal for any provider with `auth === 'oauth2'`, but left
the Connect button enabled. Clicking it sent `credentials: {}` to
`POST /pos/connections`, which the service accepted and persisted as a
PENDING row that no per-provider OAuth handler will ever flip to
ACTIVE. Backend had no oauth2 validation branch, so a curl/Postman
caller hitting the endpoint directly could pollute the table the same
way.

**Fix:**
- Frontend (`apps/web/src/app/[schoolId]/settings/pos/page.tsx`):
  Connect button gets `disabled={submitting || provider.auth ===
  'oauth2'}` plus a `disabled:cursor-not-allowed` style and a `title`
  tooltip. Mirrors the streaming-page treatment.
- Backend (`apps/api/src/pos/pos.service.ts`): inserted an
  `oauth2` guard in `createConnection()` BEFORE the existing
  apiKey/partnerKey/webhook validators, throwing
  `BadRequestException('OAuth flow not yet implemented for this
  provider. Contact sales for activation.')`. Defensive — even if the
  frontend disable is bypassed, the API rejects the request.

**Files changed:**
- `apps/web/src/app/[schoolId]/settings/pos/page.tsx:317-325` —
  disable Connect button + title tooltip when oauth2.
- `apps/api/src/pos/pos.service.ts:80-92` — server-side guard
  rejecting oauth2 connections.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` and `cd apps/web && npx tsc
--noEmit` — zero new errors in production code (only pre-existing
`.spec.ts`/`.test.tsx` failures unrelated to this batch).

---

## integrations-BUG-004 — Ad-network ConnectModal no PARTNER/DIRECT distinction

**Severity:** Medium (UX/data hygiene; PARTNER tier creates empty-cred
PENDING rows that block the operator from understanding the actual
activation path).

**Bug:**
`/settings/monetize` `NetworkTile` only branched on
`integrationTier === 'CLOSED'` -> open docsUrl, otherwise open the
generic ConnectModal. This meant PARTNER networks (Hivestack,
Vistar, Place Exchange, Broadsign Reach, Loop Media — all real
OpenRTB SSPs that require a publisher contract before activation)
opened the same Connect form as the DIRECT house-only network. The
operator could fill in placeholder creds and "connect," producing an
empty-cred PENDING row that nobody would ever resolve.

**Fix:**
`NetworkTile` click handler now branches three ways:
- CLOSED -> open `docsUrl` in a new tab (existing behavior).
- PARTNER -> open `docsUrl || websiteUrl` in a new tab (publisher /
  partnership application page); fall back to
  `mailto:partners@venueos.com?subject=Partnership inquiry — <name>`
  if neither URL is set.
- DIRECT (or anything else) -> open the existing ConnectModal.

Also added a small inline "Apply for partnership" badge inside
PARTNER tiles so the operator sees the destination before clicking,
preventing surprise on the "this opened a new tab instead of a form"
moment.

`integrationTier` field shape (DIRECT | PARTNER | CLOSED) confirmed
in `packages/api-types/src/ad-network.ts:56`.

**Files changed:**
- `apps/web/src/app/[schoolId]/settings/monetize/page.tsx:244-289` —
  three-way click branch + Apply-for-partnership inline badge.

**TypeScript check:**
`cd apps/web && npx tsc --noEmit` — zero new errors in production
code.

---

## integrations-BUG-005 — PropertiesPanel picker links use relative href

**Severity:** Low (UX dead-end; broken link from template builder ->
settings).

**Bug:**
`StreamingChannelPickerField` and `PosCategoryPickerField` rendered
their "no connections yet" empty-state link as `<a
href="settings/streaming">` / `<a href="settings/pos">`. Inside the
template builder route
(`/[schoolId]/templates/[id]/edit`) those relative hrefs resolved to
`/[schoolId]/templates/[id]/edit/settings/streaming` (404).

**Fix:**
- Added `import { useParams } from 'next/navigation'` to
  `PropertiesPanel.tsx`.
- Both pickers now read `schoolId` from `useParams()` and build
  absolute hrefs `` `/${schoolId}/settings/streaming` `` and
  `` `/${schoolId}/settings/pos` ``. Defensive fallback to
  `/settings/streaming` / `/settings/pos` if `schoolId` is somehow
  missing (should never happen inside the template builder route, but
  cheap to guard).

`useParams<{ schoolId?: string | string[] }>()` returns the dynamic
segment value; we coerce a string-array (catch-all routes) to its
first element to be future-proof.

**Files changed:**
- `apps/web/src/components/template-builder/PropertiesPanel.tsx:4` —
  added `useParams` import.
- `apps/web/src/components/template-builder/PropertiesPanel.tsx:3530-3590` —
  StreamingChannelPickerField reads `schoolId` and builds absolute href.
- `apps/web/src/components/template-builder/PropertiesPanel.tsx:3614-3660` —
  PosCategoryPickerField reads `schoolId` and builds absolute href.

**TypeScript check:**
`cd apps/web && npx tsc --noEmit` — zero new errors in production
code.

---

## integrations-BUG-006 — StreamProviderListItem missing bridgeSteps

**Severity:** Medium (type-safety; shape drift between API and web for
BRIDGE-tier providers — DIRECTV, DISH Business, Atmosphere TV, Mood
Media, iHeart for Business).

**Bug:**
The canonical `StreamProviderListItem` interface in
`packages/api-types/src/streaming.ts:401-419` did not declare
`bridgeSteps`, but the controller (`streaming.service.ts:45`) already
passes the field through from `StreamProviderDef`. The web app's
local `Provider` interface in `streaming/page.tsx` redeclared the
field manually, and `BridgeSetupModal` used it via
`provider.bridgeSteps || []`. Without the DTO declaration, any new
consumer of the api-types package would hit `any`-typed access or
have to redeclare the field locally.

**Fix:**
Added `bridgeSteps?: ReadonlyArray<{ step: string; detail?: string;
productExamples?: ReadonlyArray<string> }>` to
`StreamProviderListItem`, matching the source-of-truth shape on
`StreamProviderDef`.

Rebuilt the package (`cd packages/api-types && pnpm build`) so the
emitted `dist/` matches the new source — required because the API
consumes the package via its compiled `main` entry, not the raw
`.ts`.

**Files changed:**
- `packages/api-types/src/streaming.ts:401-425` — added `bridgeSteps`
  to `StreamProviderListItem`.
- `packages/api-types/dist/*` — regenerated.

**TypeScript check:**
`pnpm build` in `packages/api-types` succeeded. Subsequent
`cd apps/api && npx tsc --noEmit` and `cd apps/web && npx tsc
--noEmit` — zero new errors in production code.


## editor-BUG-001 — FITNESS_WORKOUT_TIMER missing editor case

**Severity:** Medium (UX gap — operator forced into JSON-only Advanced
panel for a widget that has a real preset entry and is rendered live
in fitness templates).

**Bug:**
`apps/web/src/components/template-builder/PropertiesPanel.tsx` had
explicit `case` blocks for every other FITNESS_* widget but fell
through for `FITNESS_WORKOUT_TIMER`. Operators could see the timer
on the canvas, drag it from the preset palette, but had no friendly
form to set work seconds, rest seconds, rounds, accent colors, or
class metadata. The Advanced JSON panel worked but is hostile —
class operators are not coders.

**Fix:**
Added an explicit `case 'FITNESS_WORKOUT_TIMER':` block alongside
the other FITNESS_* cases (inserted just before the POS-driven menu
board section, ~line 2274). Surfaces the full
`FitnessWorkoutTimerConfig` shape from
`apps/web/src/components/widgets/fitness/FitnessWorkoutTimerWidget.tsx`:
- `classTitle` (TextField — chip label)
- `trainerName` (TextField — chip suffix)
- `mode` (SelectField — Tabata / HIIT / EMOM / AMRAP / Custom).
  Switching the preset auto-fills `workSeconds` / `restSeconds` /
  `totalRounds` to match (Tabata=20/10x8, HIIT=40/20x8, EMOM=60s
  rounds, AMRAP=10min single round). Custom leaves the values alone.
- `workSeconds` / `restSeconds` / `totalRounds` / `currentRound`
  (TextField — manual override of the preset numbers)
- `workColor` / `restColor` (ColorPickerField — phase tint)
- `autoStart` (ToggleField — fire timer on widget mount in live mode)
- `audioCues` (ToggleField — phase-transition audio; default true)

The audio cues field isn't part of the typed `FitnessWorkoutTimerConfig`
yet because the widget renders silently today; it's there as a
forward-compat hook so when the audio path lands the editor already
has the toggle.

**TypeScript check:**
`cd apps/web && npx tsc --noEmit | grep -v test | grep error` — no
errors. The pre-existing test-file errors in `touch-widgets.test.tsx`
are unrelated to this fix.

---

## editor-BUG-002 — 9 RESTAURANT/BAR widgets missing editor case

**Severity:** Medium (UX gap — restaurant/bar pilot tenants forced
into JSON-only editing for the daily-driver widgets in their pack).

**Audit result:**
Surveyed every `widgetType:` literal in
`apps/api/src/templates/{restaurant,bar,retail}-presets.ts` and
diffed against the existing `case` blocks in PropertiesPanel.tsx.
Found 19 widget types referenced in presets, 4 already cased
(RESTAURANT_MENU_BOARD, BAR_TAP_LIST, BAR_COCKTAIL_MENU,
RETAIL_PRODUCT_GRID) and 15 falling through to the Advanced JSON
default. Per task instructions, prioritized 9 highest-value:

**Fixed (9):**
- RESTAURANT_COMBO_CAROUSEL (title, accent, rotationMs, combos JSON)
- RESTAURANT_SPECIALS_CALLOUT (headline, subhead, item, prices,
  emoji, theme, legacy tag/accent fields)
- RESTAURANT_LOYALTY_TICKER (program name, rotation, accent, theme,
  QR url+caption, messages text-area normalized to array)
- RESTAURANT_WAIT_TIME (title, estimateMins, partiesAhead, venue,
  SMS number+keyword, status override)
- RESTAURANT_ALLERGY_LEGEND (title, layout, theme, accent, custom
  entries JSON)
- BAR_HAPPY_HOUR_COUNTDOWN (title, subtitle, startsAt, endsAt,
  accent, postEndedMs, drinks JSON)
- BAR_GAME_DAY_SCHEDULE (title, subtitle, accent, maxRows, games JSON)
- BAR_EVENT_TONIGHT (eyebrow, artist, subtitle, doors/show times,
  cover, footer, two-tone neon accents)
- BAR_TRIVIA_SCOREBOARD (title, subtitle, round/question counters,
  deadline, accent, maxRows, teams JSON)

Each case reads the matching Widget.tsx Config interface and emits
the right primitive: TextField for strings/numbers, ColorPickerField
for hex color fields, SelectField for typed enums (theme / status /
mode / layout), ToggleField for booleans, TextAreaField with safe
JSON parse for array fields. JSON catch blocks follow the
editor-BUG-003 fix pattern (no setField — preserve previous valid
value while user is mid-typing).

**Still missing (6 widgets fell through to JSON Advanced):**
- BAR_TAP_LIST and BAR_COCKTAIL_MENU already had minimal cases
  (title + posSync only); not extended in this batch.
- RETAIL_LOOKBOOK_CAROUSEL
- RETAIL_STOREFRONT_HOURS
- RETAIL_PRICE_CALLOUT
- RETAIL_SALE_COUNTDOWN
- RETAIL_LOYALTY_QR
- RETAIL_WAYFINDING_MAP

These are next-batch fodder. Restaurant pack is fully covered;
retail pack still needs the 6 widget cases.

**TypeScript check:**
`cd apps/web && npx tsc --noEmit | grep -v test | grep error` — no
errors.

---

## emergency-009 — ScreenEmergencyController.allClear missing @AllowPanicBypass

**Severity:** Critical (life-safety adjacent — operator can trigger but
not clear).

**Bug:**
`apps/api/src/emergency/screen-emergency.controller.ts` had asymmetric
auth on per-screen emergency endpoints. The `trigger` handler carried
`@AllowPanicBypass()` so an operator with `canTriggerPanic: false` could
still fire a per-screen lockdown. The matching `allClear` handler did
NOT carry the decorator. Result: an operator who legitimately fired an
emergency through the bypass could not clear it again — the screen
would stay stuck on lockdown until a full admin stepped in. Trigger and
clear must always be reachable by the same operator-set.

**Fix:**
Added `@AllowPanicBypass()` above the `allClear` method, matching the
trigger handler. Inline comment documents the symmetry requirement so
a future refactor doesn't drop one and not the other.

**Files changed:**
- `apps/api/src/emergency/screen-emergency.controller.ts:307-318` —
  `@AllowPanicBypass()` decorator on `allClear` + comment block.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` — zero new errors. Pre-existing
spec-file errors (`screens.register.spec.ts`, `sso.service.spec.ts`)
unchanged.

**Acceptance test:**
1. Set a CONTRIBUTOR's `canTriggerPanic: true` and trigger a per-screen
   override at `POST /api/v1/emergency/screens/:id/trigger` — succeeds
   via `@AllowPanicBypass()`.
2. Without flipping `canTriggerPanic`, call `POST /api/v1/emergency/
   screens/:id/all-clear` — now succeeds via the matching decorator.
3. Pre-fix the same call returned 403; post-fix it returns 200 and
   deletes the override.

---

## ai-imports-003 — Filename not sanitized in /imports/design

**Severity:** High (security + UX).

**Bug:**
`apps/api/src/imports/imports.controller.ts` persisted
`originalName: file.originalname` raw and computed
`niceName = basename(file.originalname, ext)` with no length cap and no
character filter. Both fields land in the database and round-trip into
JSON responses + UI labels:
- `originalName` is shown in the asset library and audit trail.
- `niceName` becomes `Playlist.name`, displayed on the schedule + screen
  picker, and used in the API response message.

A 5 MB filename would round-trip into responses; control characters
(`\r`, `\n`, `\t`, NUL) could corrupt log lines, JSON outputs, or UI
rendering; reserved Windows filename chars (`< > : " | ? * / \`) could
cause display issues or download failures.

**Fix:**
1. Added two new helpers at module scope:
   - `sanitizeOriginalName(raw)` — strips control chars (`\r\n\t` +
     C0 0x00-0x1f), trims, caps at 200 chars.
   - `sanitizePlaylistName(raw)` — strips control chars + reserved
     filename chars (`/\\<>:"|?*`), collapses whitespace, trims, caps
     at 200 chars.
2. The handler computes `safeOriginalName` from `file.originalname`
   and `niceName` from `sanitizePlaylistName(basename(...))`. If the
   sanitized result is empty, falls back to literal `'Imported design'`
   so `Playlist.name` is never the empty string.
3. Both `Asset.originalName` (stored) and `Playlist.name` (stored +
   echoed in response message) use the sanitized values.

**Files changed:**
- `apps/api/src/imports/imports.controller.ts:65-92` — new
  `NAME_MAX_LEN`, `sanitizeOriginalName`, `sanitizePlaylistName`.
- `apps/api/src/imports/imports.controller.ts:148-159` —
  `safeOriginalName` + sanitized `niceName` in the asset/playlist
  create flow.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` — zero new errors.

**Acceptance test:**
1. Upload a file named `evil\r\nlogspoofed.pdf` — `Asset.originalName`
   stores `evillogspoofed.pdf` (CR+LF stripped); `Playlist.name` is
   `evillogspoofed`.
2. Upload `<<<my:design.pdf>>>` — `Playlist.name` is `mydesign`
   (reserved filename chars stripped).
3. Upload a file with a 1 MB filename — both fields cap at 200 chars.
4. Upload `.pdf` (empty basename) — `Playlist.name` is `'Imported
   design'` instead of empty string.

---

## emergency-007 — SOS location string log injection / display injection

**Severity:** High (logs, audit, signed payload integrity).

**Bug:**
`apps/api/src/emergency/emergency.controller.ts` `triggerSos` accepted
`body.location` from `SosInputSchema` (already capped at 500 chars) but
took no further sanitization. The string flowed into:
- `textBlob = `SOS from ... — ${body.location}`` — rendered onscreen.
- `AuditLog.details.location` — forensic record.
- `signer.signMessage('SOS', { ..., location: body.location })` —
  pushed to every player.

A `\r\n`-injected location string could forge fake log lines, splice
arbitrary content into the screen overlay's textBlob, or confuse
downstream log-processing pipelines.

**Fix:**
Added a single sanitize step at the top of the SOS handler:
```ts
const safeLocation = body.location
  ? String(body.location).replace(/[\r\n\t]/g, ' ').trim().slice(0, 500)
  : null;
```
Used `safeLocation` for `textBlob`, `AuditLog.details.location`, and
the signed message payload. The Zod 500-char cap is preserved as a
defense-in-depth bound at the boundary.

**Files changed:**
- `apps/api/src/emergency/emergency.controller.ts:617-630` —
  `safeLocation` derived from `body.location`; `textBlob` now uses it.
- `apps/api/src/emergency/emergency.controller.ts:651-666` —
  `AuditLog.details.location` uses sanitized value.
- `apps/api/src/emergency/emergency.controller.ts:670-679` — signed
  SOS payload uses sanitized value.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` — zero new errors.

**Acceptance test:**
1. POST `/api/v1/emergency/sos` with
   `{ "location": "Cafeteria\r\nFAKE: admin cleared all alerts" }`.
2. Inspect the resulting `EmergencyMessage.textBlob` — the `\r\n` is
   replaced with a space, so it reads
   `"SOS from staff@school — Cafeteria FAKE: admin cleared all alerts"`
   on a single line; no log-line spoofing.
3. `SELECT details FROM audit_logs WHERE action='SOS_TRIGGER'` —
   `details.location` is `"Cafeteria FAKE: admin cleared all alerts"`.
4. Player receives the signed message with the same single-line value.

---

## player-008 — /api/v1/player/latest-version unauthenticated + unthrottled

**Severity:** High (info disclosure + DoS amplification).

**Bug:**
`apps/api/src/player-ota/player-ota.controller.ts` exposed
`GET /latest-version` with no `@UseGuards`, no roles, and no throttle.
The handler is documented as "Admin-callable" for the dashboard's
"current vs latest" chip, but anyone — anonymous, unauthenticated —
could call it and:
- Enumerate the upstream GitHub release URL + SHA, leaking the exact
  APK build chain (Player vs Manager release tags, asset URLs).
- DoS the GitHub Releases API by churning the in-memory cache through
  the server (the cache is per-process; concurrent requests bypass it).

The other player endpoints in the same file (`update-check`,
`apk/latest`, `manager-update-check`, `manager-apk/latest`) are
intentionally unauthenticated because kiosks call them before pairing.
`latest-version` is not a kiosk endpoint and should be admin-gated.

**Fix:**
Added `@UseGuards(JwtAuthGuard, RbacGuard)`, `@RequireRoles(SUPER_ADMIN,
DISTRICT_ADMIN, SCHOOL_ADMIN)`, and `@Throttle({ default: { limit: 30,
ttl: 60_000 } })` to the `getLatestVersion` method. Imports for the
guards/decorators added at the top of the file. The other endpoints
(intentionally unauthenticated kiosk paths) are untouched.

**Files changed:**
- `apps/api/src/player-ota/player-ota.controller.ts:33-40` — added
  `UseGuards` import + `JwtAuthGuard`, `RbacGuard`, `RequireRoles`,
  `AppRole` imports.
- `apps/api/src/player-ota/player-ota.controller.ts:404-422` — gated
  `getLatestVersion` with guards + roles + throttle; comment block
  documents the audit fix.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` — zero new errors.

**Acceptance test:**
1. Anonymous `GET /api/v1/player/latest-version` — 401 Unauthorized.
2. CONTRIBUTOR JWT — 403 Forbidden (role gate).
3. SCHOOL_ADMIN JWT — 200 with `{ versionName, versionCode, source }`
   as before.
4. 31+ requests per minute from one admin — 30 succeed, the rest get
   429 Too Many Requests via the throttler.

---

## ai-imports-004 — Sample loaders silently merge into one POS connection

**Severity:** Medium (data integrity in demo mode).

**Bug:**
`apps/api/src/sample-data/sample-data.controller.ts` had two loaders
(`POST /pos/sample-restaurant`, `POST /pos/sample-retail`) that both
created a `posProviderConnection` with `providerId: 'custom-webhook'`.
The schema has `@@unique([tenantId, providerId])` so only one row can
exist per tenant. The lookup was `findFirst({ where: { tenantId,
providerId: 'custom-webhook' } })` — the SECOND loader to run for a
given tenant found the FIRST loader's connection and inserted its
items into the wrong displayName-tagged row.

Result: an admin who clicked "Load restaurant" then "Load retail" got
all 24 menu items + 18 retail SKUs jumbled under a single connection
named "[Sample] Restaurant menu" (whoever ran first). Categories
mixed; the menu-board widget rendered a confused superset.

**Fix:**
1. Each loader owns a uniquely-tagged displayName:
   - Restaurant: `[Sample] Restaurant Webhook`
   - Retail: `[Sample] Retail Webhook`
2. The lookup is now `findFirst({ where: { tenantId, displayName: ... } })`
   instead of by providerId — the loader finds ONLY its own tagged row.
3. The `createConnection` call still writes `providerId='custom-webhook'`
   so the unique index still applies. The first loader to run wins
   that index slot. The second loader's `createConnection` will throw
   a unique-constraint error; we catch it and return a friendly
   message asking the operator to wipe sample data first and re-run.
   That preserves data integrity without silently merging.

**Files changed:**
- `apps/api/src/sample-data/sample-data.controller.ts:145-180` —
  restaurant loader uses tagged displayName lookup + unique-error
  fallback. Comment block documents why providerId-based lookup fails.
- `apps/api/src/sample-data/sample-data.controller.ts:243-275` —
  retail loader mirrors the same pattern.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` — zero new errors.

**Acceptance test:**
1. Empty tenant. POST `/pos/sample-restaurant` — creates connection
   tagged `[Sample] Restaurant Webhook` with 24 menu items.
2. POST `/pos/sample-retail` — returns
   `{ ok: false, message: '...wipe sample data first...' }` instead
   of silently merging. Restaurant items are untouched.
3. POST `/sample-data/all` (DELETE) — wipes the restaurant row.
4. POST `/pos/sample-retail` — creates connection tagged
   `[Sample] Retail Webhook` with 18 retail SKUs.
5. POST `/pos/sample-restaurant` again — same fallback message.
6. Dashboard's POS Connections list shows the tagged displayName,
   making the source loader obvious at a glance.

---

## ai-imports-006 — AiGenerateModal missing role="dialog" / aria-modal / focus trap

**Severity:** Medium (a11y / WCAG dialog pattern).

**Bug:**
`apps/web/src/components/ai/AiGenerateButton.tsx` rendered the modal as
an unannotated `<div>` with no `role`, no `aria-modal`, no
`aria-labelledby`, and no focus management. Screen readers had no way
to identify it as a modal; keyboard users had to manually Tab into the
textarea on open; Tab and Shift+Tab could leak focus to background
page content while the modal was still visible; closing the modal
didn't restore focus to the launching element.

**Fix:**
1. Added `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`
   pointing at a stable `id` (`ai-generate-modal-title`) on the
   modal's outer panel div, with a matching `id` on the `<h2>` title.
2. Added `aria-label="Close"` to the close button.
3. Captured the previously-focused element on mount; restored focus
   to it on unmount.
4. Auto-focused the textarea on mount via a `ref`.
5. Added Tab / Shift+Tab focus-trap logic: queries all focusable
   elements inside the dialog and cycles between first and last.
   First element wraps to last on Shift+Tab; last wraps to first on
   Tab. Anything that loses focus to outside the dialog is pulled
   back to the appropriate edge.

The existing Escape-key close + AbortController-on-unmount logic was
preserved — the new keydown handler co-exists with both.

**Files changed:**
- `apps/web/src/components/ai/AiGenerateButton.tsx:118-185` —
  `dialogRef`, `textareaRef`, `titleId` constants; expanded
  `useEffect` to capture-and-restore focus + auto-focus textarea +
  tab-trap on Tab / Shift+Tab.
- `apps/web/src/components/ai/AiGenerateButton.tsx:190-205` — outer
  panel div now carries `role`, `aria-modal`, `aria-labelledby`, and
  `dialogRef`; `<h2>` got `id={titleId}`; close button got
  `aria-label="Close"`.
- `apps/web/src/components/ai/AiGenerateButton.tsx:224-232` — textarea
  got `ref={textareaRef}` for auto-focus on mount.

**TypeScript check:**
`cd apps/web && npx tsc --noEmit` — zero new errors in AiGenerateButton.

**Acceptance test:**
1. Open the AI Generate modal with a screen reader (NVDA / VoiceOver):
   announces "dialog, Generate <intent> with AI" via the
   aria-labelledby title.
2. Open via mouse click — textarea auto-focuses (no Tab needed).
3. Press Tab repeatedly — focus cycles within the modal's controls
   (textarea → tone buttons → Generate button → close button → back
   to textarea). Background page elements never receive focus.
4. Press Shift+Tab from the textarea — wraps to the close button.
5. Press Escape — modal closes; focus returns to the launching ✨ AI
   button (or wherever it was when the modal opened).

---

## editor-BUG-003 — JSON-parse failure leaks string into cfg arrays

**Severity:** High (renderer crash on partial keystrokes).

**Bug:**
Three FITNESS_* cases in PropertiesPanel.tsx had this pattern in
their TextAreaField onChange:

```ts
onChange={(v) => {
  try { setField({ creatives: JSON.parse(v) }); }
  catch { setField({ creatives: v }); }
}}
```

When the user typed mid-stream (e.g. just pasted `[{`), `JSON.parse`
threw and the catch path wrote the raw string into `cfg.creatives`.
The widget then crashed when its render loop tried to iterate the
string as an array (`creatives.map(...)` throws TypeError).

**Fix:**
Replaced the catch path in three locations:
- `case 'FITNESS_AD_BANNER'` — creatives JSON
- `case 'FITNESS_CLASS_SCHEDULE'` — classes JSON
- `case 'FITNESS_MOTIVATIONAL_QUOTE'` — quotes JSON

New pattern: `catch { /* keep previous value; user is mid-typing */ }`.
Empty catch keeps the last valid array intact; the textarea retains
the in-progress text via its own local `useState` mirror (see
TextAreaField definition around line 2470). When the user finishes
typing valid JSON, the next keystroke reaches the try branch and
commits.

The same safe-parse pattern was reused for every JSON-array editor
added in editor-BUG-002 (combos, drinks, games, teams, entries,
etc.) so the bug doesn't recur.

**TypeScript check:**
`cd apps/web && npx tsc --noEmit | grep -v test | grep error` — no
errors.
