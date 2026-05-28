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
| `DATABASE_URL` | Prisma connection pooled (Supabase pgBouncer port 6543). **MUST include `connection_limit=10` or higher** — Prisma's default when `pgbouncer=true` is **1**, which causes every concurrent request to time out with `Timed out fetching a new connection from the connection pool` and a cascade of `DATABASE_ERROR` 500s across every endpoint. Also include `pool_timeout=20` for headroom under background-service load (canary auto-promote, offline-screen-scanner, cohort outage detection). | `postgresql://user:pass@host:6543/postgres?pgbouncer=true&connection_limit=10&pool_timeout=20` |
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
| `PORT` | API server port | `8080` |
| `NODE_ENV` | `development` \| `production` | `development` |
| `CSRF_ENFORCE` | `false` → warn-mode. Default (unset) = enforced (sec-fix wave1 #7). | `false` |
| `CSRF_WARN` | `true` → warn-mode (alias for `CSRF_ENFORCE=false`). | `true` |
| `DEV_WS_ALLOW` | Dev-only: `true` enables unsigned `dev_` WebSocket tokens. **Never set in production.** | `true` |
| `ANTHROPIC_API_KEY` | Claude API key for the AI content-generator feature (sparkle button next to text fields in the template editor). When unset, the button surfaces "AI not configured for this deploy" — feature degrades gracefully, app keeps working. Cost-capped at 30 generations/hr/tenant via in-memory rate limit; claude-3-5-haiku at 300 max_tokens caps spend at ~$0.005/call. | `sk-ant-api03-...` |
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` | OAuth client for Canva Connect (Stage-2 design imports). Pending partner approval at canva.dev/docs/connect — when set, the `/[schoolId]/settings/imports` page lights up the live "Sign in with Canva" flow. Stage-1 PDF/PPTX uploads work without these. | (from canva.dev developer portal) |
| `STRIPE_SECRET_KEY` | Stripe API key. When set, billing goes live — `/billing/checkout`, `/billing/portal`, `/billing/invoices`, and the webhook all work. When unset, `StripeService.enabled()` is false and every billing endpoint degrades gracefully (checkout/portal return `{enabled:false}`, invoices `[]`), so a deploy with no billing is unaffected. | `sk_test_…` / `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the Stripe webhook (`POST /api/v1/billing/webhook`). Every event is verified against it; without it the webhook 400s. From the Stripe dashboard webhook config (or `stripe listen`). | `whsec_…` |
| `STRIPE_PRICE_MONTHLY` | Stripe recurring Price id for the $15/screen/month plan. | `price_…` |
| `STRIPE_PRICE_ANNUAL` | Stripe recurring Price id for the $150/screen/year plan. | `price_…` |

Never commit `.env`. Use `.env.example` as a template.

**Stripe billing setup.** Billing (Settings → Billing) is fully built
but dormant until Stripe is configured. To turn it on: (1) create a
free Stripe account; (2) in Stripe, create two recurring
Products/Prices — $15 per screen / month and $150 per screen / year;
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

**Sprint 1.5 — Submit-for-review workflow (CONTRIBUTOR → ADMIN approval)**

Partner asked (2026-04-25):
> "they should be able to add assets, customize templates, then
> create and schedule the playlist but when they do that they get
> to pick one or multiple users that get notified its ready to go,
> then the admin go to the reviewer tab, review everything, update
> anything needed, and then approve it and it gets published"

Today's state: `Asset.status` already has `PENDING_APPROVAL` →
`APPROVED`. Playlists/Schedules have no equivalent. CONTRIBUTOR
role exists. No notification system. No "Reviewer" UI tab.

What v1 needs (this is a Sprint 1.5 build, NOT v2):

- **`Submission` Prisma model** — bundles a draft set of changes for
  one review:
  ```
  Submission {
    id           String  @id @default(uuid())
    tenantId     String
    submittedById String  // user who submitted
    notifyUserIds String[] // who to ping (admin user ids)
    status       String  // PENDING | APPROVED | REJECTED
    note         String? // submitter's "what is this for"
    reviewerNote String? // admin feedback on reject/approve
    assetIds     String[] // assets in this submission
    playlistIds  String[]
    scheduleIds  String[]
    createdAt    DateTime
    decidedAt    DateTime?
    decidedById  String?
  }
  ```
  Asset / Playlist / Schedule each grow an optional
  `submissionId String?` reverse pointer for "what submission is
  this part of."

- **API endpoints** (all tenant-scoped, RBAC-checked):
    - `POST /submissions` — CONTRIBUTOR role; creates a submission
      bundling references to draft assets/playlists/schedules they
      already created. Body includes `notifyUserIds` (must all be
      DISTRICT_ADMIN or SCHOOL_ADMIN in the same tenant).
    - `GET /submissions?status=PENDING` — DISTRICT_ADMIN /
      SCHOOL_ADMIN; lists submissions targeting them.
    - `GET /submissions/:id` — full payload with embedded
      assets/playlists/schedules so the reviewer sees the full
      context in one screen.
    - `POST /submissions/:id/approve` — DISTRICT_ADMIN /
      SCHOOL_ADMIN; flips Asset.status PENDING_APPROVAL→APPROVED,
      Schedule.isActive false→true (if asked), playlist publish
      flag if relevant. Writes immutable AuditLog entry.
    - `POST /submissions/:id/reject` — same actors; writes
      reviewerNote. CONTRIBUTOR sees the rejection on their
      dashboard with the feedback inline.

- **Notification delivery (Phase 2 of this sprint, ship-after-MVP):**
    - In-app: Notification table + UnreadBadge on the toolbar bell
      icon (already-modeled `Notification` row exists; just need to
      wire the trigger).
    - Email: a `pendingReviewSubmissions` daily-digest cron is
      enough for v1. Real-time email is a Phase-3 polish.

- **UI surface:**
    - On Playlists page: a "Submit for review" button next to
      Save. Opens a small modal: "Notify whom?" (multi-select of
      admins in the tenant) + free-text note. Hits `POST /submissions`.
    - New `/[schoolId]/reviews` page (tab in the dashboard nav for
      DISTRICT_ADMIN / SCHOOL_ADMIN only): list of pending
      submissions with submitter, date, # of items in the
      submission. Click to drill in: full preview of each asset /
      playlist with the existing in-product editors inline.
      Approve / Reject buttons + a textarea for reviewerNote.
    - On the CONTRIBUTOR dashboard: a "My submissions" widget
      showing PENDING / REJECTED with admin feedback.

- **RBAC:**
    - CONTRIBUTOR can submit + view own submissions
    - DISTRICT_ADMIN / SCHOOL_ADMIN can list, approve, reject
    - SUPER_ADMIN can do everything across tenants

- **Why Sprint 1.5 (between Sprint 1 and 2-6):** the partner's
  pilot tenant has CONTRIBUTOR users who are already creating
  content but cannot publish without admin approval. Today they're
  emailing the admin asking "can you approve my asset?" — that's
  brittle and doesn't scale. Sprint 1.5 closes that workflow gap.
  Sized at ~1 week of focused work for the MVP (without
  notifications); ~2 weeks with email + in-app delivery.

- **Schema migration is purely additive** (new table + 3 nullable
  columns on existing tables) so it's safe to ship to the live
  pilot tenant without risk of data loss. Per memory:
  "additive only" — and the new optional pointers don't change
  existing query patterns.

- **NOT in scope for Sprint 1.5:** version-control of in-flight
  edits (the "submission" is a snapshot in time; mid-flight edits
  to the same asset land directly in the live row). That's a
  Sprint 9-ish polish.

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

**Sprint 8b — Indoor floor plans + per-screen emergency targeting**

Sprint 8 covers the *outdoor* "where in the city" map view. Sprint 8b
covers the *indoor* "where in the building" view AND the matching
emergency model — instead of one tenant-wide alert, you trigger
**different content on different screens at the same time** based on
where the threat is and where each screen physically lives.

This is the single biggest emergency-product differentiator from
Yodeck / Rise Vision / OptiSigns, none of whom do per-screen scoped
emergencies. Real customer scenarios:

  - Active shooter localized to the gym → gym + adjacent hallway
    screens show "lockdown immediately, do NOT move." Wing-A
    classrooms show "lockdown, secure room." Cafeteria shows
    "evacuate via north exit, NOT central corridor."
  - Cafeteria flood → only cafeteria screens show the wet-floor
    alert. Everything else stays on the regular schedule.
  - Fire in the chemistry lab → lab + adjacent hall show evacuate;
    everyone else gets "use east stairwell only."

The existing per-tenant `emergencyStatus` model ships ONE alert to
every screen. That's wrong for situations where the right action
depends on where you physically are.

- **Floor plan model.** New `FloorPlan` row:
  `{ id, tenantId, name, buildingLabel, floorLabel, imageUrl,
     widthPx, heightPx, defaultZoneIds, createdAt }`. The image is a
  PNG/PDF the operator uploads (their architectural floor plan or a
  hand-drawn sketch — both are fine). We store dimensions so the
  drag-drop coordinates stay consistent.
- **Screen positioning.** Add `Screen.floorPlanId`, `Screen.floorX`,
  `Screen.floorY` (px coords on the floor plan image). Optional —
  if a screen isn't placed yet it just doesn't render on the floor
  plan view. Multi-floor schools get one FloorPlan per floor.
- **Zones.** New `FloorZone` row: `{ id, floorPlanId, name, color,
   shape (polygon JSON: array of {x,y} px coords) }`. Operator draws
  named zones on the floor plan ("Wing A", "Cafeteria", "Gym").
  Screens inside a zone polygon are auto-grouped for triggers.
- **Per-screen emergency override.** New `ScreenEmergencyOverride`:
  `{ id, screenId, type (LOCKDOWN/EVACUATE/WEATHER/ALL_CLEAR),
    severity, mediaUrl, textBlob, expiresAt, triggeredByUserId,
    triggeredAt, scopeNote }`. The player checks this BEFORE
  falling back to the tenant-wide override. Per-screen wins.
- **Pre-cached scoped emergency assets.** The Sprint 7 emergency
  cache tier already pre-fetches all 4 panic-type playlists for the
  tenant. Extend it: also pre-fetch the per-zone scoped variants
  (e.g. "lockdown - hold position" vs "lockdown - evacuate now")
  if any are configured. Disk impact is small — emergency content
  is text + a few images, not video. Cache tier still capped at
  the 1GB hard floor.
- **Trigger UX — three modes the operator picks before sending:**
    1. **Whole tenant** — same as today, identical content everywhere.
    2. **Pick zones** — click 1+ zones on the floor plan, pick a
       different override per zone (or one for all selected). The
       remaining screens default to the global override or stay on
       schedule based on operator choice.
    3. **Pick individual screens** — multi-select via checkbox or
       lasso on the floor plan. Per-screen overrides.
  Below the picker: per-scope content selector ("This zone shows:
  [Lockdown - hold]" vs "[Lockdown - evacuate]"). Hold-to-trigger
  3-second confirm still applies — UX safeguard is unchanged.
- **Pre-saved scenarios.** "Active shooter — gym" can be a saved
  template that pre-selects the gym zone with "lockdown - evacuate"
  and pre-selects all other zones with "lockdown - hold position."
  Operator picks the scenario, hits trigger, all the per-zone
  routing happens in one signed pub/sub burst. Critical for the
  drill scenario where seconds matter.
- **Pub/sub scoping** — the existing signed Redis channels are
  already per-scope (`tenant:X` / `group:X` / `device:X`). We just
  start broadcasting on `device:<screenId>` channels for per-screen
  overrides. Player already subscribes to its own device channel.
  Zero protocol change.
- **Audit log entry.** Includes the floor plan id + the zone /
  screen list + the scenario id used. Forensics: "at 9:42:03 on
  2026-04-19, Operator X triggered lockdown on screens
  [list of 14 screen ids in zones [Gym, Hall-2A, Hall-2B] using
  scenario 'Active shooter - gym wing'." Every detail captured
  immutably for incident review.
- **Drill mode.** Same UX, but writes a separate `DrillRun` row +
  audits as a drill, doesn't actually flip emergencyStatus on the
  player. Lets safety officers practice the routing without taking
  down screens. Required for SROs / state safety audits.
- **Upload pipeline.** Floor plans are uploaded just like assets
  (Supabase storage). PDF inputs auto-convert to PNG via the same
  Sprint 10 pipeline (libreoffice or pdf-lib). Multiple-page PDFs
  produce one FloorPlan per page, named "Building - Floor 1",
  "Building - Floor 2", etc.
- **Mobile triggering.** The mobile panic page (already shipped) gets
  a "scope" picker — default "whole tenant" but operator can
  pick a saved scenario from the dropdown. Zone/screen picking on a
  small touchscreen is hard, so phone defaults to scenario-based
  triggering; floor-plan-driven triggering stays on the desktop
  console where the precision actually exists.
- **Privacy / FERPA.** Floor plans are sensitive (operational
  security). They're tenant-scoped and only DISTRICT/SCHOOL_ADMIN
  can view + edit. Image storage URLs are signed and short-TTL
  (Sprint 7 pattern). Never indexed, never shared cross-tenant.
- **Why this is a moat.** Per-screen scoped emergency content is
  what enterprise / multi-building schools want and no signage
  product offers it. Combined with our existing signed pub/sub +
  immutable audit log + emergency-cache tier (offline-first),
  Sprint 8b makes EduCMS the only K-12 signage product that can
  credibly claim "we route the right alert to the right room
  in 200ms even if WiFi is partially down."

Implementation order:
  1. FloorPlan model + upload UI + image hosting (cheapest piece).
  2. Drag-drop screen positioning on the floor plan view.
  3. Zone drawing tool (polygon editor).
  4. Per-screen emergency override schema + player rendering
     priority (per-screen > per-tenant).
  5. Trigger UX with zone / screen / scenario picker.
  6. Pre-saved scenarios + drill mode.
  7. Mobile panic page scenario picker.

Builds on Sprint 7 (offline cache for per-zone variants) and shares
the geographic map view with Sprint 8 (toggle: outdoor map ↔ indoor
floor plan).

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

**Sprint 10 — PDF / PPTX / Slides import → auto-slideshow**

Closes the #1 conversion objection from prospects: "I already make
my menus / flyers / morning announcements in Canva (or PowerPoint
/ Google Slides) — can I just publish that?" Yes. Drag the file in,
we render it to a playlist of images automatically.

- **Schema additions** to `Asset`:
  - `processingStatus` (`PENDING | PROCESSING | READY | FAILED`)
  - `parentAssetId` — original PDF/PPTX, so each rendered page
    points back to its source for re-render at higher DPI later
  - `pageNumber` — 1-indexed position inside the source doc
  - `sourceFormat` — `PDF | PPTX | KEYNOTE | DOCX | OTHER`
- **New endpoint** `POST /api/v1/assets/import-deck` accepting a
  PDF or PPTX upload. Returns the parent Asset row immediately
  with `PENDING` status; conversion runs as a background BullMQ job
  on the existing Redis. UI polls or websocket-subscribes for
  `READY`.
- **Conversion pipeline (free / self-hosted):**
  - PDF → PNG: `pdfjs-dist` (Mozilla's renderer, pure JS, no
    binary). Render at 2× target screen height (4K screens get
    4320px-wide images). 1-3 MB per page.
  - PPTX → PDF → PNG: shell out to
    `libreoffice --headless --convert-to pdf`, then PDF→PNG above.
    LibreOffice handles ~95% of decks, fonts preserved if
    embedded.
  - Bound: max 100 pages per upload, 50MB file cap, 60s job
    timeout per page. Reject files > caps with a friendly
    "split into smaller decks" error.
- **Auto-create Playlist** on completion. Named after the source
  file (`Menu Week of April 19`). Default per-slide duration 8s,
  override per item afterward. User drops the playlist on a screen
  / schedule like any other.
- **Asset-library UI:**
  - "Import deck" tile next to "Upload" — accepts .pdf, .pptx,
    .ppt, .key (Keynote falls back to "open in Keynote, export
    PDF" message — Apple doesn't license a converter we can self-
    host).
  - Per-page thumbnails grouped under the parent asset (collapsible
    tree row).
  - Per-page "use as image" lets them grab one slide for a single
    IMAGE zone instead of the whole playlist.
- **What customers get for free** because Playlist is the output:
  audit log, role gates, schedules, per-slide duration tuning,
  reorder/delete, drag onto any screen.
- **Honest limitations** (document in the import dialog so support
  tickets don't pile up):
  - Slide animations + transitions flatten to stills.
  - Embedded video is dropped (workaround: separate VIDEO widget
    on a different zone).
  - Live edits don't sync — re-export and re-upload (Sprint 11
    Canva Connect fixes that).
  - Hyperlinks flatten.
- **Why now (post-launch).** Yodeck, Rise Vision, OptiSigns, and
  ScreenCloud all ship this as table stakes for paid signage.
  Customers expect it; the absence is a real objection in pilot
  conversations. Defer for launch only because it's not life-
  safety; ship in Sprint 10 as the first big "buyer convenience"
  feature.

---

**Sprint 11 — Direct Canva Connect (and Slides / PowerPoint Online)**

Builds on Sprint 10. Same UX outcome (Canva design appears on the
screen) but via OAuth so edits in Canva auto-sync — no re-export
ritual. Same architectural pattern works for Google Slides and
Microsoft PowerPoint Online; ship Canva first because that's what
prospects ask for by name.

- **OAuth flow:** Canva
  [Connect API](https://www.canva.dev/docs/connect/) — register
  EduCMS as a Canva integration, redirect URI on our domain,
  store the user's refresh token encrypted in a new
  `IntegrationToken` table scoped per-user-per-tenant.
- **"Connect Canva" button** in `/settings/integrations`. After
  consent, the asset library gains an "Import from Canva" tile.
- **Picker UX:** modal lists the user's Canva designs (paginated
  via Canva's `/v1/designs` endpoint), with thumbnails. Pick one →
  server fetches the export (PNG or PDF, our choice — PDF for
  multi-page decks, PNG for single designs) → routes through the
  same Sprint 10 conversion pipeline → produces an Asset (or a
  Playlist for multi-page).
- **Auto-resync:** opt-in per imported design. A nightly cron
  re-fetches the export; if Canva's `updated_at` is newer than
  our last sync, re-render and update the Asset in-place. Player
  cache invalidates by SHA mismatch (already covered by Sprint 7
  offline-first).
- **Resync cadence:** default daily, opt-in to hourly for high-
  change designs (cafeteria menus). Hard cap at 4× per hour to
  respect Canva rate limits.
- **Sister integrations** (same pattern, different OAuth scope):
  - **Google Slides** — Drive API + Slides API. Export as PDF.
  - **PowerPoint Online** — Microsoft Graph API.
    `/me/drive/items/{id}/content?format=pdf`.
  - **Figma** — REST API. Designers love this for kiosk hero
    art that gets iterated weekly.
- **Security review (this is OAuth, treat carefully):**
  - Refresh tokens encrypted at rest with `DEVICE_SECRET_KEY`-
    style envelope encryption.
  - Per-tenant feature flag `EXTERNAL_INTEGRATIONS_ENABLED`
    (district admins can disable for their schools).
  - Audit log entry on every connect / disconnect / sync.
  - Disconnect button purges the refresh token immediately.
- **Why a separate sprint from Sprint 10:** Sprint 10 is "drag a
  file in" — zero new external dependencies, ships in days,
  closes the objection. Sprint 11 is "live two-way connection
  with a third-party service" — needs OAuth security review,
  rate-limit handling, and ongoing maintenance as Canva's API
  evolves. Don't entangle them; Sprint 10 stands alone and Sprint
  11 is a delight upgrade on top.

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

**Version 2 — Safety-Centric Platform Pivot (Sprint 12+)**

Strategic frame: stop selling "another digital signage CMS with
alerts" — become a **school-and-district incident coordination
platform that happens to own the screens natively**. The signage
fleet becomes one endpoint of an orchestration layer that also
handles incident workflow, accountability, responder context, and
multi-modal delivery. Pricing shifts from $/screen to $/school +
Command tier + Responder Bridge enterprise tier — collapses the
"signage + separate safety tool" buying motion into one product
that still comes in below the stitched-together alternative.

**Core architectural correction (the load-bearing change):** keep
the existing cloud stack as **system-of-record** (admin UX,
tenancy, storage, reporting). Add a **campus-local edge service**
as the **system-of-action** during outages or urgent triggers. WAN
down does not mean alerts stop. This single change is what shifts
us from "good signage app" toward "credible safety platform."

### 7 core workstreams

**WS-1 · Edge alert fabric.** Campus-local alert broker (simplest
form: Android player APK becomes dual-role — one player on each
LAN is "leader" via leader-elect, brokers alerts when WAN is
down). Signed alert envelopes, player heartbeat service, local
cache of takeover layouts, LAN trigger path, cloud-to-edge sync,
dry-contact + webhook adapter for fire/access/door systems.
**Acceptance:** A campus can trigger and display an alert with WAN
down; online players return proof-of-display; normal content
resumes correctly after all-clear.

**WS-2 · Incident command engine.** Replaces the current single
`Tenant.emergencyStatus` flag with a proper FSM:
`OPEN → ACK → ACTIVE → RECOVERY → CLEARED`. Per-incident-type
playbooks (lockdown / shelter / evacuate / medical / facilities /
district advisory), severity levels, zone routing, role-based
tasks, escalation paths, structured all-clear and recovery stages.
Every transition immutably AuditLog'd.
**Acceptance:** Admins can define response playbooks per incident
type; an incident has a state, an owner, and required next steps.

**WS-3 · Multi-modal endpoint layer.** Screen takeover ✓ already.
Add: desktop takeover (Windows/Mac agent or browser tab claim),
mobile push (APNs/FCM), email (Sendgrid), SMS + voice (Twilio),
PA / IP-speaker hooks (Valcom / Atlas / SingleWire InformaCast
Fusion — partner-gated, deferred), TTS, multilingual templates,
public-view vs staff-view rendering split.
**Acceptance:** One incident sends differentiated outputs to
students, staff, admins, and responders from a single trigger.

**WS-4 · Responder bridge — Raptor / RapidSOS connector.** We do
NOT build 911 origination ourselves (liability + ECC alignment
burden). Partner with **Raptor** (preferred — already covers PA /
door-lock / drill management) and / or **RapidSOS** (open
integration program) as the 911/ECC bridge. We build the facility
profile (floor plans → covered by Sprint 8b!), aerial map, entry
instructions, camera RTSP/HLS share-links, door/lock state, site
contacts, event timeline, secure one-time responder link. Then a
thin connector exports our incident packet into Raptor/RapidSOS
format.
**Acceptance:** First responders open one URL and see site
context, incident type, location, live updates. **Commercial
dependency: needs partnership pitch BEFORE the integration code.**

**WS-5 · Accountability + reunification.** Teacher / staff roll
call (mobile flow: "mark room safe / help / missing"), room
rosters (fed by Clever SIS — Sprint 2), guardian verification +
digital signatures, dismissal/release chain, after-action exports.
Highest single net-new build but highest competitive moat — no
signage product offers this and the safety-only products (Raptor,
CrisisGo, Singlewire) all charge separately for it.
**Acceptance:** Incident commander sees who is accounted for,
which rooms still need response, and who has been released to
whom — with auditable timestamps + signatures.

**WS-6 · District command center.** Cross-school dashboard,
inherited policies (district publishes playbook → schools inherit
or override), school-level overrides, geofenced district alerts,
mutual-aid views, district notices, policy versioning. Builds on
the existing tenant hierarchy.
**Acceptance:** District admin publishes once and enforces or
customizes across every school without duplicating content / rules.

**WS-7 · Open integration platform.** Inbound CAP (OASIS standard
for all-hazard alerts) and IPAWS consumption (FEMA national
alerting), RSS/Atom feeds, REST + webhook SDK, provider adapter
framework, test simulator, sandbox tenant, schema docs, policy
APIs. **Note:** outbound public IPAWS origination is OUT of scope
unless we deliberately become a FEMA-authorized origination
software provider — separate authorization model entirely.
**Acceptance:** A new partner integrates without touching core
orchestration code; customers can simulate incidents end-to-end
before go-live.

### 3 above-and-beyond bets (parity → leadership)

**B-1 · Dynamic route intelligence.** Per-screen context-aware
emergency rendering. Instead of one generic "lockdown" card on
every display: hallway north of the incident shows "AVOID NORTH
STAIRWELL," adjacent wings show "SHELTER IN CURRENT ROOM,"
lobbies show "DO NOT ENTER," reunification screens pivot to
parent instructions after all-clear. Sprint 8b indoor floor
plans + per-screen overrides lays the data foundation; this is
the routing logic on top. **Crown jewel — nobody else does this.**

**B-2 · Proof + replay.** Capture which screens were online,
what each rendered, when each acknowledgment arrived, what
playbook step was completed, what responder packet was opened.
Auto-generate incident replay + after-action PDF. AuditLog
already captures most of this — just needs the UI + export.
Cheap for us, expensive for competitors to retrofit.

**B-3 · Controlled AI assistance.** Template-fill only. Summarize
incoming context. Draft staff + parent follow-ups from verified
fields. Generate after-action reports from logged data.
**Never** let an LLM invent evacuation language, responder
actions, or legal/medical instructions in real time. Scope
narrowly; feature-flagged.

### Pricing tiers (collapses 2-3 vendor purchases into one)

| Tier | Posture | Includes | Why |
|---|---|---|---|
| **CMS Core** | $5–7/screen/mo, self-serve | Content, playlists, templates, orientation, health, standard takeover alerts | Undercuts ScreenCloud/Carousel materially |
| **School Unlimited** | $1,499–1,999/school/yr | Unlimited displays, district/school tenancy, alert authoring, CAP/custom provider ingest, all-clear handling, district policies | Sits near Rise Enterprise but adds native safety value |
| **Command** | +$1,000–2,000/school/yr | Incident workflows, accountability, drill reporting, reunification-lite, responder packet, staff views | Undercuts the "signage + separate safety tool" combo |
| **District Ops** | Quote / annual contract | Cross-school command center, mutual-aid mesh, SSO, audit exports, premium support, policy governance | Districts buy predictability + governance |
| **Responder Bridge** | Assisted sale only | 911/ECC integrations, structured responder data, testing support, partner onboarding | Real support burden = real margin |

**Bonus tier — Free Pilot.** 1 school / ≤5 screens / 90 days /
full Command features. Superintendents won't write a PO for
software they haven't seen run in their hallways. Free pilot →
Command upgrade is the funnel.

### What we deliberately do NOT build (liability + market structure)

- **Direct 911 call origination.** Raptor/RapidSOS handle this.
  Building it ourselves means owning ECC alignment, configuration
  testing, and policy workflow with every PSAP — see RapidSOS's
  own docs warning that silent alarms only work when school + ECC
  pre-align on testing/config/workflow.
- **Outbound public IPAWS origination.** Requires FEMA
  authorization as an alert-origination software provider.
  Inbound IPAWS consumption is fine; origination is a different
  authorization tier we'd take on deliberately or not at all.
- **PA / IP-speaker proprietary protocols** (Valcom, Atlas,
  SingleWire InformaCast Fusion). Defer; let Raptor cover.
- **Weapon / anomaly detection** (gunshot detection, AI camera
  scanning). Vendor-partner if customers ask.
- **Anonymous tipline.** CrisisGo's territory; later adjacency.

### Phase plan (no shortcuts — Phase 1 must precede everything)

**Phase 1 — Foundation (must precede everything; freeze schemas
before code).** Event-schema freeze (CAP v1.2-compatible from day
one so CAP inbound is free later — incident type, severity,
zones, signed envelope, proof-of-display ACK shape). Campus edge
broker (extend offline-first work; player APK becomes dual-role
leader-elect — no new hardware). Incident state machine
(`Tenant.emergencyStatus` → proper FSM). Proof-of-display (extend
existing heartbeat to include `lastRenderedIncidentId` +
timestamp; we get incident replay data for free).
**After Phase 1, we ship as a "credible edge-first emergency
platform" — already above all cloud-only signage CMS competitors.**

**Phase 2 — Differentiation (responder + accountability).**
Facility profile (floor plans, contacts, cameras — overlaps
Sprint 8b). Raptor SOS integration (commercial pitch first, then
adapter code). Accountability — roll call (largest single UI
build, highest customer value). Reunification-lite (guardian
verification + release-chain audit; pairs with Clever SIS).

**Phase 3 — District + openness.** District command center
(formalize policy inheritance on existing tenant hierarchy).
CAP/IPAWS inbound. Webhook + provider SDK.

**Phase 4 — Leadership.** Dynamic route intelligence (B-1).
Proof + replay (B-2). Controlled AI assistance (B-3).

### Open questions that gate Phase 2

1. **Green-light on pitching Raptor.** Need to draft partnership
   email + one-pager spec before code. RapidSOS as fallback if
   Raptor declines (more open integration program; same adapter
   shape on our side).
2. **Phase 1 ordering confirmation.** Schema freeze before
   anything else is non-negotiable — parallelizing too early
   without frozen event/policy schemas produces a lot of
   convincing code that doesn't converge.
3. **Accountability scope.** Full SIS-driven reunification ≈ 2-3
   months. Roll-call only first ≈ 3 weeks. Lite-then-layer or
   hold until full?
4. **Free pilot policy.** 1 school / ≤5 screens / 90 days
   confirmed?

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

---

**Sprint 13 — VenueOS Sports (the all-in-one live-event venue system)**

Strategic frame: VenueOS becomes the premiere all-in-one sports-venue
system — real-time scoreboards, perimeter ribbon/fascia banners,
celebration animation triggers, and game-day show control — scaling
from a K-12 gym to a pro stadium. Ambition: #1 in the industry from
K-12 sports → college → every major professional sport.

This is NOT a new product built from scratch. It is a sports-mode
layer pointed at an already-built real-time signage engine. The hard,
expensive parts of a sports system are things VenueOS already ships
(see "what we already have" below). Phases 1-2 are mostly assembly.

Research basis (2026-05-16, two deep web-research passes — market +
technical architecture). Key sources, recorded so the research is
durable: Daktronics (Show Control / All Sport), ANC LiveSync,
ScoreVision (HS-focused, software-first, sponsorship-subsidized),
Nevco / Electro-Mech, Ross XPression Tessera (virtual-canvas LED),
DELTAcast DELTA-stadium, Sportzcast / Scorebird (console tap-off),
GameChanger, Genius Sports / Sportradar (league push feeds, 20-30s
lag), NovaStar / Brompton / Megapixel (LED processors).

Market reality: the industry is bifurcated. Pro/college is locked-up
six-to-eight-figure capex (Daktronics, ANC) — a *later* play, not the
beachhead. The **high-school + rec segment is the opening**, and
ScoreVision has validated the software-first, sponsorship-subsidized
playbook there — but ScoreVision still chains its software to its own
hardware. VenueOS's structural edge over every incumbent: a
hardware-agnostic Android player + template builder + signed
real-time pub/sub it ALREADY ships.

### What we already have (the unfair advantage)

- **Signed WebSocket pub/sub** (built for emergency alerts) — instant
  fleet-wide content takeover with HTTP-polling fallback and
  per-screen scoping (Sprint 8b). A celebration cue IS an emergency
  trigger; the fan-out engine already exists.
- **Runs on NovaStar Taurus** — the player can BE the LED controller,
  skipping the separate six-figure processor on smaller installs.
- **Mobile hold-to-trigger panic page** — the exact control-surface
  pattern for phone-driven game control ("Touchdown" vs "Lockdown").
- **Template builder + brand shim** — scoreboard layouts and
  celebration animations are templates; the brand shim auto-recolors
  every animation to the school's colors.
- **Immutable AuditLog** — becomes sponsor proof-of-play reporting
  for free.
- **Custom resolutions + EXTERNAL_HTML widget** — already in place.

### 1. Hardware topology

**Standard sports-vertical player: the Goodview EP6N** (eval +
spec sheet in `docs/EP6N_HARDWARE_EVAL.md`). As of 2026-05-27 this
is the canonical hardware target for every new sports-vertical
install. It supersedes the ECBox3576 — same RK3576 SoC family +
Android 14 so the Player APK ships unchanged, but adds the I/O ring
that closes the integration gaps we've been working around: **dual
native RS232**, **GPIO IN×2 / OUT×2**, **HDMI IN** (broadcast
capture), **RJ45 in + out passthrough**, **12 V aux out**, 6 TOPS
NPU, all-aluminum passive cooling, 24/7 duty rating. Every new
sports quote, every new install playbook, every customer-facing
"recommended hardware" spec should lead with EP6N. The ECBox3576
stays in the catalog for legacy installs + as the budget option;
the Taurus stays for LED-controller-native deployments.

The EP6N also unlocks features the older boxes can't run:
  - **GPIO-wired hardware panic button** → emergency trigger.
  - **GPIO IN dry-contact** → fire-alarm panel integration.
  - **GPIO OUT relay** → lobby status lamp, audible horn during
    emergency states.
  - **HDMI IN broadcast capture** → in-box streaming-overlay path
    for NFHS Network / Hudl (collapses the $180–400 USB capture
    card BOM line).
  - **RS232 #1 → CTS Gen 6 + RS232 #2 → Stream Deck** on one box.
  - **6 TOPS NPU** → on-device alt-text, auto-celebration via
    crowd-audio classifier.

Two deployment modes, both still supported as add-ons:
  - **Taurus-native** — player runs ON the NovaStar Taurus LED
    controller; player → LED, no separate processor. The cost-killer
    for HS gyms with existing Taurus. Note Chromium 83 ceiling
    (CLAUDE.md rule #10 — no `inset` shorthand, no flex `gap`).
  - **Source mode** — player (EP6N preferred) outputs HDMI/SDI at
    the wall's EXACT pixel resolution into a third-party processor
    (NovaStar / Brompton / Megapixel) for big college/pro walls.

A venue is a set of **surfaces**, each a screen or screen-group with
a role: `VIDEO_BOARD`, `RIBBON`, `AUX` (end-zone/corner), `CONCOURSE`,
`LOCKER_ROOM`, `STREAM` (broadcast overlay). Cues target roles, not
devices.

The `Screen.hardwareModel` column (Prisma, additive) carries the
specific hardware ID — `goodview-ep6n`, `goodview-ecbox3576`,
`novastar-taurus`, `pi5`, `generic-android`, `web`. The dashboard's
per-screen settings panel surfaces hardware-specific I/O config
ONLY for models that support it (the EP6N gets a "Wiring" subpanel
with GPIO assignment + dual-RS232 routing + HDMI-IN source select;
the ECBox only gets the single-RS232 routing; the Taurus / Pi /
generic get neither).

### 2. The Sport Engine — the abstraction that handles EVERY sport

Never hardcode football vs basketball. A declarative `SportDefinition`
drives the whole scoreboard + cue system:
  - `clock`: countdown | countup | none
  - `segments`: { name (Quarter/Period/Inning/Set/Half), count,
    overtimeRule }
  - `score`: { unit (points/runs/goals), increments[] }
  - `statFields[]`: sport-specific (football down/distance/ball-on;
    baseball balls/strikes/outs/baserunners; basketball team
    fouls/bonus/possession arrow; volleyball sets/serve; …)
  - `celebrations[]`: trigger events (TD, field goal, 3-pointer,
    home run, goal, pin, ace, record, …)
  - `mode`: HEAD_TO_HEAD | LEADERBOARD (meet sports are leaderboards,
    not head-to-head — the one paradigm shift)

Sports coverage, grouped by clock model:
  - **Continuous-clock invasion** — football, basketball, soccer,
    hockey, lacrosse, water polo, field hockey, rugby, futsal,
    team handball.
  - **Inning/turn** — baseball, softball, cricket.
  - **Set/rally** — volleyball, tennis, badminton, pickleball,
    table tennis.
  - **Bout/match** — wrestling, boxing, MMA, fencing.
  - **Meet/leaderboard** — track & field, swimming/diving, cross
    country, gymnastics, cheer, golf, rowing.
  - **E-sports** — maps/rounds (growing fast in HS).

Ship ~6 flagship sports first (football, basketball, baseball/
softball, soccer, volleyball, wrestling — ~90% of HS athletics);
the schema makes the rest mostly config.

### 3. Scoreboard builder

The template builder gains a scoreboard widget set bound to the
active `SportDefinition`: `ClockWidget`, `ScoreWidget`,
`SegmentWidget`, sport-bound `StatWidget`s. Operator picks a sport →
correct scoreboard template → recolors to school colors via the
brand shim. Custom resolution = the actual board size.

### 4. The Cue & Celebration engine

A `CueDeck` per sport — a launchpad of cues:
`Cue { name, animation, audio, targetSurfaces[], durationMs,
autoRevert, sponsorSlot? }`. Trigger sources, all fanned out through
the signed pub/sub:
  - **Phone** — panic-page pattern: score ±, clock, celebration
    buttons; hold-to-trigger on the big ones.
  - **Launchpad UI** — a tablet grid.
  - **Elgato Stream Deck** — support it as the physical cue panel.
    $150 hardware vs a $3K Daktronics console.
  - **AUTO** — a score feed reporting 14→21 fires the touchdown cue
    itself.
  - **Keyboard hotkeys** for the laptop operator.
Fan-out is per-surface (full animation on the video board,
score-flash on the ribbon, corner banner on concourse), auto-reverts
after N seconds. Content-level sync lands every surface within
~150ms — plenty for HS; hardware genlock stays a pro-tier add-on.
Celebration animations are `EXTERNAL_HTML` templates → auto-rebrand
via the shim. Pre-cache them like emergency assets so game
presentation survives stadium WiFi failure.

### 5. Surfaces — ribbon / video board / concourse

A `RIBBON` surface uses a **virtual-canvas + pixel-map**: the operator
describes the physical panel chain ("60 panels, 192×192, straight/
curved run") → VenueOS computes the off-spec canvas (e.g.
11520×192) and slices content across panels so a scroll wraps the
bowl seamlessly. Reuses custom-resolution support; the pixel-map is
the one net-new piece. Ribbon-native widgets: infinite-scroll
sponsor banner, score-follow, rotation.

### 6. Score-data ingestion — the "two clocks" rule

Three tiers, shipped in order:
  1. **Manual phone entry** (MVP — enough for most HS).
  2. **Console tap-off** — a small box (Sportzcast/Scorebird-style,
     or our own serial reader) reads the existing Daktronics All
     Sport console and publishes to our cloud. THE LIVE GAME CLOCK
     MUST COME FROM HERE — local and fast.
  3. **League feeds** — Genius Sports / Sportradar for stats overlays
     + college. These lag 20-30s. RULE: clock from local console,
     stats from feed — never mix them.
A `ScoreSource` abstraction makes all three interchangeable.

### 7. Sponsorship — a first-class revenue system

Sponsorship is the BUYING TRIGGER, not a feature (ScoreVision schools
clear $50-130K/yr; that revenue is why they buy). Build it in from
day one:
  - **Ad inventory units**: ribbon rotations, full-board between-play,
    co-branded celebration ("this touchdown brought to you by …"),
    persistent scorebug bug, concourse loops.
  - **Scheduling**: dayparting, frequency caps, flight dates,
    makegoods.
  - **Proof-of-play**: auto-generated from the immutable AuditLog —
    "your logo: 14 touchdowns, ~47K impressions, 92% delivered."
  - **Model**: school sells local ads + keeps the money; VenueOS
    charges SaaS + optional rev-share. Later: a cross-district
    sponsor marketplace.

### 8. Game-day operations

A `Game` object with a state machine (`SCHEDULED → PRE_GAME → LIVE →
HALFTIME → FINAL`). A **rundown / game script** — a timeline of
sponsor reads, hype videos, promos tied to stoppages. Operator
tablet shows three panes: scoreboard control + cue launchpad +
rundown. Two-person mode (scorekeeper + show caller) or
solo-volunteer mode.

### 9. Go-to-market — K-12 → college → pro

  - **Beachhead: K-12 athletics.** Every school VenueOS already sells
    has a gym and a field; the athletic director is down the hall
    from the principal who already signed. A warm upsell, not a cold
    sale — the structural advantage over ScoreVision.
  - **The wedge / the pitch:** "You're not buying a scoreboard.
    You're buying a screen that runs announcements, lunch menus, and
    booster ads five days a week — and becomes a full
    game-presentation system on Friday night." A gym scoreboard is
    dark 95% of the time; no incumbent uses it as everyday signage.
    That rewrites the capex math.
  - **College:** same software, larger surfaces, real ribbon boards,
    console tap-off + league feeds. Incumbents have capex lock-in —
    enter via mid-major and Olympic-sport venues first.
  - **Pro:** the architecture scales (source mode into pro
    processors, multi-surface cue fan-out, genlock add-on). Pro is a
    deliberate later play — it requires displacing entrenched
    Daktronics/ANC relationships and a pro-grade support burden.
    Sequence it; don't lead with it.

### 10. God-tier (stretch)

  - **Streaming overlay** — the scorebug renders as a transparent
    browser-source overlay for NFHS Network / Hudl livestreams. One
    scorebug, board + broadcast.
  - **Instant replay** — pair a camera; replay to the board.
  - **Fan engagement** — QR on the ribbon → phone polls, "make some
    noise" meter, fan-cam, kiss-cam, t-shirt-toss prompts.
  - **District command** — a district runs every school's boards
    from one dashboard + a live "scores around the district" ticker.
  - **Severe-weather safety** — a stadium is a mass-gathering venue;
    the existing emergency system = lightning/evac alerts that
    override the game. A genuine safety differentiator no scoreboard
    company has.
  - **Auto-celebration via ML** — detect the goal from crowd-audio.
  - Walk-up music, record boards, senior night, rivalry mode.

### 11. Data model (Prisma — additive)

`SportDefinition` (seeded constant) · `Game` · `GameEvent` (score +
cue log) · `Surface` · `CueDeck` / `Cue` · `Sponsor` ·
`SponsorPlacement`. Proof-of-play reuses `AuditLog`. All additive —
new tables + nullable pointers, safe to ship to live pilot tenants.

### 12. Phasing

  - **Phase 1 — MVP:** Game Mode toggle, phone control, manual
    scoring, 6 flagship sports, scoreboard templates, celebration
    pack, single surface. Mostly assembly of existing parts.
  - **Phase 2 — Monetize:** sponsorship system + proof-of-play,
    Stream Deck support, remaining sports.
  - **Phase 3 — Multi-surface:** ribbon boards, pixel-map,
    per-surface cue fan-out.
  - **Phase 4 — Live data:** console tap-off, league feeds,
    streaming overlay.
  - **Phase 5 — God-tier:** auto-celebration, fan engagement,
    district ops, replay.

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

# 4. Clean up old worktrees so the new dispatch starts fresh.
git worktree prune
git worktree list  # should only show /Users/.../EDU CMS for master
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
```

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
    utility class.** NovaStar Taurus LED controllers — one of our
    production targets — ship Chromium 83 (June 2020). The CSS `inset`
    shorthand was added in Chrome 87. On Chromium 83, `inset: 0` is
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

**Last Updated:** 2026-05-16
