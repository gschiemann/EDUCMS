# Audit — §1 Real-time/Emergency · §15 Cross-browser/Taurus · §17 Operational/DX

_Agent a0a082294beea3152 · read-only, file:line-traced · 2026-05-30_

## Coverage (D/UX/F)
| Section | D | UX | F |
|---|---|---|---|
| §1 Real-time + emergency | B | B | B+ |
| §15 Cross-browser/Taurus | A | A | B+ |
| §17 Operational/DX | A | A | A− |

## §1 Real-time / Emergency — B+ (strong; one P1)
**Verified working:** emergency trigger/all-clear atomic (state+auditLog in one `$transaction`); cross-tenant `resolveScopeTenant` before every write; portrait+landscape variants cleared atomically (the "stuck on lockdown" bug fixed); `@AllowPanicBypass`+RbacGuard holds RESTRICTED_VIEWER exemption; canTriggerPanic staleness mitigated (`markUserTokensInvalid`+`getTokenInvalidBefore`). **verifyWsHmac is REAL** — traced to `redis.service.ts:137` on EVERY replica's pmessage (not theater); old nonce `verifyMessage()` correctly removed. Timestamp units ms-consistent (signer→verifier→gateway→player). All 9 player message types + GAME_STATE/CTS_MANUAL_CUE handled. Per-eventId dedup (bounded 500 + 5min TTL). Clock-skew offset via AUTH_OK serverTime. HTTP manifest poll backstop (adaptive 5s/10s). SSE fallback. Hold-to-trigger 3s + keyboard + ARIA. SSRF allowlist on all operator media URLs.
- **G1 — P1 — SSE drops GROUP-scoped emergencies.** `sse.service.ts:115-116` `broadcastToScope` matches only `tenant`/`device`, not `group`. A group-scoped OVERRIDE/ALL_CLEAR never reaches a player on SSE fallback (backstopped by 5-10s HTTP poll, so not P0, but real-time life-safety latency on proxy-heavy school nets). Fix: add `group` arm + `groupId` to SseClient + look up `screen.screenGroupId` in SseController (mirror the WS gateway).
- G5 — P3 — SSE event handlers skip the signature/freshness/dedup checks the WS path applies (`player/page.tsx:3641-3655`). Server-side `verifyWsHmac` gate is the primary protection; SSE injection requires server access. Fix: port SENSITIVE_TYPES checks into SSE handlers (reuse `recentEventIdsRef`).

## §15 Cross-browser / Taurus — A (clean)
taurus-safety CI gate passing (171 files, gap=1196 cq=1037 within baseline, ratchets DOWN-only, comment-stripped). Canonical inset grep = zero real violations (all hits are comments, the layout.tsx Chromium-83 inset polyfill, or the allowlisted dual-declaration in KioskSplash/player). Pre-commit blocks `inset:0`. Cross-browser CI: webkit holiday-bridge + sports-celebration + React-widget-render (Chromium+WebKit) + emergency-path (Chromium×WebKit matrix). Flex-gap + cq-unit + inset polyfills wired in player.
- G3 — P2 — pre-commit catches CSS `inset:0` but NOT Tailwind `inset-0` class (CI taurus gate does catch it). Fix: extend pre-commit grep to `\binset-[0-9xypb]`.
- G4 — P2 — `RetailWidgets.tsx` baseline `hasSelector:1` is a stale false-positive (comment) → run `check-taurus-safety.cjs baseline` to tighten 1→0.
- P2 — several widgets carry cq-units in baseline (Chromium-105 feature) — only an issue IF those specific widgets deploy to a Taurus LED wall (LCD unaffected per CLAUDE.md scope).

## §17 Operational/DX — A− (excellent)
Health endpoints correct (liveness always-200 + caps, readiness 503, emergency-path); railway healthcheck → liveness; boot-secret enforcement (4 secrets + ALLOWED_ORIGINS + DATABASE_URL pool-sizing all throw at prod boot); connection_limit=10/pool_timeout=20 enforced; multi-replica caches documented + invalidated on emergency; Prisma warmup post-listen; OTA version/tag sync guard (catches the v1.0.66 class); CI suite (deploy-reliability 4 jobs, taurus, cross-browser, emergency-path, prod-smoke nightly, keep-warm 5min); pre-push preflight + pre-commit lockfile.
- **G2 — P2 — API Jest tests are `continue-on-error: true`** (`deploy-reliability.yml:129-131`) → a failing unit test (incl. emergency controller) doesn't block merge. NOTE: the suite is now green (lead fixed the 2 stale specs earlier today → 55 suites/719 tests pass), so this flag can finally be flipped to blocking.
- G7 — P3 — `keep-warm.yml:26` hardcodes the prod Railway URL in the public repo (move to a secret + add failure alert). G8 — P3 — `prod-smoke.yml` seed creds in public workflow comments (move to secrets; test tenant only).

## Explicitly cleared (not theater): verifyWsHmac real callers, ms timestamp parity, ALL_CLEAR manifest-as-truth, canTriggerPanic staleness, zero Taurus inset violations, all boot secrets enforced.

## Fix priority: P1 G1 (SSE group scope). P2 G2 (flip Jest to blocking — suite now green), G3 (pre-commit inset-class), G4 (baseline tighten).
