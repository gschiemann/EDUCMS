# §1 + §2 Cluster Audit — Real-time / Pub-Sub + Storage/Content Pipeline

**Audit date:** 2026-05-30 · read-only, code-traced + live-deploy verified · master `8eb8768`/`5d16519`.

**Verdict up front:** This cluster is the strongest in the app and has materially improved since the 2026-05-28 synthesis. **All four life-safety/storage P0s the synthesis flagged (P0-1 emergency media never caches; P0-2 SOS/broadcast/media never reach kiosks on fallback tiers) are FIXED and verified against current code + the live deploy** (`db:ok, redis:ok`, commit `5d16519`, newer than the synthesis). The signing/HMAC chain is real and traced to live callers. Residual findings are P2/P3.

## 1. Coverage table

| § | Domain | D | UX | F | Status |
|---|--------|---|----|----|--------|
| 1 | Real-time + signed pub/sub | A | A | **A−** | covered |
| 2 | Storage + content pipeline | A | A | **A−** | covered (USB *ingest* verify is native-APK, out-of-scope here) |

**Depth notes — every documented safeguard traced to a real caller:**
- `verifyWsHmac` (the Redis fan-out gate): REAL caller at `redis.service.ts:137`, inside the `pmessage` subscriber (`redis.service.ts:90-92`) that fires on every replica. Forged Redis publishes are dropped before WS *and* SSE fan-out (`redis.service.ts:148-149`). Not theater.
- Signer ms/seconds bug: FIXED. Signer uses `Date.now()` ms (`websocket-signer.service.ts:65`); verifier window is ms 120s (`ws-signature.ts:60-73`); gateway passes the *signed* timestamp through unchanged (`realtime.gateway.ts:296-311`).
- `verifyMessage()` (the historical "theater" method) is correctly REMOVED; the dependency comment (`websocket-signer.service.ts:24-56`) documents why.
- Live deploy: `/emergency/messages` → **401** unauth, `/emergency/trigger` → **403** unauth. Real gates, not costumes.

## 2. Findings

**P2 — §2 — Legacy assets ship `sha256: null`; no backfill job exists.**
`screens.controller.ts:3363,3411` correctly ship `Asset.fileHash ?? null` (the P0-1 fix). New uploads DO populate `fileHash` (`assets.controller.ts:556,947`). But there is **no backfill script** for pre-existing null-hash rows (grep for backfill/script/cron → zero hits). Consequence: emergency/playlist assets uploaded before the hashing landed cache **without any SHA-256 integrity verification** (`sw-player.js:475`). Not a re-download loop (fixed), but a tamper-detection gap on legacy media. *Fix: one-off prisma backfill that downloads each null-hash asset, computes SHA-256, writes `fileHash`.*

**P2 — §1 — SSE-tier emergency messages bypass the client-side freshness/replay/dedup gate.**
The WS path runs SENSITIVE_TYPES through signature-presence + 30s freshness + per-eventId dedup (`player/page.tsx:3849-3875`). The **SSE path does not** — `handle('SOS'|'TEXT_BROADCAST'|'MEDIA_ALERT', …)` (`player/page.tsx:3712-3715`) sets state directly with no eventId dedup, by explicit design ("we trust the server-side signer", `:3642-3644`). Defensible — the Redis fan-out gate already HMAC-verifies before SSE broadcast, so forgery is blocked server-side; only client-side *replay* dedup is absent on this tier. Low risk. *Fix (optional): route SSE emergency payloads through the same `recentEventIdsRef` dedup as WS.*

**P3 — §2 — 80%-emergency-floor warning not implemented.**
SW reports `floorBytes` in cache status (`sw-player.js:583`) but there's no "warn admin when emergency assets exceed 80% of the 1GB reserved floor" logic (CLAUDE.md Sprint 7 spec). Cosmetic/operational; the 1GB floor itself is real and never-evicted (`sw-player.js:64,78-79`, copy-forward on SW upgrade `:100-120`).

**Confirmed FIXED since synthesis (no longer gaps):**
- **P0-1** (emergency media never caches) — fixed; real `fileHash`/null shipped, SW skips verify on null. ✅
- **P0-2** (SOS/broadcast/media never reach kiosks on fallback) — fixed three ways: device-JWT `GET /emergency/messages` (`emergency.controller.ts:1176-1227`, live 401), EmergencyOverlay polls it with `deviceToken` (`EmergencyOverlay.tsx:97-103`), and SSE consumer now has SOS/TEXT_BROADCAST/MEDIA_ALERT handlers (`player/page.tsx:3712-3715`). ✅
- **P1-9** (desktop emergency console silent for SR) — fixed; `EmergencyLiveRegion`/`useEmergencyAnnouncer` is a real component used by the trigger modal + broadcast console. ✅
- **Egress (11.7GB on 273MB — the 2026-05-21 systemic defect)** — fixed; every upload path goes through `storage.upload()` setting `Cache-Control: public, max-age=31536000, immutable` (`supabase-storage.service.ts:218`; `asset-files.controller.ts:45`). ✅

**Other verified-solid (no finding):** 3-tier fallback (WS→SSE→HTTP poll), all device-JWT-authed; WS HELLO re-checks live Screen→tenant binding + revocation (`realtime.gateway.ts:131-160`); per-screen override > tenant-wide in manifest backstop (4-tier resolution, `screens.controller.ts:2505-2540`); hold-to-trigger 3000ms (`panic/page.tsx:31`) + typed-confirm-word on desktop (`EmergencyTriggerModal.tsx:66,224`); emergency-assets endpoint device-JWT-gated + audit-logged + single-query (`screens.controller.ts:3229,3275`); all emergency writes wrap state+audit in one `$transaction`; SSRF allowlist on every operator media URL (`media-url-guard.ts`); USB export HMAC-signs `manifest.sig` per-tenant + per-asset SHA (`usb-export.controller.ts:357-362`).

## 3. Biggest risk in my cluster
**Legacy null-hash emergency assets cache with zero integrity verification (P2)** — the only real residual life-safety-adjacent gap, and it's narrow: affects only assets uploaded before the `fileHash` pipeline landed; the re-download loop that made it a P0 is fixed. A one-off backfill closes it entirely.
