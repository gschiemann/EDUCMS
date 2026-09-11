# VenueOS — Current State

The committed description of what this repo actually is and actually ships.

Why this file exists: the working "current status" notes live under `docs/research/`,
which `.gitignore:93` excludes. A fresh clone therefore contains none of it, and a new
developer (or a new AI session) has no tracked, accurate picture of the system. Every
claim below was checked against code in this repo and carries a `file:line` so the next
reader can re-check it rather than trust it. Anything not verifiable from the repo is
marked **unverified**.

---

## 1. What VenueOS is

A multi-tenant CMS that runs the screens in a building — everyday digital signage plus
native life-safety alerting on the same displays. Tenants are hierarchical (a district
owns schools; `Tenant.parentId`, `packages/database/prisma/schema.prisma:14`), and an
emergency triggered at the district fans out to every descendant tenant.

Born in K-12; the data model and UI copy are vertical-aware, and separate API modules
exist for sports venues (`apps/api/src/sports/`), food service and retail via POS
(`apps/api/src/pos/`), and fitness (`apps/api/src/fitness/`). Screens are Android
displays, LED controllers, or any browser pointed at the player route.

---

## 2. Architecture as deployed

| Piece | What it is | Where |
|---|---|---|
| `apps/api` | NestJS 11 (`apps/api/package.json:33`) HTTP + WebSocket API. Every controller declares its own `api/v1/...` path — there is **no** `setGlobalPrefix`. | Railway |
| `apps/web` | Next.js 16 App Router (`apps/web/package.json:53`), React 19.2.4 (`:56`), Tailwind 4 (`:89`). Dashboard **and** the browser player (`apps/web/src/app/player/`). | Vercel |
| `apps/player` | Android kiosk app, Kotlin/Gradle. `versionCode = 10117`, `versionName = "1.1.17"` (`apps/player/app/build.gradle.kts:197-198`); latest tag is `player-v1.1.17`. | Sideloaded / OTA |
| `apps/edge` | Cloudflare Worker intended to front the API. It is in the pnpm workspace (`pnpm-workspace.yaml:2`) but has no `turbo.json` build wiring. Whether it is deployed is **unverified** from the repo. | — |
| `packages/api-types` | Shared request/response types + Zod schemas (`@cms/api-types`). | — |
| `packages/database` | Prisma schema + client. 76 models, 114 applied migrations. | — |
| `packages/scoreboard-cts` | Serial decoders for Colorado Time Systems and Daktronics All Sport consoles. | — |
| `packages/signage-design` | The AI signage design engine — archetypes, type scale, contrast rules. | — |

The API image builds from `Dockerfile`; all three stages use `node:22-alpine` pinned by
digest (`Dockerfile:92,98,171,220`).

**Postgres** is Supabase, reached through Supavisor in **session mode (port 5432)** — not
transaction pooling. Prisma's pgbouncer/transaction-pooling path costs several extra
network round trips per logical read, which is why session mode is the configured shape;
the API refuses to boot if `pgbouncer=true` is set without `connection_limit>=10` and
`pool_timeout>=20` (`apps/api/src/main.ts:312-325`). Session mode holds a real Postgres
connection per pool slot, so `connection_limit` must stay low — check
`SELECT current_setting('max_connections')` before raising it.

**Redis** carries pub/sub fan-out, express sessions, rate-limit storage and leader leases
for background workers. It is **optional**: a missing `REDIS_URL` logs a warning and the
API runs on the HTTP-polling realtime fallback rather than crashing
(`apps/api/src/realtime/redis.service.ts:101-105`).

**Object storage** is Supabase Storage (`apps/api/src/storage/supabase-storage.service.ts:64-91`).

`packages/auth-core` and `packages/ws-events` **do not exist** in this repo. They are
still named in `railway.json:11-12` and in `CLAUDE.md`; both references are stale.

Boot-time hard stops in production: `ALLOWED_ORIGINS` must be set
(`apps/api/src/main.ts:295-297`), and `JWT_SECRET`, `SESSION_SECRET`, `DEVICE_SECRET_KEY`,
`DEVICE_JWT_SECRET` must all be present (`apps/api/src/security/required-secret.ts:56-59`).

---

## 3. What actually ships

