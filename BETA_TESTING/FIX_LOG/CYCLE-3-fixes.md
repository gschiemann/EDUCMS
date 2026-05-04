# CYCLE-3 Fix Log

## editor-BUG-004 — 6 RETAIL widgets missing editor case

**Severity:** Medium (UX gap — retail pilot tenants forced into JSON-only
editing for the daily-driver widgets in the retail pack).

**Carry-over from cycle-2:**
editor-BUG-002 fixed 9 RESTAURANT_/BAR_ widgets but deferred the 6
RETAIL widgets that also fall through to the Advanced JSON default
in PropertiesPanel.tsx. This cycle-3 fix closes that gap. After this
batch, the only widgets in the retail/restaurant/bar packs still
falling through to JSON-only Advanced are BAR_TAP_LIST and
BAR_COCKTAIL_MENU (each have a minimal title+posSync case already;
not extended in this batch per task scope).

**Fixed (6):**
- RETAIL_LOOKBOOK_CAROUSEL — rotationMs, fadeMs, ink, accent, slides
  JSON array of `{ eyebrow, headline, subhead, price, imageUrl,
  swatchColor, emoji }`
- RETAIL_STOREFRONT_HOURS — eyebrow, headline, subhead, statusOverride
  (auto/open/closed select), bg/ink/accent colors, openHours JSON
  object keyed by sun-sat
- RETAIL_PRICE_CALLOUT — eyebrow, headline, subhead, salePrice,
  originalPrice, discountLabel override, image (AssetPickerField),
  emoji + swatchColor fallback, bg/ink/accent colors, sellingPoints
  JSON array (max 3)
- RETAIL_SALE_COUNTDOWN — eyebrow, headline, endsAt ISO timestamp,
  finishedMessage, fineprint, bg/ink/accent colors
- RETAIL_LOYALTY_QR — eyebrow, headline, subhead, ctaText,
  qrFootnote, qrImageUrl (AssetPickerField), bg/ink/accent colors,
  perks JSON array (max 3)
- RETAIL_WAYFINDING_MAP — heading, subheading, bg/ink/accent colors,
  youAreHere `{ x, y }` JSON, departments JSON array of `{ name, x,
  y, width, height, color, emoji, highlight }`

Each case reads the matching Widget.tsx Config interface
(`apps/web/src/components/widgets/retail/Retail*Widget.tsx`) and emits
the right primitive: TextField for strings/numbers, ColorPickerField
for hex color fields, SelectField for typed enums (statusOverride),
AssetPickerField for image URLs, TextAreaField with safe JSON parse
for array/object fields. Catch blocks follow the editor-BUG-003
pattern (no setField inside catch — preserve previous valid value
while user is mid-typing).

Inserted right after the existing `case 'RETAIL_PRODUCT_GRID':`
block (around line 2356) so all 7 retail-pack cases sit together.
Existing cases were not refactored.

**Files changed:**
- `apps/web/src/components/template-builder/PropertiesPanel.tsx:2357-2454` —
  six new RETAIL_* case blocks.

**TypeScript check:**
`cd apps/web && npx tsc --noEmit | grep -v test | grep error` —
zero new errors in production code. Pre-existing test-file errors
in `RoleGate.test.tsx` and `touch-widgets.test.tsx` (missing
@testing-library/react types) unchanged.

**Acceptance test:**
All 6 RETAIL widgets now have explicit editor cases that emit real
form controls instead of falling through to JSON-only Advanced mode.
Open the template builder, drop a RETAIL_LOOKBOOK_CAROUSEL /
RETAIL_STOREFRONT_HOURS / RETAIL_PRICE_CALLOUT / RETAIL_SALE_COUNTDOWN
/ RETAIL_LOYALTY_QR / RETAIL_WAYFINDING_MAP zone, click it — the
Properties panel shows labeled TextField / SelectField / ColorPicker
/ AssetPicker / TextAreaField controls bound to the real Config
interface fields. Mid-typing in JSON textareas does not crash the
renderer (safe-parse pattern preserves the last valid array/object
on parse failure).

