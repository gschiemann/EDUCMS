# PLATFORM-INFRA integration audit @ HEAD (`b9122ea0`) — 2026-08-03

> Census agent report, persisted verbatim. Read-only. Baseline: `docs/research/2026-08-03-deep-audit/` (`ffddbdc4`), 24 commits behind HEAD.

## 1. Integration table

| Integration | Status @ HEAD | Env gate | Degradation when unset | Evidence |
|---|---|---|---|---|
| **Supabase Postgres** | READY | `DATABASE_URL`/`DIRECT_URL` | none — hard dep | `integrations-health.controller.ts:220-224` |
| **Supabase Storage** | READY (primary transport) | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | `NOT_CONFIGURED` row; bug-screenshot upload silently skipped | `storage-transport.ts:157-206`; `health.controller.ts:221-248` |
| **Redis** | READY-if-set, degrade-clean | `REDIS_URL` (+ `REDIS_DISABLED`) | HTTP-polling realtime; in-memory TTL revocation cache; **7s boot hard-cap intact** | `redis.service.ts:87-104,139-164` |
| **GitHub — player OTA** | REAL, overhauled tonight | `GH_TOKEN`\|`GITHUB_TOKEN`, `PLAYER_APK_GITHUB_REPO`, `*_SHA_PINS` | fail-closed: no sha ⇒ no update advertised; `authed=false` diagnostic log | `player-ota.controller.ts:1188-1200,651-708`; `release-policy.ts:225-256` |
| **GitHub — bugs PR** | **wired but non-functional in prod** | `GITHUB_REPO` + `GH_TOKEN` | falls back to `manual:<id>` + copy-diff UX (honest) | `bugs.controller.ts:599-618,1177`; `Dockerfile:79-89` (no `gh`) |
| **Google Maps geocode** | READY-if-set, server-only | `GOOGLE_MAPS_API_KEY` | auto-fallback google→census→nominatim | `geocoding.service.ts:62,99,272-300` |
| **OSM Nominatim** | READY (keyless fallback) | none | n/a — is the fallback | `geocoding.service.ts:274,140-150` |
| **Pexels stock photos** | ABSENT in prod, degrades to null | `PEXELS_API_KEY` | `search()` returns `null`/`[]`, **never throws**; boards ride gradient; UI renders nothing | `stock-image.service.ts:64-66,106-114`; `StockPhotoSearch.tsx:56-101` |
| **Sentry — API** | **SDK initialized; DSN set in prod ⇒ LIVE** | `SENTRY_DSN` | warn + no-op | `sentry.ts:37-62`; `main.ts:8-9` (pre-import) |
| **Sentry — web/browser** | **SDK initialized, gated on a DIFFERENT key** | `NEXT_PUBLIC_SENTRY_DSN` | warn + no-op — **dark unless that key is also set** | `sentry.client.config.ts:3,26-27`; `instrumentation.ts:1-8`; `next.config.ts:210-224` |
| **Sentry — Kotlin player** | **absent** | — | no native crash capture | 2 methods |
| **Canva Connect** | stubs only, honest | `CANVA_CLIENT_ID`/`_SECRET` | `COMING_SOON` + export-to-PDF path; **no dead sign-in button** | `integrations-health.controller.ts:763-789` |
| **Weather (widgets)** | READY, keyless (Open-Meteo) | none | n/a | `WidgetRenderer.tsx:1092,1106`; `v2/WeatherWidgets.tsx:44` |
| **GrowthBook / flags** | real OpenFeature system; env-fallback is what actually runs | `GROWTHBOOK_*`; else `FF_<FLAG>` | warns once, falls back to `FF_*` | `feature-flags.service.ts:38-62,103-106` |
| **AI Anthropic (platform)** | ABSENT in prod | `ANTHROPIC_API_KEY` | 503 "AI is not configured" on ~14 spend paths | `ai.service.ts:592-596` + 12 more |
| **AI BYOK (Anthropic/OpenAI/Google)** | READY per-tenant | `Tenant.aiKeyEncrypted` | see §2 | `ai-key.controller.ts:76-92`; `ai.service.ts:541-596` |

## 2. Delta since baseline

**Closed since `ffddbdc4`:**
- **`d20ce9cf` — storage P2 ×2 CLOSED.** `SCREEN_TELEMETRY_ONLY_FIELDS` now contains `resolution/osInfo/browserInfo/userAgent/ipAddress` (`manifest-hot-cache.ts:296-300`) and the five `lastCrash*` (`:309-313`). Re-register waves and crash-loops no longer bust the fleet cache.
- **`d6b8acbb` — last silent Tier-1 spend path CLOSED.** Both vision entrypoints hard-stop with an audit row and `return null` (`ai-alt-text.service.ts:648-664`). Repo-wide `source:'platform'` = exactly 4 sites, all downstream of the unreadable-key gate. Residual platform read outside gate: `bug-analyzer.service.ts:314` (SUPER_ADMIN bug triage, not a tenant path).
- **`430afcc5`/`b9122ea0` — OTA overhaul VERIFIED ACCURATE.** Authenticated fetches (`githubApiHeaders` `:1188-1196`), Railway proxy from request origin (`:694`, `:948`, routes `:1041`, `:1105`), sha from proxy-cache bytes (`shaViaProxyCache` `:651`/`:921`), fail-closed with `check GH_TOKEN` log, env-driven pins, `provenance=` logging, dot-boundary host allowlist.

