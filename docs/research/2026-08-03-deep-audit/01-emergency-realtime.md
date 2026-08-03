# §1 Real-time + emergency audit — 2026-08-03

**Scope:** Standard Audit Surface §1 (emergency system + signed pub/sub), read-only, at HEAD `cec023ec` (master, ≥ `a74c7894` — the merged security wave). Prior audit `docs/research/2026-08-01-player-security-audit/01-REALTIME-BUS.md` (R-01…R-08) spot-checked for presence-at-HEAD; launch-readiness `00-LAUNCH-READINESS.md` §8 cross-referenced.

**Verdict: STRONG.** Every R-01…R-08 fix is present and correct at HEAD; the emergency core (trigger/all-clear, audit immutability, manifest backstop, player replay defence) is genuinely well-built. One NEW substantive gap: **there is no district-wide emergency in a hierarchical district** — a district-admin trigger does not reach child-school screens. Everything else is polish or documented tradeoff.

## Coverage table

| Bullet | Status | D | UX | F | Note |
|---|---|---|---|---|---|
| Emergency trigger / all-clear / per-screen overrides | covered | – | A | A | `emergency.controller.ts` + `screen-emergency.controller.ts`; roles + tenant-ownership + media/playlist guards |
| @AllowPanicBypass → canTriggerPanic (live vs JWT) | covered | – | A | A- | JWT claim, but **tightening revokes tokens** (`users.controller.ts:454`) |
| AuditLog on trigger AND all-clear + immutability | covered | – | – | A | atomic `$transaction`; **DB-level** UPDATE/DELETE/TRUNCATE blocked |
| Tenant.emergencyStatus + panic playlist types (6) | covered | – | A | A | landscape+portrait per type; atomic flip |
| Scope fan-out tenant/group/device; **district→child** | covered w/ GAP | – | C | C | F-1: district scope never reaches child-school screens |
| WS gateway signing/verify (unit, freshness, legacy flag) | covered | – | – | A | ms end-to-end; `ACCEPT_LEGACY_UNBOUND_WS_SIG=false` |
| Redis fan-out gate (verifyWsHmac every path) | covered | – | – | A | sole `broadcastToScope` callers are post-gate |
| HTTP polling backstop (manifest live emergency) | covered | – | A | A | no-store all branches; emergency before cache; 304-streak; never-retained |
| SSE controller fallback | covered | – | – | A- | parity fixed; device JWT still in query (R-06, LOW) |
| Player WS handlers (all 10 types) + dedup | covered | – | – | A | shared `checkSensitivePush` LRU across WS+SSE |
| Hold-to-trigger + typed-confirm consistency | covered | A | A | A | 3s `HOLD_MS` + aria-live + keyboard (`broadcast/page.tsx`) |
| Per-eventId dedup at every layer | covered | – | – | A | player LRU; server stateless-by-design (multi-replica) |
| Remote-input lockout during emergency | covered | – | A | A | `page.tsx:3000-3035` (web player only) |
| Emergency preempts multi-screen sync | covered | – | – | A | top-level overlay; manifest emergency branch returns first |
| Player-side signature verification | covered (honest) | – | – | C | presence-only smoke test **by documented design** (Ed25519 not built) |
| REVOKED screen + emergency | covered | – | – | B | cut off entirely (manifest 403 + WS reject) — by-design, see F-2 |

## Findings

### [P1] F-1 — No district-wide emergency; a district-admin trigger never reaches child-school screens — NEW
**Evidence (three independent methods):**
- Manifest resolves emergency **only from the screen's own tenant row**: `screens.controller.ts:3116` `tenant.findUnique({ where: { id: screen.tenantId } })` — no `parentId` walk anywhere in the emergency block (3093-3483).
- Emergency controller has **zero** child-tenant fan-out: `triggerEmergency` (`emergency.controller.ts:408`) updates one `Tenant` row (`where: { id: scopeId }`, :493) and publishes to one channel `tenant:${scopeId}` (:590). Grep for `parentId`/child iteration in `apps/api/src/emergency/**` returns nothing.
- `resolveScopeTenant` (:278-316) sets `owningTenantId = scopeId` for tenant scope then **403s any non-SUPER_ADMIN whose tenant ≠ scopeId** — so a DISTRICT_ADMIN (callerTenantId = district) can trigger *only* `tenant:<districtId>`, and is blocked from targeting a child-school tenant id.
- Web callers always pass a single school scope: `actions/trigger-emergency.ts:35-37` (`scopeType:'tenant', scopeId: payload.schoolId`).

