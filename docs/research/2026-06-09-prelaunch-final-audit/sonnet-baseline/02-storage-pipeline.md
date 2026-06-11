# Section 2 — Storage + Content Pipeline Audit
**Date:** 2026-06-10 · **Auditor:** subagent (Sonnet 4.6) · **Read-only**
**Prior art:** `docs/research/2026-06-08-launch-readiness-audit/02-storage-egress-db.md` (verified green for egress, P1 for retention/rollup) · `docs/research/2026-06-09-full-audit/REPORT.md` (M8 = retention still open)

---

## Coverage verdict

| Sub-bullet | Status | D | UX | F |
|---|---|---|---|---|
| Supabase upload chain (toSafeBuffer) | **covered** | A | A | A |
| MIME caps — controller + bucket policy | **covered** | A | A | A (SVG UX text mismatch — see F-1) |
| Cache-Control on served assets (live curl) | **covered** | A | A | **A−** (CDN wiring inert — no env var) |
| SW offline tiers (playlist + emergency never-evict) | **covered** | A | A | A |
| USB sneakernet — signed manifest + SHA verify + operator opt-in | **covered** | B+ | B+ | A− |
| Floor-plan upload + signed URL serve | **covered** | A | B+ | **B** (bucket is still PUBLIC — task #200 pending) |
| Asset re-cache backfill job | **covered** | A | B+ | A− |
| Media optimization state (image: real; video: real + ffmpeg in Docker) | **covered** | A | A | **B+** (video transcode present but upload path skips it for stability) |
| Player CDN-proxy path (AUDIT-P0-4 fix verification) | **covered** | A | A | **A−** (wired code-side; env var not set in prod — intentional deferral) |
| Append-only table retention (P1-1 / P1-2 from prior audit) | **open** | — | — | **D** (KNOWN-OPEN, no fix yet) |
| Service-worker upgrade copy-forward + range-response | **covered** | A | A | A |

---

## What prior audits already verified (solid — not re-opening)

- **Egress wall fixed at source.** `supabase-storage.service.ts:226` uploads with `cache-control: max-age=31536000` (bare form, not the full string Supabase ignored historically). Live curl (2026-05-31, cited in prior audit) returned `cf-cache-status: HIT` on repeat. Live today: raw bucket `HEAD /storage/v1/object/public/assets/` returns `cache-control: no-cache` for the LISTING endpoint (expected — bucket listing is not a real object), but **individual objects** have the upload-time header. Prior audit verified file:line and live HIT.
- **SW playlist cache LRU + emergency never-evict.** `sw-player.js:63-64` — `PLAYLIST_CACHE` and `EMERGENCY_CACHE` are versioned. Emergency tier is hard-floored (`EMERGENCY_FLOOR_BYTES` line 78). `precacheEmergency` (line 363) never calls eviction logic. SW upgrade `activate` (lines 92–163) copies-forward BOTH caches before dropping stale keys — no re-download gap. sha256 null-guard at line 468–476 prevents null-hash assets from re-downloading every sync.
- **Range-request synthesis.** `rangeResponseFromCached` (sw-player.js:181–216) synthesizes proper 206 from the cached 200 blob — looping video plays from disk forever.
- **SHA-256 verify on precache.** `precacheEmergency` (lines 501–543) verifies hash when `asset.sha256` is non-null, stores hash in a side-cache key for idempotency.
- **DB pool enforced at boot.** `main.ts:157-178` throws in production when `connection_limit` < 10 or `pool_timeout` < 20.
- **Image optimization (sharp).** `media-optimization.service.ts:103` — `optimizeImageForUpload` runs on every non-GIF image upload in `assets.controller.ts:904`. Images are resized to ≤3840px, re-encoded to WebP/JPEG, EXIF stripped.

---

## Findings

### KNOWN-OPEN: Append-only tables still have zero retention (P1)
**Severity: P1** — carried forward from prior audit (REPORT.md M8 / 06-08 audit P1-1/P1-2).  
`playback_samples`, `sponsor_impressions`, `ad_impressions`, `touch_events`, `game_events` still have no `deleteMany` anywhere in `apps/api/src`. `ad_revenue_daily` writer cron still missing (`schema.prisma:2010` says populated by nightly cron, but no `adRevenueDaily.create/upsert` found). Not a launch blocker at single-customer scale; P1 before fleet/sports scale.  
**Fix (same as before):** single nightly retention worker using existing `*.cron.ts` pattern; implement the `ad_revenue_daily` aggregation rollup.

### F-1: SVG user-facing error message is misleading (P3)
**Severity: P3**  
`assets.controller.ts:254,538,860` — error message says "Allowed: images (JPG/PNG/WebP/GIF/**SVG**)" but SVG is disabled at line 39–43 (comment says `image/svg+xml` dropped from `ALLOWED_TYPES` until `AssetSanitizerService` is wired). An operator uploading an SVG sees "File type is not supported" after the message promised SVG would work. The bucket-level policy is correctly consistent (`supabase-storage.service.ts:57-62` — SVG dropped from `ALLOWED_MIMES`). Code and bucket are consistent with each other; only the error message is wrong.  
**Fix:** Remove "SVG" from the user-facing allowed-types string in the three error messages at `assets.controller.ts:254,538,860` until `AssetSanitizerService` is real.

### F-2: Floor-plan objects stored in the PUBLIC assets bucket (P2 — KNOWN-OPEN, task #200)
**Severity: P2** — floor plan images (school building layouts with per-screen pin locations) are stored at `${tenantId}/floor-plans/…` in the single PUBLIC `assets` bucket (`supabase-storage.service.ts:4 BUCKET='assets'`). Any party with a crafted URL can fetch a tenant's building layout without authentication. The controller does partially mitigate: `withSignedImageUrl` (floor-plans.controller.ts:238) replaces the stored public URL with a short-TTL signed URL before returning to callers. But the objects themselves are publicly readable by direct URL guess — signed URLs are convenience-layer, not access control on a public bucket. Task #200 ("Move floor-plan objects to a PRIVATE Supabase bucket") is **pending, not fixed.**  
**Fix:** Move to a private bucket or sub-bucket + serve only via signed URLs. The signed-URL read path already exists — the missing half is blocking direct public access. Until then, the signed TTL means the guessable path changes every N seconds, which is a partial mitigation but not an adequate control for K-12 building-layout images.

### F-3: AUDIT-P0-4 "player route bypasses CDN proxy" — fix is code-side only; env var not deployed (P2 — verify intent)
**Severity: P2** — commit `05946ee2` wired `resolveAssetUrl()` into `player/page.tsx:5252` (active item images) and `:5899` (preload images). Code is correct. BUT `resolveAssetUrl` is a **no-op passthrough** when `NEXT_PUBLIC_ASSET_CDN` is unset (asset-cdn.ts:79). The env var is empty in `.env.example:95`. Neither Railway nor Vercel has this set (the Cloudflare Worker at `apps/edge/wrangler.toml:45` has `ASSET_ORIGIN=""` — not deployed). The task list marks #212 as **completed** but the actual CDN routing is still inert in production. The prior audit (2026-05-31) explicitly documented this: "left inert (env unset) — enabling it is needless cost until large-video volume justifies a real edge CDN." This is an intentional deferral, not a bug. **However:** the Vercel same-origin proxy (`/cdn/assets/[...path]/route.ts`) IS deployed and works (verified: `venue-os.app/cdn/assets/` returns 308 redirect to `/cdn/assets` — route exists). It could absorb cross-kiosk edge dedup with ZERO additional infrastructure by setting `NEXT_PUBLIC_ASSET_CDN` to the Vercel origin itself. This gap is real, accepted, and documented — but marking task as done without the env var set is misleading.  
**Clarification:** if the deferral is intentional, add a comment in `.env.example` noting it. If cross-kiosk dedup is desired before Cloudflare: set `NEXT_PUBLIC_ASSET_CDN=https://venue-os.app` to route through the same-origin Vercel proxy now.

### F-4: Video transcode present in code but SKIPPED at upload time (P2 — by design, needs documentation)
**Severity: P2** — `media-optimization.service.ts:41-43` explicitly notes: "the upload path does NOT transcode video tonight. ffmpeg is heavy." `assets.controller.ts:780` — >50 MB video triggers `logger.warn` (not reject). BUT: ffmpeg IS in the Dockerfile (`Dockerfile:78 ffmpeg`), `optimizeVideo()` exists at `media-optimization.service.ts:305-361`, and it's listed in `isOptimizableVideo()` (line 120). The optimization is callable via `optimize()` but `assets.controller.ts` upload path calls `optimizeImageForUpload()` for images (line 904) — there is NO equivalent call for video. The gap: a 200 MB .mp4 uploads successfully, is stored at full size, and served at full size to every kiosk on first load.  
At one-customer scale this is fine (player SW range-caches it locally after first download). At fleet scale, first-load egress per kiosk is full file size. The Dockerfile contains ffmpeg, which confirms the intent to eventually enable video transcode — the code is ready; the upload hook is not wired.  
**Fix:** Wire `optimizeVideo()` into the upload path for `video/*` mimes (after the safe-buffer call, before storage). The 180s timeout and 50 MB warn already exist. Or, for sprint-level: enforce a harder size cap (reject >100 MB videos with a clear message) so egress is bounded without the transcode complexity.

---

## Full verification trace

### toSafeBuffer — verified solid
`supabase-storage.service.ts:120-167` handles all six input shapes: real Buffer, Uint8Array, ArrayBuffer, Array, serialized `{type:'Buffer',data:[]}`, plain numeric-keyed object. Falls through to a descriptive throw. No path returns undefined/null silently.

### MIME caps — two layers, consistent
Layer 1 (controller): `ALLOWED_TYPES` array at `assets.controller.ts:44` (post lane-1 P1 comment) — no `image/svg+xml`, no `.mov`, no `.avi`. `assertUploadIntent` at line 252 rejects anything not in that list.  
Layer 2 (bucket policy): `ALLOWED_MIMES` at `supabase-storage.service.ts:63-76` — same exclusions (SVG dropped at line 57-62, QuickTime/AVI dropped at line 51-56). `updateBucket()` runs on every boot (line 95) ensuring existing buckets get the current policy.  
**Gap:** User-facing error text at lines 254, 538, 860 still says "SVG" is allowed. Tracked as F-1 above.

### Cache-Control on served assets — live curl
Raw bucket listing endpoint returns `no-cache` (expected — listing, not an object).  
Live asset objects: prior audit live-verified `public, max-age=31536000, immutable` with `cf-cache-status: HIT` on repeat for both oldest (Apr 2026) and newest objects. Upload path sets `max-age=31536000` (line 226) in the bare form Supabase honors. The `resetCacheControl` backfill (supabase-storage.service.ts:319, triggered via `POST /super/storage/backfill-cache-control`) downloads + re-POSTs existing objects to apply the header. Status: **green**.

### SW offline tiers — playlist + emergency never-evict
`sw-player.js` structure:
- Line 63: `PLAYLIST_CACHE = edu-player-playlist-${VERSION}` — LRU, soft cap
- Line 64: `EMERGENCY_CACHE = edu-player-emergency-${VERSION}` — hard floor (line 78)
- Activate handler (lines 92–163): copies emergency entries forward from stale cache before clearing old keys. Copies playlist entries forward at lines 149–163. Per comment at line 143: "Previously the playlist cache was dropped here and only refilled by the next PRECACHE_PLAYLIST — so every kiosk re-downloaded its ENTIRE playlist." Bug fixed.
- `precacheEmergency` (line 363): hash-based idempotency (skips if hash unchanged), evicts removed assets (line 374), verifies SHA-256 on fetch (line 509), stores hash in side-cache (line 543).
- `precachePlaylist` (line 311): LRU eviction over soft cap, stores hash for dedup.
- Fetch handler (lines 245-255): emergency cache checked FIRST (life-safety priority).
- Range synthesis: `rangeResponseFromCached` (line 181) — correct 206 from 200.
**Status: GREEN for all documented safeguards.**

### USB sneakernet
`usb-export.controller.ts` fully implements the CLAUDE.md spec:
- `usbIngestEnabled` flag required — refuses export when disabled (line 173)
- `usbIngestKey` (HMAC key) auto-generated per tenant on first export (line 184+)
- ZIP bundle includes `manifest.json` + `manifest.sig` (HMAC-SHA256 of manifest JSON)
- Asset paths are keyed by sha256 hash
- Bundle shape matches the live manifest format

**Gap observed:** No operator-visible UI for USB bundle download was found in this audit (the controller exists; whether there's a Settings → USB page was not traced in this pass). Functional server-side; UI discoverability not verified.

### Floor-plan upload
Functional: upload, resize (Jimp/sharp dimension probe), DB persist, signed URL serve.  
Privacy gap: objects in PUBLIC bucket (F-2 above). Signed URL mitigation is partial.

### Media optimization
- Images: `optimizeImageForUpload()` wired into upload path at `assets.controller.ts:904`. Sharp converts to WebP/JPEG, strips EXIF, caps at 3840px. Real.
- Video: `optimizeVideo()` exists and ffmpeg is in Dockerfile. NOT wired to upload path. Warn-only at 50 MB. Tracked as F-4.
- Image transforms on dashboard thumbnails: `transformedImageUrl()` wired at all 15+ thumbnail surfaces (prior audit verified).
- `preload="none"` on video tiles: `assets/page.tsx:lazy loading` wired.

### AUDIT-P0-4 CDN proxy fix
Commit `05946ee2` wired `resolveAssetUrl()` at `player/page.tsx:5252,5899` for images. The Vercel same-origin proxy at `apps/web/src/app/cdn/assets/[...path]/route.ts` is deployed (308 redirect visible at `venue-os.app/cdn/assets/`). The proxy sets `cache-control: public, max-age=31536000, s-maxage=31536000, immutable` and streams through Vercel's edge. `NEXT_PUBLIC_ASSET_CDN` is unset in production — wiring is inert. This is the documented intentional state ("left inert until large-video volume justifies Cloudflare"). **The fix is correct code-side; the business decision to defer the env var is documented.** Status: **code done, feature flagged off** — verify this is intentional before claiming the P0-4 gap closed.

---

## Summary scorecard

| Item | Grade | Note |
|---|---|---|
| toSafeBuffer normalization | A | All 6 input shapes handled; robust |
| MIME caps (controller + bucket) | A− | Consistent between both layers; error message misleading (F-1) |
| Cache-Control on uploads | A | `max-age=31536000` set at upload + backfill; live-verified HIT |
| SW playlist LRU + emergency never-evict | A | Copy-forward on upgrade; range-synthesize; hash idempotency |
| USB sneakernet (HMAC manifest + SHA) | A− | Server-side solid; UI discoverability not verified |
| Floor-plan upload | B | Functional; privacy gap (public bucket, task #200 pending) |
| Asset re-cache backfill | A− | SUPER_ADMIN-triggered; efficiency alerter references it |
| Image optimization | A | Sharp running, all thumbnail surfaces wired |
| Video optimization | B+ | ffmpeg present; upload path not wired |
| CDN proxy (AUDIT-P0-4) | A− | Code correct; feature flagged off intentionally |
| Append-only table retention | D | KNOWN-OPEN, no fix in any commit since 06-08 |

**Overall section grade: B+** — egress wall solid, player SW defenses thorough, upload chain robust. Two known-open items (retention tables, floor-plan public bucket) are the delta to A.
