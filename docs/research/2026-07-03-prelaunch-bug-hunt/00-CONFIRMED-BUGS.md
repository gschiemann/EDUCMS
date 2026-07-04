I'll produce the triage report directly from the confirmed findings. Let me analyze severity, prod-reachability, and identify the EMERGENCY subsystem items.

Let me first verify which findings touch the emergency subsystem (requiring Greg sign-off) — the two emergency-realtime lens items reference emergency-code sign-off explicitly.

# VenueOS Bug Triage — Ranked Fix Report

**6 findings survived adversarial verification** across 7 subsystems. No near-duplicates found (each is a distinct file/mechanism). Ranked below by severity × prod-reachability. Two findings are in the **EMERGENCY subsystem** and are flagged **NEEDS GREG SIGN-OFF before fixing**.

---

## CRITICAL / HIGH

### 1. Android kiosks never receive per-screen emergency alerts over WebSocket
- **File:** `apps/api/src/realtime/realtime.gateway.ts:174`
- **Severity:** HIGH — **EMERGENCY SUBSYSTEM → NEEDS GREG SIGN-OFF before fixing**
- **Prod-reachability:** Live now. Every Android-paired kiosk (the live pairing path) is affected for its full 365-day connection.
- **Failure scenario:** Android pair tokens carry no `deviceId` claim. WS auth succeeds because `processHello` falls back to `sub` (line 147), but line 174 sets `ctx.deviceId = decoded.deviceId` with **no `sub` fallback** → `ctx.deviceId` stays `undefined`. `broadcastToScope` matches on `ctx.deviceId === id`, so every device-scoped emergency broadcast on `device:<screenId>` (per-screen OVERRIDE/ALL_CLEAR — the "Gym — LOCKDOWN on one screen" life-safety path) is silently dropped on the WS fast-path for the entire Android fleet. Passes the HMAC gate, then vanishes. Redis device-set/heartbeat registration is also skipped. Degrades to the 5–10s HTTP-poll manifest backstop (delay, not total loss), but the primary realtime tier is dead. SSE is unaffected but never engages because WS auth succeeds.
- **Recommended fix:** Mirror line 147 — `ctx.deviceId = decoded.deviceId || decoded.sub`. Purely ClientContext population; do **not** touch emergency signing/verify.
- **Lens:** emergency-realtime

