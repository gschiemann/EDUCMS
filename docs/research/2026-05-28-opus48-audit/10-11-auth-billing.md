# SECURITY AUDIT — §10 Auth + Identity · §11 Billing + Commerce

> Opus 4.8 full-app audit, 2026-05-28. Read-only. Traced the guard chain, the
> seat-enforcement tx, the Stripe webhook, the MFA crypto, the SSO signature path —
> not comments.

## Page 1 — Coverage (D / UX / F)
| # | Domain | D | UX | F | Status |
|---|---|---|---|---|---|
| 10.1 | JWT issuance + revocation | B+ | B | **B−** | COVERED — revocation checked everywhere, fails CLOSED on Redis error. **Gated on `NODE_ENV==='production'` only** + no cross-user revocation (P1-A/B) |
| 10.2 | Argon2 password hashing | A | A | A | COVERED — Argon2id m=64MB/t=3/p=4 (above OWASP); timing decoy; no plaintext fallback |
| 10.3 | express-session cookies | A− | A | A | COVERED — OIDC state/nonce; SESSION_SECRET boot-required |
| 10.4 | TOTP MFA | A− | A− | A− | COVERED — **fully built, not pending.** RFC6238, AES-256-GCM seal, Argon2id backup codes. No per-code replay lock (P2-A) |
| 10.5 | WebAuthn passkeys | — | — | — | **N-A — not built** (honest) |
| 10.6 | SSO (OIDC/SAML/Google/Okta) | B+ | B | B+ | COVERED — **built**, real passport-saml + openid-client crypto; tenant-scope gate. Generic OIDC/SAML (no dedicated Google/Okta button) |
| 10.7 | Clever SIS | B | B | B | COVERED — built; no hole spot-checked |
| 10.8 | **Role staleness (canTriggerPanic/role)** | C | C | **C** | COVERED — **REAL GAP, P1-A** |
| 11.1 | Stripe Checkout/Portal/Invoices | A− | A | A | COVERED — all Stripe-hosted, graceful degrade |
| 11.2 | Webhook idempotency+ordering+audit | A | n/a | A | COVERED — hardening **held** |
| 11.3 | License seat enforcement (SERIALIZABLE) | B+ | B− | A− | COVERED — over-seating IS prevented; loser gets 500 not graceful retry (P2-B) |
| 11.4 | Multi-vertical pricing tiers | B | B | B | COVERED |
| 11.5 | Free pilot lifecycle | B | C+ | C+ | COVERED — `activateTrial` is a **stub**; PILOT_SEAT_LIMIT=1000 contradicts documented 3 (P2-C) |
| 11.6 | Dunning/past-due UX | C+ | C | B | PARTIAL — webhook sets PAST_DUE/SUSPENDED + blocks new pairs; no in-app banner verified |
| 11.7 | Refunds + comp seats | B | B | B | COVERED — comp via /super; refunds via Stripe Portal only (acceptable) |
| 11.8 | **PCI scope (no PAN)** | A | A | A | **VERIFIED CLEAN — no PAN/CVV/card on servers or logs.** Stripe-hosted iframe only (SAQ-A) |

## SECURITY FINDINGS
**P0 — none exploitable today.** No auth bypass, no missing tenant-scope on a
mutating endpoint, no PAN leak, no replay hole in §10/§11. Documented safeguards
(webhook idempotency, SERIALIZABLE seat tx, fail-closed revocation, SSO tenant-scope
gate, privilege-escalation table) are all real + wired — not theater.

### P1-A — Role / `canTriggerPanic` staleness: a demoted user keeps elevated capability for up to 30 days (the named emergency risk)
`canTriggerPanic` + `role` are read from the **JWT claim**, never re-checked vs the
live DB row on the emergency path:
- `jwt-auth.guard.ts:131` — `canTriggerPanic: payload.canTriggerPanic` (token, not DB)
- `rbac.guard.ts:71-73` — `@AllowPanicBypass` reads `typedUser.canTriggerPanic` from the claim
- `users.controller.ts:163-222` (updateRole) + `:261-332` (setCanTriggerPanic) update
  the DB row + audit, **but never revoke the target's existing JWT(s).**