### Emergency alerting
`POST /api/v1/emergency/trigger` (`apps/api/src/emergency/emergency.controller.ts:441`)
and `POST /api/v1/emergency/:overrideId/all-clear` (`:920`), plus SOS (`:1159`), text
broadcast (`:1271`) and media alert (`:1418`). The controller sits behind
`JwtAuthGuard + RbacGuard` (`:55`); trigger requires SUPER_ADMIN / DISTRICT_ADMIN /
SCHOOL_ADMIN (`:443`). `@AllowPanicBypass()` lets a non-admin holding
`User.canTriggerPanic` fire it — deliberately, for wall stations and front-desk staff —
but RESTRICTED_VIEWER can never trigger, flag or not
(`apps/api/src/auth/rbac.guard.ts:69-75`).

Redis fan-out **starts before** the database write on the tenant path
(`emergency.controller.ts:497-504`), so a slow pool cannot delay the alert. A screen that
misses the push still gets the alert from its authenticated manifest, which resolves
per-screen override first, then the tenant's own `emergencyStatus`, then an ancestor
tenant's (`apps/api/src/screens/screens.controller.ts:4920-4922,4974-4986`) — the
manifest, not the push, is the arbiter of the overlay.

`audit_logs` is append-only at the storage layer: a Postgres trigger raises on UPDATE and
DELETE, with a single carve-out for the FK user-id anonymisation
(`packages/database/prisma/migrations/20260531000000_audit_logs_immutable/migration.sql:30,49,56`).

### Signage, playlists, schedules
Assets (with an approval status), asset folders, playlists, playlist items, schedules and
screen groups are first-class models. Schedule resolution is deterministic — screen-pin
beats group, then priority, then newest start time, then stable id
(`apps/api/src/screens/effective-schedule.ts`). Screens poll
`GET /api/v1/screens/:id/manifest` (`apps/api/src/screens/screens.controller.ts:4789`),
served from a per-screen in-process cache invalidated by Prisma mutation hooks and
schedule-window boundaries (`apps/api/src/screens/manifest-hot-cache.ts`). Emergency
branches return before that cache and are never cached.

### Player and APK fleet
Pairing at `POST /api/v1/devices/pair` (`apps/api/src/devices/devices.controller.ts:24`).
The web player keeps its credential lifecycle, manifest gate, offline cache, back-trap,
poster-canvas sizing and frame-locked multi-screen sync as separate pure modules under
`apps/web/src/app/player/`. Two service workers ship (`apps/web/public/sw.js`,
`sw-player.js`). USB sneakernet export exists (`apps/api/src/usb-export/`).

OTA: the GitHub Release for a `player-v*` tag is the source of truth for the version
catalogue and the digest (`apps/api/src/player-ota/player-ota.controller.ts:8-26`).
Supabase object storage holds delivery copies in a **private** bucket served by 1-hour
signed URLs, and its sidecar hash is only ever cross-checked against the API's own digest,
so a compromised bucket cannot get different bytes installed
(`apps/api/src/player-ota/apk-storage.ts:56`).

### Templates — three distinct editing architectures
Do not confuse them; they share nothing but the word "template".

1. **React-zone presets.** Zones rendered by `WidgetRenderer`, edited field-by-field in
   the properties panel. `apps/api/src/templates/system-presets.ts` defines 317 entries in
   `RAW_SYSTEM_PRESETS` plus 37 in `MODERN_SCHOOL_PRESETS`; the export filters out any
   preset still using a retired widget type, so the shipped count is ≤354
   (`system-presets.ts:3337-3352`). `CLAUDE.md`'s "17 system presets" is stale.
2. **EXTERNAL_HTML boards.** Self-contained HTML documents under
   `apps/web/public/templates/{hs,school,signage,kiosk,fitness}/` — 250 files today —
   each loaded in a **null-origin sandboxed iframe** (`sandbox="allow-scripts"`, no
   `allow-same-origin`; `apps/web/src/components/widgets/WidgetRenderer.tsx:3979,4220`,
   dispatched at `:950`). React cannot reach into that iframe, so both editing directions
   go through a shim baked into each file by `apps/web/scripts/inject-shim-v2.cjs`
   (apply + click-to-edit) or `apps/web/scripts/inject-click-shim.cjs` (click-only, for
   menu boards whose hand-written `applyMenu()` must not be clobbered). Kiosk boards load
   the external `apps/web/public/templates/kiosk/_edit-shim.js` instead. Editing a board
   without re-running its injector leaves it on an older apply-only shim and silently
   un-editable by click.
