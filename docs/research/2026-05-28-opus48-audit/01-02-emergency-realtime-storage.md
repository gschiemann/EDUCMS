# AUDIT — §1 Real-time + signed pub/sub · §2 Storage + content pipeline

> Opus 4.8 full-app audit, 2026-05-28. Read-only. Verified live against
> `https://api-production-39a1.up.railway.app` (commit `45d07b5`, db=ok, redis=ok,
> ws_signer=ok).

**Headline:** The signing/verification chain that was "theater" in the 2026-05-21
audit is now **genuinely wired and correct** — `verifyMessage()` is deleted,
`verifyWsHmac()` fires at the Redis gate (`redis.service.ts:137`), AuditLog
immutability is a real DB trigger, SW SHA-256 is a real content check. But there
is **one P0** (emergency media silently fails to cache on a life-safety tier) and
**one P1 life-safety functional gap** (SOS/broadcast/media-alerts never reach
kiosks on the SSE or HTTP-poll fallback tiers — the documented fallback poll is
broken for the actual deployment target). Both verified by tracing to real call
sites + a live `401`.

---

## Page-1 Coverage (D=Design / UX=Operability / F=Functionality)

### §1 Real-time + signed pub/sub
| Bullet | D | UX | F | Confidence |
|---|---|---|---|---|
| Emergency trigger | ✓ | ✓ | ✓ | verified — `emergency.controller.ts:296-553`; Zod, scope-owned, SSRF-guarded, audited, signed+published |
| All-clear | ✓ | ✓ | ✓ | verified — signed ALL_CLEAR, audited |
| Per-screen overrides | ✓ | ✓ | ✓ | verified — manifest priority per-screen > per-tenant (`screens.controller.ts:2449-2554`) |
| WS signing+verify (ms timestamp, freshness) | ✓ | — | ✓ | **verified** — `realtime.gateway.ts:266-318`; the sec-vs-ms P0 from 2026-05-26 is fixed |
| Redis fan-out gate (`verifyWsHmac` per pmessage) | ✓ | — | ✓ | **verified** — `redis.service.ts:137`; stateless → multi-replica safe |
| HTTP polling backstop via manifest | ✓ | ✓ | ✓ | verified — manifest carries live emergencyStatus + per-screen override |
| SSE fallback | ✓ | ✓ | **partial** | **verified** — transport works but consumer drops SOS/TEXT_BROADCAST/MEDIA_ALERT/TENANT_CHANGED (P1) |
| Player WS handlers (all 9) | ✓ | ✓ | ✓ (WS) | verified — `page.tsx:3565-3870`; all 9 on the WS path with signature+freshness+dedup |
| Hold-to-trigger + typed-confirm | ✓ | ✓ | ✓ | mobile panic page |
| Per-eventId dedup | ✓ | — | ✓ | **verified** — player `recentEventIdsRef` bounded 500/5min. Server gate intentionally no nonce (multi-replica tradeoff, documented) — correct design |

### §2 Storage + content pipeline
| Bullet | D | UX | F | Confidence |
|---|---|---|---|---|
| Supabase upload + Cache-Control/egress | ✓ | ✓ | ✓ | **verified** — `supabase-storage.service.ts:212` `public,max-age=31536000,immutable`; sharp 1920px/q85 in presign chain. 2026-05-21 egress fix is real |
| SW cache tiers (playlist + emergency never-evict floor) | ✓ | ✓ | mostly | verified — emergency tier never auto-evicted (eviction is PLAYLIST-only `:344-358`). Gap: FLOOR/80%-warning declared not enforced (P2) |
| SW SHA-256 integrity | ✓ | — | **partial** | verified — recomputes digest, refuses on mismatch. **But server ships URL-derived hash for some assets → SW rejects them (P0)** |
| USB sneakernet (signed manifest, SHA, PIN) | ✓ | ✓ | ✓ (export) | verified — `usb-export.controller.ts:357` HMAC; on-device verify/PIN in APK (out of repo) |
| Floor-plan upload | N-A | N-A | N-A | Sprint 8b — columns exist, upload not built in repo |
| Re-cache backfill | ✓ | — | ✓ | verified — setHash committed only on allCached |
| Transcoding pipeline | ✓ | ✓ | ✓ | sharp on image upload; PDF/PPTX import computes real fileHash |

