# Wave C — Emergency triggering end-to-end (CD1)

**Surface:** The complete life-safety emergency path — trigger / all-clear /
SOS / broadcast / media-alert across tenant/group/device scope, the signed
WS chain, the SSE + HTTP-poll fallback tiers, the player consumers, and the
immutable audit trail.

**Scale tier:** Load-bearing / life-safety (the "emergency moat" — the wedge
the whole product is sold on). This is the one path where a silent failure
can get someone hurt.

**Standard Audit Surface §§ covered:** §1 (real-time + signed pub/sub) — FULL;
§16 (forensic / audit coverage) — FULL. Adjacent: §10 (auth — panic-token
staleness, JWT revocation), §15 (Chromium-83 player safety on the overlay).

**Method:** read-only code trace of every layer + live `curl` against prod
(`api-production-39a1.up.railway.app`). NO live broadcast was fired on any
shared scope (per ground rules). Verification is code-trace + endpoint-shape
+ prod health probes.

---

## Provider-by-provider classification table

"Provider" here = each documented safeguard / tier / scope in the emergency
path. The lead's 2026-05-21 standard: trace every documented safeguard to its
real callers — assumed-working ≠ working.

| provider / integration | REAL / COSTUME / NOT-BUILT / DEFERRED | evidence (file:line / curl) | notes |
|---|---|---|---|
| `POST /emergency/trigger` (all 4+ panic types) | **REAL** | `emergency.controller.ts:352-642`; enum `lockdown/weather/evacuate/hold/secure/medical` at `packages/api-types/src/index.ts:131-134` (6 types — SRP-aligned, not 4) | Zod-validated `.strict()`, writes `Tenant.emergencyStatus` + both orientation playlist pointers in a `$transaction` with the audit row. |
| trigger × **tenant** scope | **REAL** | `:404-517` — updates `emergencyStatus`, `emergencyPlaylistId`, `emergencyPortraitPlaylistId` + audit, atomically | Also auto-resolves panic-playlist by type, location-based per-screen overrides. |
| trigger × **group** scope | **REAL** | `:518-565` + `buildScreenEmergencyUpserts` `:199-240` — writes per-screen `ScreenEmergencyOverride` rows so the HTTP-poll manifest backstop sees it | This was the 2026-06-01 fix; group scope reaches poll-only kiosks now. |
| trigger × **device** scope | **REAL** | `:527-565`; per-screen override + audit atomically | Plus dedicated `screen-emergency.controller.ts` (`:362 /:screenId/trigger`, `:502 bulk-trigger`). |
| all-clear `POST /:overrideId/all-clear` | **REAL** | `:644-811` — clears tenant status + `deleteMany` overrides + audit atomically; signs `ALL_CLEAR`; device/group variants delete per-screen rows (`:696-748`, emergency-003 fix) | All 3 scopes delete their override rows so a rebooted kiosk doesn't re-read a stale lockdown. |
| WS message **signing** (`WebsocketSignerService.signMessage`) | **REAL** | `websocket-signer.service.ts:63-79`; called at `emergency.controller.ts:568,664,907,989,1075,1154` + `screen-emergency.controller.ts:341,467` | HMAC-SHA256 over canonical `eventId:timestamp:type:JSON(payload)`. Timestamp = `Date.now()` (ms). |
| WS **verify gate** (`verifyWsHmac` at Redis fan-out) | **REAL — wired with real callers** | `redis.service.ts:137` calls it on every `pmessage`/`message`; impl `ws-signature.ts:51-91` | This is the answer to the 2026-05-21 "theater" finding: the old `verifyMessage()` was DELETED (`websocket-signer.service.ts:24-56` documents why) and replaced by this stateless gate that DOES have a live caller. Drops `no-signature`/`stale`/`future`/`bad-signature`. |
| timestamp **unit** (ms vs sec) consistency | **REAL — no mismatch** | signer ms `Date.now()` → verifier ms `Date.now()-timestamp` (`ws-signature.ts:71`) → gateway preserves original signed ms timestamp (`realtime.gateway.ts:268-289,321`) → player freshness uses ms (`player/page.tsx:3914-3915`) | The P0-1 ms-vs-sec bug (gateway rewriting to seconds) is fixed: `broadcastToScope` passes the envelope's ORIGINAL signed timestamp through unchanged. |
| signature + eventId **pass-through** | **REAL** | `realtime.gateway.ts:268-289` preserves `signature`/`eventId`/`timestamp` (audit fix #6) | Previously dropped; if dropped, the player's SENSITIVE_TYPES gate would reject every real emergency. |
| freshness window | **REAL** | `ws-signature.ts:60,71-73` — 120s server window; player 30s window with server-clock offset (`player/page.tsx:3914`) | Generous by design so clock skew can't drop a real alert. |
| HTTP-poll **manifest** backstop (tenant) | **REAL** | `screens.controller.ts:2570-2616` — `emergencyActiveForThisScreen = !!activeScreenOverride \|\| tenant.emergencyStatus !== 'INACTIVE'` | Device-JWT authed manifest carries live emergency field. |
| HTTP-poll manifest backstop (**group + device**) | **REAL** | `screens.controller.ts:2554-2568` reads per-screen `ScreenEmergencyOverride`; trigger writes those rows for group/device (`:534`) | The critical 2026-06-01 closure — a poll-only kiosk (WS+SSE both blocked) now sees group/device lockdowns. |
| device-JWT poll `GET /emergency/messages` | **REAL** | `emergency.controller.ts:1287-1338` — hard-requires `kind==='device'`, resolves tenant from LIVE screen row (not stale JWT claim), per-scope filter | curl unauth → **401** (verified). |
| user-session poll `GET /emergency/status` | **REAL** | `emergency.controller.ts:1184-1228` — tenant-scoped, SUPER_ADMIN-only cross-tenant | curl unauth → **401** (verified). Sprint 7E fix scoped it to caller tenant. |
| SSE fallback tier (server) | **REAL** | `sse.controller.ts` (device-JWT auth + revocation check), `sse.service.ts:121` `broadcastToScope`, fanned from `redis.service.ts:149` | Same Redis fan-out, AFTER the HMAC gate. |
| SSE fallback tier (player consumer) | **REAL** | `player/page.tsx:3677` `new EventSource(/realtime/sse?token=)`, opens after 3 WS failures (`:4184`), registers `SYNC/OVERRIDE/ALL_CLEAR/SOS/TEXT_BROADCAST/MEDIA_ALERT/ALL_CLEAR_MESSAGE` (`:3714-3773`) | P0-2 fix added the Sprint-5 message types to SSE. |
| player WS handler: OVERRIDE | **REAL** | `player/page.tsx:3970-3972` → `fetchContent()` (manifest is sole arbiter) | Forged ALL_CLEAR can't drop a real alert — re-fetch re-asserts. |
| player WS handler: ALL_CLEAR | **REAL** | `:3970` → `fetchContent()`; deliberately NOT in SENSITIVE_TYPES (player-006) so a clock-skewed boot can't drop it | Safe: manifest re-confirms within 10s. |
| player WS handler: SOS / TEXT_BROADCAST / MEDIA_ALERT | **REAL** | `:3980-4004` `setPushedEmergencyMessage(...)`; reads both `text` and `textBlob` (P0-2 blank-broadcast fix) | These travel SENSITIVE_TYPES — signature-presence + freshness + dedup enforced (`:3899-3933`). |
| player WS handler: ALL_CLEAR_MESSAGE | **REAL** | `:4002-4004` `setPushedEmergencyMessage(null)` | Distinct from ALL_CLEAR (which is for OVERRIDE manifest re-fetch). |
| per-eventId **dedup** (player) | **REAL** | `player/page.tsx:3919-3932` — bounded `recentEventIdsRef` Set, 5-min TTL, 500 cap, on SENSITIVE_TYPES | Server gate is stateless (multi-replica), client carries the dedup — documented tradeoff. |
| immutable **AuditLog** on every trigger/clear | **REAL** | every endpoint writes `auditLog.create` inside the same `$transaction` as the mutation (`:497,547,685,707,733,887,977,1058,1136`; screen-emergency `:291,435`) | TRIGGER_EMERGENCY / CLEAR_EMERGENCY / SOS_TRIGGER / BROADCAST_TEXT / MEDIA_ALERT / CLEAR_EMERGENCY_MESSAGE. |
| AuditLog **DB-level immutability trigger** | **REAL** | migrations `20260526010000_audit_log_immutability/migration.sql` (+ `20260531000000`, `20260609000000` dedupe) — `BEFORE UPDATE`/`BEFORE DELETE` → `RAISE EXCEPTION` | Storage-level — UPDATE/DELETE on `audit_logs` rolls back the tx. |
| `@AllowPanicBypass` + `canTriggerPanic` capability | **REAL** | `panic-bypass.decorator.ts`; `rbac.guard.ts:69-75` — bypass requires `canTriggerPanic && role!=RESTRICTED_VIEWER`; SOS explicitly blocks VIEWER (`emergency.controller.ts:834`) | RESTRICTED_VIEWER hard-blocked even if flag is set (defense-in-depth). |
| panic-token **staleness** (canTriggerPanic→false revocation) | **REAL** | `jwt-auth.guard.ts:113-118` per-user "invalid-before" epoch rejects pre-revocation tokens; `redis.service.ts:219-232` writer | P1-1 fix (task #174). Stale `canTriggerPanic:true` claim is invalidated on flip. Fail-CLOSED on Redis error (`:124-125`). |
| cross-tenant scope verification | **REAL** | `resolveScopeTenant` `:267-317` — single gate, 400/404/403; playlistId ownership re-checked (`:376-386`); mediaUrl SSRF allowlist (`media-url-guard.ts`) | SUPER_ADMIN any tenant; everyone else confined. |
| hold-to-trigger UX (mobile panic) | **REAL** | `app/panic/page.tsx:37` `HOLD_DURATION_MS=3000`; pointer + keyboard hold (`:247-294`); aria-live announcements (`:350`) | Pointer-capture, progress fill, SR support. |
| typed-confirm UX (desktop console) | **REAL (present)** | desktop emergency console exists with aria-live (task #181 P1-9); panic page uses hold | Not re-verified pixel-by-pixel this pass — flagged below as coverage gap, not a defect. |
| GPIO status-lamp auto-drive | **REAL (fire-and-forget, non-blocking)** | `:617-635,787-805` — tenant scope only; never rolls back the trigger | Goodview EP6N. |
| outbound webhook on emergency.triggered/cleared | **REAL** | `:598-608,772-780` — tenant scope only, fire-and-forget | Retry queue is P1-5 (task #177). |

**Tally: REAL = 28, COSTUME = 0, NOT-BUILT = 1, DEFERRED = 0.**
(NOT-BUILT = the documented full per-tenant Ed25519 asymmetric player-side
verification — see F4 below; it is honestly documented as a follow-up, not
faked.)

---

## Findings table

| # | Sev | area | what | repro | evidence |
|---|---|---|---|---|---|
| F1 | **P2** | SSE replay/freshness asymmetry | The SSE consumer deliberately skips the client-side signature-presence + freshness + per-eventId dedup that the WS path enforces ("we trust the server-side signer for these"). A legit-but-replayed SSE `ALL_CLEAR_MESSAGE` injected after the server HMAC gate (e.g. a compromised intermediary replaying a still-fresh frame) would clear a pushed SOS overlay with no client dedup. | Code-trace: SSE `handle()` does no `recentEventIdsRef` check; WS does. | `player/page.tsx:3700-3702` (comment) vs `:3919-3932` (WS dedup). Mitigated by: server HMAC gate (`redis.service.ts:137`) blocks forgery; manifest poll re-asserts OVERRIDE within 10s. Real risk is narrow (replay of an already-signed message within 120s, only affects pushed-message overlays, not lockdown state). |
| F2 | **P2** | broadcast/media-alert scope reach (poll tier) | `SOS`/`TEXT_BROADCAST`/`MEDIA_ALERT` persist an `EmergencyMessage` row and are delivered via WS + SSE + device-poll `/messages`. But unlike OVERRIDE, they do **not** write a `ScreenEmergencyOverride` row, and the manifest backstop only surfaces `ScreenEmergencyOverride` + `Tenant.emergencyStatus`. A kiosk on the **manifest-only** path (polls `/manifest` but not `/emergency/messages`) would not see a pushed broadcast. | Code-trace: broadcast/media-alert/SOS write `emergencyMessage.create` only; manifest reads `screenEmergencyOverride` + tenant status. | `emergency.controller.ts:961-987,1042-1073` (no override row) vs `screens.controller.ts:2554` (manifest reads override). NOTE: the player DOES poll `/emergency/messages` on the device-JWT path (`EmergencyOverlay` self-poll), so in practice this is covered — but it depends on that second poll loop being healthy, not the primary manifest. Worth a one-line confirm that the overlay self-poll is unconditionally mounted. |
| F3 | **P2** | success-path E2E test gap | Per task #206 (still pending) + memory, only the emergency-broadcast **failure** path has an E2E test; the success path (trigger → signed publish → player renders) lacks one. The Playwright Emergency Path test (task #72/P0-8) covers trigger→manifest but the full broadcast-success render isn't asserted. | Task #206 `[pending] Emergency broadcast SUCCESS-path E2E test (only failure path verified)`. | Not a code defect — a test-coverage gap on the most load-bearing path. Recommend closing before GA. |
| F4 | **P2 (documented, not a defect)** | player-side signature is presence-only | The player's WS gate checks that a `signature` FIELD is present on SENSITIVE_TYPES but does NOT cryptographically verify it (the HMAC secret is intentionally not shipped to kiosks). Full per-tenant Ed25519 asymmetric verification is documented as a follow-up. | `player/page.tsx:3868-3880,3908-3911`; `ws-signature.ts:14-18`. | This is honestly documented and the PRIMARY safeguard (server-side HMAC gate at the Redis chokepoint) is real and wired. Flagging only so it's on the GA risk register, not as a regression. |

**No P0 or P1 findings.** The emergency path is the most-hardened surface in
the codebase and every documented safeguard traced to a real, live caller.

---

## Coverage — what I could NOT reach + why

- **Live broadcast end-to-end on real glass.** Per ground rules I did NOT fire
  a real emergency on any shared scope or touch the Dodgers tenant/LED. I did
  not spin up a throwaway tenant + paired kiosk to watch an OVERRIDE render
  (would require a live device pairing + WS session). Verified by code-trace +
  prod health (`/health/emergency-path` → `ws_signer:ok`, `db:ok`, `redis:ok`)
  + endpoint-shape (401 on protected reads, 403 on unauth trigger).
- **Desktop emergency-console typed-confirm UX** — confirmed it exists (task
  #181) but did not pixel-verify the typed-confirm flow this pass; the mobile
  panic hold-to-trigger was fully traced.
- **APK-native realtime** — the Android player's Kotlin WS/SSE handling was not
  read line-by-line (out of scope; the web player route is the rendering
  surface for emergencies and was fully traced).
- **Multi-replica race** under real concurrent trigger+all-clear — reasoned
  about (the `$transaction` wrapping + stateless verify make it safe) but not
  load-tested live.

---

## Grade per Greg's 3 lenses

- **DESIGN — A.** The path is architected exactly as a life-safety system
  should be: signed at the source, verified at a single server-side chokepoint,
  three independent delivery tiers (WS → SSE → authed HTTP poll) that degrade
  gracefully, manifest as the sole arbiter of state so a forged ALL_CLEAR can't
  drop a real lockdown, and an immutable DB-enforced audit trail. The 2026-05-21
  "theater" finding was genuinely closed (verifyMessage deleted, real gate
  wired). Every comment explains the threat model.
- **UX — A−.** 3-second hold-to-trigger with progress fill + full keyboard +
  aria-live SR support on the mobile panic page; RESTRICTED_VIEWER hard-blocked.
  Minor: I didn't re-verify the desktop typed-confirm flow this pass.
- **FUNCTIONALITY — A−.** Every tier and every scope reaches the player and is
  audited; zero costumes. Held back from A only by: the SSE/WS client-gate
  asymmetry (F1), the broadcast-vs-manifest reach nuance (F2), and the missing
  success-path E2E test (F3) — all P2, none launch-blocking, but F3 should be
  closed before GA so this path is regression-proofed.

**Launch verdict: SHIP. No code changes required on the emergency path for
beta.** The four P2s are register-and-track items, not blockers.
