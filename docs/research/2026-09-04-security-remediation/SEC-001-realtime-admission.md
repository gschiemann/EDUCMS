# SEC-001 (realtime) — a bootstrap credential is no longer a realtime principal

**Branch:** `worktree-agent-a0d20770821c048fc` (4 commits, branched from `f22bc8e0`)
**Status:** closed against the audit's pass condition, with two named residuals and one
fleet-behaviour change the lead must decide to accept. **Not pushed.** Lead owns the merge.

> ⚠️ `docs/research/` is in `.gitignore` (line 85), so this file is NOT in the branch's
> commits. It lives only in the worktree. Copy it out before the worktree is removed.

---

## 1. The pass condition, line by line

> "A bootstrap/unproven token gets WS AUTH_FAIL and SSE 401; it cannot subscribe, ACK,
> heartbeat, stamp online status, or consume a socket slot. WS also validates kind,
> algorithm, status, and credential epoch through the shared verifier and periodically
> revalidates open sockets."

| Clause | Status | Proof |
|---|---|---|
| Bootstrap token → WS `AUTH_FAIL` | ✅ | `sec-001-realtime-admission.spec.ts` — "a BOOTSTRAP token gets AUTH_FAIL and the socket is closed" (asserts the frame, `close(4001)`, **and** that the logged reason is `credential_unproven`) |
| Bootstrap token → SSE 401 | ✅ | "a BOOTSTRAP token gets 401 and opens no stream" (also asserts the reason) |
| cannot subscribe | ✅ | "cannot SUBSCRIBE" — no `sadd` to `tenant:*:devices` / `group:*:devices`, and a fan-out on all three scopes (tenant/group/device) reaches nothing |
| cannot ACK / heartbeat | ✅ | "cannot stamp online status, ACK or heartbeat" — `processHeartbeat` / `processAck` both return on `!ctx.isAuthenticated`; no `hset`, no `metrics:ack` publish |
| cannot stamp online status | ✅ | same test — `screen.updateMany` (the `stampPushConnected` write) is never called |
| cannot consume a socket slot | ✅ | "a refused BOOTSTRAP caller consumes NO socket slot" — 3 legit sockets + 8 bootstrap connects, all 3 legit sockets still open and authenticated, no `close(4009)` |
| WS validates **kind** | ✅ | "refuses a token that is not `kind: device`" |
| WS validates **algorithm** | ✅ | `admitDeviceCredential` passes `algorithms: DEVICE_JWT_ALGORITHMS` (`['HS256']`) — no longer a library default on either realtime transport |
| WS validates **status** | ✅ | "refuses a REVOKED screen" |
| WS validates **credential epoch** | ✅ | "refuses a credential whose epoch has been retired past the grace window" |
| …**through the shared verifier** | ✅ | one function, `admitDeviceCredential` in `apps/api/src/screens/device-auth.ts`; `verifyDeviceForScreen` (HTTP), `processHello` (WS) and the SSE `?token=` leg all call it. `verifyDeviceForScreen`'s bearer branch is now a thin wrapper — the inline copy was deleted, not duplicated |
| WS **periodically revalidates** open sockets | ✅ | `RealtimeGateway.tickCredentialRevalidation()` on a 30 s ticker; 8 tests covering revoke / epoch rotation / denylist / row deletion / tenant rebind / group move / two fail-open cases |
| Emergency OVERRIDE still reaches a screen on the manifest poll | ✅ | "the life-safety fallback is UNCHANGED" — drives the real `DeviceIdentityInterceptor` **and** the real `ScreensController.getManifest` with the real register-minted bootstrap token; asserts `isEmergency === true` and a lockdown type |

---

## 2. What was actually wrong

`mintDeviceJwt` (screens.controller.ts ~L635) stamps a fingerprint-only credential with
**two** markers — `unproven: true` and `aud: venueos:device-bootstrap` — and
`isUnprovenDeviceClaim` reads either. SEC-001 taught the HTTP verifier to refuse it. The
realtime transports each carried their own copy of "verify a device token" and neither
copy knew:

**`realtime.gateway.ts` `processHello`** verified a signature (no `algorithms` option),
checked the exact-token denylist, read the screen row for its tenant binding, and set
`isAuthenticated = true`. It never checked `kind`, `Screen.status`, `credentialEpoch`, or
either bootstrap marker. Consequences for anyone holding a leaked device fingerprint:

