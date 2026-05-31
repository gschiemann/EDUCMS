# EDU CMS — Cloudflare Worker edge

Sprint 11 Phase B fleet-grade reliability. Sits between kiosks/dashboard
and the Railway-hosted NestJS API.

## Why this exists

| Problem | What this fixes |
|---|---|
| Railway redeploys drop a few seconds of requests during container swap → kiosks briefly see 502s, mis-classified as outages | Cloudflare Workers ship globally in <5s with zero in-flight loss. Cutover lands users on the new code atomically. |
| Schools in remote US districts round-trip ~150–300ms to Railway us-west2 | Closest CF PoP serves the request. Median latency <100ms globally. |
| 10k+ kiosks all heartbeating at 30s → Railway origin sees ~333 RPS just for pings | Health + version + build-info GETs cache at the edge for 10–300s. Origin sees only the misses. |
| Volumetric / DDoS abuse hits Railway directly | CF's free tier filters most of it before it reaches origin. |

## What stays on Railway (never edge-cached, never edge-served)

- `/api/v1/player/update-check` — OTA decisions are per-screen, must reach origin every time
- `/api/v1/player/apk/v/:vc` — APK byte stream, origin's LRU already handles this
- `/api/v1/realtime/*` — WS upgrade + SSE long-lived streams (worker still passes them through; just not cached)
- `/api/v1/screens/status/*` — heartbeats write DB state
- `/api/v1/screens/*/manifest` — per-device content manifest
- `/api/v1/emergency/*` — life-safety, never serve stale
- All POST / PUT / DELETE
- Any request with an `Authorization` header or `Cookie` (per-user data)

## What gets edge-cached

| Path | TTL | Why |
|---|---|---|
| `/api/v1/player/latest-version` | 300 s | release tags move at most once/day |
| `/api/v1/health` | 10 s | smooths Railway healthcheck flapping for the status pill |
| `/api/build-info` | 60 s | acceptable lag between Vercel deploy and clients picking up the new SHA |

## Local dev

```bash
cd apps/edge
pnpm install
pnpm dev                # wrangler dev — local worker on http://localhost:8787
```

In another tab:

```bash
curl -i http://localhost:8787/api/v1/health
# look for x-edu-edge-cache: MISS (first call) / HIT (subsequent within TTL)
```

## Deploy

First-time setup (once per Cloudflare account):

```bash
cd apps/edge
pnpm install
npx wrangler login
```

Deploy to `*.workers.dev` (staging, no DNS bind):

```bash
pnpm deploy:staging
# → edu-cms-edge-staging.<your-handle>.workers.dev
```

Smoke-test by temporarily setting `NEXT_PUBLIC_API_URL` on Vercel to the
worker URL and confirming kiosk pairing + manifest + heartbeat all work.

Production deploy (after smoke-test passes):

1. Add the prod hostname (e.g. `api.educms.app`) as a Cloudflare zone.
2. Uncomment the `[env.production]` block in `wrangler.toml` with the
   right route.
3. `pnpm deploy` ships globally.
4. Repoint `NEXT_PUBLIC_API_URL` on Vercel from Railway → the worker.

The cutover is reversible — if anything misbehaves, point
`NEXT_PUBLIC_API_URL` back at Railway and disable the worker route.
Kiosks pick up the new URL on next page reload (use the
`POST /screens/refresh-web` dashboard button to accelerate).

## CI

Add to `.github/workflows/edge-deploy.yml` (NOT included in this PR —
keeps the worker change reversible without a CI handshake):

```yaml
- uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    workingDirectory: apps/edge
    command: deploy
```

## Why not a separate Vercel / Netlify edge layer

Cloudflare Workers have the lowest cold-start (<5 ms) and broadest PoP
coverage (300+ cities). Vercel Edge Functions are good but pricier at
fleet scale, and their pricing model penalizes the kiosk's high request
count. Netlify Edge has narrower coverage. Cloudflare is the right
tool for the "lots of small kiosks, low payload, global" profile.

---

## Asset CDN deploy runbook (added 2026-05-30)

**Context:** Supabase Storage serves every asset with `cache-control: no-cache`.
Cloudflare never caches no-cache responses, so every asset load round-trips
back to Supabase origin (observed: 98 MB stored → 5.79 GB egress). The worker
now proxies `/cdn/assets/<path>` and overrides the header with a 1-year
immutable directive so Cloudflare serves all repeat fetches from its edge.

### Prerequisites

- Cloudflare account (free tier is sufficient for this use case)
- Your Supabase project URL (visible in Supabase Dashboard → Settings → API)
- Access to Vercel project settings for the web app

### Step 1 — Install and authenticate

