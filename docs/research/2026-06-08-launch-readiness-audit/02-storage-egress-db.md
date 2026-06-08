# Storage / Egress / Database Cost Audit — VenueOS (EDU CMS)

**Date:** 2026-06-08 · Read-only · file:line-traced · Agent: a14997e6f71af71cc

## Summary

**Egress posture for launch: SAFE on Supabase Pro 250 GB.** The original "59× re-download multiplier" root cause (every object served `cache-control: no-cache`) **is fixed at the source and no longer reproducible.** A prior lead live-curl on 2026-05-31 (`docs/research/2026-05-30-tools-enabled-audit/02-storage-egress-ai.md`) confirmed raw Supabase objects — oldest (2026-04-17) and recent — now serve `cache-control: public, max-age=31536000, immutable` with Smart CDN `cf-cache-status: HIT` on repeat fetch. The upload path (`supabase-storage.service.ts:226`) sets the bare `max-age=31536000` form that Supabase honors. The egress wall is gone.

**The player route — the 24/7 highest-egress surface — is well-defended independent of any CDN.** It does NOT pull raw Supabase URLs "forever." A dedicated service worker (`apps/web/public/sw-player.js`) pre-caches playlist + emergency tiers, **copies caches forward on version bump (no re-download)**, and is **range-aware** — synthesizes 206 responses from the cached blob so a looping video plays from disk (`rangeResponseFromCached`, `sw-player.js:181-216`). Cache keys are query-stripped so signed-token rotation doesn't wipe + re-download the fleet hourly (`stableKey`, `:677`). Each asset downloads **once per version per kiosk**, then disk forever. Solid.

**Biggest residual leak: large video.** Never transcoded (`media-optimization.service.ts` "does NOT transcode video"; >50 MB is a soft warning, not a reject — `assets.controller.ts:780`); bypasses the image transform pipeline by design; large (>10–28 MB) video is empirically edge-MISS-prone. On the player this is absorbed by the SW range cache, so it bites only **cross-kiosk first-load** and **dashboard video previews** (already mitigated with `preload="none"`). Not a launch blocker at one-customer scale; #1 to watch as the fleet grows.

**Biggest non-egress cost risk: unbounded append-only tables.** Five+ analytics/log tables grow forever with **zero retention/pruning anywhere** (verified: 0 `deleteMany`). Fine at one customer; storage + slow-query cost within months at multi-tenant scale.

## Edge CDN / player-route egress verification

| Item | Verdict | Evidence |
|---|---|---|
| Cloudflare edge worker (`apps/edge`) | **NOT deployed** — needs owner's Cloudflare account | `apps/edge/wrangler.toml:45` `ASSET_ORIGIN=""`; `.env.example:95` `NEXT_PUBLIC_ASSET_CDN=` empty |
| `resolveAssetUrl` (`asset-cdn.ts`) | **No-op until `NEXT_PUBLIC_ASSET_CDN` set** | `CDN_BASE` undefined → passthrough |
| `resolveAssetUrl` wired into player | **YES — images only** (commit `05946ee`) | `player/page.tsx:5251-5253` (active item), `:5899` (preload). Video/web/pdf stay raw (SW range-cache keying). Inert today but correctly placed. |
| Vercel same-origin proxy `/cdn/assets/[...path]` | **EXISTS, works, needs NO Cloudflare** | `apps/web/src/app/cdn/assets/[...path]/route.ts` — edge runtime, SSRF-locked to `assets` bucket, overrides `no-cache`→`immutable` |
| **Gap: the Vercel proxy gets zero traffic** | **Wiring mismatch** | `resolveAssetUrl` builds `${CDN_BASE}/cdn/assets/...` where `CDN_BASE = NEXT_PUBLIC_ASSET_CDN` (external worker host). Flag unset → nothing routes to the same-origin proxy either. The one CDN layer that needs no Cloudflare is built but unreachable. See P2-1. |
| Player precache wiring | **Fully wired** | `player/page.tsx:3033` `precachePlaylist`, `:2555` `precacheEmergency`; SW registered `offline-cache.ts:27` |
| Dashboard SW vs player media | **Dashboard SW correctly bypasses `/player` + cross-origin Supabase** | `sw.js:76-85`. No conflict. |

