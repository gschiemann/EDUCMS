# Efficiency Audit — DB / API / AI / Storage (2026-07-01)

Mandate (Greg, Day-1 evening): *"audit API/DB efficiency — no waste anywhere."*
Read-only. Method: 3 parallel Explore sub-agents (DB sweep, API/realtime sweep,
AI+storage sweep) + direct lead verification of every claim against the actual
file:line before inclusion — two sub-agent claims were **wrong and are
corrected/removed below** (see "Corrections to sub-agent claims"). Findings
are grounded in code read on `e6f886e0` (master, 2026-07-01), cross-checked
against `docs/research/2026-06-15-platform-metrics-audit/` (the last
efficiency pass) so fixed items aren't re-flagged.

Assumptions used everywhere fleet math appears (state explicitly per CLAUDE.md
memory: ~150 screens is the realistic pilot fleet size; `numReplicas: 1` today
per `railway.json`). Where I could not compute a real number, I say so instead
of inventing one.

---

## TOP-12 RANKED WASTE — real numbers, file:line, fix sketch

### 1. No gzip/brotli compression on the NestJS API (P1, effort S, risk LOW)
**File:** `apps/api/src/main.ts` — bootstrap registers `helmet`, `express.json()`,
CORS, sessions; **no `compression()` middleware anywhere** (verified: no
`require('compression')` / `app.use(compression(...))` in the file, and
`"compression"` is not a dependency in `apps/api/package.json`).
**Magnitude:** every JSON response — board polls, manifest polls, template
list, dashboard queries — goes over the wire uncompressed. gzip typically
gets 3-6x on JSON. Using the board-poll math below (~2,140-96,000 req/day
depending on concurrent open boards, ~5-15KB/response), that's a genuine
multi-hundred-MB/day-to-low-GB/day egress difference at even modest
concurrency, i.e. real Railway/Vercel egress $ before the fleet is large.
**Fix:** `pnpm --filter api add compression` + `app.use(compression({ threshold: 1024 }))`
in `main.ts`, placed after helmet, before routes. Skip compressing
already-compressed asset bytes (images/video go through Supabase/CDN, not
this API, so no double-compression risk).
**Risk of fixing during launch week:** LOW — compression middleware is
extremely well-trodden, no behavior change to response bodies, easy to
verify with one curl `Accept-Encoding: gzip` check. Good Day-2/3 fix.

### 2. `/sports/board/:id` client pollers never send `If-None-Match` — the server's 304 path is dead code in practice (P1, effort S/M, risk LOW)
**Files:**
- Server has NO ETag support at all on this endpoint:
  `apps/api/src/sports/sports-board.controller.ts:41-43` (`board()` → `sports.getBoard(id)`)
  → `apps/api/src/sports/sports.service.ts:447-456` (`getBoard`, 1s in-memory
  cache, no crypto hash, no ETag header, no 304 branch).
- Contrast with the **screens manifest** endpoint, which DOES have real
  ETag/304 support: `apps/api/src/screens/screens.controller.ts:3257-3260`
  (`versionHash` computed, `res.setHeader('ETag', ...)`, `if (activeDeviceHash === versionHash) return res.status(304)`)
  and a second copy for the board-surface manifest branch at lines 2978-2985.
  `activeDeviceHash` is read from `req.headers['if-none-match']` at line 2480.
- **But no client ever sends that header.** Verified zero hits for
  `If-None-Match` anywhere under `apps/web/src` (`grep -rn "If-None-Match" apps/web/src`
  → empty). The player's `fetchContent()` (`apps/web/src/app/player/page.tsx:3009`)
  fetches the manifest with `cache: 'no-store'` and no conditional header, so
  the 304 branch server-side code has literally never fired in production.
