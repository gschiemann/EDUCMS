# Rate-limit tracker fix — per-IP caps never fired 429 behind Railway proxy

**Date:** 2026-07-07
**Author:** Opus 4.8 (lead)
**Status:** ✅ FIXED + LIVE-VERIFIED (commit `0e24f885`)
**Severity:** P1 hardening (NON-blocking for launch — Argon2 is the primary brute-force control)

---

## Symptom

The per-IP `@Throttle` brute-force caps (login 10/min, register, password-reset,
invite, branding-scrape, feeds, ingest…) **never fired a 429 in production**.
Verified live: 16 rapid failed logins from a single client returned all 401,
zero 429, and `x-ratelimit-remaining` oscillated non-monotonically (e.g.
`…6,5,4, then 9 again`) — the "partially accumulate then reset" fingerprint.

## What it was NOT (ruled out live, in order)

1. **Not the Redis storage wiring** — `app.module.ts` correctly wires
   `storage: new RedisThrottlerStorage(redis)`; the login `/10` override was
   applied (header showed `x-ratelimit-limit: 10`).
2. **Not Redis being down** — `/health` reported `redis: "ok"` on every replica.
3. **Not fail-open to per-replica memory** — the storage's one-shot fail-open
   `warn` (`[RedisThrottlerStorage]`) **never appeared** in 60m of logs, so the
   Lua `EVAL` was succeeding on every request. (Two earlier hardening commits —
   `61e2a695`, `67ae620f` — removed a latent `PX 0` invalid-expire throw and an
   over-strict `status !== 'ready'` gate, and bounded the eval with a 250ms
   timeout so it can't hang login. Net-positive, but they did not move the 429.)
4. **Not a test artifact** — the test client's egress IP was verified stable
   (`99.65.178.111` ×12 via api.ipify.org), so the 16 logins genuinely shared a
   source and *should* have accumulated.

## Root cause (proven by elimination + a live diagnostic)

The throttle **key itself was moving between requests**. The stock
`ThrottlerGuard` tracker resolves to `req.ip`. Under `app.set('trust proxy', 1)`
(main.ts:58) behind Railway's multi-hop internal mesh, `req.ip` lands on a
**rotating internal Railway proxy address**, so `throttle:<name>:<ip>` changed
per request and the SHARED Redis counter never reached the limit.

The `[tracker-diag]` log added in the fix captured it directly:

```
chosen=216.241.83.102  req.ip=152.233.76.9  req.ips=["152.233.76.9"]
xff="216.241.83.102, 152.233.76.9"
```

- `xff` has **two** entries; leftmost `216.241.83.102` = stable client,
  `152.233.76.9` = internal hop.
- Old tracker used `req.ip` = `152.233.76.9` (the internal hop that rotated).
- New tracker uses leftmost XFF `216.241.83.102` — stable across all requests.

## Fix

`apps/api/src/security/client-ip-throttler.guard.ts` — `ClientIpThrottlerGuard
extends ThrottlerGuard`, overrides `getTracker` to key on the **leftmost
X-Forwarded-For** entry (the original client), stable no matter how many
internal hops Railway appends. For a normal single-entry XFF this equals
`req.ip`, so the common case is unchanged. Wired as `APP_GUARD` in
`app.module.ts` (replacing the stock `ThrottlerGuard`).

**Safety:** the override only changes throttle-key derivation — it does not
touch authentication. `getTracker` is fully defensive (try/catch → `req.ip` →
`'unknown'`), so it can never throw / 500 a login. 7 unit tests cover the
stability contract (`client-ip-throttler.guard.spec.ts`).

**Spoofing tradeoff (documented in the guard):** the leftmost XFF is
client-settable, so an attacker could rotate it to evade this per-IP cap. That
is acceptable for a defense-in-depth throttle — an XFF-spoofing attacker can
already rotate source IPs, and Argon2 password hashing is the primary control.
This change strictly improves the honest-client case, where the cap previously
never fired at all.

## Live verification (prod, deploy `0e24f885`)

18 rapid failed logins from the stable client:

```
#01–#10  http=401  remaining=9,8,7,6,5,4,3,2,1,0   ← clean monotonic (shared counter accumulating)
#11–#18  http=429  retry-after=60                   ← cap fires at limit+1, stays blocked
```

Exactly the behavior that was impossible before. **Closed.**

## Follow-up (optional, non-blocking)

- The `[tracker-diag]` WARN log is self-limited to 3/process and harmless
  (client IPs already appear in RequestLog). It can be removed in a future
  cleanup pass; leaving it gives cheap telemetry if Railway's proxy topology
  ever changes.
- Consider whether `trust proxy` should be raised to Railway's real hop count so
  `req.ip` is correct for *audit logs* too (currently audit `ipAddress` may log
  the internal hop). Out of scope for the rate-limit fix; flagged for later.