```bash
cd apps/edge
pnpm install          # installs wrangler locally
npx wrangler login    # opens browser → authorize your Cloudflare account
```

### Step 2 — Set the ASSET_ORIGIN variable

The worker needs to know your Supabase Storage base URL. **Do not commit this
value** — set it via wrangler's secret mechanism instead:

```bash
# Format: https://<your-supabase-project>.supabase.co/storage/v1/object/public/assets
npx wrangler secret put ASSET_ORIGIN
# Paste the URL when prompted. Enter to confirm.
```

Alternatively, set it directly in the Cloudflare Dashboard:
Workers → edu-cms-edge → Settings → Environment Variables → Add variable.

### Step 3 — Deploy the worker

```bash
# Staging (workers.dev subdomain, no DNS changes required):
pnpm deploy:staging
# → deploys as: edu-cms-edge-staging.<your-handle>.workers.dev

# Production (same command, default env):
pnpm deploy
# → deploys as: edu-cms-edge.<your-handle>.workers.dev
```

Wrangler will print the worker URL after a successful deploy. Copy it.

### Step 4 — Smoke-test the asset proxy

Replace `<worker-url>` with your actual workers.dev URL and
`<supabase-asset-path>` with any known asset path (e.g. a tenant UUID /
filename you can see in the Supabase Storage dashboard):

```bash
# First fetch — should be MISS (origin fetch + cache write)
curl -sI "https://<worker-url>/cdn/assets/<supabase-asset-path>" \
  | grep -i "x-edu-asset-cache\|cache-control\|cf-cache-status"

# Expected output (first fetch):
# x-edu-asset-cache: MISS
# cache-control: public, max-age=31536000, stale-while-revalidate=86400, immutable
# cf-cache-status: MISS  (Cloudflare's own layer; may show EXPIRED on very first fetch)

# Second fetch — should be HIT from Cloudflare edge (no Supabase round-trip)
curl -sI "https://<worker-url>/cdn/assets/<supabase-asset-path>" \
  | grep -i "x-edu-asset-cache\|cache-control\|cf-cache-status"

# Expected output (repeat fetch):
# x-edu-asset-cache: HIT
# cache-control: public, max-age=31536000, stale-while-revalidate=86400, immutable
# cf-cache-status: HIT
```

If `cf-cache-status: HIT` appears on the second curl, the edge cache is
working and Supabase is not being hit.

### Step 5 — Enable in the Next.js web app

In your Vercel project → Settings → Environment Variables, add:

```
NEXT_PUBLIC_ASSET_CDN = https://<worker-url>
```

(Use the same URL you confirmed above. No trailing slash.)

Redeploy the web app (Vercel → Deployments → Redeploy, or `git push`).
After the redeploy, the `resolveAssetUrl()` helper in
`apps/web/src/lib/asset-cdn.ts` rewrites Supabase asset URLs to flow
through the CDN automatically.

### Step 6 — Verify end-to-end in the browser

1. Open the VenueOS dashboard → Assets page.
2. Open DevTools → Network tab.
3. Click on any image asset to expand the preview.
4. In the Network tab, find the request for that asset file.
5. Check the Response Headers:
   - `x-edu-asset-cache: HIT` on the second load confirms edge cache hit.
   - `cache-control: public, max-age=31536000, ... immutable` confirms
     the browser will also cache the asset locally for up to 1 year.
6. Open the Cloudflare Dashboard → Workers → edu-cms-edge → Analytics.
   You should see requests increasing as kiosks start loading assets.

### Rollback

If anything misbehaves, clear the Vercel env var `NEXT_PUBLIC_ASSET_CDN`
and redeploy the web app. Assets immediately fall back to direct Supabase
URLs — no data loss, no Supabase change required.

To purge the Cloudflare edge cache for a specific asset (e.g. after
replacing it in Supabase Storage):

```bash
# Via Cloudflare API — replace <zone_id>, <cf_api_token>, and the URL:
curl -X POST "https://api.cloudflare.com/client/v4/zones/<zone_id>/purge_cache" \
  -H "Authorization: Bearer <cf_api_token>" \
  -H "Content-Type: application/json" \
  --data '{"files":["https://<worker-url>/cdn/assets/<path>"]}'
```

Or use Dashboard → Caching → Purge Cache → Custom Purge → enter the
worker CDN URL of the asset.

### Video / audio seeking (Range requests)

The worker handles HTTP Range requests correctly:
1. On the first request (cache miss), it fetches the full object from
   Supabase, caches it with the immutable header, then slices the
   requested byte range and returns 206.
2. On subsequent range requests (cache hit), it slices the cached full
   body — no Supabase contact at all.

This means video widgets with `<video>` elements that issue Range requests
for scrubbing will work correctly and entirely from edge cache after the
first player load.