**Scenario:** admin revokes a receptionist's panic capability (or demotes a
SCHOOL_ADMIN). DB says no. **Their token still says yes** — with `rememberMe` it lives
**30 days** (`auth.service.ts:146`). They can still `POST /emergency/trigger` and lock
down the district. The code admits it (`users.controller.ts:253-259`: "the user's
CURRENT JWT keeps the old value… admin can force /auth/logout (Sprint 2+ feature)") —
**that feature doesn't exist** (only self-logout writes `jwt_revoked_list`). RESTRICTED_VIEWER
hard-block (`rbac.guard.ts:72`) mitigates demote-to-viewer, but NOT demote-to-CONTRIBUTOR
or a `canTriggerPanic:false` flip. **Fix:** on tightening, add target's tokens to
`jwt_revoked_list` (Redis set + fail-closed check already exist), or per-user
`tokenInvalidBefore` checked in the guard.

### P1-B — JWT revocation is `NODE_ENV==='production'`-gated
`jwt-auth.guard.ts:89` — the whole `jwt_revoked_list` check is inside
`if (NODE_ENV==='production')`. In staging/preview/misconfigured deploys, logout +
revocation are silent no-ops. SSE (`sse.controller.ts:65`) + WS gateway
(`realtime.gateway.ts:133`) check unconditionally — inconsistent. **Fix:** drop the
env gate (cheap + fails-closed already).

## §11 PCI-Scope Statement (VERIFIED)
Grepped API for `card_number|cardnumber|pan|cvc|cvv|exp_month|exp_year|creditcard` —
zero true hits. All card entry on Stripe-hosted Checkout + Portal; we store only
opaque IDs (stripeCustomerId/stripeSubscriptionId). Webhook reads only
id/type/status/created/customer/subscription. Logs never print card data, passwords,
JWTs, or secrets. **PCI-SAQ-A intact.**

## §11 License-Enforcement Concurrency (the explicit ask)
**Over-seating IS prevented; only gap is graceful-degradation.** Seat gate is a
single `Serializable` tx (`screens.controller.ts:1044-1073`): `assertSeatAvailable`
runs `screen.count({pairedAt:{not:null}})` with the **tx client** then sets pairedAt
in the same tx. Two admins racing the last seat → each write falls in the other's
predicate → PG SSI aborts one (40001→P2034). Loser can't commit, ceiling holds. Only
two `pairedAt` writers (admin /screens/pair guarded; /devices/pair is a no-op when
already claimed); register never sets it → one gate. **Gap (P2-B):** the raw
`$transaction` isn't wrapped in `withDbRetry` (which treats P2034 as retryable), so
the loser gets an unhandled **500** instead of a clean retry→402 LICENSE_EXHAUSTED.

## TOP 10 RANKED FIXES
1. **(P1-A) Revoke live tokens on role-downgrade + `canTriggerPanic:false`** —
   `users.controller.ts` updateRole/setCanTriggerPanic. Closes the 30-day
   "revoked-but-still-can-lockdown" window. Highest-value fix in scope.
2. **(P1-B) Un-gate JWT revocation from `NODE_ENV==='production'`**
   (`jwt-auth.guard.ts:89`) — make unconditional, match SSE/WS.
3. **(P2-B) Wrap the SERIALIZABLE pair tx in `withDbRetry`**
   (`screens.controller.ts:1044`) → clean 402 instead of 500 to the losing admin.
4. **(P2-A) Per-code TOTP replay protection** — persist `mfaTotpLastUsedStep`, reject
   reuse within the ±1 window (today same code works ~90s).
5. **(P2-C) Reconcile pilot seat limit** — `PILOT_SEAT_LIMIT=1000`
   (`license.service.ts:33`) contradicts documented 3-seat + `activateTrial`'s
   `seatLimit:3`. Lets pilots claim 1000 seats free. Drop to contracted number +
   verify the License upsert end-to-end.
6. **(P2) Finish `activateTrial`** (`billing.controller.ts:129`) — copy-only stub;
   wire Setup-Intent or document the 14-day trial as the no-License default.
7. **(P3) MFA rate limiter in-memory, not multi-replica-safe** (`mfa-rate-limiter.ts`)
   — per-IP @Throttle (Redis) is the real backstop; migrate per-user limiter to Redis
   before scaling past ~3 replicas.
8. **(P3) SSO "test connection" false confidence for SAML** (`sso.service.ts:462`) —
   validates field presence, doesn't contact IdP; real SP-initiated validator is a
   follow-up.
9. **(P3) `MfaController.audit` swallows all failures silently** (`:587-600`) — add a
   fallback log line so a dropped mfa.disabled/challenge_failed row is at least visible.
10. **(P3) `BillingController.invoices` fires `syncSubscriptionQuantity`
    fire-and-forget on every page load** (`:107`) — Stripe write per invoice view;
    debounce or move to pair/unpair hooks only.

## Verified strengths (not assumed)
- Webhook hardening held: ProcessedStripeEvent.id PK (atomic insert-first dedup),
  License.tenantId @unique (atomic upsert), out-of-order rejection, audit in same tx.
- SSO cross-tenant takeover guard real (`sso.controller.ts:206`).
- Privilege escalation closed in one place (`role-assignment.ts`) — SCHOOL_ADMIN
  can't mint a DISTRICT_ADMIN; SUPER_ADMIN can't self-replicate via invites.
- Password reset: 256-bit token, SHA-256 at rest, TTL, single-use, lookup-by-hash
  (no enumeration).
- Emergency writes funnel through `resolveScopeTenant` — no cross-tenant trigger.

**Bottom line:** §10/§11 is a notably hardened surface — no exploitable P0. The one
finding that matters most is **P1-A (role/panic staleness on the emergency path)**:
a revoked panic capability keeps working for up to 30 days because nothing revokes
the live token. Everything else is P2/P3 polish.