- full delivery of the screen's **tenant-, group- and device-scoped** emergency traffic
  (`broadcastToScope` matches on `ctx.tenantId` / `ctx.groupId` / `ctx.deviceId`, all of
  which `processHello` populated);
- forged **delivery evidence** — `processAck` publishes attacker-chosen
  `eventId`/`status` onto `metrics:ack`;
- forged **liveness** — `processHeartbeat` writes `device:<id>:status` and
  `stampPushConnected(..., {force:true})` makes a dark screen report a live push channel;
- **eviction of the real kiosk** — an admitted socket counts against
  `MAX_SOCKETS_PER_DEVICE = 3` and the cap evicts *oldest*, so repeated attacker connects
  push the genuine kiosk off the push tier and down to polling;
- a **REVOKED or epoch-retired** screen kept its socket, because neither was checked.

**`sse.controller.ts`'s legacy `?token=` leg** did check kind, live status and epoch, but
not the bootstrap markers, and verified with `jwt.verify(token, secret)` — no
`algorithms` allowlist.

The SSE **ticket** path was already safe: `POST /screens/:id/stream-ticket` mints through
`verifyDeviceForScreen` without `allowUnproven`, so a bootstrap credential could never
obtain a ticket. Verified, not assumed.

---

## 3. The fix

### 3.1 One admission predicate — `admitDeviceCredential`

`apps/api/src/screens/device-auth.ts`. Order (identical to what `verifyDeviceForScreen`
always did, so no HTTP reason string or ordering changed):

1. HS256-only verify (explicit allowlist), `kind === 'device'`, a subject claim that
   agrees with itself and with the caller's `expectedScreenId`.
   *New sub-check:* if a token carries **both** `sub` and `deviceId` and they disagree, it
   is refused. HTTP reads `sub`; WS read `deviceId || sub`. Refusing the disagreement is
   what makes those two readings provably resolve the same screen.
2. **Bootstrap refusal**, before any Redis or Postgres work. Deliberate: the signature is
   already verified so the claim is ours, and a fingerprint-scanning attacker cannot spend
   the `connection_limit=10` pool on a credential we were always going to reject — which
   matters most on HELLO, the frame RT-01 exists to protect.
3. Token-string revocation, **fail closed** (`RedisService.sismember` throws
   `RevocationIndeterminateError` under SEC-012; the continuity exception is for safe HTTP
   *reads* only, never a push channel).
4. Live row: exists, not `REVOKED`, paired unless `allowUnpaired`, epoch acceptable.
5. Identity returned **from the row** (DT-03), never from a claim.

`verifyDeviceForScreen`'s bearer branch is now ~20 lines that call this and translate the
result; the HMAC-header branch is untouched. The `credential_unproven` → `stampRepairRequired`
write stays in `verifyDeviceForScreen` **on purpose** — see §5.

Also added: `DEVICE_CREDENTIAL_RETIRED_REASONS` / `isRetiredDeviceCredentialReason`, the
set of refusals that justify closing an **already-open** connection.

### 3.2 WebSocket

- `processHello`'s signed branch is now a single `admitDeviceCredential` call with
  `allowUnpaired: true` (preserves today's behaviour for a screen on the pairing splash —
  it has no tenant yet and still legitimately holds a socket for its own device-scoped
  REFRESH_WEB / CHECK_FOR_UPDATES) and `credentialMaxAgeMs:
  DEVICE_IDENTITY_CREDENTIAL_MAX_AGE_MS`.
- The pre-existing "tenant rebound since mint → force re-auth" check is kept.
- `ClientContext.deviceToken` retains the admitted token so the sweep can re-run the same
  admission. `null` on the dev-only unsigned `dev_` branch.
- `tickCredentialRevalidation()` on a 30 s ticker (matching `SseService.REVOCATION_SWEEP_MS`),
  `unref()`d, cleared in a new `onModuleDestroy`. Carries the `NO LEADER LEASE,
  DELIBERATELY` comment: it is per-connection work on sockets this process holds, exactly
  like `SseService`'s two timers.

### 3.3 SSE

The legacy `?token=` leg's hand-rolled verification is replaced by the same call. Response
shapes preserved exactly: missing/unpaired screen → 404, everything else → 401, revocation
fails closed, and the long-lived credential keeps its rotation grace window (the 60-second
ticket path stays strict, untouched).

---

## 4. Posture choices, stated so they can be argued with