**Magnitude:** every manifest/board poll pays full JSON re-serialize +
transfer even when nothing changed, which for a live game is most polls
(scores/clock change maybe once every few seconds; the poll runs every 750ms
= ~4,800/day/board). Can't state a precise $ number without traffic logs, but
the fix is "already built, just not wired up" — close to free ROI.
**Fix:** (a) Player: cache the last-seen manifest ETag per screen, send
`If-None-Match` on the next fetch, treat 304 as "no state change, skip
apply". (b) Board/ribbon/scorebug: add the same ETag+304 pattern to
`getBoardFresh()` (the endpoint currently has none), then have the 5 client
polling implementations (see #4) send `If-None-Match` too.
**Risk of fixing during launch week:** LOW for the player manifest side
(server code already exists and is exercised by tests presumably covering
the 304 path already — just wire the client). MEDIUM for the board/ribbon
side since it touches the hot live-game path in the middle of launch week —
recommend doing the player-manifest half now, deferring the board/ribbon
half to right after launch (see "do NOT fix now").

### 3. `ClockAdvanceService` — unconditional 1Hz `Game.findMany` on every replica, forever, even with zero live games (P1, effort S, risk LOW)
**File:** `apps/api/src/sports/clock-advance.service.ts:22-63`.
`onModuleInit` starts `setInterval(() => void this.tick(), 1000)` unconditionally
(no early-return when there are no LIVE games) and `tick()` calls
`this.sports.autoAdvanceExpiredClocks()` →
`apps/api/src/sports/sports.service.ts:2571-2573`:
```ts
const games = await this.prisma.client.game.findMany({
  where: { status: 'LIVE', clockRunning: true },
});
```
No `select` (full-row fetch of every column including `stats`/`spotlight` JSON
blobs) and **no supporting index** — `Game`'s indexes are
`@@index([tenantId, status])`, `[scoreboardTemplateId]`, `[ribbonTemplateId]`,
`[scorebugTemplateId]`, `[homeTeamId]`, `[awayTeamId]`
(`packages/database/prisma/schema.prisma` — no `[status, clockRunning]`
composite). This query has zero `tenantId` predicate, so it can't even use
the `(tenantId, status)` index as a leading match — it's a straight
`status='LIVE'` scan.
**Magnitude:** exactly 86,400 queries/day, every day, forever, per replica
— even at 2am with zero games in progress. This is the SAME bug pattern the
platform already fixed twice for screen pings/cache-status/render-proof
(debounce when idle) but this one was missed. **This is already documented
as a known issue by a previous engineer** — `railway.json`'s
`healthcheckTimeout` comment (`"//healthcheckTimeout"`) explicitly says: *"a
1Hz Game.findMany background poller adding pool contention... Follow-up: the
1Hz Game.findMany poller is an efficiency + boot-contention bug worth fixing
so 60s is safe again."* This audit independently re-confirms it from the
code, not just the comment.
**Fix:** (a) add `@@index([status, clockRunning])` to `Game` (additive
migration, safe). (b) Short-circuit: keep an in-process boolean/count of
"any LIVE+running game" set by the game-state mutation paths (score/clock
update, game-start, game-end) so the poller can skip the query entirely
when it's already 0 — or simplest: only run the `setInterval` while at least
one game is LIVE (start it on game-start, stop it when the last LIVE game
ends), falling back to a slow "any live games?" check every 30s when idle.
(c) add `select` to only pull the columns `autoAdvanceExpiredClocks` reads.
**Risk of fixing during launch week:** LOW — the fix doesn't change gameplay
behavior (advance-on-expiry timing unchanged), just skips work when idle.
Index addition is a pure-win additive migration.

### 4. FIVE separate client implementations of the same 750ms `/sports/board/:id` poll, no dedup, no delta application (P2, effort M, risk MEDIUM if touched this week)
**Files (all independently `fetch` the same endpoint on the same 750ms cadence):**
- `apps/web/src/app/board/[gameId]/page.tsx:209` (`POLL_MS = 750`)
- `apps/web/src/app/ribbon/[gameId]/page.tsx:248` (`POLL_MS = 750`)
- `apps/web/src/components/sports/ScorebugSurface.tsx:188` (`POLL_MS = 750`)
- `apps/web/src/components/widgets/sports/GameStateContext.tsx:70,97-116` (`POLL_MS = 750`, recursive `setTimeout`)
- `apps/web/src/components/widgets/v2/SportsScoreboardWidgets.tsx:279` (`setInterval(load, 750)`)
- (plus `ConsoleScoreboardCelebration.tsx:105` also polling at 750ms for the operator console)
Each does its own `fetch` + `applyCtsOverlay` + full JSON parse + full
component re-render — there is no shared subscription/cache across these
call sites even when the SAME game is being viewed by the SAME browser tab
in two different widget instances (e.g., a custom EXTERNAL_HTML template
with both a scoreboard AND a ribbon widget on one screen would double-fetch
the identical payload every 750ms).
**Magnitude:** per board, 4,800 req/day (86,400s / 0.75s). If N boards are
concurrently open (operators + LED displays + OBS overlays for the same
game), it's N×4,800/day. This is architecturally sound for a single viewer
(server-side `boardCache` in `sports.service.ts:433-434` already caps DB
load to 1 query/second regardless of viewer count — see verified-efficient
list below) — the waste is specifically the **duplicate client-side fetch
+ parse + re-render** when multiple widgets on ONE page independently poll,
and the **lack of ETag** (see #2) meaning the payload is always fully
re-shipped.
**Fix:** Consolidate the 5 polling implementations behind the existing
`GameStateContext` provider (already built, already used by template-driven
widgets) so `/board`, `/ribbon`, `/scorebug` pages and `SportsScoreboardWidgets`
all subscribe to one poll per page instead of one per widget instance.
**Risk of fixing during launch week:** MEDIUM — this touches the actively-used
live-game rendering path across 5 files in the middle of launch week; a
regression here breaks a customer's live scoreboard on-air. **Recommend
deferring to post-launch** (see "do NOT fix now") — the current pattern
works correctly today, this is a cleanliness/efficiency improvement, not a
correctness bug.

### 5. In-memory `boardCache`/`tenantStateCache`/ping-debounce maps are per-replica (P3 today, P1 the day `numReplicas` > 1)
**Files:** `apps/api/src/sports/sports.service.ts:433-434` (`boardCache`, 1s
TTL); `apps/api/src/screens/manifest-hot-cache.ts:33-118` (`tenantStateCache`
2s TTL, `lastPingWrites`/`cacheReportWrites`/`renderProofWrites` 25s/120s/40s
debounce maps) — all plain in-process `Map`s, explicitly documented as
intentional in the header comment (*"Not a Redis cache on purpose... If we
horizontally scale the API beyond 2-3 pods the per-pod cache divergence is
still bounded by TTL"*).
**Magnitude:** today `railway.json` sets `numReplicas: 1` (verified), so this
is currently a non-issue — one process, one cache, no divergence. The day the
API scales to 2+ replicas, cache hit rate for these maps drops roughly
proportionally to replica count (a 2-replica fleet round-robining requests
sees ~50% of "should be a cache hit" polls land on the replica that doesn't
have it, forcing a real DB hit within the TTL window) — bounded and safe
per the code comment, but worth flagging now since it's exactly the kind of
thing that becomes a silent regression the day someone bumps `numReplicas`
for the launch-week load bump.
**Fix:** no code change needed pre-launch. Add a one-line CI/config guard or
comment-linked checklist item: "if numReplicas > 1, move these to Redis
first" (Redis is already in the stack for pub/sub, so this is a known,
bounded future task, not new infrastructure).
**Risk of fixing now:** N/A — correctly deferred already by the original
author's comment. Listed here only so launch-week doesn't accidentally bump
`numReplicas` without remembering this.

### 6. `AuditLog` write on device-noise-adjacent hot paths — verify volume, not yet proven wasteful (P3, needs live pg_stat_statements to confirm, effort S)
**Context:** `apps/api/src/audit/audit.controller.ts` already excludes
`DEVICE_NOISE` action types from the /audit LIST query (`action: { notIn:
DEVICE_NOISE }`), which implies the platform is AWARE some AuditLog actions
are noisy device-originated writes (e.g., pairing/heartbeat-adjacent). I did
not find (in the time available) the exact write call sites that populate
`DEVICE_NOISE`-classified rows to compute a real volume number — flagging
as a "needs a live pg_stat_statements check" item rather than a confirmed
finding, per this audit's honesty requirement. The June-15 platform audit's
59%-of-DB-time telemetry-write finding was the same shape of bug and IS
already fixed (`shouldSkipLastPingWrite` et al., verified below) — this is
a "check there isn't a second one" flag, not a proven waste.
**Fix:** run `SELECT action, count(*) FROM audit_logs WHERE created_at > now() - interval '1 day' GROUP BY action ORDER BY 2 DESC LIMIT 20` against prod
Postgres to see if any device-noise action dominates row volume. If one
does, apply the same debounce pattern already proven at
`manifest-hot-cache.ts`.
**Risk:** N/A until measured.

### 7. Ribbon metadata on `/sports/board` fetched as 5 separate sequential-shaped queries instead of 1 batched `findMany` (P3, effort S, risk LOW)
**File:** `apps/api/src/sports/sports.service.ts` — inside `getBoardFresh()`'s
`Promise.all` (lines 506-561), `latestRibbonMessages`, `latestRibbonPresets`,
`latestRibbonSpeed`, `latestRibbonSlides`, `latestRibbonScoreRepeat` are each
their own `gameEvent.findFirst({ where: { gameId, type: '<ONE_TYPE>' } })`
call (5 separate queries, all correctly inside the `Promise.all` so they're
parallel, not sequential — this is NOT an N+1 across viewers, just 5
round-trips instead of 1 per board-cache-miss).
**Magnitude:** bounded by the same 1-second `boardCache` TTL that already
caps this whole function to ≤1 execution/second per game regardless of
viewer count — so worst case this is 5 extra tiny indexed `findFirst` calls
per second per LIVE game, not per poll. With realistically <10 concurrent
live games fleet-wide, this is 40-50 extra tiny queries/sec at absolute peak
— measurable but not a real bottleneck at pilot scale.
**Fix:** collapse into one `gameEvent.findMany({ where: { gameId, type: { in: [...5 types] } }, orderBy: { createdAt: 'desc' } })` and pick each type's latest row
in-memory. Nice cleanup, not urgent.
**Risk of fixing now:** LOW but touches the live board response shape —
same "defer past launch, low-value/moderate-risk-for-the-week" call as #4.

### 8. Templates LIST endpoint ships every zone's full `defaultConfig` for every template, every gallery load (P3, partially mitigated, effort S, risk LOW)
**File:** `apps/api/src/templates/templates.controller.ts:420-457`. The list
endpoint already did a real, well-documented perf pass (2026-05-09 comment,
lines 401-419) dropping `brandKit`, legacy `thumbnail`, `isTouchEnabled`,
`TemplateZone.touchAction`/`name`, and joins — cutting a 1-3MB/17-22s
response down significantly, plus `@Header('Cache-Control', 'private,
max-age=30, stale-while-revalidate=120')` (line 334). **Still included per
zone:** `defaultConfig` (line 451) — for ordinary widget zones this is a
small config object, but for `EXTERNAL_HTML` zones `defaultConfig` is `{ url:
'/templates/hs/varsity.html' }` (verified: EXTERNAL_HTML presets store only a
static-file URL, e.g. `apps/api/src/templates/system-presets.ts:465` —
**not** inline HTML), so this specific over-fetch fear (shipping full board
HTML on every list load) **does not materialize** — the gallery's
`ScaledTemplateThumbnail` needs `defaultConfig` to render the real widget
tree at scale per the comment, so this is deliberate, not accidental.
**One real residual gap:** AI-Designer boards (`createFromCandidate`) carry
their HTML **inline** as `cfg.html` (srcdoc), per
`apps/web/src/components/template-builder/PropertiesPanel.tsx:6782,6988`
("AI Designer boards carry their HTML INLINE (cfg.html, srcdoc)"). If an
AI-Designer board's zone `defaultConfig` is included in the templates LIST
response the same way EXTERNAL_HTML's is, that zone's `defaultConfig` could
be tens of KB of raw HTML shipped on every gallery load for every kept
AI-Designer board. **I could not confirm from static reading alone whether
`TemplateZone.defaultConfig` for an AI-Designer zone actually stores the
full `cfg.html` string** (vs. storing a reference and hydrating separately)
— this needs one direct query against a tenant with a kept AI-Designer board
to confirm size, or a grep for where `createFromCandidate` persists
`defaultConfig`.
**Fix (if confirmed):** exclude/truncate `defaultConfig.html` specifically
for `widgetType === 'EXTERNAL_HTML'` zones whose `defaultConfig` size exceeds
a threshold in the LIST select (keep it in the detail/get-one endpoint,
which already fetches everything).
**Effort:** S once confirmed. **Risk:** LOW (read-path only).

### 9. No pagination on `/templates` LIST or `/playlists` LIST (P3, effort S, risk LOW)
**Files:** `apps/api/src/templates/templates.controller.ts:420` (`findMany`,
no `take`/`skip`); `apps/api/src/playlists/playlists.controller.ts:63-83`
(`findMany`, no `take`/`skip`). Both already have `select`-scoped queries
(see #8, and playlists uses a light `template: { select: {...} }`, not full
zones — corrected from an earlier mis-citation, see Corrections section).
**Magnitude:** unmeasured — fine at pilot scale (tens of templates/playlists
per tenant), becomes a real cost only once a tenant accumulates hundreds of
templates. Not urgent for a 5-day launch sprint with the current customer
count.
**Fix:** add `take`/`skip` query params, default page size ~100 (larger than
any realistic current tenant so it's a no-op today, just future-proofing).
**Risk:** LOW, but genuinely not worth spending launch-week time on — see
"do NOT fix now."

### 10. `sports/board/:id/athletes/:token` and the feed endpoint use a per-instance in-memory sliding-window rate limiter (`feedHits: Map`) — same per-replica caveat as #5 (P3)
**File:** `apps/api/src/sports/sports-board.controller.ts:33-40`. Documented
as intentional (*"leaves headroom while stopping a flood from a leaked
token"*), bounded by the same single-replica reality as #5. No action needed
now; same "don't bump numReplicas without addressing this" flag as #5.

### 11. `EfficiencyAlertingService`, `ScreenWedgeDetector`, `PosSyncCron`, `WebhookRetryWorker`, `CanaryAutoPromote`, `OfflineScreenScanner`, `ProofOfPlaySampler`, `CleverSyncCron`, `LicenseReconcileCron` — 9 independent `setInterval`-based background workers, all single-replica-only by construction (P3, informational)
**Files:** `apps/api/src/efficiency/efficiency-alerting.service.ts:38`,
`apps/api/src/screens/screen-wedge-detector.cron.ts:127`,
`apps/api/src/pos/pos-sync.cron.ts:31`, `apps/api/src/webhooks/webhook-retry.worker.ts:61`,
`apps/api/src/player-ota/canary-auto-promote.ts:49`,
`apps/api/src/notifications/offline-screen-scanner.ts:33`,
`apps/api/src/analytics/proof-of-play.sampler.ts:55`,
`apps/api/src/integrations/clever/clever-sync.cron.ts:25`,
`apps/api/src/billing/license-reconcile.cron.ts:81`. None of these are
wasteful individually (each runs on its own sane cadence — 60s to hourly —
and does bounded, purposeful work), but this is the SAME architectural
pattern as the clock-advance poller (#3): plain `setInterval`, no
distributed lock, correct only because `numReplicas: 1`. This is not new —
the June-15 platform audit already flagged "background crons
single-replica-only (scaling landmine)" — re-confirmed present, still true,
still deferred appropriately (fixing requires either @nestjs/schedule +
Redis-backed distributed lock, or `numReplicas` staying at 1 through launch).
No fix recommended for launch week.

### 12. Health check does a real DB `SELECT 1` on every hit (P4 — verified negligible, listed only to close the loop on the sub-agent's claim)
**File:** `apps/api/src/health/health.controller.ts:79,85` — `/health`
(the keepwarm target) runs `withTimeout(prisma.$queryRaw\`SELECT 1\`, 400)`
on every call. At the documented keepwarm cadence (~4 min per
`apps/web/src/app/api/cron/keepwarm/route.ts` comment), that's ~360
queries/day — genuinely negligible, matches CLAUDE.md's description of
`/health` returning `{status, db, redis, ...}` by design. Not waste; listed
only because a sub-agent's phrasing implied "no DB work" which is imprecise
— the DB check exists and is fine at this cadence.

---

## Per-sweep verified-efficient list (what's already good)

### Database
- **Telemetry write debounce** — `apps/api/src/screens/manifest-hot-cache.ts:82-141`.
  `shouldSkipLastPingWrite` (25s), `shouldSkipCacheReportWrite` (120s + content-hash
  bypass), `shouldSkipRenderProofWrite` (40s) all present and wired at
  `screens.controller.ts:666,2512,3316`+. Matches the June-15 audit's "kills
  ~59% of DB load" fix — confirmed still in place.
- **`withDbRetry` on hot writes** — confirmed present at
  `screens.controller.ts:549,671,1184,2487,3319,3387`.
- **`GameEvent` per-type index** — `packages/database/prisma/schema.prisma:2222`,
  `@@index([gameId, type, createdAt])`, with an inline comment dating the fix
  to 2026-06-15 and explaining the exact 33.5%-seq-scan problem it closes.
  Confirmed present.
- **`AuditLog` dual index** — `@@index([tenantId, createdAt])` (sort path) +
  `@@index([tenantId, action])` (filter path), `schema.prisma:1114-1115`. The
  `/audit` list query (`action: { notIn: DEVICE_NOISE }`, `orderBy: createdAt`)
  is well-served by the `(tenantId, createdAt)` index; no composite gap.
- **`/sports/board` payload** — explicit `select` (not full-row `include`) at
  `sports.service.ts:463-472`, commented as a deliberate "Lane-4 P0 fix."
- **`/templates` LIST payload trim** — deliberate `select`, documented
  2026-05-09 fix dropping brandKit/thumbnail/touch-only fields, plus a
  `Cache-Control: private, max-age=30, stale-while-revalidate=120` header.
- **`/playlists` LIST** — uses a light `template: { select: {id,name,
  screenWidth,screenHeight,category} }`, no zones/defaultConfig at all; the
  fleet-publish decoration step batches via `groupBy` + in-memory maps
  instead of per-playlist queries (`playlists.controller.ts:90-114`) — this
  is a correct batched pattern, not an N+1.
- **`Sponsor`/`Game` reporting query** (`sponsors.service.ts:394-402`) —
  2-query `Promise.all`, low-frequency (reporting endpoint, not hot-path
  polled), fine as-is.

### API / realtime
- **`QueryClient` defaults** — `apps/web/src/components/providers.tsx`
  confirmed `refetchOnWindowFocus: false` globally with an explicit
  warning comment against adding a global interval. No violation found.
- **`refetchIntervalInBackground: true` on `LeadersPanel.tsx:80`** — this is
  a CORRECTLY documented `perf-allow` exception per CLAUDE.md's own escape
  hatch ("a live *display/board* surface that must keep updating off-focus
  is the one legit exception... mark the line `// perf-allow: <reason>`").
  The line carries exactly that comment. **This is compliant, not a
  violation** — see Corrections section, one sub-agent misread its own
  citation here.
- **Manifest ETag/304** — real, working, server-verified
  (`screens.controller.ts:2480,2978-2985,3257-3260`). The gap is 100%
  client-side (nobody sends `If-None-Match` — see waste #2), not a missing
  server capability.
- **System presets** (`apps/api/src/templates/system-presets.ts`, ~2,300+
  lines today) — a module-level constant, loaded once at boot, not
  re-parsed per request. Confirmed efficient.
- **Keepwarm cron** — hits `/health` only (cheap liveness check), correct
  ~4min cadence, no real per-request work beyond the negligible SELECT 1.
- **Player asset-set hash short-circuit** — `apps/web/src/app/player/page.tsx`
  computes a hash of the playlist's asset keys and only re-posts to the
  Service Worker when it changes, avoiding redundant SW messages (distinct
  from, and does not substitute for, the missing If-None-Match on the
  manifest fetch itself — both are real, one is done, one isn't).

### AI spend
- **Anthropic ephemeral prompt caching** — verified present on **all four**
  raw `fetch('https://api.anthropic.com/v1/messages')` call sites in the
  codebase: `apps/api/src/ai/ai-providers.ts:441` (shared dispatcher used by
  `dispatchAi`/`dispatchAiMessages`, which the Designer/Concierge/touch-template
  paths all route through — confirmed via `ai.service.ts:2608,2753` calling
  `dispatchRawOrThrow` rather than hand-rolling a fetch), `ai-alt-text.service.ts:861,1090`,
  and `bug-analyzer.service.ts:630`. `cache_control: { type: 'ephemeral' }` is
  set on the system-prompt block in every case. This closes what would
  otherwise be the single largest AI-spend waste (the ~16.6K-token
  `DESIGNER_SYSTEM_PROMPT` sent uncached on every 3-candidate fan-out) —
  confirmed NOT a live issue.
- **AI hourly cap** — `apps/api/src/ai/ai-hourly-cap.ts` is genuinely
  Redis-backed (sorted-set sliding window, key `ai:rl:gen:<tenantId>`,
  shared across sparkle/touch-template/alt-text/Concierge), fails open only
  on Redis outage (documented, correct trade-off — a Redis blip must not
  block a paying customer, and the real ceiling is the Postgres monthly
  platform cap + per-call `max_tokens`).
- **3-candidate fan-out** — `ai.service.ts` uses `Promise.allSettled` (parallel,
  same total token cost as sequential, faster wall-clock), and because all 3
  candidates share the identical system-prompt prefix, calls 2-3 land inside
  the Anthropic 5-minute cache TTL from call 1 — this is real, automatic
  savings, not a manual optimization that could regress.
- **Alt-text generation** — fire-and-forget, once per image upload
  (`assets.controller.ts`), gated to image mimetypes only, sharing the same
  hourly cap; not re-triggered on list/edit.
- **`max_tokens` sizing** — spot-checked sparkle (~300), touch-template
  (~900), Concierge (~1,100), alt-text (~300, clamped 160), Designer HTML
  (16,000 — deliberately large because the output IS a full HTML document,
  not oversized for its task). No evidence of a "just in case" oversized
  default.
- **Timeout scaling** — `ai-providers.ts:404-409` scales the abort timeout
  with `maxTokens` for slow/reasoning models (`min(240s, 90s + maxTok*6)`),
  fixing the 2026-06-30 503-storm-on-parallel-slow-calls incident. Prevents
  a retry storm turning into duplicate AI spend.
- **`attachKeptBoardPhoto`** — confirmed at-most-one-image-per-board guard
  exists (`boardAlreadyHasPhoto` check before generating), consistent with
  the documented contract in CLAUDE.md's `PEXELS_API_KEY` section.

### Storage / infra
- **EXTERNAL_HTML boards store a `url`, not inline HTML** — verified across
  `system-presets.ts` (dozens of `defaultConfig: { url: '/templates/...' }`
  entries) — the templates LIST endpoint is not shipping board HTML for the
  ~107 static EXTERNAL_HTML boards. (AI-Designer boards are the one
  unconfirmed exception — see waste #8.)
- **Keepwarm target is `/health`**, not a heavier endpoint — cheap by
  construction.
- **No compression on asset bytes needed from this API** — asset serving
  already goes through the CDN/proxy path (#212, prior fix); this audit's
  compression finding (#1) is about JSON API responses, a distinct and
  currently-unaddressed gap.

---

## Corrections to sub-agent claims (verified wrong, removed from the ranked list)

1. **"Playlist list endpoint ships full template zones + defaultConfig
   (~600KB/request)"** — **FALSE.** The sub-agent quoted
   `templates.controller.ts:440-453` (the templates list endpoint's zone
   `select`) but attributed it to `playlists.controller.ts`. The actual
   `/playlists` list query (`playlists.controller.ts:63-83`) uses
   `template: { select: { id, name, screenWidth, screenHeight, category } }`
   — no zones, no defaultConfig, at all. Verified by direct read. Removed.
2. **"`LeadersPanel.tsx`'s `refetchIntervalInBackground: true` VIOLATES the
   mobile-perf standard"** — **FALSE**, self-contradicting citation. The
   sub-agent's own quote of the line includes the comment
   `// perf-allow: live-game board data (see CLAUDE.md "Mobile performance
   standard")` — which IS the documented, sanctioned escape hatch CLAUDE.md
   defines for exactly this case ("a live display/board surface that must
   keep updating off-focus is the one legit exception"). Reclassified as
   verified-compliant, not a finding.
3. **AI-spend sub-report's overall tone** ("zero new waste... no changes
   required") was independently spot-checked rather than trusted outright,
   given how uniformly positive it read. All four Anthropic cache_control
   call sites, the Redis-backed hourly cap, and the fire-and-forget alt-text
   pattern were re-verified directly by the lead and hold up. The specific
   dollar figures in that sub-report (e.g. "$1,100/month savings",
   "$220/year") are **plausible-shaped but not independently re-derivable**
   from the code alone (they require real Anthropic pricing + real tenant
   call volume, neither of which is in the repo) — treat the *mechanism*
   claims as verified, the *dollar* claims as unverified estimates.

---

## "Do NOT fix now" — correct-but-risky-this-week, defer past launch

1. **Consolidating the 5 duplicate 750ms board/ribbon/scorebug pollers into
   one `GameStateContext` subscription (waste #4).** Touches the live,
   currently-working, on-air scoreboard rendering path across 5 files.
   A regression here breaks a customer's game mid-broadcast. Correct
   architecture improvement, wrong week.
2. **Adding ETag/304 to `/sports/board/:id` itself (the second half of waste
   #2).** Same live-path risk as above — do the lower-risk manifest-client
   half now if time allows, defer the board-endpoint half.
3. **Collapsing the 5 ribbon-metadata queries into one `findMany` (waste #7).**
   Touches `getBoardFresh()`, the same hot live-game function. Low value
   (already capped by the 1s board cache) for the risk of touching this
   function during launch week.
4. **Moving `boardCache`/`tenantStateCache`/debounce maps to Redis (waste
   #5/#10).** Unnecessary while `numReplicas: 1`; premature infra work that
   adds a network round-trip to the hottest path in the app for zero
   near-term benefit. Correctly deferred by the original author's own
   comment — re-confirming that call, not overriding it.
5. **Pagination on `/templates` and `/playlists` LIST (waste #9).** No
   tenant is close to needing it yet; the churn-to-value ratio this week is
   bad. Revisit once a tenant crosses ~200 templates.
6. **Distributed-lock hardening on the 9 single-replica cron workers (waste
   #11).** Only matters if/when `numReplicas` is bumped above 1 — not
   planned for launch week per `railway.json`.

## Recommended launch-week sequencing (if efficiency fixes are prioritized at all this week)

Given the mandate is efficiency alongside a hard 5-day launch clock, and per
the plan's own Day-3 slot ("efficiency FIX wave"), the safe, high-ROI,
low-regression-risk subset is:
1. Add `compression()` middleware (#1) — S, near-zero risk, broad win.
2. Add `@@index([status, clockRunning])` to `Game` + skip-when-idle guard on
   `ClockAdvanceService` (#3) — S, additive migration, matches an issue a
   previous engineer already flagged in `railway.json` as worth fixing.
3. Wire `If-None-Match` into the player's manifest fetch only (half of #2)
   — S/M, the server side is already built and presumably already tested.

Everything else in the ranked list is real but correctly belongs in the
post-launch efficiency pass, not this week.
