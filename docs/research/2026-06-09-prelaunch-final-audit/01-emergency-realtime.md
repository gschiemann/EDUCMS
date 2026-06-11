# Section 1 — Real-time + Signed Pub/Sub (Emergency Chain)

**Auditor:** prelaunch-final-audit agent (frontier-model deep pass)
**Date:** 2026-06-10 (assignment dated 2026-06-09)
**Method:** full code trace of the trigger→fan-out→player chain + live read-only probes of https://venue-os.app. No emergency was triggered on live; no SUPER_ADMIN login; no data mutated.
**Live state at audit:** `GET /api/v1/health/emergency-path` → 200 `{db:ok, redis:ok, ws_signer:ok}` at commit `cf5772ae` (HEAD). SSE unauthenticated → 401. WS upgrade on the production API origin (`api-production-39a1.up.railway.app/realtime`) → **101 Switching Protocols** (verified with curl --http1.1).

## Coverage table (Section 1 bullets × lenses)

| Bullet | Coverage | D | UX | F |
|---|---|---|---|---|
| Emergency trigger / all-clear / per-screen overrides | covered | A | A- | A- |
| WS gateway signing + verification (timestamp unit, signature pass-through, freshness) | covered | A | n/a | A |
| Redis fan-out gate (verifyWsHmac on every replica pmessage) | covered | A | n/a | A |
| HTTP polling backstop via manifest | covered | A- | n/a | A |
| SSE controller fallback | covered | B+ | n/a | B+ |
| Player WS handlers (OVERRIDE, ALL_CLEAR, TENANT_CHANGED, SOS, TEXT_BROADCAST, MEDIA_ALERT, REFRESH_WEB, CHECK_FOR_UPDATES, SYNC) | covered | A | n/a | A- |
| Hold-to-trigger + typed-confirm consistency (desktop + /panic) | covered | A | A | A |
| Per-eventId dedup at every layer | covered | B | n/a | B (SSE layer lacks it — finding F-1) |

**Section grades: DESIGN A- / UX A / FUNCTIONALITY A-.** This is the strongest subsystem in the product. The chain is real (not theater), honestly documented, and most of the 2026-05/06 P0s are verifiably fixed in code. The deductions are the SSE-tier asymmetry and the fail-open revocation primitive described below.

---

## 1. The full chain, as traced