## emergency-012 — SUPER_ADMIN cross-tenant per-screen trigger regression

**Severity:** High (cross-tenant operator workflow blocked, life-safety
adjacent — a SUPER_ADMIN responding to a district-wide incident could
not target individual screens outside their primary tenant).

**Cycle-2 carry-over:**
emergency-004 hardened `ScreenEmergencyController` against the
"Prisma silently strips undefined filter" tenant-isolation leak by
adding `requireTenantId` (rejects any token without tenantId) and
`resolveScreen` (strictly filters by callerTenantId). Both helpers
treat the absence of tenantId as a hard 403 — but SUPER_ADMIN tokens
legitimately may carry no tenantId (they operate cross-tenant). The
sibling `EmergencyController.resolveScopeTenant` already handled this
with an `isSuper` bypass; `ScreenEmergencyController` did not. Net
effect: a SUPER_ADMIN trying to fire a per-screen emergency on a
screen outside their default tenant got a 403 before the DB call.

**Fix:**
- `requireTenantId(req)` now returns `string | null`. If the token
  carries a non-empty tenantId, return it (existing behavior). If
  it does not but `req.user.role === SUPER_ADMIN`, return `null`
  (cross-tenant operator). Otherwise still throw 403 — no change
  for non-super callers without tenantId.