**Admission fails CLOSED. Re-validation of a LIVE socket fails OPEN.** The sweep closes
only on a definitive retirement (token denylisted, screen revoked/deleted/unpaired, epoch
stale, an unproven credential, a subject that stopped matching, tenant rebind). It keeps
the socket on `revocation_check_unavailable` and on a thrown Prisma error. Dropping the
fleet's push tier because Redis and Postgres blinked would cut lockdown delivery during
exactly the incident most likely to coincide with a real emergency — the same reasoning
behind `REVOCATION_CONTINUITY_GRACE_MS` and `SseService.tickRevocation`. Both fail-open
cases are tested.

**Plain JWT expiry does NOT close a live socket.** Expiry is not an operator action, the
holder is still the screen the token names, and (post-fix) a bootstrap token cannot get in
at all — so closing on it would only cost a real kiosk its push tier while its 10-minute
renewal is in flight. An expired token still cannot open a *new* socket. If the lead wants
expiry to close sockets too, it is one entry in `DEVICE_CREDENTIAL_RETIRED_REASONS` plus a
`jwt_invalid:jwt expired` special-case.

**A tenant rebind closes the socket; a group move does not.** Re-scoping a live socket
onto another district's emergency channel is the DT-03 failure class. A group move stays
inside the tenant, so it is routing, not trust: `ctx.groupId` follows the live row.

---

## 5. Fleet-behaviour changes the lead should accept deliberately

**5.1 An unproven screen loses its realtime push tier.** This is the direct consequence of
the pass condition and the main operational cost of the fix. A screen that has been
downgraded to a bootstrap credential (APK re-sideload, cleared WebView storage, a token
expired over summer break, a superseded epoch) used to keep a WebSocket — ~200 ms alert
delivery. It now gets `AUTH_FAIL` on WS and 401 on SSE, and settles on the player's HTTP
poll. Tracing the player's ladder (`apps/web/src/app/player/page.tsx`): WS closes →
`failCount ≥ 2` sets `wsDegraded` (5 s emergency poll cadence) → 3 WS failures escalate to
SSE → 2 SSE failures engage the 5 s HTTP fallback poll. Steady state per affected screen:
~2 WS connects/min (backoff caps at 30 s) plus 1 `/screens/register` per minute
(`attemptCredentialRecovery` is single-flight with a 60 s cooldown). Each refused HELLO
costs one JWT verify and nothing else — the bootstrap refusal precedes all Redis and
Postgres work.

*Net:* alerts still arrive, at ≤5 s instead of ~200 ms, for screens the dashboard already
flags `REPAIR_REQUIRED`. **Measure the blast radius before merging:**
`SELECT count(*) FROM screens WHERE "authState" = 'REPAIR_REQUIRED';` — I could not run
this from the worktree.

**5.2 WS now requires `kind: 'device'`.** Both live mint paths (`mintDeviceJwt`,
`devices.controller.ts` pair exchange) have always set it, and `JwtAuthGuard` has always
required it for HTTP device auth — so a token lacking it is already unable to reach any
device HTTP route. No live token is affected. The old *test fixtures* did lack it; they
were corrected (see §7).