**Still open:** bug-screenshots bucket contradiction UNCHANGED (`bugs.controller.ts:1005` comment "private" vs `:1028` `public:true` vs `:1090` public URL).

**Bucket inventory:** `assets` public:true 500MB; `floor-plans` **private** 25MB (re-enforced each boot); `branding-logos` public:true; `bug-screenshots` public:true.

## 3. Ranked open findings

**F1 [P1] — Sentry API is live, but the BROWSER half rides a second env key prod may not set.** The deep audit's premise was wrong in the app's favour: the SDK **is** wired (`apps/api/src/sentry.ts:37-62` behind a pre-everything import at `main.ts:8-9`; `instrumentation.ts:1-8` + `withSentryConfig`). But `sentry.client.config.ts:3` reads **`NEXT_PUBLIC_SENTRY_DSN`** — a distinct key. If prod sets only `SENTRY_DSN`, every browser surface — operator console AND the `/player` renderer whose `PlayerErrorBoundary` calls `Sentry.captureException` (`player/page.tsx:2039-2041`) — is silently dark. Secondary: `sentry.edge.config.ts` has no `beforeSend` (only surface with no PII scrub); source-map upload disabled (`next.config.ts:213-216`) so arriving stacks are minified.

**F2 [P1] — bugs→GitHub PR integration cannot work in the prod container.** `bugs.controller.ts:1177` does `spawn('gh', …)`; the runner image installs no `github-cli` (`Dockerfile:79-89`; 2 methods). Effect: with envs set, every approval burns 15s, ENOENTs, records `manual:<id>`. User-visible degradation is honest (copy-diff UX) — ops/latency defect, not a lying UI. Neither `GH_TOKEN` nor `GITHUB_REPO` documented in `.env.example`.

**F3 [P1] — `FeatureFlagsService.isEnabled()` never consults GrowthBook, even when up.** `feature-flags.service.ts:64-74`: both branches `return this._envFallback(flag)`. Only `isEnabledAsync` reaches OpenFeature, with exactly 2 call sites (`sports.service.ts:816,4020`). Health grid claims "Per-tenant flag overrides are live" whenever GrowthBook envs are set (`integrations-health.controller.ts:308-310`) — true for those 2 sites, false for any future sync one. Real system; decorative sync wrapper.

**F4 [P2] — bug-screenshots intent vs shipped policy (carried).** Screenshots capture the admin dashboard (tenant names, emails, console/network), up to 2MB, unredacted, in a `public:true` bucket. UUID paths make URLs unguessable — same posture as `assets` — but nothing says that was the decision. Flip to private+signed, or fix the comment.

**F5 [P2] — no native crash reporting on the Kotlin player** (2 methods; `apps/player/README.md:193` states it's a follow-up). A crash killing the WebView host process is invisible.

**F6 [P3] — `SENTRY_DSN` in zero CI workflows**, so CI keeps printing "error tracking disabled" regardless of prod — the exact signal the baseline audit mistook for a prod verdict.

**Verified-clean (no finding):** Google Maps key never reaches the browser (**three** methods — no `NEXT_PUBLIC_*GOOGLE*` anywhere; all web occurrences are comments; the one key-bearing helper's sole caller passes no opts → keyless branch). Pexels degrades to null on every path and the UX promises nothing (`StockPhotoSearch` returns `null` when unconfigured, so the Photos section collapses). Canva honest in both branches, no sign-in control. Redis 7s hard cap intact (`redis.service.ts:139,159-163`). Storage transport/watchdog/`/health/storage` all intact. Weather = keyless Open-Meteo — but note it is an *unproxied third-party call from every kiosk*: an outage or firewalled district takes weather widgets down with no server-side cache.

## 4. UNVERIFIED

1. **Whether `NEXT_PUBLIC_SENTRY_DSN` is set in Vercel prod** — decides F1's severity entirely.
2. Whether prod sets `GITHUB_REPO` (only `GH_TOKEN` attested). If unset, F2 never fires.
3. Whether `PLAYER_APK_SHA_PINS`/`MANAGER_APK_SHA_PINS` are populated on Railway (unpinned still ships with honest `provenance=UNPINNED` logging).
4. Live bucket ACLs in the Supabase project (boot `updateBucket` should converge `floor-plans` private).
5. Whether `PLATFORM_ALERT_EMAILS` is set (watchdog falls back to SUPER_ADMIN sweep).
6. **`@sentry/nextjs` v10 auto-loading of `sentry.client.config.ts`** — v10.49.0 declared but `node_modules` not installed in this checkout; v9+ prefers `instrumentation-client.ts`, which does not exist here. **If v10 dropped the legacy path, browser Sentry is dead even WITH the public DSN set.**
7. GitHub-side authorization on the repo's releases (tag protection, `contents:write` holders).
