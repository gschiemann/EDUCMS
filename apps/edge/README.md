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