---

## Theater Check — every prior-flagged safeguard is now genuinely wired
- **`verifyMessage()` (2026-05-21 theater):** GONE. Real gate `verifyWsHmac` has a real caller `redis.service.ts:137`. ✅
- **Immutable AuditLog:** real DB trigger — `migrations/20260526010000_audit_log_immutability/migration.sql:41-49` (BEFORE UPDATE/DELETE → RAISE EXCEPTION). ✅
- **Signed WS / HMAC at gate:** canonical string identical signer↔gate; constant-time compare; freshness window; live `ws_signer:"ok"`. ✅
- **Player signature check:** now enforces freshness + per-eventId dedup. Signature *value* not verified client-side (no secret on kiosk, by design, documented) — server gate is the real defense. ✅ Acceptably real.
- **SW SHA-256:** recomputes from bytes (real) — **but fed a non-content hash for some assets (P0).**

**No remaining pure-theater safeguards in §1/§2.** The holes below are real-but-broken wiring.

---

## 🔴 P0-1 — Emergency media silently fails to cache when `Asset.fileHash` is null, and ALWAYS for per-screen emergency assets
**File:** `apps/api/src/screens/screens.controller.ts:3235-3236, 3271` × `apps/web/public/sw-player.js:491-505`. Verified by trace.

The emergency-assets endpoint ships a URL-derived hash:
```ts
const hash = item.asset.fileHash
  ?? crypto.createHash('sha256').update(`${item.asset.fileUrl}:${item.asset.fileSize ?? 0}`).digest('hex');  // :3236
// per-screen URLs, UNCONDITIONALLY synthesized:
sha256: crypto.createHash('sha256').update(`${url}:screen-emergency`).digest('hex'),                          // :3271
```
The SW recomputes the digest from the body and refuses on mismatch
(`sw-player.js:500-504`). A URL-derived hash never equals the body's real SHA-256:
- **Per-screen emergency assets (Sprint 8b "evacuate via north exit" media) NEVER cache** — `:3271` always synthesizes even when a real `fileHash` exists. Breaks the Sprint 7/8b "pre-cache scoped emergency assets, survives WiFi failure" promise.
- **Any asset with `fileHash=null`** (external-URL assets, legacy rows) → emergency media silently uncached.
- When this happens `precacheEmergency` never commits `setHash` and **retries the full set every 5 min forever** (fleet-wide egress) while the screen degrades to text-only.

**Fix:** (a) for per-screen asset URLs, look up the owning `Asset.fileHash`, don't synthesize. (b) when `fileHash` is null, backfill (download+hash once server-side) OR send `sha256: null` and have the SW **skip** verification for null hashes rather than computing a fake one it then rejects.

---

## 🔴 P1-1 — SOS / TEXT_BROADCAST / MEDIA_ALERT never reach kiosks on SSE or HTTP-poll fallback (life-safety)
**Files:** `EmergencyOverlay.tsx:75-78`; `player/page.tsx:3467-3490` (SSE handlers); `emergency.controller.ts:40,1073-1088` (`/emergency/status` guard). Verified by trace + **live `curl /api/v1/emergency/status?tenantId=test` → `401`.**

