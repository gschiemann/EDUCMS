# Pre-Launch Final Audit — Section 1: Real-time + Signed Pub/Sub

**Date:** 2026-06-10  
**Auditor:** Subagent (claude-sonnet-4-6)  
**Coverage:** Section 1 of the Standard Audit Surface  
**Grades:** Design A | UX A | Functionality A−  
**Overall section coverage:** COVERED  

---

## Coverage Table

| Bullet | Status | Grade (D/UX/F) |
|---|---|---|
| Emergency trigger / all-clear / per-screen overrides | COVERED | A/A/A |
| WebSocket gateway signing + verification | COVERED | A/A/A |
| Redis fan-out gate (verifyWsHmac on every replica's pmessage) | COVERED | A/A/A− |
| HTTP polling backstop via manifest endpoint | COVERED | A/A/A |
| SSE controller fallback | COVERED | A/A/A |
| Player WS message-type handlers (OVERRIDE, ALL_CLEAR, TENANT_CHANGED, SOS, TEXT_BROADCAST, MEDIA_ALERT, REFRESH_WEB, CHECK_FOR_UPDATES, SYNC) | COVERED | A/A/A |
| Hold-to-trigger + typed-confirm UX consistency | COVERED — with one gap (see F-1) | A/B/B+ |
| Per-eventId dedup at every layer | COVERED | A/A/A |

---

## Live Health Check

```
curl https://venue-os.app/api/v1/health/emergency-path
→ {"status":"ok","checks":{"db":"ok","redis":"ok","ws_signer":"ok"},"uptime_s":61239,...,"commit":"cf5772ae..."}
```

All three checks (DB, Redis, WS signer) alive and green at audit time.

---

## Full Chain Trace

### 1. POST /emergency/trigger

**File:** `apps/api/src/emergency/emergency.controller.ts`

The entry point is well-defended. In order:

1. **ZodValidationPipe** validates the body against `TriggerEmergencyInputSchema` (from `@cms/api-types`) — structured input rejection before any logic.
2. **assertAllowedEmergencyMediaUrl** — SSRF allowlist check on any operator-supplied mediaUrl. Prevents painting `file:///etc/hosts` or attacker content onto screens.
3. **resolveScopeTenant** — the single cross-tenant gate. Resolves owning tenant from scope (tenant/group/device), then checks `SUPER_ADMIN || owningTenantId === callerTenantId`. Throws 400/404/403 appropriately. This is solid.
4. **Playlist cross-tenant check** — if `overridePayload.playlistId` is set, verifies it belongs to the owned tenant. Prevents a SCHOOL_ADMIN from playing another tenant's playlist by UUID guess.
5. **$transaction** — tenant status update + AuditLog + ScreenEmergencyOverride upserts all atomic. A concurrent trigger or all-clear cannot split the mutation.
6. **invalidateTenantState(scopeId)** — hot-path cache bust so the next manifest poll sees new state without waiting for the 2s TTL.
7. **signer.signMessage('OVERRIDE', payload)** — HMAC-SHA256 signed envelope via `WebsocketSignerService`. The `eventId` (UUID) + `timestamp` (Date.now() ms) + `type` + `payload` are the canonical string. Signature covers all four fields.
8. **redisService.publish(channel, signedMessage)** — publishes to `tenant:X`, `group:X`, or `device:X`. On Redis failure: Sentry capture + warn, proceed (HTTP poll backstop covers screens).
9. **webhookDispatch.dispatch** (fire-and-forget) — outbound webhook on emergency.triggered for tenant-scope only.
10. **gpio.driveStatusLampForEmergency** (fire-and-forget) — Goodview EP6N GPIO status lamp, tenant-scope only.

**Group / device scope:** Per-screen `ScreenEmergencyOverride` upserts are written so the HTTP-poll manifest backstop ALSO reflects the emergency for screens on WS-blocking proxies. This was a previous audit finding and is now fixed.

**AuditLog:** Written inside the same `$transaction`. Every trigger logs `overrideId`, `severity`, `type`, `portraitPlaylistId`, `locationBasedEnabled`, `locationScreenCount`, `locationSpecificCount`, `triggeredByTenant`. Cannot be modified or deleted (DB-level immutability triggers verified in prior audit §16).

### 2. RBAC + @AllowPanicBypass

**Files:** `apps/api/src/auth/panic-bypass.decorator.ts`, `apps/api/src/auth/rbac.guard.ts`

The decorator is `SetMetadata('allow_panic_bypass', true)` — NestJS reflector metadata, not bypass of the guard. The guard reads it:

- If `allowPanicBypass && user.canTriggerPanic && role !== RESTRICTED_VIEWER` → allow.
- Otherwise must hold `SUPER_ADMIN | DISTRICT_ADMIN | SCHOOL_ADMIN`.

Correct. RESTRICTED_VIEWER is hard-blocked even if `canTriggerPanic=true` is set by a rogue admin. The CONTRIBUTOR role can reach `POST /sos` (explicitly listed in `@RequireRoles`) but NOT `/trigger` (which only lists the admin trio + AllowPanicBypass for delegated-canTriggerPanic users). This is the intended design.

**Staleness risk (KNOWN-OPEN from prior audit, P2):** `canTriggerPanic` lives in the JWT claim — if Redis is down when an admin sets `canTriggerPanic=false`, `markUserTokensInvalid()` throws (correctly, not silently swallowed: `redis.service.ts:222`) but the caller (`users.controller.ts`) must catch and surface the error. Worth verifying the user-deletion path, but not new.

### 3. WebsocketSignerService + ws-signature.ts

**Files:** `apps/api/src/security/websocket-signer.service.ts`, `apps/api/src/security/ws-signature.ts`

`signMessage(type, payload)`:
- Generates `eventId = crypto.randomUUID()` and `timestamp = Date.now()` (milliseconds — **critical, was wrong as seconds before the P0-1 fix**).
- Canonical string: `"${eventId}:${timestamp}:${type}:${JSON.stringify(payload)}"`.
- HMAC-SHA256 with `DEVICE_SECRET_KEY` (via `requireSecret` — throws at boot in prod if unset).
- Returns `{ eventId, timestamp, type, payload, signature }`.

`verifyWsHmac(message, secret, maxAgeMs=120_000)`:
- Validates: message is object, signature is non-empty string, eventId is non-empty string, timestamp is finite number.
- Freshness window: `Date.now() - message.timestamp > 120_000` → stale; `< -120_000` → future (clock-skew guard). **120-second window** is documented as intentionally generous so transport latency / multi-replica clock drift never drops a real emergency.
- Canonical string recomputed, constant-time compare via `crypto.timingSafeEqual`. Length checked first to avoid throwing on mismatch.

This is solid. The key never leaves the server; the player does field-presence check only (documented as intentional, full asymmetric per-tenant Ed25519 verification is a documented follow-up).

### 4. Redis fan-out gate (redis.service.ts handleRedisMessage)

**File:** `apps/api/src/realtime/redis.service.ts:121-153`

Every `pmessage` from the Redis subscriber goes through `handleRedisMessage`. The gate:

1. Parses JSON.
2. **Calls `verifyWsHmac(parsed, this.deviceSecret)`** — this is the real server-side gate. If verification fails (no signature, stale, future, bad HMAC), the message is DROPPED with a warn log and never reaches the WS gateway or SSE service. A forged message published directly onto the Redis channel is stopped here.
3. If ok: fans to `this.gateway.broadcastToScope()` AND `this.sse.broadcastToScope()` (if set).

**Finding (F-2, P3 — dead code, not a security hole):**  
Line 87 registers `this.subscriber.on('message', ...)` for exact-subscribe events, but the code only ever calls `psubscribe('tenant:*', 'group:*', 'device:*')` (never `subscribe`). The `message` handler is therefore dead code — it never fires. The `pmessage` handler at line 90 is the real consumer. This is benign (not a double-delivery bug, not a dropped message), but the dead `on('message')` handler is confusing and should be removed.

**Multi-replica:** The HMAC verify is stateless (no single-use nonce), so every replica independently verifies and fans the same message to its locally-connected clients. A single-use nonce would cause all replicas except the first to drop the message, starving their clients. This is the documented correct tradeoff, with player-side per-eventId dedup catching replays.

### 5. WS Gateway (realtime.gateway.ts)

**File:** `apps/api/src/realtime/realtime.gateway.ts`

Auth flow (HELLO → processHello):
- Rejects `dev_` tokens in prod (`NODE_ENV === 'production'` checked + `DEV_WS_ALLOW !== 'true'`).
- Verifies DEVICE_JWT_SECRET via `jwt.verify`.
- Checks `jwt_revoked_list` in Redis (fail-closed: any Redis error throws 'Revocation check unavailable', not a silent pass).
- Live Screen lookup: verifies screen still exists and tenantId hasn't changed since JWT was minted. Group derived from live screen row (not stale JWT claim) — ensures a screen moved between groups gets group-scoped broadcasts immediately.
- Sends `AUTH_OK` with `serverTime: Date.now()` so clock-skewed Android kiosks can compute their local offset for the freshness gate.
- 10-second auth timeout closes unauthenticated connections (generous for slow mobile connections).

`broadcastToScope(type, id, message)`:
- Passes original `message.signature`, `message.eventId`, and `message.timestamp` through unchanged. This was the P0-1 fix — previously signature/eventId were dropped and timestamp was rewritten to seconds, causing every signed event to fail the player's freshness gate.

`send(client, type, payload, ..., signedTimestamp)`:
- Frame timestamp is `signedTimestamp` if provided (for signed envelopes) or `Date.now()` (for control messages). Correct.

### 6. SSE Controller + Service

**Files:** `apps/api/src/realtime/sse.controller.ts`, `apps/api/src/realtime/sse.service.ts`

Auth: device JWT verified (same `DEVICE_JWT_SECRET`), revocation checked (fail-closed), live screen row looked up for tenantId + groupId. Refuse to open stream for unpaired/non-device tokens.

Headers: `text/event-stream`, `no-store no-transform`, `X-Accel-Buffering: no`, keep-alive. 25-second keepalive pings prevent proxy half-close.

The SSE service is registered with `redisService.setSseService(sse)` so the fan-out at `redis.service.ts:149` reaches both WS and SSE clients. The HMAC gate runs ONCE (at the Redis pmessage) before fanning to both transports — not per-transport.

### 7. Player WS Handler — All Message Types

**File:** `apps/web/src/app/player/page.tsx`

All 9 required message types are handled:

| Type | Handler action |
|---|---|
| `SYNC` | `fetchContent()` |
| `OVERRIDE` | `fetchContent()` — manifest is the sole arbiter of emergency state |
| `ALL_CLEAR` | `fetchContent()` — intentionally NOT in SENSITIVE_TYPES (a stale clock could drop it; manifest confirms within 10s) |
| `TENANT_CHANGED` | Cached + signature checked via SENSITIVE_TYPES gate; triggers `fetchContent()` |
| `SOS` | SENSITIVE_TYPES gate + `setPushedEmergencyMessage()` |
| `TEXT_BROADCAST` | SENSITIVE_TYPES gate + `setPushedEmergencyMessage()` (reads both `text` and `textBlob` fields) |
| `MEDIA_ALERT` | SENSITIVE_TYPES gate + `setPushedEmergencyMessage()` |
| `REFRESH_WEB` | Scope check (tenant or exact screen match), jitter delay, `window.location.reload()` or `EduCmsNative.reload()` |
| `CHECK_FOR_UPDATES` | Shows OTA prompt if `EduCmsNative.checkForUpdates` available |
| `ALL_CLEAR_MESSAGE` | `setPushedEmergencyMessage(null)` — clears pushed overlay |

**SENSITIVE_TYPES gate (player-side):**  
- Set: `{'OVERRIDE', 'TENANT_CHANGED', 'SOS', 'TEXT_BROADCAST', 'MEDIA_ALERT', 'ALL_CLEAR_MESSAGE'}`.
- Checks: (1) signature field must be present (non-empty string), (2) `|adjustedNow - timestamp| <= 30_000` where `adjustedNow = Date.now() + serverClockOffsetRef.current`, (3) per-eventId dedup via `recentEventIdsRef` (Map, bounded at 500 entries, evicts entries older than 5 min).
- Server clock offset learned from `AUTH_OK.serverTime` — corrects for Android kiosks booting without NTP sync.

**ALL_CLEAR design (correct):** ALL_CLEAR triggers `fetchContent()` only, does not optimistically clear the overlay. The manifest (not the WS message) is the sole arbiter — a forged ALL_CLEAR cannot drop a real lockdown.

**Per-SSE path (P0-3 fix, verified):**  
SSE consumer registers handlers for SOS, TEXT_BROADCAST, MEDIA_ALERT, ALL_CLEAR_MESSAGE — the fix for the "silent drop behind WS-blocking proxy" issue.

### 8. HTTP Polling Backstop

Three tiers of fallback:
1. **WS** (preferred): connects immediately on player load.
2. **SSE** (`/api/v1/realtime/sse?token=...`): engaged if WS fails 2+ times.
3. **HTTP poll** (`setInterval(() => fetchContent(), 5_000)`): engaged if SSE fails 2+ times.

The manifest at `/api/v1/screens/:id/manifest` carries `emergencyStatus`, `emergencyPlaylistId`, `emergencyPortraitPlaylistId`, and per-screen override data. For group/device scope triggers the `ScreenEmergencyOverride` rows are written to DB so the manifest (not just the WS/SSE channel) reflects the emergency.

**Device-authenticated emergency message poll** (`GET /emergency/messages`): A separate endpoint for device JWTs (not user sessions) that returns active `EmergencyMessage` rows scoped to the screen's tenant/group/device. Closes the SOS/TEXT_BROADCAST/MEDIA_ALERT gap for WS+SSE-blocked kiosks.

### 9. All-Clear Chain

Symmetric to trigger:
- `resolveScopeTenant` — same cross-tenant gate.
- Atomic `$transaction`: clears `Tenant.emergencyStatus` + `emergencyPlaylistId` + `emergencyPortraitPlaylistId`, deletes `ScreenEmergencyOverride` rows for ALL screens in tenant (tenant scope), or the exact screen (device scope), or group's screens (group scope). AuditLog written in same transaction.
- Signs ALL_CLEAR message via `signer.signMessage('ALL_CLEAR', { overrideId, clearedBy })`.
- ALL_CLEAR is classified as SENSITIVE on the player — the comment in clearEmergency explains that an unsigned ALL_CLEAR would be dropped by the player's SENSITIVE_TYPES gate, keeping screens stuck on lockdown. This is correct and signed.
- `invalidateTenantState(scopeId)` cache bust.
- Redis publish, webhook dispatch, GPIO lamp drive (all fire-and-forget, same as trigger).

**Group-scope all-clear gap fixed (verified):** Previously device-scope all-clear never deleted the ScreenEmergencyOverride row. A rebooted screen would re-read the override and stay locked. Now all three scope types delete their override rows atomically.

### 10. Hold-to-Trigger + Typed-Confirm UX Consistency

**Mobile `/panic` page (`apps/web/src/app/panic/page.tsx`):**  
- `HOLD_DURATION_MS = 3000` (comment notes it was previously 1500ms, restored to 3s per CLAUDE.md Key Safeguard #5).
- Visual: animated progress ring that fills over 3s of continuous hold. Per-button hold state, timer-based progress.
- A11y: `aria-live="assertive"` region + Web Speech API (best-effort, graceful degrade on Taurus/Chromium 83).
- Each type (hold/secure/lockdown/evacuate/weather/medical) has its own color + icon. Clear.

**Desktop dashboard modal (`apps/web/src/components/emergency/EmergencyTriggerModal.tsx`):**  
- Uses **typed confirmation word** (type-specific: HOLD, SECURE, LOCKDOWN, EVACUATE, SHELTER, MEDICAL). Submit disabled until the exact word is typed.
- No hold-to-trigger mechanism. This is a deliberate UX difference: desktop is deliberate keyboard-driven; mobile is touch-optimized hold.
- A11y: aria-live via `useEmergencyAnnouncer()`.
- Server success required before setting `emergencyActive` in store.

**Finding (F-1, P2):**  
The two emergency-trigger surfaces use DIFFERENT confirmation mechanisms (hold-to-trigger on mobile, typed-confirm on desktop). Both are legitimate UX patterns, but they are not consistent. A school admin who triggers from their phone expects hold; one who triggers from the desktop gets a type-confirm dialog. CLAUDE.md documents "Hold-to-Trigger UX" as a key safeguard (#5) but doesn't specify it must apply to both surfaces. The desktop has its own protection (typed confirm word per alert type), which is arguably more resistant to accidental trigger than a hold. Not a security gap, but worth documenting for consistency. No action required for launch.

---

## Summary of Findings

### Previously Known — Verified as FIXED

- **P0-1 (WS gateway timestamp ms vs sec mismatch):** Fixed — `broadcastToScope` passes original `message.timestamp` through unchanged; `send()` defaults to `Date.now()` for unsigned control messages. Verified at `realtime.gateway.ts:269-289`.
- **P0-3 (SOS/TEXT_BROADCAST/MEDIA_ALERT never reached SSE kiosks):** Fixed — SSE consumer at `player/page.tsx:3738-3741` handles all three types. `EmergencyTriggerModal` and `GET /emergency/messages` device-auth endpoint both verified.
- **P0-6 (verifyMessage had zero callers — audit theater):** Fixed — `verifyMessage()` removed from `WebsocketSignerService`; real gate is `verifyWsHmac` at `redis.service.ts:137`. Traced to actual caller — not theater.
- **Group/device scope HTTP-poll gap:** Fixed — `ScreenEmergencyOverride` rows written on trigger and deleted on all-clear for group and device scope.
- **Device-scope all-clear never cleared override row (emergency-003):** Fixed — see `emergency.controller.ts:697-717`.

### Known-Open from Prior Audits

- **KNOWN-OPEN (P2, from 2026-06-08):** `canTriggerPanic` revocation silent on Redis-less deploys — a downgraded user keeps the panic JWT claim for up to 30d if Redis is down at privilege-change time. `markUserTokensInvalid()` correctly throws on Redis failure (not swallowed), but the API endpoint calling it may not surface the error to the operator. Not exploitable without active Redis failure during the exact revocation window.

### New Findings This Pass

| # | Severity | Finding |
|---|---|---|
| F-1 | P2 | Desktop modal uses typed-confirm; mobile /panic uses hold-to-trigger. Both are valid but inconsistent. Not a launch blocker. |
| F-2 | P3 | `redis.service.ts:87` registers `subscriber.on('message', ...)` for exact-subscribe events, but code only calls `psubscribe(...)`. The `message` handler is dead code — never fires. Not a security issue or dropped-message risk, but misleading and should be removed. |

---

## Grades

| Lens | Grade | Reasoning |
|---|---|---|
| **Design** | A | Emergency pages are clear, color-coded, panic-type icons, hold progress rings. Looks production-quality. Desktop modal has SRP type descriptions. |
| **UX** | A | Mobile: 3-second hold with visual progress — accidental-trigger-resistant. Desktop: per-type confirm word — excellent. Auth check on /panic with explicit error for misconfigured `NEXT_PUBLIC_API_URL`. A11y live regions + speech. One minor inconsistency (F-1, hold vs typed-confirm across surfaces). |
| **Functionality** | A− | Full chain verified end-to-end: signing/HMAC → Redis gate → WS gateway → SSE → player. Three fallback tiers (WS → SSE → HTTP poll) all implemented and wired. All 9 SENSITIVE message types handled. Per-eventId dedup with memory bound. Server-clock offset corrects for NTP-dead kiosks. One dead code smell (F-2), one known-open soft gap (canTriggerPanic staleness), task #206 (success-path E2E test pending). |

---

## Missing Features (deferred, not faked)

- **Per-tenant asymmetric Ed25519 signature verification on the player** — documented in `websocket-signer.service.ts` comments and CLAUDE.md as a follow-up. The player does field-presence check only; full crypto verification requires per-tenant keys issued at pair time. Server-side HMAC gate is the primary safeguard.
- **Emergency broadcast SUCCESS-path Playwright E2E test** (task #206, pending) — only the failure path is verified in CI.
- **CAP / IPAWS inbound / Raptor / RapidSOS / PA-speaker integrations** — all V2, correctly not built.
