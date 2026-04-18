# EDU CMS — Developer Guide

## Project Mission

A secure, real-time K-12 school CMS for interactive digital displays, signage, and emergency alerts. Built for districts and schools to manage content on thousands of screens in lockdowns, weather events, and daily operations. Ambition: adopted by every K-12 district in the United States.

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
| `DATABASE_URL` | Prisma connection pooled | `postgresql://user:pass@host:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | Prisma direct (migrations only) | `postgresql://user:pass@host:5432/postgres` |
| `SUPABASE_URL` | Supabase project URL | `https://xyz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase auth + storage | `eyJ...` |
| `JWT_SECRET` | Signing JWTs (64-char hex) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SESSION_SECRET` | express-session encryption (64-char hex) | (same as JWT_SECRET safe) |
| `DEVICE_SECRET_KEY` | Signing device tokens (64-char hex) | (random) |
| `DEVICE_JWT_SECRET` | Device JWT signing (64-char hex) | (random) |
| `REDIS_URL` | Redis pub/sub for realtime | `redis://localhost:6379` |
| `ALLOWED_ORIGINS` | CORS whitelist (comma-sep) | `https://yourdomain.vercel.app,http://localhost:3000` |
| `PORT` | API server port | `8080` |
| `NODE_ENV` | `development` \| `production` | `development` |

Never commit `.env`. Use `.env.example` as a template.

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
3. **Signed WebSocket Messages** — WebsocketSignerService signs each payload before Redis broadcast. Player verifies signature before rendering.
4. **HTTP Polling Fallback** — If Redis fails, screens fall back to polling `/api/v1/emergency/status?tenantId=X` every 10s.
5. **Hold-to-Trigger UX** — Mobile panic page requires 3-second hold on button to prevent accidental taps.

### WARNING: Emergency System Changes
Any modification to emergency endpoints, payload validation, auth bypass logic, or audit logging requires explicit code review and sign-off. Never weaken the @AllowPanicBypass decorator or skip AuditLog creation. Test trigger/clear flows end-to-end before merging.

## Template System

Templates define screen layouts using **17 system presets** (in `apps/api/src/templates/system-presets.ts`, ~960 lines) plus custom teacher-created templates.

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

## Backup & Rollback

Refer to `docs/BACKUP_AND_ROLLBACK.md` for full procedures. Summary:
- **Before risky changes:** `git tag backup/pre-sprint-N-$(date +%Y%m%d-%H%M%S) && git push origin --tags`
- **Tarball backup:** `tar -czf edu-cms-backup-$(date +%Y%m%d-%H%M%S).tar.gz . --exclude=node_modules --exclude=.git/objects`
- **Restore from tag:** `git reset --hard backup/pre-sprint-N-TIMESTAMP`
- **Recover one file:** Extract from tarball, copy out

Keep 3 most recent tarballs; older ones can be deleted (git history is safe).

## Sprint Plan Context

Zero-budget roadmap underway (6 sprints planned):

**Sprint 1** (in progress)
- Observability (Sentry free tier)
- Accessibility (axe-core automated testing)
- E2E (Playwright + CI pipeline)
- CSRF protection
- Zod at API boundary (request/response validation)
- Feature flags (GrowthBook self-hosted)
- Health check endpoints + probes
- Secret hygiene review

**Sprints 2–6**
- SSO (OIDC/SAML)
- SIS integration (Clever)
- Template builder UI (drag-drop zones)
- Touch/kiosk hardening
- Emergency system expansion (SOS button, broadcastable text, media)
- Polish (UX, performance, mobile)

**Sprint 8 — Screen management at scale (map view + fleet ops)**

Once a customer has 100+ screens across multiple buildings or
locations, the flat list in `/screens` stops being useful. Sprint 8
turns screen management into a real operations console.

- **Geographic data on Screen.** Add `latitude` / `longitude` /
  `address` columns. Auto-geocode `address` via OpenStreetMap
  Nominatim (free, rate-limited; fall back to manual lat/lng entry).
  When a screen first registers we capture nothing — admin sets the
  location once when assigning to a building.