3. **Holiday boards.** 59 HTML files under `apps/web/public/holiday-templates/` (58 boards
   plus `_overhaul-gallery.html`, an index), on a separate
   `holiday:*` postMessage bridge whose editable fields are sourced **live** from the
   board rather than from a static schema
   (`apps/web/src/components/widgets/HolidayWidget.tsx:119-142`).

### Sports
Game schedule, clock advance, console token auth, board ETags, sponsors and sponsor
impressions, per-sport stats, swim timing feed (`apps/api/src/sports/`). Console serial
decoding lives in `packages/scoreboard-cts`. Proof-of-play sampling, hourly rollup and
retention are in `apps/api/src/analytics/proof-of-play*.ts`.

### POS / menu boards
Provider connectors for Square, Clover, Lightspeed and Shopify
(`apps/api/src/pos/providers/`), an OAuth controller, a sync cron, a webhook path, and a
menu admin service that feeds the menu boards.

### Billing
Stripe Checkout / Customer Portal / invoices plus a signature-verified webhook
(`apps/api/src/billing/`). Everything keys off `STRIPE_SECRET_KEY`: with it unset,
`StripeService.enabled()` is false and every endpoint degrades gracefully rather than
erroring (`apps/api/src/billing/stripe.service.ts:112`, header at `:1-19`). Card entry
happens only on Stripe-hosted pages. Prices come from `STRIPE_PRICE_MONTHLY` /
`STRIPE_PRICE_ANNUAL` Price ids — the amounts written in `stripe.service.ts:16-17` and in
`CLAUDE.md` disagree with each other, so trust neither and read the Stripe dashboard.

### AI
Three providers (Anthropic / OpenAI / Google) with per-tenant BYOK keys stored encrypted.
Key resolution is the whole policy: if a tenant has **any** BYOK key configured, the
platform key is never spent on their behalf — an unreadable key raises
`AI_KEY_UNREADABLE` instead of silently falling through
(`apps/api/src/ai/ai.service.ts:603-670`). The platform `ANTHROPIC_API_KEY` is used only
when no BYOK key was ever configured (`:653-657`). Surfaces include the signage design
engine, alt-text generation, a guided intake concierge, and a fact-guard.

---

## 4. Security posture — implemented vs enabled

**Emergency message signatures are verified SERVER-side, at the Redis fan-out gate.**
Every `pmessage` runs through `verifyWsHmac` before it can reach the WebSocket gateway or
the SSE fallback; a failure is dropped and logged
(`apps/api/src/realtime/redis.service.ts:261-268`; implementation at
`apps/api/src/security/ws-signature.ts:112`). **The player deliberately does not verify
the HMAC** — the secret stays on the server. Its client gate checks three other things on
every sensitive push, on both WS and SSE: signature *presence* (absence proves the message
never passed the signer), freshness against a server-corrected clock, and per-eventId
replay in an LRU shared across transports
(`apps/web/src/app/player/pushGate.ts:96-115`). That split is the design, not a gap.

**MFA.** TOTP with encrypted secrets, backup codes, partial challenge tokens, rate
limiting and a forced-enrollment path are all implemented (`apps/api/src/auth/mfa*.ts`,
`totp.ts`). It is being made **mandatory for privileged roles** — SUPER_ADMIN,
DISTRICT_ADMIN, SCHOOL_ADMIN (`apps/api/src/auth/mfa-policy.ts:66-70`), plus anyone
holding `canTriggerPanic` regardless of role (`:206,210`). The requirement is *derived from the live user
row at every session mint*, not backfilled into a column, so a later promotion cannot
escape it. It is advisory until a dated constant in that file and blocking after;
`MFA_REQUIRED_ENFORCE_AFTER` only moves that date. `evaluateMfaPolicy` must stay the only
place that decides — the enforcement points must agree, or a privileged user is refused
both a session *and* the enrolment escape hatch, which is a bricked account rather than a
control. There are SIX enforcing consumers plus one audit-only reader: `AuthService.login`,
`AuthService.refreshSession`, `SessionController.refresh` (the SEC-010 cookie path),
`MfaController.assertEnrollmentRequired` (the enrol-without-a-session escape hatch, which
refuses in the OPPOSITE direction from the rest), `TenantsController.switchTenant` and
`MfaController.disable`; `AuthController.login` reads it for the audit row only. (The
`mfa-policy.ts` header said "three" while there were five until 2026-09-11; it is current
now — keep it that way.)

