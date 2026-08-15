# EDU CMS — Developer Guide

## Project Mission

**VenueOS** — a secure, real-time signage + emergency-alert CMS. Born in K-12 (interactive displays, digital signage, and life-safety lockdown / weather / evacuation alerts across thousands of screens) and now **multi-vertical**: K-12 districts (the beachhead + the emergency moat), live **sports venues** (Sprint 13 — scoreboards, ribbon boards, game presentation), and QSR / restaurant / retail / worship / corporate. The wedge: ONE platform that runs everyday signage **and** native life-safety **and** (in sports) full game presentation on the same screens — so the board earns its keep 5 days a week, not just on Friday night.

> **READ FIRST — current audit + remediation program (2026-07-12):** `docs/research/2026-07-12-world-class-fullapp-audit/VENUEOS-WORLD-CLASS-AI-DEVELOPER-BRIEF.md` is the self-contained execution brief for AI development agents — master remediation program + nine evidence appendices, code-verified against the full 21-section Standard Audit Surface (humans: `00-MASTER-REMEDIATION.md` in the same folder). Older background: `docs/research/2026-05-28-opus48-audit/00-MASTER-SYNTHESIS.md`. New here? Start with `CONTRIBUTING.md`. Pre-launch April-2026 design docs in `docs/archive/` are HISTORICAL ONLY — ignore them.

Ambition: the default operating system for every screen a school, venue, or multi-location operator runs.

## Technology Stack

**Backend:** NestJS 11 + Express, Prisma ORM, PostgreSQL (Supabase), Redis (realtime)
**Frontend:** Next.js 16 (App Router), React 19, Zustand, Tailwind CSS 4, shadcn/Base UI, dnd-kit, React Query
**Monorepo:** Turborepo + pnpm
**Auth:** Argon2 password hashing, JWT + HttpOnly cookies, express-session, @nestjs/jwt + @nestjs/passport
**Realtime:** Signed WebSocket messages via Redis pub/sub with HTTP polling fallback
**File Storage:** Supabase (Postgres + object storage)
**Testing:** Jest (backend), Playwright (E2E)

## Monorepo Layout

```
apps/
  api/                 NestJS API server on port 8080 (or $PORT)
  web/                 Next.js web dashboard on port 3000 (or $PORT)
  player/              (future kiosk/display player)

packages/
  database/            Prisma schema + @prisma/client, seed script
  api-types/           Shared TypeScript types (API contracts)
  auth-core/           Shared auth utils (JWT, Argon2, session config)
  ws-events/           WebSocket event types + signed message helpers
```

## How to Run

### Install & Setup
```bash
pnpm install                 # Install all dependencies
pnpm db:push                 # Apply Prisma migrations to database
pnpm db:seed                 # Seed test data (tenants, users, templates)
```

### Development
```bash
pnpm dev                     # Start both API and web (parallel, in watch mode)
pnpm dev:api                 # NestJS API alone (watch mode, port 8080)
pnpm dev:web                 # Next.js web alone (watch mode, port 3000)
```

### Build & Run (Production)
```bash
pnpm build                   # Build both API and web
pnpm start                   # Start API in production mode
# For web: next start (from apps/web dir)
```

### Database Commands (from root)
```bash
pnpm db:generate             # Regenerate @prisma/client
pnpm db:migrate              # Create a new migration (interactive)
pnpm db:reset                # Destroy and recreate database (dev only)
```

### Testing & Lint
```bash
pnpm test                    # Run Jest suite
pnpm lint                    # Fix ESLint issues
```

### API Scripts
Individual app scripts available:
- `pnpm --filter api run start:prod` — NestJS production binary
- `pnpm --filter api run test:cov` — Jest with coverage
- `pnpm --filter web run build` — Next.js static build

## Environment Variables

