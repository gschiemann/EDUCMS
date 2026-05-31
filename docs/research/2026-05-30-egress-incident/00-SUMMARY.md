# Supabase egress incident + efficiency overhaul — 2026-05-30

## Incident
Supabase free-tier egress quota (5.5 GB) exhausted → HTTP 402 on Storage →
all media (images/video/PDF) stopped loading. App **core stayed up** (Railway
API + DB + Redis green throughout; only Storage egress was walled). Resolved
operationally by upgrading to **Supabase Pro** (250 GB egress).

## Verified root cause (proof, not assumption)
- 98 MB stored, but 5.79 GB egress = **~59× multiplier** — the same files
  re-pulled over and over, NOT too much data.
- **Every object is served `cache-control: no-cache` / `cf-cache-status: MISS`**
  regardless of what cacheControl we set at upload. Proven 3 ways:
  raw-REST upload with the full `public, max-age=…, immutable` string, raw-REST
  with bare `max-age=31536000`, AND the documented storage-js `cacheControl`
  option — **all three serve `no-cache`** (verified by curling the live header,
  incl. yesterday's upload).
- Task #42's earlier "fix" patched `storage.objects.metadata.cacheControl`
  (a DB column Supabase does **not** serve the header from) and was verified by
  reading the DB, not the wire — so it never actually changed egress.
- With `no-cache`, Cloudflare never caches → every dashboard preview, builder
  tile, and (especially) headless/Playwright/screenshot test re-pulls the full
  file. With no real customers, **our own testing was the traffic.**

## Fix architecture (Supabase won't serve cacheable headers → own the layers)
Three prongs, each shipped this session (one CI batch):

1. **Edge caching proxy** (`apps/edge` Cloudflare Worker) — commit `2a3e198`.
   Reverse-proxies Supabase Storage, **overrides `no-cache` → immutable**, serves
   repeats from Workers Cache (incl. headless). Range-aware for video. Web helper
   `apps/web/src/lib/asset-cdn.ts` is a **no-op until `NEXT_PUBLIC_ASSET_CDN` is
   set**. **DEPLOY NEEDS OWNER'S CLOUDFLARE ACCOUNT** — runbook in
   `apps/edge/README.md` (`wrangler login && wrangler deploy`, set ASSET_ORIGIN,
   set NEXT_PUBLIC_ASSET_CDN in Vercel, verify `cf-cache-status: HIT`).

2. **Image transforms + stop auto-pull** — commit `1f6f05c`.
   `apps/web/src/lib/asset-image.ts` `transformedImageUrl()` rewrites Supabase
   image URLs → `/render/image?width&quality` (Pro). Applied to 11 thumbnail/
   preview/builder surfaces. **Measured 2.4 MB → ~60 KB at 320px (~97%).**
   Non-player `<video>` tiles → `preload="none"` + play-on-demand.

3. **Efficiency monitoring** — commits `34e8f1a` + `e552485` (lead hardening).
   Per-route byte/latency ring + Redis fan-out, slow-query (`$use`) logging,
   `GET /api/v1/super/efficiency` (SUPER_ADMIN) + dashboard at `/super/efficiency`,
   **50/70/90% egress-budget alerts + anomaly (>3× baseline)** via Resend.
   Interceptor + middleware are try/catch-wrapped so observability can never
   break the request/query hot path. `EGRESS_BUDGET_GB` (default 250).

## Lead-filtered / dropped
- The transforms agent also changed `player/page.tsx` to keep ALL playlist
  videos mounted (`preload=auto`). **DROPPED** — on a 24/7 low-end kiosk that
  risks N simultaneous downloads + decode buffers (OOM/jank), and the range-aware
  service worker already covers loop caching. Revisit only with a real-device
  SW-loop measurement.
- The earlier `fd69d70` cacheControl re-set (upload format + backfill) is
  **insufficient** (Supabase ignores it) — superseded by the edge proxy. Harmless
  but not the fix.

## Follow-ups
- **Owner action:** deploy the edge worker (`apps/edge/README.md`) → then flip
  `NEXT_PUBLIC_ASSET_CDN` in Vercel + wire `resolveAssetUrl` into asset call sites.
- Rotate Railway secrets surfaced in-session (GH_TOKEN, DB pw, Stripe) as hygiene.
- Agent transcripts: `/private/tmp/claude-501/<project>/<session>/tasks/{a043b93374d35db37,a36ba7c3b525ff73e,a9d2fce266cf04c14}.output`.