### Trigger (`POST /api/v1/emergency/trigger`, emergency.controller.ts:352-642)
1. `JwtAuthGuard` + `RbacGuard`; `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)` + `@AllowPanicBypass()` — a `canTriggerPanic=true` user of any non-RESTRICTED_VIEWER role may fire (rbac.guard.ts:69-76). RESTRICTED_VIEWER hard-blocked at the guard AND at the flag writer (users.controller.ts `PUT :id/can-trigger-panic` refuses to set it).
2. Zod strict boundary (`TriggerEmergencyInputSchema`, packages/api-types/src/index.ts:164): scopeType enum, Id ≤128, severity enum, textBlob ≤5000, URL ≤2048, `.strict()` rejects extra keys.
3. SSRF allowlist on `overridePayload.mediaUrl` (media-url-guard.ts) before anything else.
4. `resolveScopeTenant()` (emergency.controller.ts:267-317) — the single access gate: tenant scope = scopeId itself; group/device resolved from DB; non-SUPER callers strictly confined to their own tenant (403). Group/device 404 when absent.
5. Playlist-ownership check: an explicit `overridePayload.playlistId` must belong to the owning tenant (376-386) — closes the cross-tenant playlist-UUID paste.
6. State + audit atomic: tenant scope wraps `tenant.update(emergencyStatus + both orientation playlist pointers)` + `auditLog.create(TRIGGER_EMERGENCY)` + optional location-based per-screen `screenEmergencyOverride` upserts in ONE `$transaction` (488-517). Group/device scope persists per-screen `ScreenEmergencyOverride` rows + audit in one transaction (546-564) — so the **HTTP-poll-only kiosk sees group/device lockdowns too** (the 2026-06-01 fix, verified present).
7. `WebsocketSignerService.signMessage('OVERRIDE', payload)` → envelope `{eventId: uuid, timestamp: Date.now() ms, type, payload, signature: HMAC-SHA256(DEVICE_SECRET_KEY)}` (websocket-signer.service.ts:63-79).
8. `invalidateTenantState(scopeId)` busts the 2s manifest hot-cache (tenant scope; group/device scope doesn't need it — the manifest reads `screenEmergencyOverride` fresh per poll, screens.controller.ts:2535-2546).
9. `redis.publish('tenant|group|device:<id>', signed)`; failures swallowed + Sentry-tagged — screens fall to the manifest poll. Webhook dispatch + GPIO status-lamp are fire-and-forget and can never block or roll back the trigger.

### Fan-out gate (redis.service.ts:121-153)
Every replica's `pmessage` handler calls `verifyWsHmac(parsed, DEVICE_SECRET_KEY)` BEFORE fanning to the WS gateway and SSE service. ws-signature.ts: canonical string `eventId:timestamp:type:JSON(payload)`, constant-time compare with length pre-check, freshness ±120s (both stale AND future rejected). Stateless by documented design (a single-use nonce would starve all replicas but the first). The gate is type-agnostic — it covers OVERRIDE, ALL_CLEAR, SOS, TEXT_BROADCAST, MEDIA_ALERT, TENANT_CHANGED, REFRESH_WEB, CHECK_FOR_UPDATES, SYNC, GAME_STATE alike, since everything on `tenant:*`/`group:*`/`device:*` channels must verify. When Redis is down, `publish()` short-circuits directly into `handleRedisMessage` (same gate) for the in-process gateway.

### WS gateway (realtime.gateway.ts)
- HELLO auth: device JWT verified against `DEVICE_JWT_SECRET`; `dev_` tokens only outside production AND only with `DEV_WS_ALLOW=true` (loud warning).
- Revocation list checked (see finding F-3 — the primitive is fail-open).
- Tenant binding read from the LIVE Screen row, not the JWT claim; mismatch forces re-auth; groupId sourced live so group lockdowns reach pre-existing pairings (149-171).
- `AUTH_OK` ships `serverTime` so wrong-clock kiosks compute an offset (186-197).
- `broadcastToScope` passes the envelope's `signature`, `eventId`, and ORIGINAL signed `timestamp` (ms) through unchanged (255-290) — the 2026-05-26 P0-1 seconds-vs-ms fix is in place and commented.

### Player WS consumer (apps/web/src/app/player/page.tsx:3816-4100)
- `SENSITIVE_TYPES = {OVERRIDE, TENANT_CHANGED, SOS, TEXT_BROADCAST, MEDIA_ALERT, ALL_CLEAR_MESSAGE}` get: signature-presence check, 30s freshness using the server-clock offset, and per-eventId replay dedup (bounded Map: 5-min expiry, 500 cap) (3867-3901).
- **ALL_CLEAR is deliberately NOT optimistic**: it only triggers `fetchContent()`; the device-authed manifest is the SOLE arbiter of emergency state (3902-3916 + 3059-3084). A forged/replayed ALL_CLEAR cannot drop a real lockdown (manifest re-asserts), and a clock-skewed kiosk that boots post-clear cannot get stuck locked (ALL_CLEAR exempt from the freshness gate — player-006).
- All 9 required handlers present: OVERRIDE/ALL_CLEAR/SYNC → fetchContent; TENANT_CHANGED → full tenant-scoped local wipe (token, manifest cache, emergency cache, SW tiers, native unpair) (3922-3937); SOS/TEXT_BROADCAST/MEDIA_ALERT → `setPushedEmergencyMessage` (reads both `text` and `textBlob` — the blank-broadcast fix); ALL_CLEAR_MESSAGE → clear; REFRESH_WEB with 0-8s jitter + scope match; CHECK_FOR_UPDATES gated behind operator confirm; plus GAME_STATE/CTS_MANUAL_CUE (correctly non-sensitive tier).
- Emergency state cached locally (`edu_emergency_cache_v1`) for power-cycle ride-through.

### SSE fallback (sse.controller.ts / sse.service.ts / player 3636-3755)
- Engaged after ≥3 WS failures; device JWT in query (EventSource limitation, documented); revocation checked; tenant + group resolved from the live screen row; 25s keepalive comments; full signed envelope forwarded (RedisService hands `parsed` — eventId/timestamp/signature included in the SSE `data:`).
- Player registers SYNC, OVERRIDE, ALL_CLEAR, CHECK_FOR_UPDATES, REFRESH_WEB, SOS, TEXT_BROADCAST, MEDIA_ALERT, ALL_CLEAR_MESSAGE. See findings F-1/F-2 for what it skips.
- After 2 SSE failures → 5s HTTP poll (`fetchContent`) — the floor tier.

### HTTP-poll backstop
- Manifest (device-authed) carries flat `isEmergency/emergencyType/emergencySeverity/emergencyScope[/Note]/emergencyExpiresAt` (screens.controller.ts:2593-2840); player consumes the flat shape (P0-2 fix verified, page.tsx:3059-3077). Per-screen override read fresh each poll with read-time expiry handling; tenant state behind a 2s in-process cache busted on trigger/clear.
- `GET /emergency/status` (user-session, tenant-scoped, SUPER_ADMIN may pass tenantId) and `GET /emergency/messages` (device-JWT-only, `kind==='device'` hard-required, scope filter limited to the screen's own tenant/group/device memberships, live-row tenant resolution) — the P0-2 kiosk-poll fix verified present (emergency.controller.ts:1282-1333). EmergencyOverlay self-polls every ~10s.

### All-clear (audited as thoroughly as trigger)
- `POST /:overrideId/all-clear` (644-811): same scope gate; tenant scope atomically clears status + BOTH orientation pointers + deletes **all** tenant ScreenEmergencyOverride rows + audit; device scope deletes the row (emergency-003 fix — no stuck-after-reboot); group scope deletes rows for the group's screens (2026-06-01 symmetric fix). Hot-cache invalidated; ALL_CLEAR **signed** (the player would treat an unsigned ALL_CLEAR_MESSAGE as droppable and the manifest as arbiter regardless); webhook + GPIO-low mirrors; Sentry-tagged publish failures.
- `POST /messages/:messageId/all-clear`: 404 on unknown id; tenant ownership enforced; atomic cleared-at + audit; signed ALL_CLEAR publish.
- The overrideId path param is informational-only for audit pairing (dashboard passes the real one; mints `clear_<uuid>` otherwise — emergency-002 fix). The player never trusts it; safe.

### Operator UX (consistency check)
- **Desktop** (`EmergencyTriggerModal.tsx`): type selection (6 SRP types) + per-type typed-confirm word (HOLD/SECURE/LOCKDOWN/EVACUATE/SHELTER/MEDICAL — distinct words prevent firing Lockdown when Hold was meant); fire button disabled until exact match; local emergency state flips ONLY after server confirms; Enter-key equivalence; aria announcements.
- **Mobile `/panic`**: 3000ms hold-to-trigger with cancel-on-release, keyboard hold path, assertive aria-live, and differentiated failure copy ("Your account no longer has emergency-trigger authority / Could not reach the server — NOTIFY SECURITY MANUALLY now — your alert was NOT broadcast"); polls /emergency/status for the dashboard's all-clear.
- **Dashboard all-clear** (`layout/EmergencyOverlay.tsx`): typed "CLEAR" confirm inside an alertdialog that owns the screen; passes the original overrideId for trigger/clear audit pairing.
- Both trigger surfaces converge on the same server action → same endpoint → same guard chain. Consistent deliberate friction on trigger AND clear. Covered.

### Live infra note (verified, not a finding)
`venue-os.app/api/v1/*` is a **Vercel rewrite** to Railway (`apps/web/vercel.json`) — Vercel rewrites do not proxy WS upgrades, and `wss://venue-os.app/realtime` 404s. This is fine because the production web build points `NEXT_PUBLIC_API_URL` directly at the Railway origin (deploy-reliability.yml:176 mirrors prod) where the upgrade succeeds (101 verified), and paired kiosks persist an explicit `?api=` root. Worth keeping in mind if anyone "simplifies" the env to the venue-os.app proxy — that change would silently kill the WS tier fleet-wide (SSE/poll would mask it). Recommend a comment in vercel.json + a prod-smoke WS-upgrade probe.

---

## 2. Findings

### F-1 (P2) — SSE tier skips every client-side gate the WS tier enforces (freshness, eventId dedup, signature presence)
**Evidence:** player/page.tsx:3667-3681 — the SSE `handle()` wrapper parses and calls handlers directly; comment admits "SSE doesn't have the signed-replay protection the WS path uses." The WS gate at 3867-3901 enforces all three. The full signed envelope IS available in the SSE `data:` (sse.service.ts `writeEvent` serializes the parsed envelope; the wrapper even destructures `data?.payload || data`), so the asymmetry is implementation, not protocol.
**Impact:** bounded — the server-side HMAC gate + device-JWT-authed stream sit upstream, and OVERRIDE/ALL_CLEAR on SSE only re-fetch the authoritative manifest. The sharpest edge: `handle('ALL_CLEAR_MESSAGE', () => setPushedEmergencyMessage(null))` clears an active SOS/broadcast overlay with no freshness/dedup/server re-confirm (the ~10s EmergencyOverlay poll re-asserts). The Standard Audit Surface requirement "per-eventId dedup at every layer" is not met at this layer.
**Fix:** extract the SENSITIVE_TYPES gate (signature presence, 30s adjusted freshness, eventId dedup) into one function and run it inside the SSE wrapper on the envelope before dispatch. ~30 lines, no protocol change.

### F-2 (P2) — TENANT_CHANGED has no SSE handler: re-paired kiosks behind WS-blocking proxies never wipe old-tenant state
**Evidence:** SSE registrations at player/page.tsx:3682-3741 cover 9 event names but not TENANT_CHANGED; the WS handler (3922-3937) wipes device token, manifest/emergency caches, SW cache tiers, and triggers native unpair. Publisher exists: screens.controller.ts:1216-1232 signs + publishes TENANT_CHANGED to the OLD tenant channel on re-pair.
**Impact:** the exact environment SSE exists for (Squid/ZScaler/iboss school proxies) is the one where a screen moved between schools keeps the previous school's cached content, device token, and SW-cached assets on disk until manual re-pair. Cross-tenant data-at-rest on a wall device.
**Fix:** `handle('TENANT_CHANGED', ...)` calling the same wipe routine (factor the WS branch into a function). Also consider a manifest-poll-side tenant-id change detector as the floor-tier equivalent.

### F-3 (P2) — KNOWN-OPEN, sharpened: device-token revocation is fail-OPEN while the code comments claim fail-closed
**Evidence:** `RedisService.sismember` returns `false` when Redis is unavailable or errors (redis.service.ts:172-183 — "fail-open for dev"). The WS gateway (realtime.gateway.ts:134-141) and SSE controller (sse.controller.ts:69-76) wrap it in try/catch with comments asserting "fail-closed posture… a transient Redis blip → reject too" — but the primitive never throws, so those catches are unreachable: a revoked 365-day device JWT keeps connecting/streaming whenever Redis is down. Contrast the genuinely fail-closed user path: `getTokenInvalidBefore` THROWS on Redis error and jwt-auth.guard.ts:114-115 rejects.
**Status vs prior audits:** 2026-06-09 REPORT H1 noted "revocation is a silent no-op on Redis-less deploys"; this finding pinpoints that the WS/SSE comments are safeguard-theater (the 2026-05-21 lesson class). Live Redis is currently healthy, so no active exposure today.
**Fix:** add `sismemberStrict()` that throws on unavailable/error; use it in the WS HELLO + SSE auth paths to match their stated posture (player reconnect/backoff already tolerates rejects). At minimum, boot-WARN when REDIS_URL unset in production.

### F-4 (P3) — Multi-replica manifest hot-cache invalidation is local-pod only
**Evidence:** manifest-hot-cache.ts — in-process Map; `invalidateTenantState` deletes only the local entry; documented "if we horizontally scale… per-pod divergence is still bounded by TTL (2s)."
**Impact:** none at one replica (today). At N replicas, a poll hitting another pod can see pre-trigger state for ≤2s — acceptable but should be on the same "before second replica" checklist as the prior audit's H5 (Redis-backed counters).
**Fix:** when scaling: publish a cache-bust on a Redis channel or accept + document the 2s bound in the scale runbook.

### F-5 (P3) — SUPER_ADMIN tenant-scope trigger against a nonexistent tenantId → 500 instead of 404
**Evidence:** emergency.controller.ts:488-496 — `tenant.update({where:{id:scopeId}})` throws Prisma P2025 when the row is missing; `resolveScopeTenant` never verifies existence for scopeType='tenant' (non-SUPER callers are safe because scopeId must equal their own real tenantId).
**Fix:** the `tenantInfo` lookup at 412 already ran — `if (!tenantInfo) throw new NotFoundException(...)` before the transaction.

### F-6 (P3) — Stale life-safety comments that will mislead the next responder
**Evidence:** player/page.tsx:3840 claims "server signs with a 10s window" (actual verify window is 120s, ws-signature.ts `maxAgeMs = 120_000`); websocket-signer.service.ts:48 cites "player/page.tsx:3465" for the dedup set (drifted, now ~3887); gateway comment cites "page.tsx:3424" for the freshness gate (now ~3883).
**Fix:** correct the numbers or replace with greppable anchors (e.g. "see SENSITIVE_TYPES gate").

### F-7 (P3) — `/emergency/sos` is CONTRIBUTOR-wide with only the global 600/min/IP throttle
**Evidence:** emergency.controller.ts:833-934 (no canTriggerPanic requirement — intentional per comment, hold-to-trigger UX + per-attempt audit are the stated mitigations); app.module.ts:158 global ThrottlerModule 600/min.
**Impact:** a compromised CONTRIBUTOR account can paint tenant-wide CRITICAL SOS overlays at up to 10/sec bursts (each audited, each clearable). Alert-fatigue/abuse vector, not a safety failure.
**Fix:** per-user `@Throttle` on /sos (e.g. 10/min) — generous enough to never gate a real human, tight enough to bound floods. Never throttle the FIRST request.

### F-8 (P3) — Document the full breadth of `canTriggerPanic`
**Evidence:** `@AllowPanicBypass()` sits on /trigger, /broadcast, /media-alert, both all-clear endpoints, and screen-emergency trigger/all-clear/bulk-trigger (emergency.controller.ts:353/645/941/1019/1107; screen-emergency.controller.ts:363/402/503). The dashboard toggle copy says "Can trigger panic," but the capability also grants tenant-wide text broadcasts, media alerts, and clears.
**Impact:** intended (a panic station must clear what it fires — emergency-009), but admins granting the flag should see the real scope.
**Fix:** one sentence in the Team-Members toggle tooltip + CLAUDE.md emergency section.

---

## 3. Verified solid (including prior-audit items re-verified)

- **The HMAC chain is real end-to-end** — signer (websocket-signer.service.ts:63), single-source canonical (ws-signature.ts), gate wired at every replica's pmessage (redis.service.ts:137) AND on the Redis-down direct path; constant-time compare; ±120s freshness; live `ws_signer: ok`.
- **P0-1 (timestamp ms vs s)** fixed and traced: gateway `send()` passes the original signed ms timestamp (realtime.gateway.ts:307-327).
- **H1 panic-capability staleness: FIXED** (was KNOWN-OPEN in 2026-06-09 REPORT) — `PUT users/:id/can-trigger-panic` tightening calls `revokeUserTokens` → `markUserTokensInvalid` (users.controller.ts:90, 352-420); guard enforces `iat < invalid-before` fail-closed (jwt-auth.guard.ts:114-115; redis.service.ts:219-252 monotonic epoch, +1s same-second guard).
- **All-clear is symmetric and stuck-proof**: atomic status+rows+audit in every scope (emergency-003 + group variant verified); manifest-as-sole-arbiter on the player kills both "forged ALL_CLEAR clears a real lockdown" and "kiosk stuck locked after clear."
- **Group/device emergencies reach poll-only kiosks** (per-screen override upserts on trigger; fresh per-poll manifest read; expiry honored read-time).
- **Cross-tenant containment at every emergency write**: resolveScopeTenant; playlist-ownership check; message-clear tenant check; screen-emergency tenant-filtered screen resolution; device /messages scope filter (tenant/group/device membership only); /status hardened to caller tenant.
- **Clock-skew engineering**: AUTH_OK serverTime offset; ALL_CLEAR exempt from freshness; skew warning log.
- **Player dedup + freshness + signature-presence on WS sensitive types** with bounded memory; TENANT_CHANGED full local wipe (WS).
- **Input hygiene**: Zod strict + bounded everywhere; SOS location CR/LF/TAB strip (log-injection defense, emergency-007); SSRF allowlist on every operator-supplied media/audio URL incl. SOS voice clips.
- **Failure posture**: Redis publish failures swallowed + Sentry-tagged, never block the response; GPIO/webhooks fire-and-forget; Redis bring-up hard-capped at 7s so boot can't hang; ALL emergency state readable via authed HTTP when realtime is dark.
- **Operator UX**: typed-confirm with per-type SRP words (desktop), 3s hold (mobile), typed CLEAR (dashboard all-clear), server-confirm-before-state-flip, "NOTIFY SECURITY MANUALLY — your alert was NOT broadcast" copy, assertive aria-live everywhere.
- **Live probes**: emergency-path 200 all-ok at HEAD commit; SSE 401 unauthenticated; WS 101 on the production Railway origin; CI has a dedicated emergency-path.yml workflow.

## 4. Missing features (this section's lens)
- Player-side cryptographic signature **verification** (per-tenant Ed25519 at pair time) — presence-check only today; documented follow-up (G8 accepted by prior audit; ws-ed25519.ts exists server-side).
- Emergency broadcast SUCCESS-path E2E (task #206 pending — only the failure path is covered by tests today).
- Prod-smoke probe asserting the WS upgrade (guards the Vercel-rewrite trap above).

## 5. Scope notes
All Section-1 bullets covered; nothing deferred. Live trigger intentionally NOT exercised (hard rule); functional verification is code-trace + read-only live probes + the existing emergency-path CI. Items already in the 2026-06-09 full-audit REPORT / 2026-06-08 synthesis were verified rather than re-reported (H1 → fixed; G8 → confirmed-as-designed; H5/per-replica → F-4 cross-ref).
