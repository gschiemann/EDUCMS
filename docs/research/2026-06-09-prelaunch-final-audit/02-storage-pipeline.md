# Section 2 — Storage + Content Pipeline — Pre-launch FINAL audit

**Auditor:** frontier deep-pass (Fable 5) · **Date:** 2026-06-10 · **Scope:** Standard Audit Surface §2 every bullet.
**Verdict: DESIGN A / UX A / FUNCTIONALITY A− · covered.** No P0. One P1 (header-form drift), one P2 (CDN proxy dark), plus 2 P3 polish.

Method: traced upload → optimize → store → serve → SW-cache → player-render end-to-end; curled 10+ live assets (GET, HEAD, Range); queried prod `storage.objects` + `assets` via read-only MCP; verified each documented egress/cache safeguard against the wire, not the code's comments.

---

## Coverage table (every §2 bullet)

| Bullet | Coverage | D | UX | F | One-line verdict |
|---|---|---|---|---|---|
| Supabase upload (toSafeBuffer, mime caps) | covered | A | A | A | toSafeBuffer handles 6 buffer shapes; dual MIME cap (controller + bucket); SVG blocked both layers |
| Cache-Control on served assets (live curl) | covered | A | A | A | **GET serves `public, max-age=31536000` HIT** — egress wall real (HEAD misleads, see F-1) |
| sw-player.js offline tiers (playlist + emergency never-evict) | covered | A | A | A | 1GB emergency floor; set-hash deferred to all-cached; copy-forward on version bump; SHA verify |
| USB sneakernet (signed manifest, SHA, PIN) | covered | A | B | A | HMAC-SHA256 manifest + per-asset SHA-256 + PIN-hash + IDOR-closed; CLI ships, UX is power-user |
| Floor-plan upload | covered | A | A | A− | PNG-probe, signed-read TTL=300s; KNOWN-OPEN public bucket (task #200) |
| Media optimization (273MB→11.7GB lesson) | covered | A | A | A− | Images REAL (sharp 1920/q85, live-verified 547KB); **video transcode still deferred** (the tail) |
| Player CDN-proxy path (AUDIT-P0-4) | covered | A | A | A− | URL-build code correct + wired images-only; **env var unset in prod → inert** (intentional) |

---

## VERIFIED FIXED (list in `solid`)

### Egress wall is REAL on the wire — the 273MB→11.7GB lesson holds
The prior audits' central claim. I verified it against reality, and it survives — but **only a GET reveals it; a HEAD lies.**

- **HEAD returns `cache-control: no-cache` / `cf-cache-status: MISS/REVALIDATED`** for every asset. This looks like a regression and is exactly what burned the 2026-05-30 incident ("DB said immutable, wire said no-cache").
- **GET returns `cache-control: public, max-age=31536000` and `cf-cache-status: HIT`** (evidence below). Supabase's HEAD handler does not serve the stored cache-control; its GET handler does, and Cloudflare caches the GET. Since players/browsers fetch with GET, **the egress fix is live.**

```
GET 2fc1525f….jpeg  -> cf-cache-status: HIT  cache-control: public, max-age=31536000
GET 11f3d489….mp4   -> cf-cache-status: HIT  cache-control: public, max-age=31536000, immutable
GET (Range 0-99) jpeg -> HTTP 206 content-range bytes 0-99/547014  cache-control: max-age=31536000
```
Prod `storage.objects`: **148 objects, 143 carry `public, max-age=31536000, immutable`**, 5 carry bare `max-age=31536000`. Both forms serve cached on GET (verified). Range requests return 206 from edge → video seeking works without origin egress.

### Upload chain — toSafeBuffer + dual MIME cap
`apps/api/src/storage/supabase-storage.service.ts:120-168` `toSafeBuffer` normalizes Buffer / Uint8Array / ArrayBuffer / byte-array / `{type:'Buffer',data}` / numeric-key objects — the historically fragile Railway-IPC path. MIME enforced at TWO layers: controller `assertUploadIntent` (`assets.controller.ts:237`, per-type size caps: video 50MB, image 25MB raw, audio/PDF 25MB) AND the bucket `allowedMimeTypes` (`supabase-storage.service.ts:63-76`). **SVG blocked at both** (stored-XSS defense, public bucket serves inline). `.mov`/`.avi` dropped (Android WebView can't play). Upload bypasses the JS client (POSTs raw to Storage REST) because supabase-js v2 mangles Buffers to 0-byte files — correct and commented.

### SW offline tiers — both safeguards real
`apps/web/public/sw-player.js` (live: VERSION `v9`, served `no-store` so kiosks always re-fetch the SW itself — correct):
- **Emergency never-evict:** separate `EMERGENCY_CACHE`, `EMERGENCY_FLOOR_BYTES = 1GB` (line 79); playlist soft-cap eviction (line 346) only touches `PLAYLIST_CACHE`. Emergency entries are never in the eviction loop.
- **Set-hash deferred to all-cached** (lines 406-429) — only commits `__edu_emergency_set_hash__` after every asset verified present, with MessageChannel ack so the page commits `lastEmergencySetHashRef` only on SW-confirmed success (player-014). Prevents the "partial download → hash matches → never retry" silent-break.
- **Copy-forward on VERSION bump** (lines 105-165) for emergency, meta AND playlist — a SW upgrade no longer re-downloads the fleet's playlists (egress spike) nor leaves 0 cached emergency assets in the gap.
- **Real SHA-256 verify** (lines 509-529): recomputes digest from received bytes, refuses cache on mismatch; correctly skips verify when `sha256: null` (legacy/external rows) instead of fabricating a hash it would then reject (P0-1 fix verified in `screens.controller.ts:3447-3467`).
- **Range 206 synthesis** (lines 181-216) so cached video satisfies `Range:` requests offline — verified the origin also returns 206, so both paths work.

### USB sneakernet — signed + hashed + IDOR-closed
- Export (`apps/api/src/usb-export/usb-export.controller.ts`): builds `manifest.sig = HMAC-SHA256(manifest.json, tenant.usbIngestKey)`, assets keyed by `<sha256>.<ext>`. Key rotation (`tenants.controller.ts:824`) mints `randomBytes(32)`, shown ONCE. USB ingest is opt-in (explicit enable, no auto-flip — correct given it can update emergency content).
- Ingest (`apps/player/.../usb/UsbIngester.kt:71-136`): verifies HMAC FIRST (constant-time-ish hex compare), rejects on mismatch, then verifies each asset's SHA-256 with `constantTimeEq` before copying. Event recorder (`tenants.controller.ts:872+`) derives tenantId from trusted `Screen.tenantId` (not body — IDOR closed), SHA-256-hashes the operator PIN, rate-limits 6/min/IP.

### Floor-plan upload
`floor-plans.controller.ts`: MIME allowlist PNG/JPG/WEBP, hand-rolled PNG-chunk dimension probe (no image dep), `toSafeBuffer` reuse, stored at `<tenant>/floor-plans/<uuid>`, audit-logged. **Read returns a short-TTL (300s) signed URL** (`createSignedUrl`), never the permanent public URL — Sprint-8b operational-security requirement met.

---

## FINDINGS

### P1 — F-1: Cache-Control header-form drift; HEAD serves `no-cache` (operational landmine, not a live egress leak)
**Area:** storage/cache. **Evidence:** 5 newer objects carry bare `max-age=31536000` (e.g. `branding/…/og-image…jpg` 2026-06-02) vs 143 carrying `public, max-age=31536000, immutable`. The bare form was introduced by `supabase-storage.service.ts:226` server-side `upload()`/`resetCacheControl()` comments claiming the full string "is silently dropped to no-cache" — but the **browser PUT path** (`AssetPicker.tsx:134`, `assets/page.tsx:464`) still sends the full `public, …, immutable` and it sticks fine (143 objects prove it). So the two ingest paths now write **different** cache-control strings, and the server-side comment's premise is contradicted by live data. Worse: **every HEAD returns `no-cache`** regardless of stored form — so any future operator/audit that curls `-I` will "confirm" the egress regression is back, panic, and re-run the (now-unnecessary) `resetCacheControl` rewrite (a full re-download of every asset = the exact egress spike they're trying to avoid). **Both forms serve cached on GET — there is no live egress leak today.** **Fix:** (1) pick ONE canonical form across both server and browser PUT paths (prefer the full `public, …, immutable`); (2) replace the misleading `servedCacheControl()` HEAD probe with a GET probe (HEAD does not reflect served cache-control on Supabase); (3) update the code comment at `:218-226` — the "full string is dropped" claim is false against current prod.

### P2 — F-2: Asset CDN edge proxy fully built + wired but dark in prod (egress residual)
**Area:** storage/CDN. **Evidence:** `apps/web/src/lib/asset-cdn.ts` `resolveAssetUrl` + `apps/edge/src/index.ts` worker (`/cdn/assets/<path>` → Supabase origin, overrides to immutable, passes Range) are complete and tested (`index.spec.ts`). The player route DOES call `resolveAssetUrl` for images at `player/page.tsx:5251` and `:5899` (AUDIT-P0-4 wiring verified — images only; video stays raw to preserve the SW range-cache key). **But `NEXT_PUBLIC_ASSET_CDN` is unset in prod, so `resolveAssetUrl` is a no-op passthrough** and the worker isn't deployed. Today egress relies entirely on Cloudflare's cache in FRONT of Supabase (which IS working — HIT confirmed). The edge worker would add cross-kiosk edge de-dup and remove the dependency on Supabase's own CDN behavior. **Not a launch blocker** (Cloudflare HIT already bounds egress); it's the documented Sprint follow-up. **Fix:** deploy worker + set env behind the existing flag when convenient; until then the no-op is safe.

### P2 — F-3: Video transcode still deferred — the egress/storage tail
**Area:** media-optimization. **Evidence:** `media-optimization.service.ts:305-340` has a full ffmpeg pipeline (scale to 1080p, x264 CRF 24, faststart) and `ffmpeg` IS in the Dockerfile (`apps/api/Dockerfile:78`), but **NO upload path calls `optimizeVideo`** — both `assets.controller.ts:774` (presign) and `:918` (multipart) only WARN on videos >50MB and store raw. Prod has 18 videos, largest 27MB, total video bytes modest today. Images ARE optimized for real (verified: recent JPEG stored 547KB, sharp 1920/q85 path live, `processing_meta` populated on 4 recent rows). So the "8MB iPhone JPG served forever" half is fixed; the "40MB phone video" half is bounded only by the 50MB hard cap. At one pilot this is fine. At a media-heavy 50-location tenant pushing many ~50MB clips, raw-stored video is the cost tail. **Fix:** wire `optimizeVideo` into `completeUpload` as a background job (it's heavy/synchronous-risky inline — the comment at `:41` already flags this); or accept and document the 50MB cap as the bound. Acceptable to launch as-is given current volume.

### P3 — F-4: 9 assets have NULL fileHash (SW can't integrity-verify them)
**Area:** upload/integrity. **Evidence:** prod `assets`: 9 of 92 rows have `file_hash IS NULL` (legacy / external-URL / placehold.co rows). The SW correctly caches these without verification (`sha256: null` branch), so no break — but they get no tamper protection if ever used as emergency assets. **Fix:** backfill `fileHash` for null rows that point at real Supabase objects (a one-time download+hash job); leave external-URL rows null. Low priority — emergency assets uploaded via the normal path are hashed.

### P3 — F-5: presign `complete-upload` re-uploads optimized image to a NEW path then deletes old — non-atomic window
**Area:** upload. **Evidence:** `assets.controller.ts:719-755` — on image optimization it uploads to a new UUID path, deletes the original, and updates the Asset row. If the process dies between create and re-upload, the Asset row points at the original (fine). If it dies after new-upload but before DB update, an orphan blob is left (storage quota creep, not correctness). Already has a rollback `delete(newPath)` on inner-catch. Low impact; mention only for completeness. **Fix:** none required for launch; a periodic orphan-sweep cron would tidy storage long-term.

---

## Notes
- The web dashboard uses the **presign** path (`useRequestPresignedUrl` → browser PUT → `complete-upload`), not the legacy multipart `/assets/upload`. Both are audited; both optimize images; both set immutable cache-control on the browser PUT.
- `connection_limit` / DB-pool, transcoding-as-a-pipeline, and re-cache backfill jobs (`super-license.controller.ts:276-312` `resetCacheControl` with before/after GET verification) all exist and are sound.
- HARD-RULE compliance: read-only throughout; no live mutation; no emergency trigger; no SUPER_ADMIN login. The Supabase project ref in asset URLs is the public storage host (appears in every served asset URL by design) — not a secret.