**Player path verdict:** the player does the right thing today **without** the CDN. The CDN wiring is belt-and-suspenders for cross-kiosk edge de-dup, not load-bearing. Egress correctness does not depend on deploying Cloudflare.

**Transform bypass count:** `transformedImageUrl()` correctly applied to **all 15+ dashboard thumbnail surfaces**. **Two intentional bypasses** are full-screen lightboxes where full-res is correct (`assets/page.tsx:1219`, `templates/page.tsx:2821`). Widget `<img>` tags are player/builder canvas renders — correctly NOT transformed (need display-res). **No incorrect bypasses found.**

## Findings — ranked

### P1-1 — Five+ append-only tables have zero retention/pruning (storage + slow-query cost at scale)
**Severity: P1** (P3 at one customer; P1 by fleet/sports/ads scale). Verified `0` deletes across every high-velocity table:
- `playback_samples` — `createMany` every 10 min × online screen (`proof-of-play.sampler.ts:158`, interval `600_000`). 500 screens = 72k rows/day, ~26M/yr. No prune.
- `sponsor_impressions` — 1 row/beacon, rate-limited 80/10s/game in-memory per replica (`sponsors.service.ts:283`). ~691k rows/game/day worst case. No prune.
- `ad_impressions` — 1 row/impression in `$transaction` (`ads.service.ts`). No prune.
- `touch_events` — schema comment says *"used for retention sweeps"* (`schema.prisma:1291`) but **no sweep exists**. No prune.
- `game_events`, `audit_logs` (immutable by design — KEEP), `webhook_deliveries`, `email_logs`, `notifications` — all unbounded.
**Fix:** ONE nightly retention worker (same `setInterval` pattern as existing `*.cron.ts` — no new dep) `deleteMany` older than N days: playback_samples 90d, sponsor/ad_impressions 180d (after rollup), touch_events 90d, notifications read+30d, email_logs 90d. Honor existing `createdAt`/`sampledAt`/`ts` indexes.

### P1-2 — `AdRevenueDaily` rollup cron is documented but does NOT exist
**Severity: P1.** `schema.prisma:2010` says `ad_revenue_daily` is *"populated by a nightly cron from ad_impressions"* and dashboards read it (`ads.service.ts:185`). **No writer exists** — no `adRevenueDaily.create`/`upsert` anywhere. Result: (a) ad-revenue dashboards empty/stale, (b) `ad_impressions` is the only truth, queried raw + never aggregated + never pruned (compounds P1-1). **Fix:** implement the nightly aggregation cron (group impressions by tenant/connection/date → upsert), then prune raw older than the rollup horizon.

### P1-3 — Large video: no transcode, soft-cap only
**Severity: P1.** `media-optimization.service.ts:41` no video transcode; `assets.controller.ts:780` >50 MB soft warning not reject; ffmpeg exists (`:344`) but only via `optimize()`, not the upload path. Absorbed by player SW range cache per-kiosk, so not a blocker at one customer. **Fix:** async ffmpeg transcode queue + poster-frame; enforce (not warn) a cap or auto-downscale.

### P2-1 — Same-origin Vercel CDN proxy built but receives no traffic
**Severity: P2.** `cdn/assets/[...path]/route.ts` is a working, SSRF-safe, immutable-overriding edge proxy needing **zero external infra**, but `resolveAssetUrl` only emits `/cdn/assets/...` when `NEXT_PUBLIC_ASSET_CDN` is set (pointed at the Cloudflare worker), so the same-origin route is never targeted. **Fix:** let `resolveAssetUrl` target the relative `/cdn/assets/...` path when a `NEXT_PUBLIC_USE_VERCEL_ASSET_PROXY` flag is on — cross-kiosk edge de-dup with no Cloudflare account.

