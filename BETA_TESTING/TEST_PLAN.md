# Test Plan — what each agent tests

Each area below has a checklist the tester agent works through. They
write a report to `BETA_TESTING/BUG_REPORTS/CYCLE-N-<area>.md` when done.

## Common methodology (all agents)

Static testing — agents can't run a live browser, so they:
1. Read the relevant controllers + services + components
2. Verify the code paths match what the tests below describe
3. Find bugs by spotting:
   - Missing null checks / empty-state crashes
   - Type drift (frontend interface ↔ backend response shape)
   - Auth / RBAC gaps
   - Schema-query mismatches (Prisma column doesn't exist or has wrong type)
   - Race conditions / dangling promises / unmount-leak
   - Hardcoded URLs / env-var misuse / dev fallbacks shipping to prod
   - i18n / a11y blockers (missing aria-label, color-only state)
   - Accessibility (axe-core has been integrated; verify it doesn't shout)
4. Write findings to `BUG_REPORTS/CYCLE-N-<area>.md` ranked P0 / P1 / P2

## Area 1 — auth (Auth + RBAC + tenant isolation)

Files to read:
- `apps/api/src/auth/` (controller, service, jwt-auth.guard, rbac.guard)
- `apps/api/src/security/` (csrf, anomaly, sanitization)
- `apps/web/src/app/login/` + `apps/web/src/app/signup/` + `apps/web/src/store/ui-store.ts`
- `apps/web/src/components/RoleGate.tsx`

Checklist:
- [ ] Login flow: email + password posts to `/auth/login`, returns user + token, store updates
- [ ] CSRF: every non-GET endpoint validates the X-CSRF-Token header
- [ ] RBAC: every controller has `@RequireRoles()` annotation; missing decorator → P0
- [ ] Tenant isolation: any controller method reading by `id` must scope `where: { tenantId: req.user.tenantId }`. Find any that doesn't.
- [ ] Password reset flow: token expiration, single-use, revocation on success
- [ ] Session persistence across tabs (Zustand + sessionStorage check)
- [ ] Logout clears session-storage AND localStorage
- [ ] Invite flow: invitation email + accept-token, single-use
- [ ] Anomaly middleware doesn't block legitimate burst (pilot tenants don't get banned for bulk uploads)

## Area 2 — editor (Templates + Widget editor + VariantPicker)

Files to read:
- `apps/web/src/components/template-builder/PropertiesPanel.tsx` (3700+ lines)
- `apps/web/src/components/template-builder/VariantPicker.tsx`
- `apps/web/src/components/template-builder/WidgetPalette.tsx`
- `apps/web/src/components/template-builder/useBuilderStore.ts`
- `apps/web/src/components/widgets/WidgetRenderer.tsx`
- `apps/api/src/templates/` (controller, ensure-system-presets, all *-presets.ts)

Checklist:
- [ ] Drop a widget on the canvas → renders without console errors
- [ ] Variant picker filters by tenant vertical (K-12 hides for gym tenant + vice versa)
- [ ] Properties panel has an editor case for EVERY widget type. Find missing cases.
- [ ] AI Generate button on ANNOUNCEMENT / FITNESS_MOTIVATIONAL_QUOTE / TICKER fires correctly
- [ ] Streaming channel picker on STREAMING + FITNESS_LIVE_TV widgets queries `/streaming/channels`
- [ ] POS category picker on RESTAURANT_MENU_BOARD / BAR_TAP_LIST / etc queries `/pos/categories`
- [ ] All 24 fitness widgets have editors (verify via grep)
- [ ] WidgetRenderer has a case for every widget type referenced in any preset
- [ ] Color picker, asset picker, font picker fields render and save correctly
- [ ] Save → reload → fields persist (verify via /templates/:id endpoint)
- [ ] Container queries on cluster of 10 widgets (FitnessAppLibrary etc) — note the Android <105 issue but verify the runtime fallback isn't crashing

## Area 3 — integrations (Streaming + POS + Ad-network)

Files to read:
- `apps/api/src/streaming/`, `apps/api/src/pos/`, `apps/api/src/ads/`
- `apps/web/src/app/[schoolId]/settings/streaming/` + `pos/` + `monetize/`
- `packages/api-types/src/streaming.ts`, `pos.ts`, `ad-network.ts`
- `apps/api/src/sample-data/sample-data.controller.ts`

Checklist:
- [ ] Streaming connect modal: every auth type (none / apiKey / customHls / iframeOnly / oauth2) renders correct form
- [ ] BRIDGE-tier setup wizard renders steps from catalog `bridgeSteps`
- [ ] POS connect: every provider's auth fields match catalog declaration
- [ ] Ad-network connect: PARTNER tier shows "Apply for partnership" not "Connect"
- [ ] Sample-data wipe: only removes `[Sample]`-tagged rows
- [ ] Sample-data idempotent: calling twice doesn't duplicate
- [ ] Streaming channel picker: dropdown populates from `/streaming/channels`
- [ ] When picked, channel data flows to widget config (playbackUrl, playbackType, allowAdOverlay)
- [ ] POS catalog sync: `/pos/items` filters by category correctly
- [ ] `/pos/categories` returns distinct category names with counts
- [ ] Ad overlay engine fires at correct cadence on StreamingWidget
- [ ] `Custom HLS` connector accepts m3u8 URL + DASH .mpd URL
- [ ] Quick Start hero on streaming page: every card's onClick lands the operator on the right modal
- [ ] WhyClosedModal renders + buttons jump to the right BridgeSetupModal preset

## Area 4 — emergency (Emergency + Floor plans + Panic flow)

Files to read:
- `apps/api/src/emergency/` (controller, service, audit-log)
- `apps/api/src/floor-plans/`
- `apps/web/src/app/panic/page.tsx`
- `apps/web/src/app/[schoolId]/floor-plans/`
- `packages/ws-events/`

Checklist:
- [ ] `/emergency/trigger` requires `@AllowPanicBypass` decorator + role gate
- [ ] AuditLog created on every trigger AND every all-clear
- [ ] Signed WS message payload validates on player side before render
- [ ] HTTP polling fallback fires when Redis unavailable
- [ ] Hold-to-trigger UX: 3-second hold required on mobile panic page
- [ ] Floor plan upload: Supabase storage path under tenant folder
- [ ] Per-screen emergency override (Sprint 8b): screenId scoping correct
- [ ] All 4 panic types (lockdown / evacuate / weather / medical) have presets
- [ ] Pre-cached emergency assets: player Service Worker pre-fetches them
- [ ] Test panic page (Mobile): tenants without `canTriggerPanic: true` blocked

## Area 5 — player (Player + APK + Offline cache + USB)

Files to read:
- `apps/web/src/app/player/page.tsx` (3000+ lines)
- `apps/web/public/sw-player.js` (Service Worker)
- `apps/api/src/screens/`, `apps/api/src/player-ota/`, `apps/api/src/usb-export/`
- `apps/web/src/lib/capabilities.ts`

Checklist:
- [ ] Player pairs via 6-character pairing code from `/screens/pair`
- [ ] Manifest fetch: `/screens/:id/manifest` returns expected shape
- [ ] Service Worker pre-caches emergency assets on every manifest sync
- [ ] Capability detection runs at boot, posts to `/screens/:id/heartbeat`
- [ ] Offline-cache LRU evicts non-emergency assets first
- [ ] APK download endpoint: `/player/apk/latest` redirects to signed release
- [ ] Auto-update toggle persists; default OFF
- [ ] USB export bundle: signed manifest + asset hashes
- [ ] WebSocket reconnect: exponential backoff, max attempts
- [ ] Browser fallback when no native bridge (legacy APK or browser-only mode)

## Area 6 — ai-imports (AI generation + Canva imports + Sample data)

Files to read:
- `apps/api/src/ai/` (service, controller, module)
- `apps/api/src/imports/` (controller, module)
- `apps/web/src/components/ai/AiGenerateButton.tsx`
- `apps/web/src/app/[schoolId]/settings/imports/page.tsx`
- `apps/web/src/app/[schoolId]/settings/test-integrations/page.tsx`
- `apps/api/src/sample-data/` (controller, module)

Checklist:
- [ ] AI service: every intent has a system prompt
- [ ] AI rate limit: 30/hr/tenant in-memory window correctly increments + caps
- [ ] AI input validation: 2000-char context cap, vertical whitelist, tone whitelist
- [ ] AI 503 when ANTHROPIC_API_KEY unset (don't crash, friendly error)
- [ ] AI fetch aborts on modal unmount
- [ ] Imports endpoint: every accepted MIME (.pdf / .pptx / .png / .jpg / .webp) creates Asset + Playlist
- [ ] Multi-page PDF detection: surfaces friendly "split for now" message
- [ ] Imports filename sanitization: blocks path traversal, caps length
- [ ] Imports CONTRIBUTOR uploads land in PENDING_APPROVAL
- [ ] Sample-data: every loader idempotent (call twice, no duplicates)
- [ ] Sample-data wipe: tagged rows only, production rows safe
- [ ] Test-integrations page: every action button wired to the right endpoint