**5.3 SSE admission now reads the 5 s credential snapshot instead of a fresh row.**
`sse.controller.ts` used to justify a direct read ("admission to a long-lived stream should
see the current row"). Sharing one predicate means sharing its snapshot. The guarantee is
unchanged, because it never rested on the read being fresh: every revocation writer calls
`invalidateDeviceCredentialCache`, which drops the in-process entry and DELs the
cross-replica copy, and the SSE sweep re-checks every 30 s regardless. Worst case is a 5 s
window on a replica whose Redis DEL failed.

**5.4 WS admission reads at the 30 s cross-replica freshness** (`DEVICE_IDENTITY_CREDENTIAL_MAX_AGE_MS`),
the same window the global device interceptor uses on the manifest poll, for the same
reason (HELLO is the expensive frame). Same invalidation guarantee as 5.3.

---

## 6. What is NOT closed — honest residuals

1. **`GET /screens/:id/manifest` still serves a bootstrap credential.** Untouched by
   design — CLAUDE.md emergency safeguard #4. Someone holding a leaked fingerprint can
   still read that screen's content assignment and emergency state. They cannot write
   anything, mint a stream ticket, open a socket or a stream, forge render proof, or
   unpair. Closing this read needs an operator-approved recovery flow, which is a product
   change, not a denylist change. A test now pins both halves so a future tightening
   cannot take the life-safety fallback with it by accident.
2. **The 30 s sweep is a window, not an instant kill.** A revoked screen's *open* socket
   survives up to 30 s. New connections are refused immediately. SSE has the same 30 s
   window and has since S15. Shortening it costs one credential-snapshot read per open
   socket per tick; at 30 s those reads are mostly served from the in-process/Redis tiers.
3. **An unauthenticated socket still holds a `clients` map entry** for up to the 10 s auth
   timeout. Pre-existing, not device-scoped (there is no credential to key on before
   HELLO), unchanged by this work. It does not consume a *device* slot — the cap counts
   only authenticated contexts.
4. **`GET /api/v1/realtime/time` is anonymous.** Reviewed and left alone: it returns server
   time only, carries no tenant data and creates no subscription. Out of scope for this
   finding; flagging it so the next audit does not have to rediscover the decision.
5. **The dev-only `dev_` token branch** (`DEV_WS_ALLOW`, non-production only) still bypasses
   all of this. Unchanged; it holds no credential to re-verify and the sweep skips it.
6. **The `alg: none` SSE test passed before this fix too**, because `jsonwebtoken` refuses
   it when a secret is supplied. What changed is that the allowlist is now *stated* rather
   than inherited from a library default. The test comment says so explicitly rather than
   claiming a vulnerability that was not there.

---

## 7. Tests

New: **`apps/api/src/realtime/sec-001-realtime-admission.spec.ts`** — 24 cases.

**Every token in it is minted by driving the real `ScreensController.register` handler**,
per the audit's explicit instruction. `bootstrapToken()` is a fingerprint-only
re-registration (`requiresRePair: true`); `provenToken()` presents a current prior token
and receives the rotated 180-day credential. Two cases assert the fixtures really are what
they claim (`unproven: true` **and** `aud: venueos:device-bootstrap`, ~1 h TTL, no tenant
claim; the proven one carrying neither marker).

**The tests are verified negative tests, not tautologies.** Reverting the three source
files to the base commit and re-running: **18 of 24 fail.** The 6 that pass on base are
the 2 fixture assertions, 2 non-regressions (proven token still works on SSE; `alg: none`
still refused), and the 2 life-safety cases — all of which *must* pass on both sides.

That check also caught a real defect in my own first draft: the SSE bootstrap case
initially passed against the unfixed code because the harness row's epoch did not match
the bootstrap token's, so the refusal was the *epoch* check, not the bootstrap gate. The
token is now minted against a screen already at epoch 1 (a fingerprint-only re-register is
downgraded and does not rotate — P5-1c), and both the WS and SSE bootstrap cases assert
the logged **reason** is `credential_unproven`.

Modified (test-only):
- `realtime.gateway.spec.ts` — device fixtures now carry `kind: 'device'` (§5.2), plus
  `invalidateDeviceCredentialCache()` in `beforeEach` because the shared admission
  memoises the row per screen id.
- `sse.controller.spec.ts` — same cache reset; all 18 existing cases unchanged and green.

**Full API suite: 245 suites / 4,123 tests, all passing. `tsc --noEmit` on
`apps/api/tsconfig.build.json`: clean.**

ESLint on the three touched source files goes 159 → 173 problems. The added 14 are the
same `no-unsafe-member-access` / `no-unsafe-assignment` categories on decoded-JWT `any`
values that already dominate the baseline in these files, plus prettier line-wrap nits. I
did not run `--fix`, because it would reformat pre-existing lines and inflate the diff the
lead has to review. Lint is not a blocking gate on this path (baseline is already red).

---

## 8. Files

| File | Change |
|---|---|
| `apps/api/src/screens/device-auth.ts` | `admitDeviceCredential` + retired-reason set; `verifyDeviceForScreen`'s bearer branch delegates to it |
| `apps/api/src/realtime/realtime.gateway.ts` | `processHello` uses the shared admission; `ClientContext.deviceToken`; `tickCredentialRevalidation` + 30 s ticker + `onModuleDestroy` |
| `apps/api/src/realtime/sse.controller.ts` | legacy `?token=` leg uses the shared admission; dead `jwt` / `requireSecret` / epoch imports removed |
| `apps/api/src/realtime/sec-001-realtime-admission.spec.ts` | **new**, 24 cases |
| `apps/api/src/realtime/realtime.gateway.spec.ts` | fixtures + cache reset |
| `apps/api/src/realtime/sse.controller.spec.ts` | cache reset |

Commits on `worktree-agent-a0d20770821c048fc`: `75ecaa0c`, `d91b869d`, `808a8853`, `a02ca69e`.