**Per-tenant MFA enforcement (2026-09-11).** `Tenant.mfaEnforced` is a nullable tri-state
resolved by `effectiveMfaEnforced()` in `@cms/api-types` — the SAME function the dashboard
toggle reads, so server and UI cannot disagree. NULL means "never stated" and resolves to
OPTIONAL, which is the new-customer default (Greg: *"i want people to have the options but
for my riot accounts, leave it turned on… so just new customers."*). Every tenant that
existed when the column shipped was backfilled to `true` by
`20260911120000_tenant_mfa_enforced`, so nothing that had MFA lost it. The flag gates the
DERIVED half only: the per-user `mfaRequired` override is unconditional in every tenant,
and an ALREADY-ENROLLED user is still challenged for their code even where enforcement is
off. Inside the API the column is read ONLY through `tenantMfaEnforced()`
(`auth/tenant-mfa-enforcement.ts`), which FAILS CLOSED on a missing row or a `select` that
never loaded it — the fail-open class the 2026-09-11 recon ranked first. The write is
`PUT /tenants/me/mfa-enforced`, SUPER_ADMIN / DISTRICT_ADMIN only (deliberately narrower
than `me/emergency-enabled`: a SCHOOL_ADMIN is governed by the policy and must not repeal
it), audited as `TENANT_MFA_POLICY_CHANGED` inside the same transaction.

**SSO.** OIDC is real: `openid-client` issuer discovery and authorization-code exchange
(`apps/api/src/sso/sso.service.ts:537,559`). SAML is **deliberately not functional** —
`passport-saml` is intentionally not installed because its 3.x line carries an unpatched
signature-wrapping CVE with no fixed 3.x release, so every `require('passport-saml')`
falls through to a stub (`sso.service.ts:19-24`). On top of that, arming SAML requires
SUPER_ADMIN (`:297-309`) and the unauthenticated callback is hard-gated on an *enabled*
SAML config (`:490`). A district admin may store SAML settings but cannot turn them on.

**Clever.** Implemented — OAuth state with HMAC, encrypted credentials, sync cron,
controller (`apps/api/src/integrations/clever/`). **Dormant**: it reports unconfigured
unless `CLEVER_CLIENT_ID` and `CLEVER_CLIENT_SECRET` are both set
(`clever.service.ts:97`). The repo carries unit tests only and no record of a run against
Clever's own sandbox or a live district, so treat it as **never validated end-to-end
against Clever**.

**Other controls in place.** CSRF enforced by default, warn-mode only when explicitly
switched off (`apps/api/src/security/csrf.middleware.ts:271`); client-IP resolution
counted from the right of `X-Forwarded-For` so a client cannot rotate its own throttle key
(`apps/api/src/security/client-ip.ts`); Redis-backed throttler storage and Redis sessions;
a tenant-isolation static gate over Prisma calls
(`apps/api/tools/check-tenant-isolation.cjs`, with a ratcheting baseline in
`tenant-isolation-baseline.json`).

**Enabled vs merely implemented is an environment question.** Many subsystems are inert
until their variable is set — Stripe, Clever, Pexels stock images, the platform AI key,
`SPORTS_BEACON_SECRET` (without it no beacon can be graded verified), `PROXY_RENDER_SECRET`,
`GATEWAY_SHARED_SECRET`, `SESSION_BFF_SECRET`. To see which are live on a given deploy,
list the service's variable **names** (`railway variables`, or the Railway dashboard) and
compare against `CLAUDE.md`'s env table. Do not infer it from the code.

---

## 5. Known limitations and open risks

- **Nothing mechanically gates a deploy.** The repo is private on a GitHub Free plan, so
  branch protection and rulesets are unavailable: both
  `GET /repos/gschiemann/EDUCMS/rulesets` and `.../branches/master/protection` return
  **403 "Upgrade to GitHub Pro or make this repository public"** (verified against the
  live API). There are no required status checks and no protected branch. CI can be red
  and a push still lands on master.
- **Railway deploys on git push, not on CI success.** No workflow under
  `.github/workflows/` runs a deploy — verified by grepping all 20 workflows for
  `railway up` / `railway redeploy` / `vercel deploy` / `vercel --prod` (zero hits). Both
  platforms build from their own GitHub integration, and the Railway service source is
  configured with `checkSuites: false`, i.e. it does not wait for check suites. Vercel
  skips a build only when nothing the web build consumes changed
  (`apps/web/scripts/vercel-ignore-build.sh`) — a cost filter, not a quality gate.
- **The Railway service config and `railway.json` disagree.** `railway.json:5,24` declare
  `builder: DOCKERFILE` and `startCommand: ./scripts/railway-start.sh`; the service's own
  stored config says builder `RAILPACK` with `buildCommand: pnpm --filter api build`.
  Which one wins is decided by Railway's config-as-code precedence, not by this repo —
  verify before assuming, and note that deleting or renaming `railway.json` would silently
  change how production builds.
- **Every hardware class is UNQUALIFIED.** Six REQUIRED display classes are declared
  (Goodview t982 Android 11 and 13, MAXHUB L55VEC, Rockchip rk3288 Android 7, NovaStar
  Taurus rk356x, Goodview LCD Android 9 — `apps/player/HARDWARE-QUALIFICATION.md:61-66`)
  and every cell of every check reads `UNQUALIFIED` (`:80-85`, and again for the manager
  at `:94-99`). The matrix only carries sections for **player 1.1.12** and **manager
  1.0.24** (`:72,88`), while the shipping player is 1.1.17 — so there is no qualification
  record at all for the current build. Green CI is a unit-test claim about 264 API spec
  files and 24 web e2e specs; it has never been a fleet claim. Headless Chromium does not
  reproduce OEM certificate stores, OEM DNS, memory pressure, or broken WebView providers.
- **Single API replica.** `railway.json:29` sets `numReplicas: 1`. Leader leases exist for
  background workers so scaling out is possible, but it is not the shipped shape.
- **Prisma is on 5.x** (`packages/database/package.json:15`). On this version
  `sslmode=verify-full` / `sslrootcert` in `DATABASE_URL` are silently ignored — strict DB
  TLS has to be expressed as `sslaccept=strict` + `sslcert`. (Established by an earlier
  negative-control test against the live database, not re-verified in this repo; do not
  assume a `verify-full` in a connection string is doing anything until you prove it.)
- **`CLAUDE.md` has stale sections.** Verified drift: it calls the repo public (it is
  private), names `packages/auth-core` and `packages/ws-events` (neither exists), says the
  Railway healthcheck uses `/health` (it uses `/health/started`), and says 17 system
  presets (there are ≤354). Prefer this file, then the code.
- **Chromium 83 is a real target.** NovaStar Taurus LED controllers ship Chromium 83–87,
  where the CSS `inset` shorthand does not parse. Player and widget paths must use the four
  physical longhand sides; the `taurus-safety` workflow and
  `apps/web/tools/check-inset-serialization.cjs` guard it. This constraint applies only to
  player/widget code — never dumb down the dashboard for it.

---

## 6. How to verify the app is healthy right now

All health routes live under `/api/v1/health`
(`apps/api/src/health/health.controller.ts:26`).

```bash
# Liveness. Always 200 once the process has bound its port, even if DB/Redis are degraded.
curl -s https://<api-host>/api/v1/health

# What Railway actually gates deploys on (railway.json:26). A one-way latch, not a check:
# 503 until the DB has served a real query and Redis has settled, then 200 permanently —
# and it opens anyway on a 45s ceiling so a dead DB cannot block the deploy forever
# (apps/api/src/health/boot-readiness.service.ts:22-58,110).
curl -s -o /dev/null -w '%{http_code}\n' https://<api-host>/api/v1/health/started

# Readiness — 503 when Postgres is unreachable. Use for monitoring, never for the
# Railway healthcheck.
curl -s https://<api-host>/api/v1/health/ready

# Deep probe of the DB + WebSocket-signer chain a lockdown trigger needs. Run before a drill.
curl -s https://<api-host>/api/v1/health/emergency-path
```

`/health` returning 200 proves only that the container is up — it deliberately carries no
DB check, so it must never be used as a readiness signal. If the dashboard is broken while
`/health` is green, check `/health/ready` and `/health/emergency-path` next; those are the
ones that touch Postgres and the signer (`health.controller.ts:70,134,152,177`). A
`502 Application failed to respond` means the container itself is down, not a downstream
service.
