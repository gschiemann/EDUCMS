# VenueOS — Launch Status (2026-05-03)

Honest accounting of what's wired up vs. what needs vendor-side setup before
it can do real work in production. Use this as the pre-launch checklist.

## ✅ What's live and working

### Multi-vertical platform
- K12 / GYM / RETAIL / CORPORATE / QSR / FASHION verticals all routed
- Vertical-aware UI copy via `useTenantCopy()` (org noun, role labels, template categories, default brand)
- Tenant.vertical column drives template visibility per tenant
- Templates page hides K12 grade-level chips for non-K12 tenants

### Templates
- 60+ K12 system presets (animated, themed, MS pack 8 + portrait, holiday lobby, etc.)
- 7 fitness/GYM presets (cardio-hub, music-player, ad-banner, class-schedule, training-video, workout-timer, motivational-quote)
- Restaurant/QSR presets (just landed by parallel agent — verify in `apps/api/src/templates/restaurant-presets.ts`)
- Retail presets (just landed by parallel agent — verify in `apps/api/src/templates/retail-presets.ts`)
- Bar presets (just landed by parallel agent — verify in `apps/api/src/templates/bar-presets.ts`)
- ensureSystemPresets() seeds + vertical-tag migrates rows on every API boot

### Widget framework
- `WidgetErrorBoundary` wraps every WidgetPreview — single bad widget no longer tanks the whole route
- Drag-threshold pattern (4px) on every widget type — click-to-edit no longer hijacks drag
- Capture-phase pointer cleanup — chalkboard / EditableText pointerup.stopPropagation() no longer leaves drag listeners hanging
- Shared `formatTime12 / parseTimeToMinutes / to24Hour` in `lib/format-time.ts` — every bell schedule + fitness class schedule now displays 12-hour regardless of stored format
- BellSchedule editor uses native `<input type="time">` (AM/PM picker + manual typing both work)
- BuilderZone CSS injection scoped to `[data-widget-content]` — font-size bumps no longer scale the chrome label badge
- VariantPicker click always ADDS — no more accidental swap when clicking a same-category tile
- Grid placement for new zones (no more cascading-stack overlap)
- Auto-jump to Properties on every selection change

### Streaming framework (Sprint 8c)
- Provider catalog in `packages/api-types/src/streaming.ts` — 14 providers across 6 tiers
- Public Broadcasters preset (NHK / France 24 / DW / Al Jazeera / Bloomberg / Sky News / CBS — venue-friendly, free, zero auth)
- StreamingWidget renderer — HLS (hls.js polyfill), DASH (lazy shaka), iframe (YouTube / Twitch / Vimeo with normalized embed URLs), RTMP/RTSP placeholder
- Ad overlay engine — lower-third / side-rail / full-bleed placements, weighted round-robin, per-channel allowAdOverlay flag
- Server-side: `/streaming/providers` + `/streaming/connections` + `/streaming/channels` REST endpoints under `/api/v1/streaming`
- Envelope-encrypted credential storage (per-row data key wrapped by DEVICE_SECRET_KEY)
- Tenant admin UI at `/[schoolId]/settings/streaming` — connect provider, pick channels, manage connections

### Billing
- License tier catalog in `packages/api-types/src/billing.ts` — 11 tiers (PILOT / CMS_CORE / SCHOOL_UNLIMITED / GYM_PRO / RESTAURANT_CHAIN / RETAIL_CHAIN / COMMAND / DISTRICT_OPS / RESPONDER_BRIDGE / COMP / CUSTOM)
- `/license/current` + `/license/tiers?vertical=X` API endpoints
- Tenant billing UI at `/[schoolId]/settings/billing` — current plan card + upgrade picker filtered to tenant's vertical
- Stripe Checkout endpoint scaffolding (`/api/v1/billing/checkout`) — 501 fallback to sales@ when STRIPE_SECRET_KEY is unset

### Existing platform
- Emergency system (4 panic types, signed pub/sub, AuditLog)
- Multi-tenant + tenant hierarchy (district→school)
- RBAC (5 roles)
- Brand kit (auto-scrape from URL, per-tenant + per-template)
- Template builder (zones, drag-drop, variants picker, brand kit)
- Player APK + manifest sync + emergency cache
- Submissions / approval workflow (Sprint 1.5)
- Floor plans + per-screen emergency overrides (Sprint 8b)

---

## ⚠️ What needs vendor-side setup before going live

Each item below is fully scaffolded in code but needs an account / API key
/ partner approval that has to happen outside the codebase.