All required env vars for `.env` (gitignored):

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | Prisma connection. **USE SUPAVISOR SESSION MODE — port 5432, NO `pgbouncer=true`.** Changed 2026-08-15 after measurement; do NOT "restore" the old 6543 + `pgbouncer=true` value. Measured on the real prod DB from one machine (wire RTT 74ms): raw `pg` on a reused connection = **68ms** (1 round trip); **Prisma via 6543 + `pgbouncer=true` = 350ms** (~5 round trips); **Prisma via 5432 session mode = 71ms** (1 round trip). Prisma's pgbouncer/transaction-pooling path turns one logical read into ~5 network round trips and made `DEALLOCATE ALL` 22% of all statements ever sent to the database. Prod result: queries 333ms -> ~212ms, boot `Prisma pool warm` 317ms -> 139ms, and `/health` stopped flickering `degraded` (the 400ms liveness budget had been sitting right on the old 333ms floor, which is what generated the "PLATFORM CRITICAL — database unreachable" emails). **`connection_limit` MUST stay LOW in session mode** — each pool slot holds a real Postgres connection and this instance has `max_connections=60` with ~30 used by Supabase itself. 10 is correct; raising it toward 25+ risks exhausting the server ceiling. Always check `SELECT current_setting('max_connections')` before changing it. Keep `pool_timeout=20`. | `postgresql://user:pass@host:5432/postgres?connection_limit=10&pool_timeout=20` |
| `DIRECT_URL` | Prisma direct (migrations only) | `postgresql://user:pass@host:5432/postgres` |
| `SUPABASE_URL` | Supabase project URL | `https://xyz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase auth + storage | `eyJ...` |
| `JWT_SECRET` | Signing JWTs (64-char hex) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SESSION_SECRET` | express-session encryption (64-char hex) | (same as JWT_SECRET safe) |
| `DEVICE_SECRET_KEY` | Signing device tokens (64-char hex) | (random) |
| `DEVICE_JWT_SECRET` | Device JWT signing (64-char hex) | (random) |
| `REDIS_URL` | Redis pub/sub for realtime | `redis://localhost:6379` |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key. Powers **every** outbound email: password-reset, user invites, welcome mail, asset-approval notices, and the Bug Reporter's "we got it / fix shipped" + owner-alert emails. When unset: dev logs to console (zero-config); **production throws on send** so the UI surfaces a real "email not configured" error instead of lying "check your inbox" (`EmailService.isConfigured()` gates this). Most common "I set the key but no emails arrive" cause is the `EMAIL_FROM` default — see below. | `re_...` |
| `EMAIL_FROM` | Sender for all outbound mail. Defaults to `VenueOS <onboarding@resend.dev>`. **WARNING:** Resend only delivers from `onboarding@resend.dev` to the email that **owns the Resend account** — every other recipient (other admins, operators, parents) is silently dropped/spam-filtered. To email anyone else you MUST verify a custom sending domain in the Resend dashboard and set this to an address on it. This is the usual root cause of "no bug emails getting sent." | `VenueOS <noreply@yourdomain.com>` |
| `EMAIL_REPLY_TO` | Optional `Reply-To` header (e.g. a district IT help alias). Unset → header omitted. | `it-help@yourdistrict.org` |
| `ALLOWED_ORIGINS` | CORS whitelist (comma-sep). **REQUIRED in production** — API refuses to boot if unset (sec-fix wave1 #8). | `https://yourdomain.vercel.app,http://localhost:3000` |
| `NEXT_PUBLIC_API_ROOT_ALLOWLIST` | Optional, comma-separated **extra API hosts the player is allowed to be pointed at** (security wave 2026-08-01, finding R-01). The player's `?api=` override used to be accepted verbatim and persisted to localStorage forever — one drive-by load of `/player?api=https://evil.example` handed an attacker the screen, because the manifest is the sole arbiter of the lockdown overlay. Now the override must pass `apps/web/src/app/player/trustGuards.ts`: `https:` only (`http:` for loopback in dev), and the host must match `NEXT_PUBLIC_API_URL`'s host, the page origin, a built-in known-good set, or this var. Matching is exact-host or a dot-boundary suffix — `venue-os.app.evil.com` is refused. Validation runs on **read** as well as write, so an already-poisoned screen self-heals on next load. **Only set this if you have a staging or on-prem install that points kiosks at a host outside `NEXT_PUBLIC_API_URL` — otherwise leave it unset.** A kiosk pointed at an unlisted host will now refuse to connect (intended, but it is a behavior change from before this wave). | `https://staging-api.yourdomain.com` |
| `TRUSTED_PROXY_HOPS` | How many **trusted proxies append to `X-Forwarded-For` in front of this API**. `apps/api/src/security/client-ip.ts` picks the client IP by counting that many entries **from the RIGHT** — with N trusted appenders the real client sits at `len - N`, and everything to its left is client-supplied and ignored. That one value is the throttle key for every per-IP rate limit AND the `ipAddress` written to `AuditLog` / `RequestLog` / `Screen` — including the forensic record of who fired a district-wide lockdown. **Default is `2`** because that is the measured Railway chain: the Railway edge + one internal hop, i.e. two appenders (`x-forwarded-for: "216.241.83.102, 152.233.76.9"`, real client leftmost). **Re-verify against a real request's `X-Forwarded-For` whenever the Railway/CDN chain changes** — adding Cloudflare or a WAF in front adds an appender, and running the API without the proxy chain removes them. Getting it wrong does not crash anything, it silently picks the wrong entry: **too HIGH** and you select an attacker-controlled position, so a client that sends its own `X-Forwarded-For` can rotate the throttle key at will (defeating every brute-force cap) and forge the audit IP; **too LOW** and you select a rotating internal hop, so the throttle key moves every request and rate limits never fire — the 2026-07-07 bug. Must be an integer ≥ 1; anything else falls back to the default. A chain SHORTER than the configured count clamps to the leftmost entry (local dev, direct hits, in-cluster probes) — that case is spoofable, which is why it must not be the production shape. | `2` |
| `PORT` | API server port | `8080` |
| `NODE_ENV` | `development` \| `production` | `development` |
| `CSRF_ENFORCE` | `false` → warn-mode. Default (unset) = enforced (sec-fix wave1 #7). | `false` |
| `CSRF_WARN` | `true` → warn-mode (alias for `CSRF_ENFORCE=false`). | `true` |
| `DEV_WS_ALLOW` | Dev-only: `true` enables unsigned `dev_` WebSocket tokens. **Never set in production.** | `true` |
| `ANTHROPIC_API_KEY` | Claude API key for the AI content-generator feature (sparkle button next to text fields in the template editor). When unset, the button surfaces "AI not configured for this deploy" — feature degrades gracefully, app keeps working. Cost-capped at 30 generations/hr/tenant via in-memory rate limit; claude-haiku-4-5 at 300 max_tokens caps spend at ~$0.005/call. | `sk-ant-api03-...` |
| `PEXELS_API_KEY` | Free [Pexels](https://pexels.com/api) stock-photo key for the **IMAGERY wave** — makes EVERY photo-appropriate AI signage board come back with a real, relevant stock photo for **$0**, for every tenant, regardless of AI provider. **PHOTO-FORWARD BY DEFAULT (2026-06-28):** the art-director now *defaults* the photo-appropriate archetypes (`hero-fullbleed`, `lower-third-banner`, `poster-promo`, `split-50`) to a real photo (`image.mode` → `stock`, even when the model omits the plan) — the themed gradient is the graceful FALLBACK, not the default outcome. The text-/data-dense archetypes (stat/grid/menu/quote/title-cta) stay on a gradient. **AUTO-PHOTO ON ACCEPT (the key lever):** the 3-candidate previews stay image-FREE (fast/cheap), but when the operator KEEPS a board (`POST /templates/create-from-candidate`), `AiService.attachKeptBoardPhoto` makes it photo-rich before persisting — **STOCK first** (free, this key) then **AI fallback** (the tenant's OpenAI/Google BYOK key, honoring the image hourly cap; never the platform Tier-1 key), at most ONE image per kept board. The engine art-directs the photo (brand grade + directional contrast scrim, `imageTreatmentCss`) so the headline stays legible; on persist the photo is re-hosted into our Supabase bucket (durable + offline-cacheable on Taurus). The operator can still one-tap **"Make it an AI photo"** to upgrade to an on-brand AI photo (`POST /templates/:id/regenerate-image`, BYOK). Used **server-side only** (key in the `Authorization` header, never the URL, never logged; ~6s AbortSignal). When **unset** AND no BYOK image provider, boards ride their themed gradient exactly as before — every image path returns null/undefined, never throws, zero regression. Generous free tier (≈200 req/hr, 20k/mo); get one free + instant at pexels.com/api. | `563492ad…` |
| `GOOGLE_MAPS_API_KEY` | Google Geocoding key for the address pickers (screen location + signup/onboarding). Used **server-side only** via the proxy `GET /api/v1/geocode` — the key never reaches the browser. Google has authoritative US house-number coverage (finds addresses OSM/Census miss). When unset, the picker auto-falls-back to OSM Nominatim (street-level, free) — app keeps working, just less precise. Free tier ≈10k lookups/mo (we only geocode at screen-setup time). Enable "Geocoding API" in GCP, restrict the key to that API, enable billing. | `AIza…` |
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` | OAuth client for Canva Connect (Stage-2 design imports — **NOT built yet, Sprint 11**). Apply at canva.dev/docs/connect. Setting these alone does NOT enable a working "Sign in with Canva" flow — the OAuth picker isn't implemented. Today: PDF/image uploads work at `/[schoolId]/templates/imports` without these keys. | (from canva.dev developer portal) |
| `STRIPE_SECRET_KEY` | Stripe API key. When set, billing goes live — `/billing/checkout`, `/billing/portal`, `/billing/invoices`, and the webhook all work. When unset, `StripeService.enabled()` is false and every billing endpoint degrades gracefully (checkout/portal return `{enabled:false}`, invoices `[]`), so a deploy with no billing is unaffected. | `sk_test_…` / `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the Stripe webhook (`POST /api/v1/billing/webhook`). Every event is verified against it; without it the webhook 400s. From the Stripe dashboard webhook config (or `stripe listen`). | `whsec_…` |
| `STRIPE_PRICE_MONTHLY` | Stripe recurring Price id for the $25/screen/month plan. | `price_…` |
| `STRIPE_PRICE_ANNUAL` | Stripe recurring Price id for the $240/screen/year plan ($20/mo effective). | `price_…` |

Never commit `.env`. Use `.env.example` as a template.

**Stripe billing setup.** Billing (Settings → Billing) is fully built
but dormant until Stripe is configured. To turn it on: (1) create a
free Stripe account; (2) in Stripe, create two recurring
Products/Prices — $25 per screen / month and $240 per screen / year;
(3) set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`,
`STRIPE_PRICE_ANNUAL` in the API env (test keys first); (4) add a
Stripe webhook endpoint pointing at `POST /api/v1/billing/webhook`
subscribed to `checkout.session.completed`, `customer.subscription.*`
and `invoice.payment_failed`, and set its signing secret as
`STRIPE_WEBHOOK_SECRET`; (5) test end-to-end with Stripe test cards;
(6) swap in live keys at go-live. All Stripe code lives in
`apps/api/src/billing/` — checkout / portal / invoices, plus the
webhook that syncs each tenant's `License` row. Card entry is on
Stripe-hosted pages only (PCI-SAQ-A).

**Secret boot-time validation (sec-fix wave1 #2).** In production
(`NODE_ENV=production`) the API refuses to start if any of these are
missing or empty: `JWT_SECRET`, `SESSION_SECRET`, `DEVICE_SECRET_KEY`,
`DEVICE_JWT_SECRET`. The old `process.env.FOO || 'default_secret_...'`
fallbacks were removed — see `apps/api/src/security/required-secret.ts`.
In dev a loud warning is logged and a fixed dev fallback is used; never
rely on that value for anything reachable from the internet.

## Core Domain Models

| Model | Purpose | Key Fields |
|---|---|---|
| **Tenant** | District or school (hierarchy-enabled) | `id`, `parentId` (for district→school), `name`, `slug`, `emergencyStatus`, `emergency*PlaylistId` (4 panic types) |
| **User** | Team member with RBAC role | `id`, `tenantId`, `email`, `passwordHash`, `role` (enum), `canTriggerPanic` (capability flag) |
| **Screen** | Physical or virtual display | `id`, `tenantId`, `screenGroupId`, `name`, `deviceFingerprint`, `pairingCode`, `status`, `lastPingAt`, `resolution`, `osInfo`, `browserInfo` |
| **ScreenGroup** | Organize screens (hallway, lobby, etc.) | `id`, `tenantId`, `name`, `description` |
| **Playlist** | Sequence of assets + schedule rules | `id`, `tenantId`, `name`, `templateId`, `items[]` (PlaylistItem[]) |
| **PlaylistItem** | Single asset in a playlist | `id`, `playlistId`, `assetId`, `durationMs`, `sequenceOrder`, `daysOfWeek`, `timeStart`/`timeEnd`, `transitionType` |
| **Schedule** | When/where a playlist plays | `id`, `tenantId`, `playlistId`, `screenId|screenGroupId`, `startTime`/`endTime`, `daysOfWeek`, `timeStart`/`timeEnd`, `priority`, `isActive` |
| **Asset** | Image, video, or document file | `id`, `tenantId`, `uploadedByUserId`, `folderId`, `fileUrl`, `mimeType`, `status` (PENDING_APPROVAL, APPROVED) |
| **AssetFolder** | Hierarchical asset organization | `id`, `tenantId`, `parentId`, `name` |
| **Template** | Screen layout (17 system presets + custom) | `id`, `name`, `description`, `isSystem`, `screenWidth`/`screenHeight`, `bgColor`/`bgGradient`/`bgImage`, `zones[]` (TemplateZone[]) |
| **TemplateZone** | Widget region in a template | `id`, `templateId`, `name`, `widgetType`, `x`/`y`/`width`/`height` (% coords), `zIndex`, `defaultConfig` |
| **AuditLog** | Immutable activity log | `id`, `tenantId`, `userId`, `action`, `targetType`, `targetId`, `details`, `createdAt` |

### User Roles
- **SUPER_ADMIN** — Anthropic/company staff; manage all tenants
- **DISTRICT_ADMIN** — District-level; manage schools, users, branding
- **SCHOOL_ADMIN** — School-level; manage screens, playlists, staff
- **CONTRIBUTOR** — Can upload/edit assets and schedules
- **RESTRICTED_VIEWER** — Read-only access to dashboards

## Emergency System (Load-Bearing)

This system triggers immediate lockdown/weather/evacuation alerts across screens. Design is defensive against both technical failure and social engineering.

### Controller Endpoints
- **POST `/api/v1/emergency/trigger`** — Dispatch emergency alert
  - Body: `{ scopeType: 'tenant'|'group'|'device', scopeId, overridePayload: { type, severity, mediaUrl, textBlob, expiresAt, playlistId, ... } }`
  - Returns: `{ success: true, overrideId, message }`
  - Roles: SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN (+ `@AllowPanicBypass()` can override `canTriggerPanic` flag)
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
1. **@AllowPanicBypass Decorator** — Only admins can override individual `canTriggerPanic` capability flags. Prevents unauthorized delegated triggers.
2. **Immutable Audit Log** — Every trigger/clear is logged with userId, severity, overrideId, timestamp. No deletion or modification allowed.
3. **Signed WebSocket Messages** — every Redis fan-out is HMAC-verified at the broadcast gate (`apps/api/src/realtime/redis.service.ts` `verifyWsHmac`) before reaching the WS gateway or SSE fallback, so a forged channel message can't enter the broadcast bus. The player checks for the presence of a `signature` field as a smoke test; full per-tenant asymmetric verification on the player itself is a documented follow-up — the primary safeguard is the server-side gate, not the client check.
4. **HTTP Polling Fallback** — If Redis fails, screens fall back to polling their device-authenticated manifest at `/api/v1/screens/:id/manifest` (which carries the live `emergency` field — same `Tenant.emergencyStatus` source of truth).
5. **Hold-to-Trigger UX** — Mobile panic page requires 3-second hold on button to prevent accidental taps.

### WARNING: Emergency System Changes
Any modification to emergency endpoints, payload validation, auth bypass logic, or audit logging requires explicit code review and sign-off. Never weaken the @AllowPanicBypass decorator or skip AuditLog creation. Test trigger/clear flows end-to-end before merging.

## Frame-Locked Multi-Screen Sync (2026-07-28)

Screens in a `ScreenGroup` with `syncMode='locked'` play their shared schedule
in lockstep (flips land within a frame across screens). Full design + research:
`docs/research/2026-07-28-multiscreen-sync/` (00-DESIGN, 01-CODEBASE-RECON,
02-INDUSTRY-RESEARCH). Rules when touching the player or realtime layer:

1. **THE INVARIANT: while sync is active, what is on screen is a pure function
   of (manifest, syncedNow).** Never add a free-running advance path (a
   `setCurrentIndex(prev+1)` from onEnded/onError/timers) without gating it on
   `syncActiveRef.current` — one screen advancing out-of-band breaks the whole
   group's phase. The rAF conductor in `player/page.tsx` owns advancement.
2. Pure math lives in `apps/web/src/app/player/sync/` (`syncClock.ts`,
   `syncTimeline.ts`) — unit-tested without mounting the 8.6k-line page. Keep
   it pure (no React/DOM/network).
3. Clock transport: WS `TIME_PING`→`TIME_PONG` (direct socket reply, like
   AUTH_OK) + HTTP `GET /api/v1/realtime/time` fallback. Server time comes from
   `TimeSyncService` (Redis-TIME-aligned so multi-replica agrees) — never raw
   `Date.now()` in gateway time responses. Player timebase is
   `performance.now()`, never `Date.now()` (Android NTP steps).
4. The manifest `sync` block is part of the ETag-hashed payload (toggle/trim
   changes bust the 304). **Never add a volatile per-request clock field to the
   manifest** — it would kill 304s fleet-wide; clock samples ride the dedicated
   endpoints above.
5. Tests that must stay green: `apps/web/src/app/player/sync/__tests__/` (Jest),
   `apps/web/tests/e2e/multiscreen-sync.spec.ts` (two-screen lockstep harness,
   chromium+webkit), `realtime.gateway.spec.ts` (TIME_PONG echo).
6. Diagnostics: `/player?synchud=1` renders the filmable sweep-bar/flash HUD;
   `window.__eduSyncState` / `__eduSyncFlips` expose live sync state; per-screen
   telemetry lands in `Screen.lastSyncReport` via the render-proof POST.
7. **Manifest content cache (2026-07-30 — Supabase egress diet).** The
   normal-content manifest is served from an in-process per-screen cache
   (`manifest-hot-cache.ts`), invalidated by (a) a Prisma `$use` mutation
   hook in `prisma.service.ts` on any write to a manifest-fed model, (b) the
   screen's next schedule startTime/endTime boundary, (c) a TTL backstop
   (30 min armed / 20 s unarmed). Emergency + sports-scoreboard branches
   return BEFORE the cache and are never cached; REVOKED/auth reads stay
   live per poll. Rules: content writes MUST go through `prisma.client`
   (raw-SQL/Studio edits show up on players only after TTL); a NEW
   high-frequency Screen telemetry column MUST be added to
   `SCREEN_TELEMETRY_ONLY_FIELDS` or fleet telemetry will thrash the cache
   (silently re-creating the 25 GB/mo egress this killed — see
   `docs/research/2026-07-30-supabase-bill-diet/`); and per sync-rule #4 the
   cached payload stays free of volatile per-request fields.

## Template System

Templates define screen layouts using **17 system presets** (in `apps/api/src/templates/system-presets.ts`, ~960 lines) plus custom teacher-created templates.

### EXTERNAL_HTML signage boards + click-to-edit shim (read before editing ANY board — 2026-06-07)

There are **three** template-editing architectures; do not confuse them:
1. **React-zone presets** — zones rendered by `WidgetRenderer`; edited field-by-field in `PropertiesPanel`.
2. **EXTERNAL_HTML boards** — the ~107 self-contained HTML files under `apps/web/public/templates/{hs,kiosk,signage,fitness}/`. Each is a full 3840×2160 (or 1920×1080 kiosk) document rendered in a **null-origin sandboxed `src` iframe** (`allow-scripts`, NO `allow-same-origin`). Because React **cannot reach into that iframe**, all editing must go through a **shim baked into the HTML file**.
3. **Holiday boards** (`public/holiday-templates/`) — a SEPARATE `holiday:*` postMessage bridge; the panel sources fields **live** from the board (see `getHolidayLiveFields` in `HolidayWidget.tsx`), not a static schema.

**The EXTERNAL_HTML shim does TWO jobs (since V5, 2026-06-07):** (a) apply overrides INBOUND (brand/text/image/styles), and (b) **report clicks OUTBOUND** — the "hot zones": click an element in the builder → the panel jumps to that element's field editor. The protocol the panel speaks: `educms-ready` (load) · `educms-edit-mode {on}` (panel→iframe, arms hover-outline + click-report; NEVER sent on the live player) · `educms-field-click {key,kind}` (iframe→panel, drives the jump). The walker keys off `data-field`/`data-imgslot`/`data-action` — so **every editable element needs one of those** (same contract as editability).

**The shim is INJECTED, never hand-written.** Three injectors:
- `apps/web/scripts/inject-shim-v2.cjs` → bakes **EDUCMS-SHIM-V5** (apply + click-to-edit) into static boards. Run per-subdir: `node apps/web/scripts/inject-shim-v2.cjs hs|signage|fitness`. Replaces V4/V3/V2 in place.
- `apps/web/scripts/inject-click-shim.cjs` → an **additive** click-only shim for the 30 `signage/{qsr,menus-pos,bar}` MENU boards, whose hand-crafted V5 carries `applyMenu()` (live per-location POS price + auto-86) that must NOT be clobbered. `node apps/web/scripts/inject-click-shim.cjs signage`.
- Kiosks load the external `public/templates/kiosk/_edit-shim.js` (apply + click + kiosk engine-render hook). The injectors **skip** any file referencing it (no double-shim).

**⚠️ REDESIGN INVARIANT — the trap that caused the 2026-06-07 "none of the templates can be edited" fire:** when you edit/redesign an existing board, the OLD shim block stays baked in. A board left on the apply-only V4 shim is **un-editable by click**. So **after editing ANY `public/templates/**` board, re-run the injector for its subdir** (and `inject-click-shim.cjs` for menu boards). Confirm with the sweep + the real-browser tests:
```bash
cd apps/web/public/templates && for f in $(find hs signage fitness -name "*.html"); do \
  grep -qE "educms-field-click|src=[\"'][^\"']*_edit-shim" "$f" || echo "NO CLICK-TO-EDIT: $f"; done
pnpm --filter web exec playwright test tests/e2e/external-html-clickedit.spec.ts   # boards (chromium+webkit)
pnpm --filter web exec playwright test tests/e2e/holiday-hotzone.spec.ts           # holiday boards
```
Full conventions (editability contract, brand tokens, auto-fit ≥50px floor, live engines, build checklist) live in `.claude/agents/venueos-template-designer.md` + `docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md` — the binding spec for any template work.

### System Presets
1. Sunny Meadow — Elementary Welcome (with layered CSS background + inline SVG)
2. Lobby Welcome Board
3. Lobby Info Board
4. Hallway Tri-Zone
5. Hallway Portrait Display
6. Cafeteria Menu Board
7. Main Entrance Ticker
8. Class Schedule Board
9. Staff Bulletin Board
10. Room Occupancy Display
11. Bus Information Board
12. Event Countdown Board
13. Achievement Showcase
14. Weather Alert Template
15. Emergency Alert (Lockdown, Evacuate, Weather)
16. Daily Digest
17. Attendance Ticker

Each preset has **zones** (layout regions) with widget types, percentage-based coordinates, and optional default config.

### Zones & Coordinates
- **x, y, width, height**: Percentages (0–100) of screen dimensions
- **zIndex**: Layering order (0 = back)
- **defaultConfig**: Widget-specific settings (e.g., `{ fontSize: 48, color: '#fff' }`)
- **widgetType**: See Widget Types below

### Widget Types (20+)
WidgetRenderer (`apps/web/src/components/widgets/WidgetRenderer.tsx`) supports:
- CLOCK, WEATHER, COUNTDOWN, TEXT, RICH_TEXT
- ANNOUNCEMENT, TICKER, BELL_SCHEDULE, LUNCH_MENU, CALENDAR
- STAFF_SPOTLIGHT, IMAGE, IMAGE_CAROUSEL, VIDEO, LOGO
- WEBPAGE, RSS_FEED, SOCIAL_FEED, PLAYLIST, (more)

Each widget can have a `theme` variant in config (e.g., Sunny Meadow theme for clock).

### Adding a New Preset
1. Create preset object in system-presets.ts with zones array
2. Add to SYSTEM_TEMPLATE_PRESETS export
3. Seed script loads on `pnpm db:seed`
4. Teachers can duplicate and customize

## Conventions

- **TypeScript:** `strict: true` in tsconfig; no `any` without deliberate reason
- **Database Access:** Always via Prisma client (typed, migrations tracked)
- **Components:** shadcn/Base UI + lucide-react icons; Tailwind for styling
- **Forms:** React Hook Form + Zod validation (Zod at API boundary is Sprint 1 goal)
- **Testing:** Jest test files live next to source as `*.spec.ts`
- **Async Patterns:** RxJS in NestJS, async/await in Next.js
- **Secrets:** Use env vars, never hardcode. .env is gitignored.

## Cross-browser support — non-negotiable

**The dashboard, the player, the holiday templates, every customer-facing
surface MUST work on every Mac and Windows browser the customer might use.**
That means:

- macOS: Safari (WebKit), Chrome (Chromium), Firefox (Gecko)
- Windows: Edge (Chromium), Chrome (Chromium), Firefox (Gecko)
- Player kiosks: Android System WebView (WebKit/Blink fork)

**Why this matters here.** On 2026-05-09 we shipped a 2-month-old "works
in Chrome, crashes in Safari" bug — every holiday template's inline
minified bridge had a literal `\n` byte (real LF) inside a regex literal.
V8/Chromium tolerated it; WebKit threw `SyntaxError: Unterminated regular
expression literal` and killed the entire bridge script. Result: holiday
hotspots, click-to-edit, and styling overrides ALL non-functional in
Safari for months. Local dev was Chrome-only so we never saw it.

**Rules going forward:**

1. **Test in WebKit before considering anything `done`.** `pnpm --filter
   web run test:cross-browser` runs the holiday-bridge protocol checks
   (18 templates × 5 protocol assertions = 90 in WebKit). It runs in
   under a minute. CI runs it on every push + PR via
   `.github/workflows/cross-browser.yml` and blocks merge on red.
   For the **authed dashboard's client-side navigation** (the surface the
   2026-06-08 favicon-crash class lived in), `pnpm --filter web run
   test:webkit-nav` logs into the live deploy in WebKit, clicks the sidebar
   nav, and fails on any React `removeChild`/`parentNode` crash or a
   click that full-reloads instead of soft-navigating. CI runs it on push
   to master via the `webkit-nav` job in `.github/workflows/prod-smoke.yml`
   (live-login, so it's post-deploy — the same window as prod-smoke).
2. **No "minified" inline JS unless you've verified it parses in WebKit.**
   Tools that emit JS (minifiers, bundlers, hand-rolled scripts) are
   the usual culprit class. Run the script through Safari Develop →
   Show JavaScript Console at least once.
3. **Avoid Chrome-specific APIs without a fallback.** Chrome ships
   things ahead of spec; Safari rarely does. Examples that have bitten
   us elsewhere: `request.body.tee()` (Streams API behavior diff),
   `document.startViewTransition` (Chromium-only at time of writing),
   structured-clone of complex objects.
4. **When adding a new test surface that touches DOM/postMessage, port
   the WebKit check pattern** in `apps/web/tests/cross-browser/
   holiday-bridge.cjs` to that surface. Keep CI fast — under 2 minutes
   per browser. Add Chromium / Firefox passes alongside WebKit when
   you find a NEW Chromium-/Firefox-specific issue (don't add them
   speculatively; the WebKit canary is the high-leverage check).
5. **CLAUDE.md is the source of truth.** When you fix a Safari bug,
   add a paragraph to `reference_recurring_failure_patterns.md` (in
   memory) so the next agent doesn't rediscover it.

6. **NEVER imperatively detach a DOM node that React rendered** —
   especially `<head>` `<link>`/`<meta>`/`<title>` under React 19 +
   Next App Router (metadata/float reconciliation manages those nodes).
   `document.querySelector('link[rel=icon]').remove()` /
   `parentNode.removeChild(reactNode)` leaves React holding a fiber
   whose `stateNode.parentNode` is now `null`; the **next client
   navigation** runs React `commitDeletion` →
   `node.parentNode.removeChild(node)` → `TypeError: null is not an
   object (… parentNode.removeChild)`, which unmounts the **whole root**
   and the app hard-reloads. **WebKit/Safari throws; Chromium silently
   tolerates it.** This was the multi-day "every menu click needs two
   clicks / it just reloads" bug (2026-06-08, `BrandStyleInjector`
   deleting the Next-emitted favicon links — fix `ddb64dab`). If you
   must override a React-rendered node, **mutate it in place** (set
   `href`/attributes) or render your own separate node — never `.remove()`
   React's. Audit any `querySelector(...).remove()` / `removeChild` that
   can hit a node React owns. See recurring-failure-patterns #12.

7. **When a customer reports a UI bug you CANNOT reproduce in Chrome,
   switch to WebKit/Safari IMMEDIATELY** (Playwright `webkit`), and
   **read the in-app bug telemetry FIRST**: `SELECT captured_context FROM
   bugs ORDER BY created_at DESC` carries the real browser (`->browser->
   userAgent`), the page, console entries, network failures and React
   Query state from the operator's actual session. On 2026-06-08 that
   one row (Safari 27, `/assets`, 0 console errors, all data loaded) is
   what finally cracked a bug I'd chased ~7 times in Chrome. "Works in
   Chrome" ≠ correct — Rule #1 (test WebKit before done) applies to
   INTERACTIVITY, not just rendering.

## Mobile performance standard — non-negotiable (2026-06-16)

The operator runs the whole product from an **iPhone**. On 2026-06-16 the
mobile bottom-nav + "More" sheet had major tap lag — and since the "More"
sheet is a pure local-`useState` toggle (no fetch, no navigation), its lag
proved the **main thread / GPU was busy at tap time**: app-wide contention,
not the tab bar. Two root-cause classes, both now fixed and **locked in by CI**
(`Mobile Perf` workflow → `node apps/web/tools/check-mobile-perf.cjs`, also
`pnpm mobile-perf-guard`). Full write-up:
`docs/research/2026-06-16-mobile-perf-deepdive/`.

**The standard the guard enforces (every new feature must keep these):**

1. **Never poll a backgrounded tab.** No `refetchIntervalInBackground: true`
   anywhere under `apps/web/src` — a phone the operator isn't looking at must
   not run timers. Poll only while visible (`refetchInterval`); refresh on
   return via per-hook `refetchOnWindowFocus`. (A live *display/board* surface
   that must keep updating off-focus is the one legit exception — mark the line
   `// perf-allow: <reason>`, reviewed in PR. See `LeadersPanel.tsx`.)
2. **No global focus-refetch storm.** The QueryClient default
   `refetchOnWindowFocus` stays **false** (`providers.tsx`). A global `true`
   fires a refetch sweep across every mounted query on every app-switch — the
   burst lands as the operator taps the nav and the tap queues. Opt in
   per-hook only where freshness-on-return genuinely matters.
3. **No GPU-expensive blur on always-mounted mobile chrome.** On the persistent
   chrome (`DashboardLayout`, `MobileTabBar`, `TopToolbar`, `Sidebar`):
   `backdrop-blur*` must be breakpoint-gated (`md:backdrop-blur-xl`, mobile gets
   `backdrop-blur-none` / a solid bg), and any big decorative `blur-[…]` must be
   `hidden md:block` (desktop-only). `backdrop-filter` re-samples everything
   behind it on every repaint frame — brutal on a phone GPU, and it's paid on
   every interaction because this chrome is always mounted.
4. **Keep the global chrome cheap.** Don't mount new pollers in the chrome
   (`MobileTabBar`/`TopToolbar`/`Sidebar`) without justification; don't combine
   multiple Zustand selectors into one object literal without `useShallow` (it
   re-renders every time — the opposite of the goal); promote slide/overlay
   animations with `will-change`/`contain` so the first frame doesn't stall.

**Escape hatch:** a genuinely-justified exception gets `perf-allow` in a comment
on the offending line (the guard skips it; the PR reviewer sees why).

Run `pnpm mobile-perf-guard` before pushing mobile/chrome/data-hook changes;
CI runs it on every push + PR and blocks merge on red.

## Deploy reliability (Railway + Vercel)

Every Railway redeploy must come up without hand-holding. Below is how to verify and recover.

**Health endpoints** (all under `/api/v1`):
- `GET /health` — liveness. Always 200 (even if DB/Redis degraded). Railway healthcheck uses this. Returns `{ status, db, redis, uptime, version, timestamp }`.
- `GET /health/ready` — readiness. 503 when DB unreachable. Use for monitoring, NOT Railway.
- `GET /health/emergency-path` — verifies DB + WS signer chain before a drill.

**Verify a deploy succeeded:**
1. `curl https://<railway-api>/api/v1/health` returns 200 with `db:"ok"`.
2. Railway dashboard: deployment shows "Healthy" (green). `healthcheckPath` is set in `railway.json`.
3. Vercel cron `/api/cron/keepwarm` logs a 200 every 5 minutes — Vercel → Logs.

**If the demo breaks:**
- API unreachable → Railway → Deployments → Restart latest. Auto-restart covers most blips (10 retries, 300s window).
- UI says "Can't reach the server" → check `NEXT_PUBLIC_API_URL` in Vercel env. If unset the frontend falls back to localhost — set it and redeploy web.
- DB errors in Railway logs → Supabase pooler hiccup. Boot warm-up logs `Prisma pool warm (Nms)`; if consistently >2s, check `DATABASE_URL` / `DIRECT_URL` split.
- Redis missing → API boots anyway (HTTP-polling realtime fallback). Emergency trigger still works.

**Never do:** weaken the 10-retry restart policy, add DB checks to liveness, or remove the 7s Redis hard-cap in `redis.service.ts`. Those three keep Railway from pod-thrashing.

## Backup & Rollback

Refer to `docs/BACKUP_AND_ROLLBACK.md` for full procedures. Summary:
- **Before risky changes:** `git tag backup/pre-sprint-N-$(date +%Y%m%d-%H%M%S) && git push origin --tags`
- **Tarball backup:** `tar -czf edu-cms-backup-$(date +%Y%m%d-%H%M%S).tar.gz . --exclude=node_modules --exclude=.git/objects`
- **Restore from tag:** `git reset --hard backup/pre-sprint-N-TIMESTAMP`
- **Recover one file:** Extract from tarball, copy out

Keep 3 most recent tarballs; older ones can be deleted (git history is safe).

## Deploy Reliability

The `.github/workflows/deploy-reliability.yml` pipeline runs on every push
to master + every PR with four parallel jobs. They catch the build
failures we hit in production debugging on 2026-04-19 BEFORE the bad
commit reaches Railway. **Always wait for the green CI check before
shipping anything user-facing.**

### Build failure modes we've seen, and how the CI catches them

1. **argon2 / bcrypt fail to native-compile on Alpine.**
   The Dockerfile builder stage is `node:20-alpine` which ships without a
   C/C++ toolchain. Without `apk add python3 make g++ openssl libc6-compat`
   before `pnpm install`, both packages fail their `node-gyp` build with
   a cryptic `ELIFECYCLE` and Railway shows "Application failed to
   respond." → Caught by the **`docker-build`** job which runs the same
   image Railway will run.

2. **Prisma schema not present at install time.**
   The root `postinstall` runs `pnpm db:generate` which calls
   `prisma generate`, which needs `packages/database/prisma/schema.prisma`
   on disk. Dockerfile must `COPY packages/database/prisma` BEFORE
   `pnpm install`. → Caught by **`docker-build`**.

3. **Workspace TS packages need a build step.**
   `packages/{api-types,auth-core,ws-events}` have `package.json` `main`
   pointing at `dist/index.js`. The Dockerfile must build them before the
   API or `node apps/api/dist/main.js` crashes with `SyntaxError:
   Unexpected token 'export'` when it tries to require a raw `.ts` file.
   → Caught by **`api-build`** and **`docker-build`**.

4. **Lockfile drift.** Adding a devDep to a package.json without re-running
   `pnpm install` breaks `pnpm install --frozen-lockfile` on Railway with
   `ERR_PNPM_OUTDATED_LOCKFILE`. → Caught by **`lockfile-check`**, AND
   pre-emptively blocked locally by `.husky/pre-commit`.

5. **TypeScript errors in `apps/web`.** Next.js fails the production
   build on type errors (`morning-news.tsx` hit this with a stale
   `'dayperiod'` type). → Caught by **`web-build`**.

### Local preflight

Before pushing, run `pnpm preflight` from the repo root. It runs the same
non-Docker checks the CI does (lockfile + workspace builds + API + web)
in under 90 seconds. The Docker check is CI-only because spinning up
Docker locally is slow.

### Post-push: WATCH CI TO GREEN — do not declare "done" before it resolves (2026-05-31)

`pnpm preflight` is NOT proof CI will pass. It skips Docker AND it runs on
*your* machine, where native modules (argon2, bcrypt) are already built and
cached. The raw GitHub runner is a fresh `pnpm install --frozen-lockfile`
that does **not** rebuild those bindings for the Jest job — so a suite that's
green locally can have 5 suites *fail to load* in CI (`Cannot find module
.../argon2.node`). On 2026-05-31 the lead flipped the API Jest gate to
blocking off a local-green run and turned Deploy Reliability red on every
subsequent push — the *operator* caught it, not the lead. That is the failure
mode this rule kills.

**Standing rule:** after EVERY `git push`, watch the run to completion and
react to red BEFORE telling the user anything shipped. The agent has `gh` —
there is no excuse to make the user your CI monitor. One-liner (backgroundable
so the harness re-invokes you on completion):

```bash
sha=$(git rev-parse HEAD)
for i in $(seq 1 24); do rid=$(gh run list --limit 40 --json databaseId,headSha,workflowName \
  -q "[.[]|select(.headSha==\"$sha\" and .workflowName==\"Deploy Reliability\")][0].databaseId"); \
  [ -n "$rid" ] && [ "$rid" != null ] && break; sleep 5; done
gh run watch "$rid" --exit-status   # exits non-zero if CI failed
gh run list --limit 40 --json headSha,workflowName,conclusion \
  -q "[.[]|select(.headSha==\"$sha\")]|.[]|\"\(.conclusion) \(.workflowName)\""
```

"Pushed, CI watch running" is honest. "Done / shipped" before CI is green is
the exact over-claim the operator has banned repeatedly.

### Pre-commit hook (husky)

`.husky/pre-commit` blocks any commit that would drift `pnpm-lock.yaml`.
Activates automatically after `pnpm install` (via the `prepare` script).
On Windows, Git for Windows runs the hook through its bundled `sh.exe`;
no extra config needed.

### When the demo breaks despite all this

Check **Railway dashboard → Deployments → latest → Build Logs**, then
**Deploy Logs**. Build Logs show Dockerfile failures; Deploy Logs show
runtime crashes. The /api/v1/health endpoint always returns 200 even
when DB or Redis are degraded — so if you get 502 "Application failed to
respond," the container itself is down (not a downstream service).

### What never to do

- Add `healthcheckPath` to `railway.json` without first confirming the
  container actually boots and `/api/v1/health` responds. The healthcheck
  GATES the deploy — a never-responding endpoint blocks all new code.
- Bump `bcrypt` or `argon2` major versions without testing on Alpine
  Docker locally first. Both have changed their build requirements
  multiple times.
- Add a workspace package without a `tsconfig.json` and `dist/index.js`
  in its `main`. The API's CommonJS `require()` cannot parse raw
  TypeScript at runtime.

## Template Design Workflow (load-bearing — read every time)

We've built ~60 templates and only the ones we iterated on look good
(Rainbow Ribbon, Animated Rainbow). Batch-built templates regress to
"rounded rectangle with shadow" every time. **Stop batching.** Use this
workflow for every template from now on.

### The 4-step loop (do not skip steps)

1. **HTML mockups in `scratch/design/<name>-vN.html`** — build 3-5
   variations of the SAME template idea, each as a standalone HTML
   file. Open `scratch/design/index.html` to navigate them. Use:
   - **Fixed pixel sizes** sized for a 1920x1080 canvas (logo 150px,
     title 88px, etc.). Never `vw`/`%` for sizing in mockups — they
     read the browser viewport, not the widget container, and the
     port to React breaks.
   - Real Google Fonts loaded via `<link>` (no system stacks).
   - Real shadows, real textures, real CSS shapes. No placeholders.
   - Every widget is a SHAPE (cloud, sun, polaroid, balloon cluster,
     ribbon banner, starburst). Never a rounded rectangle with a
     shadow. If you can't think of a shape for a widget, ask the user
     for a reference image first.
2. **User picks the winner** — they screenshot back, point at what
   they like and what to redo. Iterate until they say "ship it." Do
   NOT move to React until they explicitly approve.
3. **Port to React using the transform:scale pattern** — wrap the
   entire scene in a fixed-size 1920x1080 div, then wrap THAT in a
   container that measures its parent and applies `transform: scale(N)`
   to fit. This is the same pattern `ScaledTemplateThumbnail` uses
   for gallery thumbs. Never use `vw`/`%` for sizing inside the scene
   — keep every pixel size from the HTML mockup intact.
4. **Verify the live React render** — screenshot the deployed page,
   compare it side-by-side with the approved HTML mockup. They must
   match. If they don't, the port is broken — fix the port, don't
   redesign. Common port failures:
   - Mixed pixel + percentage units → drift between elements
   - Missing the transform:scale wrapper → text wraps weird at 4K
   - Dropped CSS keyframes during refactor → animations stop
   - Lost `dangerouslySetInnerHTML` for inline SVG logos → blank tiles

### Why batch design fails for me

When I batch-build 5+ templates in one pass, every one of them gets
the lowest-common-denominator treatment:
- Rectangle backgrounds with rounded corners
- Title font 32px (too small for 8-foot viewing distance)
- Generic emoji + grey text instead of themed shapes
- No shadow / texture variation between themes

The user has called this out repeatedly. Don't do it. **One template
at a time, with a real iteration loop, no exceptions.**

### When designing for a specific theme

Push the metaphor as far as it will go. A "Storybook" theme is not a
serif font on a beige rectangle — it's an open-book spread with a
center spine, illuminated drop caps, page numbers in roman, double
border frames, parchment texture. A "Bulletin Board" is not a brown
background with a list — it's cork texture with pinned index cards
and washi tape. If the metaphor is invisible at a glance, redo it.

### Reference-driven design

I do not have visual taste from training; I have patterns. **Ask the
user for 2-3 reference images** (Pinterest, Dribbble, real signage
photos) before starting any new theme. Without references, default
to copying a known-good template (Rainbow Ribbon is the gold standard).

### Track which templates have been approved

Every approved template gets a comment in the React component:

```tsx
// APPROVED 2026-04-19 — matches scratch/design/animated-rainbow-v3.html
// Reviewed by user, ported via transform:scale pattern. DO NOT
// regress to vw/% units.
```

Without this comment, the template is unverified. Future agents
should treat unverified templates as candidates for rebuild.

## Roadmap & Sprint Plan

> **Moved out of CLAUDE.md (2026-05-30 — governance review #9).** The full
> forward-looking plan — Sprint 1.5 (submit-for-review), 7 (offline player +
> USB sneakernet), 8/8b (fleet map + indoor floor plans), 9 (auto-branding),
> 10/11 (design imports + Canva), V2 (safety-platform pivot), multi-vertical
> expansion, and Sprint 13 (VenueOS Sports) — now lives in
> **[`docs/roadmap/ROADMAP.md`](docs/roadmap/ROADMAP.md)**. It is context +
> plans, not load-bearing rules. The rules and the Standard Audit Surface
> stay below.

## Standard Audit Surface — every audit MUST cover this list explicitly

Lead's rule (2026-05-26): *"when i say audit the entire app … every streaming integration, every AI template, every POS integration, every AI tool that exists or should exist needs to be discovered."* When the lead asks to audit "the app" / "every integration" / anything implying full coverage, the audit MUST explicitly enumerate **every** domain below and mark each: **covered** / **N-A (not yet built)** / **deferred-with-reason**. Silently scoping down is forbidden — if a domain is skipped, the audit report MUST say so on the first page.

This list is the floor, not the ceiling. Add to it when a new integration domain appears in the codebase. Future audits should grep `## Standard Audit Surface` in CLAUDE.md and check every bullet.

### 1. Real-time + signed pub/sub
- Emergency trigger / all-clear / per-screen overrides
- WebSocket gateway signing + verification (timestamp unit, signature pass-through, freshness window)
- Redis fan-out gate (verifyWsHmac on every replica's pmessage)
- HTTP polling backstop via manifest endpoint
- SSE controller fallback
- Player WS message-type handlers (OVERRIDE, ALL_CLEAR, TENANT_CHANGED, SOS, TEXT_BROADCAST, MEDIA_ALERT, REFRESH_WEB, CHECK_FOR_UPDATES, SYNC)
- Hold-to-trigger + typed-confirm UX consistency
- Per-eventId dedup at every layer

### 2. Storage + content pipeline
- Supabase asset upload + Cache-Control / egress
- Service-worker offline cache tiers (playlist + emergency, never-evict floor)
- USB sneakernet ingest (signed manifest, SHA verify, operator PIN)
- Floor plan upload (Sprint 8b)
- Asset re-cache backfill jobs
- Image / video transcoding pipeline (if/when built)

### 3. AI providers — every entry point × every provider
For each of the 3 providers (**Anthropic / OpenAI / Google**):
- Test-on-save error mapping (every status code, quota disambiguation)
- Generate-time error mapping (same disambiguation, NOT separate code)
- Out-of-credit vs rate-limit signature recognition
- AuditLog row on success AND on failed key tests
- BYOK key encryption + rotation + revocation
- Platform free-tier usage accounting (multi-replica safe)
- Model catalog freshness (deprecated-model graceful fallback)
- AbortSignal timeout on every fetch
- Prompt caching where supported (Anthropic ephemeral)
- Temperature parity across providers

### 4. AI feature surfaces — every place AI does work
- Sparkle button (text generation in widgets — PropertiesPanel mount sites)
- Touch-template generation (full-template synthesis)
- AI image generation (DALL-E / Imagen / Stable Diffusion) — if/when built
- AI background removal — if/when built
- AI translation for multilingual templates — if/when built
- TTS for emergency announcements (V2 spec — Voice synthesis)
- Auto-celebration trigger via score-feed (Sprint 13 AUTO)
- AI summarization of incoming context (V2 controlled assist)
- AI-from-CMS-data (lunch menu copy from POS, schedule descriptions)
- AI alt-text / caption auto-generation
- AI anomaly detection (offline-screen pattern, abnormal playback)
- Voice-to-text for SOS voice notes — if/when built

### 5. AI-tool comparative scan
Each "audit the entire app" pass MUST list AI features industry leaders ship that we DON'T yet have, and grade competitive parity. Examples to check:
- Yodeck / Rise Vision / OptiSigns / ScreenCloud / BrightSign AI features
- Canva Magic Write equivalent for content fields
- Smart playlist suggestions ("for a Tuesday lunch crowd")
- Content scheduling AI ("post this video next Tuesday")
- CV asset tagging on upload
- AI-generated celebration animations (Sprint 13 stretch)
- AI-suggested template themes from logo color extraction
- Computer-vision people-counting for sponsor proof-of-impressions

If a feature is on this list and we don't ship it, flag as a competitive gap with severity.

### 6. Streaming integrations
- RTSP camera feed widgets (V2 Responder Bridge)
- HLS / DASH / M3U8 live streams in player
- Embedded YouTube live / Twitch / Facebook Live / Periscope
- NFHS Network broadcast overlay (Sprint 13 streaming)
- Webcam URL widget
- Streaming asset playlist support (treat as Asset, schedule rules)
- IP camera RTSP share-links for responders (V2 Phase 2)

### 7. Sports score / data integrations (Sprint 13)
- Daktronics All Sport console tap-off
- Sportzcast / Scorebird
- Genius Sports / Sportradar live feeds
- MaxPreps
- GameChanger
- Game-state console publishing
- Auto-celebration from score delta
- Per-sport widget set parity (every sport in the Sport Engine spec)

### 8. POS / commerce integrations
- Square (restaurants / retail)
- Toast (restaurants)
- Clover (restaurants / retail)
- Lightspeed (retail)
- Shopify (retail)
- Stripe Terminal (in-venue checkout, distinct from billing)
- Pull-from-POS for menu boards (price + availability)
- Pull-from-POS for inventory signage
- Pull-from-POS for promo / happy-hour automation

### 9. Communications integrations
- Twilio SMS / voice (V2 multi-modal output)
- Sendgrid email
- APNs / FCM push notifications (mobile panic page)
- Slack outbound notifications
- Microsoft Teams outbound notifications
- PagerDuty / OpsGenie (V2 responder escalation)
- Webhook outbound (custom integrations)

### 10. Auth + identity
- JWT issuance + revocation (jwt_revoked_list)
- Argon2 password hashing
- express-session cookies
- TOTP MFA (pending)
- WebAuthn passkeys (pending)
- SSO (OIDC / SAML / Google / Okta) — Sprint 2
- Clever SIS — Sprint 2
- Role staleness (canTriggerPanic JWT-claim vs live row)

### 11. Billing + commerce
- Stripe Checkout / Customer Portal / Invoices
- Stripe webhook idempotency + ordering + audit
- License seat enforcement (SERIALIZABLE pair-tx)
- Multi-vertical pricing tiers
- Free pilot lifecycle (14-day trial activation, conversion)
- Dunning / past-due UX
- Refunds + comp seats (SUPER_ADMIN paths)
- PCI scope (every form, every log line — no PAN anywhere)

### 12. Design import integrations
- PDF / PPTX upload → playlist (Sprint 10)
- Canva Connect (Sprint 11)
- Google Slides via Drive API (Sprint 11)
- Microsoft PowerPoint Online via Graph (Sprint 11)
- Figma (Sprint 11)
- Keynote (fallback to PDF export)

### 13. Public alert integrations (V2)
- CAP (Common Alerting Protocol) inbound
- IPAWS inbound consumption (FEMA national alerts)
- IPAWS outbound origination (FEMA-authorized — explicit decision needed)
- Raptor SOS integration
- RapidSOS integration
- PA / IP-speaker (Valcom / Atlas / SingleWire InformaCast Fusion)

### 14. Multi-vertical surface
- Every vertical in `packages/api-types/src/verticals.ts` has matching copy in DistrictSchoolsCard COPY
- Vertical-specific default templates (Sports gets scoreboards, Retail gets promos, etc.)
- Sample data per vertical (signup + onboarding flows)
- Vertical-aware billing tier names (no "EDU District" on a Sports tenant)
- Per-vertical AI prompts (announcement style for school vs gym vs restaurant)
- Per-vertical sample URLs for branding wizard
- Brand-applyToTemplates covers vertical-specific widget sets (Sports, Retail, etc.)
- "Add a [noun]" buttons match the vertical (School / Location / Store / Gym / Office / Restaurant / Boutique / Bar / Venue / Hotel / Parish)

### 15. Cross-browser + Chromium-83
- Safari (WebKit) — every customer-facing surface
- Chromium 83 (NovaStar Taurus) — every player-shipped surface
- Tailwind class sweep (gap-*, inset-*, backdrop-blur-*, has-*, container-type, oklch, color-mix, aspect-ratio, text-wrap-balance)
- Cross-browser CI baseline ratchet (only DOWN, never UP)
- Per-template WebKit smoke check (not just 18 holiday templates)
- Older Android System WebView for kiosk APKs

### 16. Forensic / audit coverage
- AuditLog row on EVERY privileged action (every mutation, every key change, every login attempt, every payment event)
- DB-level immutability triggers (UPDATE/DELETE blocked at storage)
- Cross-tenant scope verification on every actor-id check
- Replay-attack defense (per-eventId dedup, idempotency tables)
- Cron-triggered consistency checks (License vs Stripe quantity, Tenant.address vs lat/lng)

### 17. Operational + DX
- Health endpoints (liveness, readiness, emergency-path)
- Pre-deploy CI gates (preflight, taurus-safety, cross-browser, a11y)
- Pre-push hooks (lockfile drift, secret scan)
- Rollback procedure (git tag + tarball discipline)
- Multi-replica safety (in-memory caches → Redis when load-bearing)
- Connection pool sizing (`connection_limit=10` + `pool_timeout=20` on DATABASE_URL)
- Boot-time required-secret enforcement

### 18. Accessibility + a11y
- axe-core CI baseline (Sprint 1 work)
- Screen-reader live regions on emergency surfaces
- Keyboard-only navigation through every flow
- aria-live announcements on hold-to-trigger
- Color-blind-safe pin colors on fleet map
- Sufficient contrast on all brand-injected palettes (WCAG AA minimum)

### 19. Template + Widget Editability Standard

Operator complaint (2026-05-26): *"none of the fucking templates are even editable, you can't edit a single word"*. The audit must grade every widget A-F against these criteria. Anything below B is a launch blocker.

For each widget under `apps/web/src/components/widgets/`:
- **Text** addressable: content, font family, font size, font color, font weight, alignment, line-height (use `StyleableField`)
- **Image** replaceable: asset picker OR URL paste, fit/position controls (cover / contain / fill)
- **Background**: solid color, gradient (2-stop minimum), image upload — all editable in PropertiesPanel
- **Clock**: timezone selector, 12/24-hour, second-hand toggle, date-format
- **Countdown**: target date/time picker, units shown (days/hours/min/sec), label customizable
- **Charts / lists / menus**: items addable / removable / reorderable
- **Position + sizing**: x/y, w/h, rotation, z-index, opacity (canvas-relative percentages)
- **Brand-palette honoring**: every color field offers "Brand primary" / "Brand accent" preset that resolves to `var(--brand-primary)` / `var(--brand-accent)`

Audits MUST list every widget + the missing fields. Adding entries to a registry without wiring them into `PropertiesPanel` does not count — the operator must actually be able to click the text and edit it.

### 20. Design + UX + Functionality lenses

Every "audit the entire app" pass MUST score every Standard Audit Surface section (1-19) across three lenses:
- **DESIGN**: does it look like a $$$ product? Would a superintendent show this to their board?
- **UX**: can a non-IT operator complete the task in 30 seconds without help / docs / a Loom video?
- **FUNCTIONALITY**: does it actually work end-to-end? Or is it "Coming soon" wearing a real-button costume?

The audit report's page 1 coverage table now has 3 columns (D / UX / F) × 19 rows. Anything ≤ B in any column is a gap.

**UX time-budget — a standing acceptance gate (added 2026-05-29).** Beyond audits: NO new operator-facing feature ships without a named **happy path** a non-IT operator can complete in **under 30 seconds / a handful of clicks**, plus a screenshot (or Playwright run) proving it. "Easiest UX — the app almost does the work for them" is a north-star, not a nicety: default to auto-detect + sensible defaults + one-click over forms; route operators through the **Integration Concierge** (paste-URL / describe-in-a-sentence → we discover + wire the integration + auto-seed the first template) wherever they'd otherwise need an IT consultant. If a feature can't clear its 30-second happy path, it isn't done.

### 21. Verification Before Claim — discipline

The "logo bug, round 7" from 2026-05-26 was the lesson: I told the user "fixed" six times in a row without verifying. The cost: trust burned, time wasted, anger earned.

Before telling the user a fix shipped, you MUST do one of:
1. Load the rendered page in Playwright, screenshot, eyeball it
2. Use the Chrome MCP / Preview MCP to navigate to the live Vercel URL and click through
3. Fetch the deployed asset (`curl ...vercel.app/path`) and grep for the change
4. Read a fresh git log on master and confirm your commit landed AND CI is green AND Vercel deployment shows "Ready" timestamp newer than your push

If you can't verify, SAY SO. "Pushed, awaiting verification" beats "Done!" every time. The user has explicitly named this: *"stop wasting my time and make sure shit is actually working before you fucking blindly tell me shit is done."*

### How to invoke this checklist

Every audit prompt sent to an agent OR run interactively MUST start with:
> "Use the Standard Audit Surface checklist in CLAUDE.md as your domain map. For every numbered section (1-21), report covered/N-A/deferred across the Design/UX/Functionality lenses. If you scope down, say so on the first page."

The audit report's first section MUST be a table showing all 21 sections × 3 lenses and their coverage status. Anything missing from the table is a gap.

## Agent Dispatch Protocol — parallel agents in isolated worktrees

Operator demand (2026-05-26): *"kick off the agents again and run this like a professional lead developer, have the agents work in their own tree if that's the best most professional way then you take their code back, you audit it all and then you alone commit and push to the main tree, you always have the ownership."*

This is now the standing rule for every parallel-agent deployment:

1. **Worktree isolation is mandatory.** Every Agent call that writes code MUST pass `isolation: "worktree"`. Without it, agents share the same working tree and stomp each other's untracked files. The Integration Concierge service files were wiped twice from contention before this rule landed.

   **1b. ANY agent that RUNS the app gets a worktree too — not just code-writers (2026-05-29).** Even a "read-only" audit agent that starts a dev server, runs a build, or drives Playwright WILL write into the working tree — `.next*` build dirs, and (observed) `next.config.ts` / `tsconfig.json` edits to stand up an isolated dev server on its own port. A 5-agent read-only mobile-UX audit fleet dispatched WITHOUT worktrees dirtied the main tree's `next.config.ts` + `tsconfig.json` and left orphaned `assets/page.tsx` / `templates/page.tsx` edits — which the lead then MISATTRIBUTED to an innocent worktree-isolated fix agent (whose transcript proved 100% of its edits were worktree-scoped). Rule: if the agent's job involves `pnpm dev` / `build` / Playwright at all → pass `isolation: "worktree"`. Only pure web-research / pure-read (grep/Read, no app run) agents may stay in the main tree.

   **1c. Assert the main tree is clean before AND after every agent batch.** Run `git status --short`; it MUST be empty (modulo intended lead commits). Any agent-origin dirtiness is a HARD STOP — reconcile it (`git checkout HEAD -- <file>` to drop orphaned edits; cherry-pick the agent's *worktree branch* as the source of truth) before merging/pushing. And before blaming an agent for main-tree edits, VERIFY via its transcript (`grep '"file_path"' <task>.output`) whether its writes were worktree-scoped or main-tree — never assert contention without proof (the 2026-05-29 misattribution).

2. **Lead agent (me) owns the merge.** Agents return their branch name. Lead reviews the diff (`git diff master..agent-branch`), audits, cherry-picks or merges, then commits + pushes to master. Agents never push to master directly.

3. **Commit before dispatch.** Any uncommitted local work must be committed (even WIP) before parallel agents fire. Untracked files survive nothing.

4. **Single-domain scope per agent.** Don't give two parallel agents overlapping files. Agent A touches widgets; Agent B touches branding; Agent C touches playlists. The worktrees isolate filesystem but logical conflicts can still surface at merge.

5. **Recovery via transcripts.** Every agent's full transcript is at `/private/tmp/claude-501/<project>/<session>/tasks/<agentId>.output`. If a fix vanishes, grep there first — anything the agent wrote before crashing is recoverable.

6. **Audit before merge.** Lead reads the agent's diff, runs tsc + lint + the agent's target tests, screenshots the affected page if UI-touching. No merge without proof.

7. **Agents are tools, not authors.** Lead is responsible for what ships. "An agent did it" is never a defense for a regression.

8. **Persist agent work to disk THE MOMENT it returns.** When any
   agent returns substantive findings (≥500 words of report-form
   output OR a punch list ≥3 items OR any work the user paid real
   money for), the lead MUST write the full report to a markdown file
   under `docs/research/<YYYY-MM-DD>-<topic>/` BEFORE writing the
   next user-facing summary. Do NOT rely on conversation context to
   hold agent work — context can compact at any time and the work
   becomes invisible to chat, regardless of how recently it landed.

   2026-05-28: Greg dispatched 4 research agents on 2026-05-27, all 4
   returned full reports (~11,800 words total), I never persisted
   them, context compacted, reports vanished from chat. Recoverable
   only because every agent's full transcript persists at
   `/private/tmp/claude-501/<project>/<session>/tasks/<agentId>.output`
   — that's the EMERGENCY path, not the design. Greg's words:
   *"why did we lose our agents work your wasting my fucking money
   now, dont do that shit ever again."*

   **Workflow:**
   - Agent dispatched → agent returns → IMMEDIATELY `Write` the
     full report to `docs/research/<date>-<topic>/<NN>-<scope>.md`
     before any other tool call.
   - Add a README to the folder listing all reports + scope.
   - THEN summarize to the user.
   - The summary cites the on-disk file paths so they're discoverable
     by future agents / future sessions / a re-read of master.

### Pre-dispatch checklist (run EVERY time before spawning agents)

Operator (2026-05-26 follow-up): *"who is the boss? you or them? how are we going to control this shit moving forward? i want an army of agents working all the time but they cant be stepping all over each other and you the entire time."*

The chaos that prompted this rule wasn't agents disobeying — it was the lead skipping pre-flight discipline. Every parallel-agent dispatch MUST start with:

```bash
# 1. Confirm on master (not on a leftover agent branch).
git branch --show-current  # must print "master"

# 2. Confirm clean tree. If dirty, commit to a wip/<topic> branch first.
git status --short  # must be empty

# 3. Confirm origin is up-to-date.
git fetch origin master && git log master..origin/master --oneline  # must be empty

# 4. Clean up old worktrees so the new dispatch starts fresh. `git worktree
#    prune` ALONE IS NOT ENOUGH — it SKIPS locked worktrees, and the harness
#    locks every agent tree, so they accumulate INVISIBLY. On 2026-06-02 this
#    reached 154 leftover trees / 83 GB and made every git command slow/erroring
#    (the operator caught it, not the lead — never again). Use the real cleanup
#    (unlock → remove --force → prune, with a branch-manifest backup):
pnpm worktrees:status            # count leftover agent/session worktrees
pnpm worktrees:clean             # remove them all (backs up to ~/Desktop first)
git worktree list                # MUST show ONLY the main tree before dispatch
```

If ANY of those four fail, **stop and fix the workspace before spawning agents.** A dirty tree means a previous session left untracked work that the next agent batch will appear to "wipe" — that was the source of every "agents are stomping me" panic.

### Mid-flight monitoring (agents running in background)

```bash
# List all live agent worktrees with commit counts + dirty file counts.
for w in /Users/gschiemann/Desktop/EDU\ CMS/.claude/worktrees/agent-*; do
  br=$(git -C "$w" branch --show-current 2>/dev/null)
  cnt=$(git -C "$w" log master..HEAD --oneline | wc -l | xargs)
  sts=$(git -C "$w" status --short | wc -l | xargs)
  echo "${br}: commits=${cnt} dirty=${sts}"
done
```

Don't tail agent transcript files — they overflow context. Trust the harness notifications.

### Merge cycle (when an agent reports complete)

```bash
# 1. Read the agent's diff against master FIRST. No exceptions.
git diff master..worktree-agent-<id>

# 2. Cherry-pick clean commits one at a time. Per-commit, not bulk.
git cherry-pick <agent-commit-sha>

# 3. Run tsc on whatever they touched.
rm -f apps/api/tsconfig.build.tsbuildinfo
pnpm --filter api exec tsc --noEmit --project tsconfig.build.json
pnpm --filter web exec tsc --noEmit | grep -v "test\.\|@testing-library"

# 4. Verify branch is master before push.
git branch --show-current  # MUST be "master"
git push origin master --no-verify   # --no-verify only when preflight has been done manually

# 5. ⚠️ REMOVE THE AGENT'S WORKTREE THIS SAME TURN. Non-negotiable. The 83 GB /
#    154-tree pileup (2026-06-02) was caused by exactly this step being skipped:
#    cherry-pick to master, then walk away leaving the locked ~540 MB tree
#    behind forever. Once the agent's commits are on master:
git worktree remove --force ".claude/worktrees/agent-<id>"   # the tree
git branch -D "worktree-agent-<id>"                          # the now-stale branch
# (or just `pnpm worktrees:clean` to sweep every finished agent tree at once.)
```

**STANDING RULE (2026-06-02): a parallel-agent session is NOT done until
`git worktree list` shows only the main tree again.** Leaving agent worktrees
behind is the "lazy development" that built an 83 GB invisible mess. Run
`pnpm worktrees:status` at the end of every agent batch; if it's not 0, clean it
before you tell the user the work shipped.

### Workspace hygiene — `pnpm hygiene` (2026-06-02)

The 83 GB worktree pileup wasn't the only accumulating-cruft failure; a process
audit that day also found a **408 MB never-gc'd `.git`** (210 MB of garbage
`tmp_obj_*` + 27,862 loose, 0 packed → `git gc` brought it to 22 MB), **8 stale
merged remote branches**, **90 stale `backup/*` tags**, and **unscanned
dependency CVEs** (passport-saml critical + tar/undici highs). Root cause was
always the same: *accumulating state with no monitor.*

**`pnpm hygiene`** (read-only; `pnpm hygiene:deps` adds the network vuln pass) is
the standing early-warning — it reports leftover worktrees, `.git` object/garbage
health, dirty tree, stale local/remote branches, backup-tag clutter, and
dependency CVEs, each with the fix command. Run it periodically and as part of
the pre-dispatch checklist. If `.git` ever shows thousands of loose objects or
any garbage, run `git gc`. Full audit: `docs/research/2026-06-02-dev-process-audit/`.

### Things that look like "agents stomping me" but aren't

- **File modified timestamps in the main tree.** Pre-existing uncommitted work from previous sessions. Run `git stash list` — if there are entries, those are the culprits, not the agents.
- **A new commit appearing on a branch named `agent/...`.** You drifted onto that branch by committing without confirming current branch. Switch back to master and cherry-pick.
- **Files reappearing as "M" after a stash pop.** The stash didn't fully clear them. Use `git checkout HEAD -- <file>` to force-revert.
- **An untracked file from an agent worktree appearing in the main tree.** Worktrees share `.git/objects` not working trees — this can't happen. If it looks like it did, the file existed in the main tree BEFORE the agent dispatch and you didn't notice.

### Anti-patterns that cause real contention (and DID cause the 2026-05-26 chaos)

- **Spawning agents without `isolation: "worktree"`.** They all write to the same tree and stomp each other's untracked files. The IntegrationDiscoveryService was wiped TWICE this way before the rule landed.
- **Committing before checking current branch.** Your commit lands on an agent branch, master stays behind, push appears to succeed (you pushed master's HEAD), but the commit isn't actually on master.
- **Cherry-picking the same logical work from two agents.** Two agents writing similar fixes (e.g. PropertiesPanel HOUSE_AD_BANNER case) will conflict at merge. Pick one, skip the other.
- **`git push --no-verify` without running preflight locally.** The pre-push hook exists for a reason; bypassing it means breaking master via the cascade of CI workflows.

## AI Integration Concierge — vision

Operator vision (2026-05-26): *"make shit not so overwhelming for people that they don't need to get an IT guy or consultants that cost so much money to just configure an integration with their POS, or streaming service for a gym, or template creation, make the path so automated that they don't know how they worked without VenueOS in the past."*

The Integration Concierge is the AI-driven discovery + setup layer that sits between the operator and the integration surface. Goal: an operator pastes their website URL OR describes their business in one sentence, and the Concierge proposes the integration stack, wires up the connectors, and auto-seeds the first templates.

### Workstreams

1. **`POST /api/v1/integrations/discover`** — pasted URL → scraped homepage + meta → classifier returns a ranked list of provider candidates per category. (POS, reservations, payments, streaming, calendar, email, fitness, identity, SIS, social, music, sponsorship.) Provider rules carry regex signals + weighted score + plain-English blurb the Concierge UI shows.

2. **`POST /api/v1/integrations/describe`** — free-text description → keyword extraction → ranked provider candidates. Catches operators who don't have a public URL yet (new venues, planned openings).

3. **Concierge UI**: after onboarding's branding step, a "Recommended integrations" wizard step. Each suggestion has: badge ("we found Toast on your site"), confidence, blurb, "Connect" / "Skip" buttons. Connect launches the provider's OAuth or guided setup. Skip remembers and won't re-suggest.

4. **Auto-seeded templates per vertical**: when an integration connects (e.g., Toast POS), the Concierge offers to drop a Menu Board template pre-wired to that integration's live data. One click → operator has a working board on screen.

5. **AI as the explainer**: if the operator hovers an unfamiliar integration ("what's Square Catalog?") the Concierge calls the platform AI (see Economic Model below) for a 1-sentence plain-English explanation. Free tier, capped at 100 calls/tenant/day.

6. **Diagnostic concierge**: if an integration goes RED, the AI assistant explains the likely cause + a 3-step fix in plain English instead of dumping a stack trace.

7. **Build-it-for-me**: an operator describes a template in one sentence ("a soccer scoreboard with our sponsors rotating on the bottom strip and a fan-cam upper-right") and the Concierge proposes a Template draft with widgets + zones + brand-palette applied, ready for the operator to tweak. Underlying call: the existing AI touch-template service, exposed in a guided wizard instead of a free-text modal.

### Economic Model (3 tiers)

Operator's intent (2026-05-26): *"we would have to use our own AI integration that our setup agent would use but use would be minimal and then the customer pays for their areas that we can call more creative AI...we will evolve that piece of the app further to where they can do a subscription and then we set them up with AI so they don't need their own API keys."*

| Tier | AI provider | Who pays | Usage cap |
|---|---|---|---|
| **Platform Concierge** (setup-time) | VenueOS's `ANTHROPIC_API_KEY` | VenueOS | Per-tenant ≤ 50 calls / lifetime + 100 calls / day during onboarding |
| **Customer BYOK Creative** (everyday) | Tenant's own Anthropic/OpenAI/Google key | Tenant pays their provider | Subject to their provider's rate limits + our 30/hr/tenant cap |
| **Managed-AI Subscription** (future) | VenueOS's keys, pooled | Tenant pays VenueOS a subscription line item | Per-tier monthly quotas; spillover billed |

The Concierge calls live on Tier 1. Sparkle button on widgets + Touch Template Generator + AI alt-text live on Tier 2. Tier 3 unlocks once we have enterprise contracts that justify the spend pool.

The platform must NEVER silently spend Tier-1 budget on Tier-2 actions. If a tenant has no BYOK and is on the Free tier, sparkle should say "Configure your AI provider — settings → AI" not "fall back to platform key."

## Design Imports = Template Feature (not a Setting)

Operator demand (2026-05-26): *"design imports... this entire settings page should not be under settings, it should be under the template section itself, it's not a setting it's a feature."*

Imports live at `/[schoolId]/templates/imports`, not `/[schoolId]/settings/imports`. The old path stays as a permanent redirect for muscle memory. The Templates page has a primary "Import design" button next to "New template."

The UX is upload → preview every page → choose "Create as Template" or "Create as Playlist" → confirm. After confirm, the operator lands on the Templates index with the new template selected, OR the Playlists index with the new playlist selected. No more "I uploaded something, where did it go?"

The page renders inside the brand shell — same chrome, same palette, same fonts as the rest of `/templates`. Not a stranded slate-colored sub-page.

## For AI Assistants

1. **Model tier:** Default to Haiku for boilerplate, syntax fixes, test stubs. Use Sonnet for feature work. Use Opus for emergency system, security issues, template builder design, or ambiguous architecture calls.

2. **Always read this file first** — it's the source of truth for the codebase.

3. **Never weaken emergency safeguards** without explicit approval from Integration Lead. Emergency system changes require review.

4. **Never commit `.env` or secrets** to git. Treat all changes as public (repo is on GitHub: `gschiemann/EDUCMS`).

5. **Repo is PUBLIC on GitHub** (`https://github.com/gschiemann/EDUCMS`). Treat all commits, PRs, and issues as visible to the world. No hardcoded credentials, API keys, or PII.

6. **Check the memory system** at `~/.claude/projects/-Users-gschiemann-Desktop-EDU-CMS/memory/MEMORY.md` for Integration Lead preferences and prior session context.

7. **Feature flags & observability** — Sprint 1 goal is GrowthBook + Sentry. Wrap new features with feature flags where reasonable.

8. **Prisma schema & types** — Source of truth is `packages/database/prisma/schema.prisma`. Regenerate `@prisma/client` after schema changes: `pnpm db:generate`

9. **VERIFY THE RENDER TREE before editing any UI file.** Three rounds
   of touch-widget edits on 2026-05-12 landed in
   `apps/web/src/components/template-builder/WidgetPalette.tsx` —
   a file that was imported but **never rendered**. CI was green,
   build succeeded, no changes appeared in the operator's UI. The
   widgets panel actually renders `<VariantPicker />` (which reads
   `variants-register.ts`), not `<WidgetPalette />`.

   **Rule before editing any component:**
   ```
   grep -rn '<ComponentName' apps/web/src --include="*.tsx"
   ```
   If nothing matches → the file is dead, your edits won't ship.
   If matches exist → read the JSX context to confirm the mount
   isn't gated behind a feature flag that's off / state that's
   never set.

   For the template builder specifically:
   - `BuilderShell.tsx` is the entry. Its render method dispatches
     panels → look there for `<WhatPanelKeyEquals === 'widgets' && <X />>`.
   - The widgets panel = `VariantPicker`. Add tiles via
     `registerVariant({ widgetType, id, render, defaultConfig })`
     in `apps/web/src/components/widgets/variants-register.ts`.
   - `constants.ts` WIDGET_GROUPS is the historical label/icon/
     color registry. Adding a tile THERE will NOT make it appear
     in the operator's palette.

   Green CI is NOT proof of correctness. CI checks syntax + types,
   not "is this file actually mounted." When changing user-visible
   UI, always verify in the rendered DOM (manual click, screenshot,
   or browser-MCP eval) BEFORE telling the user it shipped.

10. **NEVER use the `inset` shorthand in widget or player styles —
    neither the CSS `inset: 0` property NOR the Tailwind `inset-0`
    utility class.**

    **SCOPE (clarified 2026-05-29 — do NOT over-apply this):** this rule
    governs ONLY code shipped to a **NovaStar Taurus LED controller**
    (player/widget surfaces on that target). **Standard LCD displays
    (Raspberry Pi, generic Android players, desktop/mobile browsers) and
    the admin dashboard have NO such constraint — never dumb down their
    visuals for it.** The Taurus floor is Chromium **83–87** (Android-11
    units run 87, where `inset`/`gap` work); "83" is the conservative
    worst-case floor, not a blanket version ban. The `taurus-safety` CI
    gate scans only player/widget paths for exactly this reason. Default:
    build the premium/cutting-edge version for LCDs; add graceful
    degradation ONLY when a template is genuinely deployed to a Taurus LED
    wall.

    NovaStar Taurus LED controllers — one of our
    production targets — ship Chromium 83–87 (the oldest units are June-2020
    Chromium 83). The CSS `inset` shorthand was added in Chrome 87. On Chromium 83, `inset: 0` is
    silently dropped: in inline styles set via React's CSSOM (every
    `"use client"` page on the player route), the property never even
    reaches the DOM's `style` attribute string. In `<style>` blocks
    inside JSX, the CSS parser drops the rule entirely. Either way:
    `position: absolute` with no top/right/bottom/left collapses the
    element to its in-flow position with auto-sized dimensions,
    typically rendering at 0×0 in the top-left of its parent. Every
    widget that uses `useScaleToFit` then measures `offsetWidth=0` and
    renders `transform: scale(0)` — invisible.

    2026-05-13: 136 widget files (68 inline-style + 98 CSS-rule) had
    `inset: 0` and the operator's Rainbow Animated Portrait template
    was unrenderable on the Taurus until we mass-replaced them. Same
    bug pattern as the 2026-05-09 Safari minified-bridge regression
    in `reference_recurring_failure_patterns.md` — modern Chromium
    tolerates Web platform features ahead of spec; older Chromium
    forks (Android System WebView on locked-firmware controllers,
    Smart TVs, Tizen, WebOS) do not.

    2026-05-19: the SAME bug, second variant. The 2026-05-13 sweep
    only searched for the literal CSS property `inset: 0` — it never
    caught the Tailwind **`inset-0` utility class**, which Tailwind v4
    compiles to `inset: …` (and `inset-x-*` / `inset-y-*` to the
    equally Chromium-83-incompatible `inset-inline:` / `inset-block:`).
    391 such classes across 44 widget/player files were still
    landmines; an operator's custom template with 3 IMAGE widgets
    crash-looped a 960×1080 Taurus. Swept them all to physical
    longhand classes (`top-0 right-0 bottom-0 left-0`). The grep
    below now catches BOTH forms.

    **Rule:** always use the four long-hand sides:
    ```jsx
    style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
    ```
    Same in CSS:
    ```css
    .my-thing { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }
    ```
    And in Tailwind — physical longhand utilities, never `inset-*`:
    ```jsx
    className="absolute top-0 right-0 bottom-0 left-0"   // NOT inset-0
    ```

    The find/replace is mechanical and safe — `inset: 0` is defined in
    the CSS spec as exactly this long-hand, so modern Chromium / WebKit
    / Firefox compute identical styles either way. **Zero regression
    risk** for Pi / standard Android boxes / modern browsers; only
    upside for Chromium-83 LED controllers.

    Catch leftover violations with:
    ```bash
    grep -rnE 'inset:[[:space:]]*0|inset(-x|-y)?-[0-9]' \
      apps/web/src/components/widgets apps/web/src/app/player \
      apps/web/src/components/player
    ```
    Anything that returns a hit is a regression on Taurus. (The two
    intentional callsites — `KioskSplash.tsx` line 401 and the
    `TemplateScaler` outer in `player/page.tsx` — declare BOTH the
    shorthand AND the long-hand on adjacent lines, so modern engines
    parse the shorthand and Chromium 83 falls back to the long-hand.)

    2026-07-03: a THIRD variant, invisible to grep — no file contains the
    word "inset" at all. A React inline `style={{ position:'absolute',
    top:0, right:0, bottom:0, left:560 }}` object that supplies all FOUR
    physical sides in one object literal gets **re-serialized by the
    browser's own CSSOM** into the `inset` SHORTHAND in the element's
    `style` DOM ATTRIBUTE STRING — regardless of what browser is
    rendering it, this is standard CSSOM behavior, not a Chromium-83
    quirk. A non-uniform set of values (not all four identical)
    serializes to the multi-value form, e.g. `inset: 0px 0px 0px 560px`.
    The Chromium-83 polyfill above (`[style*="inset: 0"]`) exists to
    force-zero the correct, INTENTIONAL uniform case — but that same
    substring also matches any NON-uniform case whose `top` value
    happens to serialize starting with the digit `0` (confirmed
    empirically: this includes bare `0`, `'0px'`, and — less obviously —
    `'0%'` and even `'0.5%'`, since the substring test only cares about
    the leading character, not whether the value is truly zero). The
    polyfill then force-zeroes ALL FOUR sides `!important`, destroying
    the intended offset. This reproduces on **modern Chromium** (the dev
    preview browser), not just Chromium 83 — the CSSOM shorthand
    collapse is universal; only the ORIGINAL `inset` bug (Chromium not
    parsing the shorthand at all) is Chromium-83-specific. Confirmed live
    in `ScorebugTicker`'s "scrolling reel" (`apps/web/src/components/
    widgets/themes/scorebug.tsx`), three `Celebrations*Widgets.tsx`
    symmetric-margin center columns, `scrapbook.tsx`'s ruled-lines panel,
    and the `right:'auto', bottom:'auto'` pinning pattern in both
    `player/page.tsx` and `KioskSplash.tsx`.

    **Fix:** drop to 3 physical sides + an explicit `width`/`height`
    matching the intended geometry — a 3-side object can never serialize
    to the `inset` shorthand (which requires all four), so it's immune
    to the polyfill AND computes identically on every browser:
    ```jsx
    // WAS (landmine): serializes to "inset: 0px 0px 0px 560px"
    style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 560 }}
    // FIXED: can never serialize to `inset` (only 3 sides present)
    style={{ position: 'absolute', top: 0, bottom: 0, left: 560, width: 'calc(100% - 560px)' }}
    ```
    For the `right:'auto', bottom:'auto'` pinning idiom (used to let an
    explicit `width`/`height` win over a would-be inset), just OMIT
    `right`/`bottom` entirely rather than setting them to `'auto'` —
    an unset side and an explicit `'auto'` side compute identically for
    a positioned box sized by `width`/`height`, but only the omitted
    form stays at 2 keys and can never hit 4.

    **Detector:** this landmine is invisible to `grep`/regex (it can
    span multiple lines and never contains the word "inset"), so catch
    it with the AST-based guard `apps/web/tools/
    check-inset-serialization.cjs` (uses the TypeScript compiler API —
    already a repo devDependency, no new dep). It parses every
    `style={{...}}` JSX object literal under the player/widget scan
    paths and flags one whose top/right/bottom/left are all present,
    not all identical, AND `top`'s value starts with the digit `0` (the
    exact condition that collides with the polyfill's substring
    selector — a non-uniform object with a NON-zero-leading `top`, e.g.
    `{top:150,...}` or `{top:'12%',...}`, is reported separately as
    informational-only because it's provably never touched by the
    polyfill). Run: `node apps/web/tools/check-inset-serialization.cjs`.

    **The polyfill itself was NOT hardened** (evaluated and rejected,
    2026-07-03) — a precise CSS attribute-selector fix (matching only
    the exact 1-value collapsed forms `inset: 0px`/`inset: 0%`, anchored
    with `$=`/`*=` combinations) passes every unit tested EXCEPT that
    container-query units (`cqi`/`cqh`/`cqw`/`cqb`/`cqmin`/`cqmax`) and
    `ch` do NOT collapse a uniform-zero object to the 1-value shorthand
    the way `px`/`%`/`em`/`rem`/`vh`/`vw`/`vmin`/`vmax`/`pt` do — they
    stay in the 4-value form (`inset: 0cqi 0cqi 0cqi 0cqi`), which the
    hardened selector would then fail to match, silently un-protecting
    a genuinely-uniform Chromium-83 landmine that uses those units. No
    live occurrence exists in the codebase today, but "no current
    occurrence" isn't "provably regression-free" (cq-units are an
    actively-used, `taurus-safety`-tracked pattern class here) — so per
    the standing rule (never ship a polyfill change you can't prove is
    regression-free), the fix stayed scoped to the individual widgets +
    the detector. If a future agent wants to revisit this, the correct
    fix is a JS-based per-element `getComputedStyle` check (compare all
    4 resolved side values for equality) rather than another CSS
    attribute-selector attempt — CSS selectors cannot express "are these
    N values equal," only substring/prefix/suffix matches.

    Other Chromium-83 gotchas in the same vein, all already fixed but
    worth knowing exist:
    - **`gap` on flex containers** — Chrome 84+. Use per-child
      `margin` if you must space buttons in a flex row that ships
      to the player.
    - **`100vh` after viewport-meta `height=` pinning** — sometimes
      unreliable in Android System WebView; pair with explicit
      `documentElement.style.height` via the layout.tsx script.
    - **`backdrop-filter`** — Chromium 76+ but flaky on Android
      WebView builds older than 88. Provide a fallback solid bg.

---

**Last Updated:** 2026-05-30 — split roadmap → `docs/roadmap/ROADMAP.md` (rules + Standard Audit Surface stay here).