**Confirmed against a real deployment:** `seed-walnut-creek-demo.mjs` builds a district with **7 child-school tenants** (`/tenants/children`, :258) and seeds screens **per child school** (`seedScreens(childIds[s.key], …)`, :289-292). Therefore a DISTRICT_ADMIN firing a district-scope lockdown reaches only the district-office screens; the 7 schools' screens (their manifests read their own school tenant, still INACTIVE; they listen on `tenant:<schoolId>`) show nothing. Each school must be triggered separately by its own SCHOOL_ADMIN or by SUPER_ADMIN.

**Impact:** for the K-12 district story (the "beachhead + emergency moat"), there is no one-action district-wide lockdown, and the district admin's own trigger is invisible to every school. A superintendent expecting "lock down all schools now" would not get it. Per-school triggering still works (not a total outage), which is why this is P1, not P0.

**Fix sketch:** on tenant-scope trigger, if the target tenant has children, fan out — either (a) resolve child tenants and write each child's `emergencyStatus` + publish `tenant:<childId>` in the same transaction, or (b) have the manifest inherit a parent's active emergency when the screen's own tenant is INACTIVE (walk `parentId` once). (a) keeps the manifest simple and each channel scoped; (b) is cheaper but adds a parent read to the hot path. Either needs `resolveScopeTenant` to let a DISTRICT_ADMIN target their own district's descendants.

### [P2] F-2 — A REVOKED screen receives no emergency at all — NEW (surfacing a by-design tradeoff)
**Evidence:** manifest returns `403 "Device credential revoked"` for a revoked/superseded epoch before the emergency block (`screens.controller.ts:3070-3072`); WS `HELLO` rejects revoked tokens and screens whose row is gone/rebound (`realtime.gateway.ts:202-226`). So a revoked screen has no manifest, no WS, no SSE → it can never render a lockdown.
**Impact:** intentional (DT-01: revocation = de-authorization), but a physically-present screen an admin revoked will stay dark in an emergency. Worth an explicit product decision + operator-visible warning ("revoked screens will not display alerts"). Low likelihood, high-consequence class → flagging, not blocking.
**Fix sketch:** none required if accepted; otherwise, allow the emergency branch to serve a revoked-but-paired screen a read-only lockdown overlay while withholding normal content.

### [P2] F-3 — 120s server freshness window, no server-side nonce/dedup — KNOWN (R-02 refutation) / documented tradeoff
**Evidence:** `WS_SIG_MAX_AGE_MS = 120_000` (`ws-signature.ts:27`); `verifyWsHmac` deliberately has no replay nonce (multi-replica statelessness, :91-102). Cross-tenant replay is now closed by channel binding (R-02, `ACCEPT_LEGACY_UNBOUND_WS_SIG=false`). Same-tenant replay within 120s is bounded only by the player LRU (`pushGate.ts`) and, for OVERRIDE/ALL_CLEAR, by manifest arbitration.
**Impact:** minimal given R-02 + manifest-as-arbiter + player dedup. Documented and defensible; listed for completeness, not action.

## What's verified STRONG at HEAD (KNOWN fixes, all present)