### P2-2 — `sponsor_impressions` rate limit is per-replica in-memory (write-amplification)
**Severity: P2.** `sponsors.controller.ts:65` `impressionHits = new Map()` — 80/10s/game throttle is per-pod; N replicas → N×. Compounds P1-1. **Fix:** move throttle to Redis (codebase already uses Redis sliding windows for AI limits), or aggregate client-side.

### P3-1 — audit_logs count + stale model (minor)
`auditLog.count` (`bug-analyzer.service.ts:812`, `audit.controller.ts:97`) use indexed `where` — fine. Noted only: count + findMany on a never-pruned table slows as it grows; index keeps paginated reads bounded.

## Database connection pool — VERIFIED ENFORCED
- **Boot guard:** `apps/api/src/main.ts:157-178` throws on startup in production if `DATABASE_URL` has `pgbouncer=true` without `connection_limit>=10` AND `pool_timeout>=20`. The exact "silent killer" from CLAUDE.md, enforced in code.
- **Single shared Prisma client:** `PrismaService` imports the singleton from `@cms/database` (`prisma.service.ts:2`). 40+ `new PrismaClient()` are all one-shot CLI scripts under `scripts/`/`prisma/*.ts` — none on the request path.
- **Manifest hot path:** `manifest-hot-cache.ts` — 2s TTL emergency-state cache + 25s `lastPingAt` write-debounce to avoid 250 q/s + 100 w/s on a 500-screen district.

## Indexes — schema well-covered (no missing hot-query indexes found)

| Hot query | Index present |
|---|---|
| audit_logs by tenant+time, by action | `[tenantId, createdAt]`, `[tenantId, action]` ✓ |
| screens by status, by lastPingAt | `[tenantId, status]`, `[tenantId, lastPingAt]` ✓ |
| assets list/pending/folder | `[tenantId, createdAt]`, `[tenantId, status]`, `[tenantId, folderId]` ✓ |
| playback_samples aggregation | `[tenantId, sampledAt]`, `[playlistId, sampledAt]`, `[screenId, sampledAt]` ✓ |
| sponsor_impressions | `[sponsorId, ts]`, `[gameId, ts]` ✓ |
| ad_impressions | `[tenantId, servedAt]`, `[connectionId, servedAt]` ✓ |
| touch_events | `[tenantId, templateId, createdAt]`, `[templateId, zoneId]` ✓ |
| webhook_deliveries retry scan | `[status, nextRetryAt]` ✓ |

**No missing-index findings.**

## Unbounded tables table

| Table | Growth driver | Retention? | Index? | Risk |
|---|---|---|---|---|
| playback_samples | createMany /10min × screen | **NONE** | ✓ | **P1** ~26M rows/yr @500 |
| sponsor_impressions | 1/beacon, throttle per-replica | **NONE** | ✓ | **P1** ~691k/game/day ×N |
| ad_impressions | 1/impression in tx | **NONE** | ✓ | **P1** raw, never rolled up |
| ad_revenue_daily | rollup of ad_impressions | N/A | ✓ | **P1** writer cron **missing** |
| touch_events | 1/tap, player-batched | **NONE** (comment claims sweep) | ✓ | P2 |
| game_events | 1/cue/score | **NONE** | ✓ | P2 |
| audit_logs | 119 create sites (immutable — KEEP) | NONE (intentional) | ✓ | P3 |
| webhook_deliveries / email_logs / notifications | per-event | **NONE** | ✓ | P3 |
| efficiency ring | per-request | **bounded** (60-entry ring + Redis 2h TTL) | N/A | OK |

## Bottom line
- **Egress: GREEN.** Root cause fixed at source (verified live), player SW caches correctly without any CDN, transforms on every thumbnail. Supabase Pro 250 GB comfortable for one real customer.
- **DB pool: GREEN.** Boot guard enforces limits; single shared client; hot path cached.
- **Indexes: GREEN.**
- **Fix before fleet scale (not before first customer):** (P1-1) one nightly retention worker; (P1-2) the missing `ad_revenue_daily` rollup cron. (P1-3 video transcode is longer-tail.)