- **Map view at `/[schoolId]/screens?view=map`.** Toggle between
  list and map. Use **Leaflet + OpenStreetMap tiles** (free, no key)
  with `leaflet.markercluster` for dense areas. Mapbox is the easy
  upsell when funding lands; Leaflet stays default.
- **Status-coded pins:**
    - 🟢 ONLINE + emergency cache READY
    - 🟡 ONLINE but emergency cache NONE (would fetch over network)
    - 🟠 ONLINE but offline-flag (last manifest sync >5min)
    - 🔴 OFFLINE (last_ping_at >2min)
    - 🚨 EMERGENCY ACTIVE (huge red ring, blinking)
    - ⚪ PENDING / unpaired
- **Drill-down panel.** Click a pin → side panel slides in showing:
  screen name + photo, last 5 cache reports, current playlist, last
  ingest event, "Open player" / "Sync now" / "Trigger emergency on
  this screen only" buttons.
- **Cluster colors and counts.** A cluster shows the worst-status
  pin's color so a district admin instantly sees "3 screens in
  Lincoln HS are red." Cluster click zooms in.
- **Filters in the toolbar.** By status, screen group, building,
  emergency-cache readiness, last ping age, license tier (for
  SUPER_ADMIN cross-tenant view).
- **Heat-map mode for SUPER_ADMIN.** Across every tenant, density
  by status. Useful for "where do we have outage clusters?" when
  CDN/region issues hit.
- **Geo-scoped emergency triggers.** Future: lasso-select an area
  on the map → trigger emergency on every screen inside. Backed by
  the same signed pub/sub used today, just with a geographic scope
  filter applied server-side (and audit log entry includes the
  bounding box for forensics).
- **Bulk operations.** Multi-select pins → "assign to group X",
  "unpair selected", "force sync", "swap playlist". Same actions
  as the list view, but with map-driven multi-select.
- **Mobile-friendly map.** District admins on a phone can pan/zoom
  + tap a pin to drill in. Tailwind breakpoints already cover the
  layout; just need touch-friendly hit targets on the cluster pins.