These three types are delivered to kiosks **only via the live WebSocket push.** No device-authenticated poll path:
1. The manifest (only device-JWT-authed poll) carries only `OVERRIDE`-class state — NOT `EmergencyMessage` rows (`grep emergencyMessage screens.controller.ts` → none).
2. The SSE fallback consumer registers only `SYNC/OVERRIDE/ALL_CLEAR/CHECK_FOR_UPDATES/REFRESH_WEB` — **no `handle('SOS'/'TEXT_BROADCAST'/'MEDIA_ALERT')`.** On a WS-blocked proxy (Squid/ZScaler/iboss/GoGuardian — the exact reason SSE exists), staff SOS / typed broadcasts / media alerts are silently dropped.
3. The `EmergencyOverlay` self-poll (documented as the fallback) is **broken for kiosks**: it fetches `/emergency/status` with `credentials:'include'` (express-session cookie), but that endpoint is behind `@UseGuards(JwtAuthGuard, RbacGuard)` resolving tenant from `req.user.tenantId` (a USER session). A paired kiosk has a **device JWT**, not a user session → **401** (confirmed live). `if (!res.ok) return` swallows it.

**Net:** SOS/broadcast/media-alert delivery to kiosks survives only while the WebSocket is healthy. If Redis is down OR the kiosk is behind a WS-blocking proxy, these life-safety pushes are **never delivered.** Works in an admin browser tab (session cookie present) — which is how it passed review/demo. Same "works in dev, dead in the field" class as the Safari/Taurus bugs.

**Fix:** (a) add a **device-JWT-authed** variant of `/emergency/status` (reuse `verifyDeviceForScreen`), have `EmergencyOverlay` send the device bearer; AND/OR (b) add `handle('SOS'/'TEXT_BROADCAST'/'MEDIA_ALERT')` to the SSE consumer mirroring the WS handler at `page.tsx:3697-3710`. (b) closes the SSE tier; (a) closes the Redis-down tier.

---

## 🟡 P2-1 — Emergency cache floor + 80% overflow warning declared but not enforced
`sw-player.js:79,344-358,565` — `EMERGENCY_FLOOR_BYTES=1GB` declared + reported but emergency tier has no size cap and playlist eviction never subtracts the floor from the device budget. CLAUDE.md Sprint 7 "warn at 80% of floor" warning does not exist. Low real risk (emergency content small). Fix: emit a flag when `emBytes > 0.8 * FLOOR`, surface in dashboard.

## 🟡 P2-2 — RBAC guard spatial scope is a no-op for emergency triggers (defense-in-depth only)
`rbac.guard.ts:90-91` reads `body.schoolId`/`districtId` but emergency trigger body uses `scopeType`/`scopeId`, so the guard's spatial check never fires. **Not exploitable** — `resolveScopeTenant` (`emergency.controller.ts:211-261`) does the real cross-tenant enforcement. But two-layer defense is effectively one layer; add a `scopeId`-aware check or a comment.

---

## Efficiency Findings
1. **(P0-1 egress tail)** Mis-hashed emergency assets → `precacheEmergency` never commits `setHash` → player re-attempts full emergency precache **every 5 min, fleet-wide, forever.** Fixing P0-1 eliminates it.
2. Manifest emergency hot-cache is correct (2s per-tenant TTL + explicit invalidation on trigger/all-clear). No N+1. ✅
3. `location-based` trigger is O(screens) upserts per trigger inside one tx — 1000 upserts for a 1000-screen tenant. Acceptable now (rare, correctness>speed); flag for Sprint-8 scale — consider bulk upsert.
4. SW SHA-256 clones full body into ArrayBuffer per fresh asset — transient memory spike on low-RAM Taurus for large videos. One-time per asset.
5. Cache-Control `immutable,max-age=1yr` + sharp + SW range-request synthesis genuinely closes the 2026-05-21 "273MB→11.7GB egress" class on upload + playback. ✅

**Bottom line:** §1 signing/verification is solid; the old theater is genuinely
gone (traced every safeguard to a live caller, `ws_signer:ok` in prod). The two
real holes are both on the **fallback/offline tiers of life-safety delivery** and
both fail invisibly + would pass a Chrome-tab demo — which is exactly why they survived.
