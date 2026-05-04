# CYCLE 1 — Integrations (streaming + POS + ad-network)

Tester: Cycle-1 integrations agent. Scope: streaming, POS, ads, sample-data,
PropertiesPanel pickers. Static review only (no live browser).

---

## P0 — Connect button is dead for almost every streaming provider

**File:** `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:501, 619-622`

```tsx
const [agreed, setAgreed] = useState(provider.auth === 'none');
...
<button onClick={submit} disabled={submitting || provider.auth === 'oauth2' || !agreed}>
```

`agreed` only initialises to `true` when `provider.auth === 'none'` (i.e. the
Public Broadcasters card). The only other path that flips it to `true` is the
`requiresVenueLicense` checkbox (DIRECTV-Business + DISH-Business only).

Effect: the Connect button is permanently disabled for **YouTube, Twitch, Atmosphere
TV, Mood Media, iHeart for Business, Custom HLS / DASH, IPTV M3U, Vimeo Live,
Soundtrack** (oauth2 has its own `disabled` clause too, but customHls / iframeOnly
/ apiKey / license auth providers without `requiresVenueLicense` are stuck).

Of the 13 catalog providers only 3 can actually be connected through this modal:
public-broadcasters (auth=none), directv-business and dish-business
(requiresVenueLicense=true). Everything else is a dead-end.

**Fix:** drop the `!agreed` from the disabled clause OR re-purpose `agreed` as a
"venue-license confirmation" only (i.e. require it ONLY when `requiresVenueLicense`
is set).

## P0 — BridgeSetupModal continues into the same dead Connect modal

**File:** `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:362-376`

After the operator confirms every step, `onContinue` opens the Connect modal for
`custom-hls`. `custom-hls.requiresVenueLicense` is undefined and its auth is
`customHls`, so the same P0 above applies — the entire bridge workflow ends on a
permanently-disabled Connect button. Atmosphere TV / DIRECTV / DISH / Mood / iHeart
bridges are all broken end-to-end.

## P1 — POS oauth2 providers save empty/invalid connections silently

**Files:**
- `apps/web/src/app/[schoolId]/settings/pos/page.tsx:301-307` (UI submits empty creds)
- `apps/api/src/pos/pos.service.ts:81-90` (no validation for `auth === 'oauth2'`)

The POS ConnectModal renders an "OAuth flow not yet implemented" notice for
`auth === 'oauth2'` (Square, Toast, Lightspeed Retail, Shopify POS, MINDBODY) but
**still leaves the Connect button enabled**. Pressing it POSTs `credentials: {}`,
the service has no oauth2 branch in its validation block, so a PENDING row with
zero credentials is persisted. The operator now has a dead PoS row that shows
"PENDING" forever, and the Sync button returns the "handler not yet implemented"
message that hides the empty-creds bug.

**Fix:** disable the Connect button when `provider.auth === 'oauth2'` (mirror the
streaming-page treatment of `oauth2`), or short-circuit on the server.

## P1 — Ad-network ConnectModal has no PARTNER vs DIRECT differentiation

**File:** `apps/web/src/app/[schoolId]/settings/monetize/page.tsx:171-178, 285-352`

Test plan calls for "PARTNER tier shows 'Apply for partnership' not 'Connect'" but
`NetworkTile.onConnect` always opens `ConnectModal`, which always renders a
"Connect" button. PARTNER networks (Hivestack, Vistar Media, Place Exchange,
Broadsign Reach, Loop Media) all behave identically to DIRECT (`house-only`).
Click → empty creds POST → server saves a PENDING row that never activates.

The server-side check exists for k12Forbidden + integrationTier === 'CLOSED' but
nothing rejects PARTNER with empty oauth creds.

**Fix:** branch in `NetworkTile` so PARTNER opens a "Apply for partnership"
mailto/info CTA, and DIRECT opens the Connect form.

## P1 — Streaming/POS picker links resolve relatively (broken)

**File:** `apps/web/src/components/template-builder/PropertiesPanel.tsx:3572, 3640`

```tsx
<a href="settings/streaming">Settings → Streaming</a>
<a href="settings/pos">connect Square / Toast / Clover</a>
```

These links live inside the empty-state of the channel/category pickers in the
template editor (route `/[schoolId]/templates/[id]/edit`). With a relative href the
browser resolves to `/[schoolId]/templates/[id]/edit/settings/streaming` — a 404.
Should be `../settings/streaming` and `../settings/pos`, or absolute
`/${schoolId}/settings/streaming`.