- **Photo per screen.** Optional `Screen.photoUrl` so the drill-in
  shows what the wall actually looks like. Operator uploads on first
  install. Helps remote troubleshooting ("the lobby one near the
  trophy case is red").

Implementation order:
  1. Add lat/lng/address columns + Nominatim geocoder service.
  2. Map view route with Leaflet + clustering.
  3. Status-coded pins driven off existing /screens endpoint payload
     (we already report cache status + lastPingAt).
  4. Drill-down panel reusing existing screen-detail components.
  5. Geo-scoped emergency triggers (security review required).

No vendor commitment; Leaflet + OSM is free and hits the mark for
v1. Mapbox / Google Maps slot in cleanly later via a tile-source env
var if a customer demands it.

---

**Sprint 9 — Auto-branding (paste your school's URL, we match it)**

Every district wants the CMS to "look like our school." Instead of
making them fight a color picker, let them paste their existing
website URL — we scrape it, extract the brand, and theme the whole
admin UI (and default template palette) to match in under 30 seconds.
Friction killer for the pilot-sign-up conversation.

- **Tenant branding model.** Add `TenantBranding` row:
  `{ tenantId, logoUrl, faviconUrl, displayName, palette JSON,
     fontHeading, fontBody, sourceUrl, scrapedAt, confidence }`.
  `palette` is a structured object (`primary`, `primaryHover`,
  `accent`, `ink`, `surface`, `surfaceAlt`, `success`, `warn`,
  `danger`) so themes stay consistent even if the scraper only
  finds two colors — we derive shades.
- **Scraper microservice.** New `POST /api/v1/branding/scrape`
  accepting `{ url }`. Server-side:
    1. Fetch the homepage with a reasonable UA + 10s timeout.
    2. Parse with cheerio. Pull logo from
       `link[rel="icon"]`, `link[rel="apple-touch-icon"]`, OG image,
       and `<img>` matching `/logo|brand|mark/i` in class/alt/src —
       rank by size + position (top-left wins).
    3. Extract colors: read every `<link rel="stylesheet">`, parse
       with `postcss` + `postcss-value-parser`, collect every hex /
       rgb(a) / hsl(a) value. Score by frequency + proximity to
       brand-sounding selectors (`nav`, `header`, `button`,
       `.btn-primary`, CSS custom props named `--primary` / `--brand`).
       Top two wins: primary + accent.
    4. Font detection: `font-family` declarations on `body`,
       `h1`-`h3`, buttons. Match against Google Fonts catalog;
       fall back to a system-safe stack.
    5. Favicon: follow the existing favicon link; re-host in our
       Supabase bucket so we don't hotlink.
    6. Return a `BrandingPreview` DTO with everything found plus
       **confidence scores per field** so the UI can flag "we're
       not sure about this — pick one" fields.
- **Security (this is a scraping endpoint — it's dangerous):**
    - SSRF defense: resolve the URL's hostname, reject private/
      link-local/loopback IP ranges before fetching. Block
      `file://`, `ftp://`, `data:`, and non-80/443 ports.
    - Rate limit: 5 scrapes per tenant per hour. Hard cap at
      50/hour global to contain abuse.
    - Sandbox the fetch in a short-lived worker; don't execute
      any returned JS. Cheerio is static parse only — no headless
      browser in v1. (If a customer needs a JS-heavy SPA brand,
      v2 gets Playwright with a locked-down Chrome container.)
    - Max response size 5MB per fetch; max 30 stylesheet fetches
      per URL; total 10s budget end-to-end.
    - All scrape requests logged to `AuditLog` with tenantId +
      userId + URL + outcome.
- **Onboarding UX.** First-run wizard (also accessible from
  `/settings/branding`):
    1. "Paste your school's website" → URL input.
    2. Call scrape, show **live preview** of the admin UI with the
      detected palette in the right half of the screen while the
      form sits on the left (real-time: clicking a different
      primary color repaints immediately).
    3. "Name your CMS" — free-text `displayName` (defaults to
      `"${Tenant.name} Signage"` but can be anything the operator
      wants).
    4. Logo picker — shows the scraped logo + upload override.
    5. **Adopt** → persist to `TenantBranding`, invalidate CSS-
      variable cache.
- **Theme application — CSS custom properties, not a rebuild.**
  The admin layout root renders
  `<style>:root{--brand-primary:#xxx; --brand-ink:#yyy; ...}</style>`
  from the tenant's branding at request time (SSR). Every Tailwind
  utility we care about (buttons, headers, sidebar active state)
  already reads from `var(--brand-*)`. No per-tenant build, no
  dynamic className generation — one CSS var file, swap values,
  done. Sub-second theme switch.
- **Template palette overrides.** When a tenant has branding,
  default-config generators for new templates pull from the
  palette instead of the hard-coded indigo. Existing templates
  stay untouched (editor decides whether to re-theme or keep
  what's there).
- **Scope notes:**
    - v1: admin UI + default template palettes only.
    - v1.5: player chrome (loading spinner, emergency overlay
      border) picks up the palette too.
    - v2: Playwright-based scraper for SPA-heavy sites that hide
      colors in dynamic styles.
    - v3: allow multi-school districts to theme each school
      differently (TenantBranding is already scoped per tenant so
      the data model is already right).
- **Why this matters.** In demos, "paste URL → CMS looks like
  your school in 10 seconds" is the single highest-delight moment
  for a superintendent who was expecting 2 days of config hell.
  It's the gap between "nice product" and "this is us."

No third-party commitment; everything is free (cheerio, postcss,
Google Fonts CDN is free at scale). Ship behind a feature flag
(`AUTO_BRANDING`) so the pilot districts that hate surprises can
leave it off.

---

**Sprint 7 — Offline-first player (download-and-play architecture)**

The player MUST download all content locally and play from local cache.
Network is the control plane; local disk is the playback plane. This is
non-negotiable for life-safety: an emergency trigger is a tiny WS
message that flips a switch, not a content download.

- **Two cache tiers:**
  - `playlist-assets` — all assets in active playlists. LRU eviction
    when manifest no longer references them.
  - `emergency-assets` 🛡️ — every asset across all 4 panic-type
    playlists per Tenant.emergency*PlaylistId. **NEVER evicted.**
    Refreshed only when the tenant's emergency config changes.
- **Implementation order:**
  1. Service Worker + Cache API in apps/web/public/sw-player.js.
     Works in both browser and Android System WebView 60+ (Android
     7+ covered). Single codebase.
  2. New endpoint `GET /api/v1/screens/:id/emergency-assets` returns
     all 4 panic playlists' asset URLs + SHA hashes.
  3. Player postMessages manifest + emergency list to SW on every
     successful sync; SW pre-fetches into the right tier.
  4. SHA integrity check; SW re-downloads if hash mismatches.
  5. "Emergency content cached ✓ N assets / Mmb" indicator in info
     overlay.
  6. Admin sanity check in dashboard: per-screen "all emergency
     assets cached" status.
  7. (Later) Native Android download + embedded localhost server in
     the APK as a hardening layer for sub-second cold-boot.

- **Disk budget per screen — competitive landscape (researched
  2026-04-17):**
  | Vendor | Per-screen storage |
  |---|---|
  | Yodeck (Pi 4) | 8GB min / 16GB rec / ~24GB usable on 32GB card |
  | Yodeck (Pi 5) | 16GB min / 32GB rec |
  | Xibo Android | No hard cap; aggressively evicts when device free <10% |
  | OptiSigns + BrightSign | No documented per-device cache cap |
  | Rise Vision | Not documented |
  Most competitors don't expose a hard cap; they evict on free-space
  pressure. Recommendation:
  - Default soft cap: **5GB** per screen (admin-configurable
    1GB-50GB).
  - Reserve **1GB hard floor** for `emergency-assets` tier (never
    counts against the soft cap, never evicted).
  - Surface usage in dashboard: "Screen X: 3.2 GB used / 5 GB cap
    (emergency: 240 MB protected)".
  - Warn admin when emergency assets exceed 80% of the reserved
    floor so they tune media size before it overflows.
- **Failure modes covered:** WiFi pulled mid-emergency; player power
  cycle mid-emergency; CDN outage; new emergency asset uploaded but
  player offline (asset stays uncached, server logs warning, falls
  back to text-only emergency message which is always pre-cached as
  default).

- **USB sneakernet ingestion (zero-network deployment).** The player
  must run completely offline if the customer never gives it
  internet. Use cases: rural districts with no WiFi, schools on
  isolated VLANs, content updates during a network outage, initial
  provisioning before WiFi setup, safety officer pushing lockdown
  drill content by hand.

  - **Hardware path:** Android 7+ supports USB OTG host mode. APK
    registers `USB_DEVICE_ATTACHED` intent filter; on attach,
    scans the drive for the EduCMS manifest path.
  - **Expected USB layout:**
    ```
    /edu-cms-content/
      manifest.json          ← signed, declares assets + tenant + version
      manifest.sig           ← HMAC-SHA256 signature
      assets/
        <sha256>.mp4
        <sha256>.jpg
        ...
      emergency/
        <sha256>.mp4         ← lockdown / evacuate / weather / all-clear media
        ...
    ```
  - **Security model (this is critical — USB is an attack vector):**
    1. Manifest must be signed with tenant-specific HMAC key
       generated at pairing time. Tampered or unsigned drives
       are rejected with an audit log entry, no content loaded.
    2. Asset filenames are SHA-256 of content; player verifies
       hash before accepting any file into local cache.
    3. Operator confirmation prompt on first ingest from a new
       USB device fingerprint ("Update content from USB stick?
       [device serial X, Y assets]") — kiosk-mode dialog, requires
       admin PIN.
    4. **Emergency asset updates from USB require escalated
       approval:** confirmation prompt warns "This will update
       emergency content shown during lockdowns. Continue?"
       and writes to immutable AuditLog with `source: USB`,
       device serial, file hashes, operator user id.
    5. Per-tenant feature flag: `usbIngestEnabled` (default false
       for new tenants; admins must opt in). Disabled for
       restaurant/retail tenants by default — they have WiFi.
    6. Drive is read-only mounted; player never writes back to USB.
  - **Workflow for fully offline deployment:**
    1. Admin generates a signed bundle from dashboard (button:
       "Export to USB"), downloads .zip with manifest + assets.
    2. Operator copies to USB stick, walks to screen.
    3. Player auto-detects on plug-in, prompts for admin PIN,
       ingests, swaps to new content within seconds.
    4. Audit log entry posted to server when next online.
  - **Bonus:** same export bundle format works for "preload" during
    initial APK provisioning — sysadmins can ship a USB with a
    pre-paired template before any WiFi is configured.

---

**Future / multi-industry expansion (Sprint 7+, post-funding)**

- **API integrations + real-time data feeds.** Generic "data source"
  primitive (REST / GraphQL / webhook / DB / Google Sheet) that
  widgets subscribe to by id. Updates flow through the existing
  signed Redis pub/sub → emergency-grade fan-out to player fleet.
  K-12 examples: lunch menus, district calendars, athletic
  scoreboards (MaxPreps), bus tracker, weather/AQI. Beyond K-12 the
  same primitive sells to:
    - Restaurants — POS pushes price/availability to menu boards
      across 100+ stores instantly (Square / Toast / Clover webhooks).
    - Retail — inventory + promo signage updates on item changes.
    - Healthcare — wait times, room status from EHR.
    - Corporate lobbies — Workday / SharePoint event feeds.

- **Licensing + billing (per-registered-player).** Billing meter is
  the count of registered, paired Screens per Tenant. Architecture
  needs:
    - `License` model: per-tenant, with `seatLimit`, `currentSeats`,
      `tier` (Pilot / Standard / Enterprise / industry-specific),
      `billingMode` (CARD / INVOICE / PURCHASE_ORDER), `expiresAt`.
    - Enforcement: `ScreenService.register()` checks
      `currentSeats < seatLimit`; over-quota returns
      `LICENSE_EXHAUSTED` with a friendly UX prompt to add seats.
    - **In-app self-serve checkout** for credit-card customers
      (Stripe Billing — usage-based subscription per active screen,
      auto-prorate on add/remove).
    - **Invoice / PO flow** for districts and large enterprises
      (generate quote → mark paid → manual seat top-up by
      `SUPER_ADMIN`). Stripe Invoicing covers this too without
      needing a second processor.
    - **Owner control panel** at `/super` (SUPER_ADMIN only) to
      create tenants, apply licenses, comp seats, suspend, refund,
      view MRR per industry vertical, export AR aging.
    - **Industry verticals as fully separate accounts.** Tenants
      already isolate data; a `Tenant.vertical` field
      (`K12 | RESTAURANT | RETAIL | HEALTHCARE | CORPORATE`) and
      vertical-aware default templates / widget palette / pricing
      tier let one codebase serve multiple markets without
      cross-contamination.
    - **Per-vertical SKUs** so K-12 districts get FERPA add-on,
      restaurants get POS-integration add-on, etc.
    - **Compliance:** PCI-SAQ-A by keeping all card data in the
      Stripe-hosted iframe; never touch PAN.
    - **Audit hooks:** every license change writes to existing
      `AuditLog` (immutable).
  Treat as the first paid sprint once funding lands — without
  metering, the business doesn't bill.

No commercial vendors until we have funding. All free/open-source or self-hosted.

## For AI Assistants

1. **Model tier:** Default to Haiku for boilerplate, syntax fixes, test stubs. Use Sonnet for feature work. Use Opus for emergency system, security issues, template builder design, or ambiguous architecture calls.

2. **Always read this file first** — it's the source of truth for the codebase.

3. **Never weaken emergency safeguards** without explicit approval from Integration Lead. Emergency system changes require review.

4. **Never commit `.env` or secrets** to git. Treat all changes as public (repo is on GitHub: `gschiemann/EDUCMS`).

5. **Repo is PUBLIC on GitHub** (`https://github.com/gschiemann/EDUCMS`). Treat all commits, PRs, and issues as visible to the world. No hardcoded credentials, API keys, or PII.

6. **Check the memory system** at `C:\Users\gschi\.claude\projects\C--Users-gschi-OneDrive-Desktop-EDU-CMS\memory\MEMORY.md` for Integration Lead preferences and prior session context.

7. **Feature flags & observability** — Sprint 1 goal is GrowthBook + Sentry. Wrap new features with feature flags where reasonable.

8. **Prisma schema & types** — Source of truth is `packages/database/prisma/schema.prisma`. Regenerate `@prisma/client` after schema changes: `pnpm db:generate`

---

**Last Updated:** 2026-04-17