- `resolveScreen(screenId, callerTenantId: string | null)` now
  branches on `null`: if super, look up the screen by id alone via
  `findUnique`; otherwise the existing strict `findFirst` with
  `tenantId: callerTenantId`. The override row written downstream
  in `createOverrideAndBroadcast` denormalizes `tenantId` from
  `screen.tenantId` (not the caller's token) — so audit forensics
  correctly tag the affected tenant even when a SUPER_ADMIN fires
  cross-tenant.
- `bulkTrigger` mirrors the same pattern: build the `where` clause
  conditionally so SUPER_ADMIN gets `id: { in: ... }` (no tenant
  filter) while everyone else gets `id: { in: ... }, tenantId: X`.

`trigger`, `allClear`, and `getOverride` did not need direct edits —
they already call `requireTenantId` then `resolveScreen` with the
returned value, and both helpers are now cross-tenant-aware.

**Files changed:**
- `apps/api/src/emergency/screen-emergency.controller.ts:171-182` —
  `requireTenantId` returns `string | null`, allows SUPER_ADMIN
  through with null.
- `apps/api/src/emergency/screen-emergency.controller.ts:184-219` —
  `resolveScreen` accepts `string | null`, branches on null to do
  an id-only `findUnique` for SUPER_ADMIN.
- `apps/api/src/emergency/screen-emergency.controller.ts:399-432` —
  `bulkTrigger` builds the `where` clause conditionally so super
  callers skip the `tenantId` filter on the `findMany`.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit | grep -v spec.ts | grep error` —
zero errors in production code.

**Acceptance test:**
SUPER_ADMIN with no tenantId successfully triggers emergency on
screen in any tenant; DISTRICT_ADMIN of tenant A still blocked
from screens in tenant B; non-SUPER_ADMIN with no tenantId still
403s.

## emergency-011 — Device JWT in production missing tenantId / deviceId

**Severity:** P0 life-safety. All signed WebSocket emergency
broadcasts silently dropped on the WS path in production. Players
only received emergency events via the 10-second HTTP polling
fallback — a 10s lag on lockdown trigger is a real-world risk.

**Root cause:**
`apps/api/src/screens/screens.controller.ts` `mintDeviceJwt` minted
device JWTs with payload `{ sub, kind, fp }` only — no `deviceId`,
no `tenantId`. The realtime gateway
(`apps/api/src/realtime/realtime.gateway.ts:125-127`) reads
`decoded.deviceId` and `decoded.tenantId` to populate ClientContext.
In production both fields decoded to `undefined`, so every match
in `broadcastToScope` (`ctx.tenantId === id`,
`ctx.deviceId === id`) failed regardless of the broadcast scope.

The dev-only `dev_<screenId>_<tenantId>` short-circuit branch in
the gateway (line 117) DID populate the fields, masking the bug
entirely in development.

The sister mint at `apps/api/src/devices/devices.controller.ts:80`
(the /devices/pair flow) already includes `tenantId` — only the
/screens/register mint had drifted from the contract.

**Fix:**
- `apps/api/src/screens/screens.controller.ts` `mintDeviceJwt` now
  accepts an optional `tenantId` argument and includes both
  `deviceId: screenId` (mirror of `sub` for the WS gateway's
  reader) and `tenantId` (when paired) in the signed payload.
  `sub` is preserved unchanged so existing verifiers
  (`verifyDeviceForScreen`, `verifyPriorToken`, `JwtAuthGuard`,
  `player-logs.controller.verifyDeviceJwt`) keep working — they
  only check `decoded.kind` + `decoded.sub`.
- The paired re-registration call site now passes
  `existing.tenantId` so the freshly-minted token carries the
  scope.
- Unpaired branches deliberately omit `tenantId` (no tenant claim
  yet — those tokens never authenticate WS broadcasts).

**Backward compat:**
Existing paired kiosks hold tokens without `deviceId` / `tenantId`.
Those tokens still parse (additive payload only) but their WS
`broadcastToScope` match continues to fail until the device
re-fetches a token via the next /screens/register or /devices/pair
round-trip. HTTP-polling fallback keeps those screens functional
in the meantime. Documented inline in the `mintDeviceJwt` comment
so the next maintainer understands the rotation requirement.

**Files changed:**
- `apps/api/src/screens/screens.controller.ts:211-249` (mint
  signature + payload + comment)
- `apps/api/src/screens/screens.controller.ts:330` (paired
  call-site passes `existing.tenantId`)

**TypeScript check:**
`cd apps/api && npx tsc --noEmit | grep -v spec.ts | grep error` —
zero errors.

**Acceptance test:**
After fix, a freshly-paired device's JWT decodes to include both
`deviceId` and `tenantId`; WS `broadcastToScope` matches correctly
on `tenant:<id>` and `device:<id>` channels; existing devices that
re-fetch their token via the next pairing rotation will work too.

## player-014 — page-side emergency ref poisoned before SW acks

**Severity:** P0 LIFE-SAFETY (emergency cache reliability).

**Root cause:**
`refreshEmergencyCache` in `apps/web/src/app/player/page.tsx`
synchronously assigned `lastEmergencySetHashRef.current = newHash`
BEFORE awaiting the postMessage to the SW. The CYCLE-1 player-001
fix correctly stops the SW from committing its meta hash on a
partial download — but the page-side ref was already poisoned, so
the very next 5-min retry's `if (data.setHash === ref) return;`
short-circuit fired and emergency cache never re-attempted. Result:
a single transient network failure during the first push could
leave the kiosk with no emergency content cached for the lifetime
of the SW.

**Fix:**
The SW now acks completion via a `MessageChannel` port. The page
passes `channel.port2` along with the `PRECACHE_EMERGENCY` message;
the SW posts `{ ok: allCached, failures, count }` back via
`event.ports[0]` AFTER the same `allCached` decision that gates
the meta-hash write. The page commits `lastEmergencySetHashRef`
only when `ack.ok === true`. On partial / SW-unsupported / timeout
the ref stays unchanged, so the next 5-min cycle re-fires the
same precache push instead of short-circuiting.

A 60s page-side watchdog resolves `{ ok: false }` if the SW never
replies (defensive — emergency sets are small enough that 60s is
generous). 60s is well under the 5-min retry interval so the page
never stacks pushes.

**Files changed:**
- `apps/web/public/sw-player.js` — `precacheEmergency` accepts a
  third `ackPort` arg; `message` handler reads `event.ports[0]`
  and threads it through; SW posts `{ ok, failures, count }` after
  the `allCached` decision.
- `apps/web/src/app/player/offline-cache.ts` — `precacheEmergency`
  now returns `Promise<{ ok: boolean; failures?; count? }>`,
  creates a MessageChannel, transfers `port2` to the SW with
  `postMessage`, listens on `port1` for the ack.
- `apps/web/src/app/player/page.tsx:1241-1268` —
  `refreshEmergencyCache` awaits the ack and gates the ref commit
  on `ack.ok`. Logs a warning on partial so it shows up in the
  player console.

**Acceptance test:**
After fix, the page-side ref only commits after the SW confirms
allCached. To exercise the partial-download retry path: simulate
a network failure mid-push (block one of the emergency asset URLs
in DevTools Network), confirm the next 5-min cycle actually
re-fires the precache push (look for the second `PRECACHE_PROGRESS`
burst in DevTools console). With a clean push the log line
`[Player] Emergency pre-cache push: N assets` fires; on a partial
the log line is `[Player] Emergency pre-cache partial (K failures
of N) — leaving ref uncommitted so next 5-min sync retries`, and
the next 5-min tick runs the full push again.

## player-015 — SW activate deletes v1 emergency cache before v2 populated

**Severity:** P0 LIFE-SAFETY (emergency cache reliability).

**Root cause:**
The SW `activate` handler computed `stale = keys.filter((k) =>
k.startsWith('edu-player-') && !ALL_CACHES.includes(k))` and
deleted them all. On a `VERSION` bump from v1 to v2 (or v2 to v3)
this dropped `edu-player-emergency-v1` immediately, leaving the
kiosk with zero cached emergency assets until the page-side
`refreshEmergencyCache` next fired (up to ~5 min later, longer if
network was flaky). A lockdown trigger landing inside that window
would render no media on screen.

**Fix (Option A — copy then delete):**
Before deleting any stale `edu-player-emergency-*` cache, the
activate handler now opens the most-recent stale emergency cache
and copies every `(request, response)` pair into the new
`EMERGENCY_CACHE`. Hashes still match so no re-download is needed;
`refreshEmergencyCache` will short-circuit on the unchanged-hash
check after activate finishes. We also copy the matching
`edu-player-meta-*` cache (sha + size records) so the next call to
`fetchAndStore` correctly detects each asset is already up-to-date
and `sumCacheBytes` doesn't have to re-blob() every entry.

If the copy step throws (cache-full, quota, etc) we log and fall
through to deletion — the kiosk is no worse off than before the
fix, and the next `refreshEmergencyCache` re-downloads.

`VERSION` bumped from `v2` to `v3` so deployed kiosks pick up the
fix on next activate. The activate handler will copy v2 → v3
emergency entries on first install of this build.

**Files changed:**
- `apps/web/public/sw-player.js` — `activate` handler now finds
  the most recent stale emergency + meta cache, copies entries
  into the new versioned caches, then deletes the stale ones.
  `VERSION` bumped to `v3`.

**Acceptance test:**
After fix, an SW activate from v2 to v3 copies v2 emergency
entries into v3 BEFORE deleting v2; the kiosk never has 0 cached
emergency assets during a SW upgrade. To verify in DevTools:
Application → Cache Storage; immediately after the new SW
activates you should see `edu-player-emergency-v3` containing the
same entries that were in v2, and `edu-player-emergency-v2`
deleted. A `STATUS_REQUEST` to the new SW reports the same
emergency.count + emergency.bytes as before the upgrade.

**TypeScript check (both fixes):**
`cd apps/web && npx tsc --noEmit` — zero new errors in production
code. Pre-existing test-file errors in `RoleGate.test.tsx` and
`touch-widgets.test.tsx` (missing `@testing-library/react` types)
unchanged.