## P1 — `StreamProviderListItem` API type is missing `bridgeSteps`

**File:** `packages/api-types/src/streaming.ts:401-419`

`StreamingService.listProviders` (controller GET `/streaming/providers`) returns a
`bridgeSteps` array but the canonical `StreamProviderListItem` interface omits it.
The web app declares a local `Provider` interface (streaming page line 22-41) that
DOES include it, masking the drift, but anyone consuming the api-types contract
loses the field at compile time. BridgeSetupModal would silently render zero steps
if the type were honoured.

**Fix:** add `bridgeSteps?: ReadonlyArray<{ step: string; detail?: string; productExamples?: ReadonlyArray<string> }>` to `StreamProviderListItem`.

## P2 — Ads `feeCents` rounds to zero per impression

**File:** `apps/api/src/ads/ads.service.ts:213-219`

```js
const revenueCents = Math.floor(opts.cpmCents / 1000);
const feeCents     = Math.floor((revenueCents * takeRateBps) / 10000);
```

With CPM=$10 (`cpmCents=1000`), revenueCents=1. `1 * 1500 / 10000 = 0.15` → floor
= 0. Fee per impression is always 0 unless revenue per impression ≥ 7 cents (i.e.
CPM ≥ $70). For typical $5–$15 CPMs the platform earns nothing per impression
according to the column. Aggregate the math at the daily-rollup boundary instead
or work in millicents.

## P2 — `PosService.listMenuItems` crashes when `syncedAt` is null

**File:** `apps/api/src/pos/pos.service.ts:148`

```js
updatedAt: r.syncedAt.toISOString()
```

Schema `PosMenuItem.syncedAt` is `@default(now())` so existing rows are fine, but
any row inserted without going through Prisma's default (raw SQL, future webhook
ingest, partial restore) crashes the entire `/pos/items` response. Use
`r.syncedAt?.toISOString()`.

## P2 — Monetize page renders K12-forbidden tiles without filtering

**File:** `apps/web/src/app/[schoolId]/settings/monetize/page.tsx:160-183`

`AdsService.listNetworks` returns the entire catalog including `k12Forbidden`
networks. The K-12 tenant sees Hivestack/Vistar/etc. tiles, clicks Connect, gets
a server-side ForbiddenException ("not available for K-12 tenants"). Should use
`adNetworksForVertical()` server-side or hide non-allowed tiles client-side based
on tenant vertical, not error-after-click.

## GREEN

- All 9 streaming + 7 POS + 7 ads + 6 sample-data endpoints have `@RequireRoles`
  decorators with sensible role gates.
- CSRF middleware is global (apps/api/src/security/csrf.middleware.ts); none of
  the integration paths are in EXEMPT_PATHS, so all mutating requests must carry
  the `X-CSRF-Token` header.
- Schemas have `@@unique([connectionId, externalId])` on `PosMenuItem` and
  `StreamChannel`, plus `@@unique([tenantId, providerId])` on connections, so the
  sample-data controller's try/catch on duplicates is genuinely idempotent.
  Re-running every sample-data POST is safe.
- Sample-data wipe (`DELETE /sample-data/all`) only removes rows whose
  `displayName` starts with `[Sample]`. Non-tagged production rows are untouched.
- StreamProviderConnection / StreamChannel cascade-delete (`onDelete: Cascade`)
  so wiping a sample connection cleans up its channels + items automatically.
- ConnectModal closes / WhyClosedModal closes / BridgeSetupModal stop-propagation
  works correctly. Empty `bridgeSteps` is handled (placeholder text, button
  enabled).
- `/streaming/channels` + `/pos/categories` queries fall back gracefully on
  empty/error in `StreamingChannelPickerField` and `PosCategoryPickerField`
  (PropertiesPanel.tsx:3539-3586, 3606-3647) — empty array handled, friendly
  copy shown, no crash.
- No `localhost:8080` hardcodes outside `apps/web/src/lib/api-url.ts`'s
  intentional fallback constant; `apps/web/src/app/[schoolId]/settings/page.tsx`
  also uses the documented fallback pattern.
- Channel-picker → widget config wiring (PropertiesPanel.tsx:2110-2163) correctly
  copies `playbackUrl`, `playbackType`, `embedUrl`, `channelTitle`,
  `allowAdOverlay`, `streamingChannelId` for both STREAMING and FITNESS_LIVE_TV
  widgets, and clears them all on `onClear`.
- `recordImpression` correctly skips work when the connection no longer exists
  (line 217 returns early).