### 2. CTS/swim feed ingest clobbers concurrent operator stat edits (lost update)
- **File:** `apps/api/src/sports/sports.service.ts:5280`
- **Severity:** HIGH
- **Prod-reachability:** Live on the flagship first-customer config (water polo + CTS, tasks #124/#258). Continuously-open ~200 ms clobber window for the entire game.
- **Failure scenario:** `ingestCtsSnapshot` does an unguarded whole-blob read-modify-write on `Game.stats` at ~5 Hz (read 5102, merge 5173, write 5280–5283) — no transaction, version guard, or row lock. `updateStats` (operator PATCH) does the identical RMW (read 2861, write 2947). Interleave: both read `{penalties:[]}` → operator commits `[P1]` → CTS commits stale snapshot without P1 → the operator's penalty is silently erased. Any operator edit to fouls, timeouts, penalties, celebrationPack, shotClock, or structured stats can be overwritten within ~200 ms. Same pattern in `ingestSwimTiming` (5447/5464), `applySetWin` (3109), `setSegment` (2593). The task #292 fix is client-only and does not address this server-side race.
- **Recommended fix:** Serialize all `Game.stats` writers per game — either wrap each mutation in an interactive `$transaction` at `Serializable` isolation with `withDbRetry` (matching the seat-pair pattern in `screens.controller.ts`), or add an optimistic-concurrency `statsVersion` guard with retry on 0-row update. Better long-term: split feed state and operator edits out of the single JSON column. At minimum, the 5 Hz feed writes must not re-serialize operator-owned portions of the blob.
- **Lens:** data-races

### 3. Template builder re-inits store on post-save refetch → discards in-progress edits, wipes undo history
- **File:** `apps/web/src/components/template-builder/BuilderShell.tsx:194`
- **Severity:** HIGH
- **Prod-reachability:** Live on the V2 builder route whenever an operator keeps editing right after a save.
- **Failure scenario:** The init effect depends on the whole `template` object (`[template, init]`). Every save bumps `updatedAt`, so the invalidation-driven refetch produces a new object reference → the effect re-runs `init()` (useBuilderStore.ts:206–231), which unconditionally resets `zones/meta/isDirty:false/past:[]/future:[]`. Sequence: operator saves → immediately keeps editing (store dirty again, autosave draft not rewritten for up to 3s) → ~300–900 ms later the refetch resolves and `init()` overwrites the step-2 edits and clears undo/redo. No restore bar appears (the draft-recovery effect is correctly keyed `[template.id]`), so the loss is silent. The sibling effect's own comment warns that refetches produce new identities — the init effect one block above fails to apply the same guard.
- **Recommended fix:** Change the dependency array from `[template, init]` to `[template.id, init]` (matching the correct draft-recovery effect at line 210). If external-change reconcile is genuinely wanted, gate it behind `!useBuilderStore.getState().isDirty` or route it through the existing `handleReloadTheirs` conflict UX.
- **Lens:** frontend-correctness

### 4. Square webhook signature verified against re-serialized body, not raw bytes → real webhooks 401
- **File:** `apps/api/src/pos/pos-oauth.controller.ts:289`
- **Severity:** HIGH
- **Prod-reachability:** Live the moment `SQUARE_WEBHOOK_SIG_KEY` is set and a Square store is connected. Fails the large class of real payloads (non-ASCII item names, Square's own formatting/key-order/whitespace).
- **Failure scenario:** `main.ts` mounts the raw-body parser **only** for `/api/v1/billing/webhook`; the global `express.json()` consumes the Square path first, so `req.rawBody` is undefined. The handler falls back to `JSON.stringify(req.body)` (289–293). Square computes its HMAC over the exact bytes it POSTed; the parse→stringify round-trip is not byte-identical for any payload with non-ASCII text or differing escape/format/order → `timingSafeEqual` fails → 401 (317–320). In production essentially every `catalog.*`/`inventory.*` event (auto-86, price sync) is silently rejected; the POS menu goes stale with no operator-facing error. (The controller's own comment concedes the "works because Square uses compact JSON" fragility.)
- **Recommended fix:** Extend the path-scoped `expressBody.raw({ verify })` mount in `main.ts` to cover `/api/v1/pos/webhook` (or a regex over the webhook routes) so `req.rawBody` holds the exact bytes, then verify/parse from that Buffer. Do not verify HMAC against `JSON.stringify(req.body)`.
- **Lens:** integrations

---

## MEDIUM

### 5. Pushed SOS / TEXT_BROADCAST / MEDIA_ALERT overlay never reconciles or expires → stuck alert
- **File:** `apps/web/src/app/player/page.tsx:4235`
- **Severity:** MEDIUM — **EMERGENCY SUBSYSTEM → NEEDS GREG SIGN-OFF before fixing**
- **Prod-reachability:** Live; triggers on a single dropped `ALL_CLEAR_MESSAGE` (proxy blip on an open socket) or a passed `expiresAt`. Lower frequency than the HIGH items but on a physical life-safety wall.
- **Failure scenario:** A pushed message takes precedence (`active = message || polled`, EmergencyOverlay.tsx:297) **and** suppresses the self-poll (`if (message || !apiUrl) return;`, line 238). The pushed overlay clears only via an explicit `ALL_CLEAR_MESSAGE` push (page.tsx:4026/4256) or a full reload — there is no client-side `expiresAt` check and no reconciliation against server state. Unlike the OVERRIDE path (manifest-arbitrated, reconciled every 30s), the pushed EmergencyMessage overlay has no backstop. If the single `ALL_CLEAR_MESSAGE` publish is dropped or the message expires, a stale full-screen takeover ("SOS from staff", "Fire drill") stays on the wall indefinitely, masking the overlay's own self-healing poll (which the server already filters by `clearedAt`/`expiresAt`).
- **Recommended fix:** Give the pushed path a reconcile/expiry backstop — either (1) keep polling `/emergency/messages` even when a `message` prop is set and drop the pushed message once the server no longer reports it active, or (2) add a client-side timer clearing `pushedEmergencyMessage` once `Date.now()` passes `message.expiresAt` (seconds→ms).
- **Lens:** emergency-realtime

### 6. Stripe currentPeriodStart/End always null under pinned API dahlia → license-expiry backstop dead
- **File:** `apps/api/src/billing/stripe.service.ts:457`
- **Severity:** MEDIUM
- **Prod-reachability:** **Latent today** (pilot has no Stripe); activates the moment card billing goes live. Ranked last — lowest current reachability, and only a secondary belt-and-suspenders net.
- **Failure scenario:** stripe@22.1.1 pins API `2026-04-22.dahlia`, which removed `current_period_start`/`current_period_end` from the Subscription object (moved to `subscription.items.data[].current_period_*`). `syncLicenseFromSubscription` reads them off the top-level subscription (457–462) → `undefined` → every License row written with `currentPeriodEnd=null` (508–509, 520–521). For CARD-billed tenants `expiresAt` is null (only super-admin grants set it), so `assertSeatAvailable`'s `expiresAt ?? currentPeriodEnd` expiry guard (license.service.ts:116, the audit-fix-#13 net) never fires, and any UI reading the billing period gets null. Primary enforcement via subscription status (PAST_DUE/CANCELLED) still works — only the expiry backstop and period UI are dead.
- **Recommended fix:** Read the period from the subscription item under dahlia — `sub.items?.data?.[0]?.current_period_start` / `current_period_end` — with a fallback to the top-level fields for older-versioned webhook payloads. (Pinning an older `apiVersion` is a weaker alternative; the item-level read is forward-compatible.)
- **Lens:** integrations

---

## Triage notes for the lead
- **No dedupe needed:** all 6 findings are distinct files/mechanisms; none are near-duplicates.
- **Two EMERGENCY-subsystem items (#1, #5) require Greg's sign-off before any patch lands.** #1 is the highest-priority item overall — a life-safety realtime channel dead across the entire Android fleet.
- **This is not a short/empty list, but it is a clean one** for a heavily-audited codebase: 4 HIGH + 2 MEDIUM, zero CRITICAL, no total-loss defects (every emergency path degrades to a working backstop rather than failing silently to zero). Suggested fix order: #1 → #2 → #3 → #4 (all live, HIGH), then #5, then #6 (latent until Stripe goes live).