### Stripe billing
- [ ] Create Stripe account, configure tax / business profile
- [ ] Create Products + Prices in Stripe (one per LICENSE_TIER + monthly/annual)
- [ ] Paste Price IDs into `LICENSE_TIERS` in `packages/api-types/src/billing.ts`
- [ ] Set `STRIPE_SECRET_KEY` in API env (Railway prod + dev)
- [ ] `pnpm --filter api add stripe` (currently lazy-imported; install when ready)
- [ ] Configure Stripe Customer Portal (cancel / upgrade / payment-method update)
- [ ] Implement `/billing/webhook` — sync subscription status → `License.status`. Webhook signing-secret verification required.
- [ ] Test with `stripe listen --forward-to https://api/api/v1/billing/webhook`

### Streaming provider OAuth (Vimeo + Soundtrack Your Brand)
Code path is `provider.auth === 'oauth2'` — currently shows "Contact sales" placeholder.
- [ ] Register OAuth app with Vimeo (developer.vimeo.com) — client ID / secret
- [ ] Register OAuth app with Soundtrack (developer.soundtrackyourbrand.com)
- [ ] Build callback endpoint `/streaming/oauth/:provider/callback`
- [ ] Token refresh job (cron) — exchange refresh_token → access_token before expiry

### Streaming partner programs (Atmosphere / DIRECTV / DISH / Mood Media / iHeart)
These providers are partner-only (no self-serve API).
- [ ] Email Atmosphere TV partners@ — pitch as a digital-signage integration partner
- [ ] Same for DIRECTV STREAM for Business, DISH Business, Mood Media
- [ ] Once granted, build per-provider handler in `apps/api/src/streaming/providers/`

### Canva Connect
- [ ] Apply to Canva Connect partner program (canva.dev/docs/connect)
- [ ] Register OAuth app
- [ ] Build the import endpoint that calls Canva's `/v1/designs` API
- [ ] Build the per-design renderer (PDF → PNG via the Sprint 10 pipeline)

### Social media integrations (Instagram / Facebook / X / TikTok)
- [ ] Register Meta developer app (Instagram + Facebook)
- [ ] Register Twitter/X dev account
- [ ] Register TikTok for Developers app
- [ ] Build OAuth flows + post-fetch endpoints
- [ ] Add per-platform feed widgets (currently `SOCIAL_FEED` is a placeholder)

### POS integrations (Square / Toast / Clover / Stripe Terminal)
- [ ] Register Square developer app — sandbox + production
- [ ] Same for Toast (commercial-grade approval needed) and Clover
- [ ] Build webhook ingestion for menu/price changes
- [ ] Add menu-board sync that re-renders RESTAURANT presets when POS data changes

### Production deploy checklist
- [ ] Run Prisma migration for the new `stream_provider_connections` / `stream_channels` / `stream_ad_slots` tables
- [ ] Set `STRIPE_SECRET_KEY` (when ready)
- [ ] Set `STRIPE_WEBHOOK_SECRET` (when ready)
- [ ] Update Railway env: `DEVICE_SECRET_KEY` must be 64 hex chars (used by streaming creds-cipher)
- [ ] Verify `ALLOWED_ORIGINS` includes the Vercel prod URL
- [ ] Smoke-test `/api/v1/streaming/providers` returns the catalog
- [ ] Smoke-test `/api/v1/license/tiers?vertical=GYM` returns recommended GYM_PRO

---

## 🚧 Known gaps / future sprints

- DASH playback needs `pnpm --filter web add dashjs` to actually play DASH streams (lazy-loaded; widget shows fallback message until installed)
- StreamAdSlot scheduling UI (scheduler / cadence editor) not yet built — only the renderer is. Operators can define slots via API but there's no admin form yet
- Webhook-based Stripe subscription sync not implemented — License.status must be updated manually until webhook handler ships
- Per-provider channel discovery (auto-import from a connected provider's API) only implemented for `public-broadcasters`; other providers require manual URL entry
- Canva / Square / social OAuth flows scaffolded as placeholders; no actual token exchange yet

---

## 🎯 Next-up sprint candidates

In priority order if Greg wants to keep shipping:

1. **Stripe webhook + License sync** — closes the billing loop so paid customers automatically get their tier upgrade
2. **YouTube OAuth + channel discovery** — lets gym/bar operators sign in once and pick from their YouTube subscriptions
3. **Twitch channel autodetect** — same UX, easier (no OAuth needed for public embeds)
4. **StreamAdSlot scheduler UI** — daypart picker + asset → slot binding
5. **Canva Connect MVP** — partner application + import flow
6. **Square POS sync** — restaurant menu boards auto-update from Square Catalog

Each is independently shippable; recommend tackling in order so revenue infrastructure (Stripe) lands before the polish features.

---

*Last refreshed: 2026-05-03 by autonomous build session.*