- **R-01** repoint → `trustGuards.ts` (11k, unit-testable): https-only (http loopback dev-only), host allowlist with **dot-boundary** match (`hostMatches`, :83-88), rejects embedded creds, drops query/fragment, **self-heals** poisoned localStorage on read (:223-228). Wired via `getApiRoot()`→`resolveApiRoot` (`page.tsx:648`).
- **R-02** channel binding: publish binds channel (`bindWsSignatureToChannel`, `redis.service.ts:251`), consume verifies against the arrived channel (:226), legacy flag **false** (`ws-signature.ts:56`), + channel must be exactly 2 segments (:194).
- **R-03** frame cap: `maxPayload: 64*1024` (`realtime.gateway.ts:72`) + pre-`toString()` raw-frame size check (:119-128).
- **R-04** SSE parity: shared `checkSensitivePush` via `gateSse` (`page.tsx:4965-4991`), sharing `recentEventIdsRef` with WS (cross-transport replay caught); SSE `AUTH_OK` feeds the same clock offset.
- **R-05** both halves: producer publishes `device:${screen.id}` (`screens.controller.ts:1595`); consumer requires `isTenantChangeForThisScreen` exact screenId match, fail-closed (`page.tsx:5316-5323`, `pushGate.ts:144`).
- **R-07** ACK/HEARTBEAT: 30-token bucket refilled 1/s + 4KB metrics cap (`realtime.gateway.ts:47-56`).
- **R-08** doc: `ws-signature.ts:17-23` now states Ed25519 is NOT built and the player only smoke-tests for a `signature` field — matches reality (`pushGate.ts:98` presence-only).
- **07-31 stuck-lockdown wave:** manifest `no-store, no-cache` on **every** branch (`screens.controller.ts:2995`); emergency + scoreboard branches return **before** the content cache (`getManifestCache` at :3558) and emergency always 200 (never 304/cached); player emergency-mode poll uses `_eb` cache-buster + drops `If-None-Match` (`page.tsx:4477-4486`); **304 counts toward the empty-manifest streak** (:4512-4529); **emergency content never retained** by the blip defense (:4425-4434); **remote-input lockout** while an emergency/pushed-message is displayed (:3000-3035).
- **Emergency core:** trigger/all-clear both write immutable AuditLog atomically with state (`emergency.controller.ts:509/559/700/722/748`); tenant-ownership via `resolveScopeTenant`; override `playlistId` tenant-checked (:380-390); operator media URLs allowlisted (`media-url-guard.ts`); 6 panic types × landscape+portrait; per-screen overrides win over tenant-wide; expired per-screen overrides treated as cleared on read (:3098-3106). AuditLog immutability is **storage-enforced** (migrations `20260531…_audit_logs_immutable`, `20260609…_dedupe`, `20260717…_block_truncate`).
- **Auth-before-honour** on WS: 10s auth timeout, `jwt.verify` before any DB/Redis, DB tenant wins over JWT claim, group sourced from live row, `DEV_WS_ALLOW` hard-gated to non-prod (`realtime.gateway.ts:181-238`).
- **canTriggerPanic staleness** mitigated: it is a JWT claim, but removing it revokes the target's live tokens (`users.controller.ts:454`, `revokeUserTokens`); RESTRICTED_VIEWER can never carry it (guard + writer).
- **Emergency preempts sync:** `<EmergencyOverlay>` is a top-level layer (`page.tsx:9048`) independent of the sync conductor; manifest emergency branch precedes sync/scoreboard and carries no `sync` block.
- **Per-screen controller** (`screen-emergency.controller.ts`) is symmetric: same guards, `@AllowPanicBypass`+roles, media guard, AuditLog, `resolveScopeTenant`; all-clear requires ownership too (emergency-009).

## Unverified / open questions

1. **R-06 (LOW) not fully traced.** `screens/stream-ticket.ts` exists (suggests a short-lived SSE ticket), but I did not confirm SSE now uses it instead of the long-lived device JWT in `?token=`. If the SSE query still carries the 365-day device JWT, R-06 is still open. UNVERIFIED.
2. **Other realtime consumers not read.** `apps/web/src/components/player/CtsBridge.tsx` and any dashboard WS/SSE consumers are outside the core emergency path and were not audited; a second consumer with weaker gates would change the picture (same gap the prior audit flagged).
3. **Concurrency between calls.** Each trigger/all-clear is atomic within its own `$transaction`, but two simultaneous triggers (or all-clear racing a trigger) on the same tenant are last-writer-wins with no row lock; convergence relies on manifest reconcile + WS re-fetch. Acceptable by design; not load-tested here.
4. **`screen-emergency.controller` cross-tenant isolation** spot-checked (symmetric `resolveScopeTenant`), not exhaustively traced per endpoint (e.g. `bulk-trigger` :503).
5. **expiresAt:** tenant-wide alerts intentionally never auto-expire (last until ALL_CLEAR); per-screen overrides carry `expiresAt` and the manifest treats expired as cleared but does **not** delete (read-only path; relies on a cron/janitor to prune). Confirmed behavior; no active pruning cron was located in this pass.
6. **Redis-down mid-emergency:** trigger/all-clear swallow publish failures (Sentry + warn), state is persisted to Postgres first, and screens converge via the HTTP manifest poll (`no-store`, live emergency field). Path is sound; not exercised live (read-only mandate).
