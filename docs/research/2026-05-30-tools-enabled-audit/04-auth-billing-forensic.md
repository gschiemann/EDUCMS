# Audit — §10 Auth/Identity · §11 Billing/Commerce · §16 Forensic/Audit

_Agent a3617a50b0c01f1bf · read-only, file:line-traced · 2026-05-30_

## Coverage (D/UX/F)
| Section | D | UX | F |
|---|---|---|---|
| §10 Auth + Identity | B | B | B+ |
| §11 Billing + Commerce | B | B | B+ |
| §16 Forensic/Audit | C | C | B |

## TOP FINDINGS
### F-1 — P0 — `audit_logs` has NO DB-level immutability trigger
CLAUDE.md §16 claims "DB-level immutability triggers (UPDATE/DELETE blocked at storage)" — **this is not implemented.** Zero `CREATE TRIGGER … audit_logs` in any migration. App-layer never mutates audit rows (seed skips deleteMany in prod), BUT a SUPER_ADMIN with Supabase/psql access or a compromised API process can UPDATE/DELETE audit history. The documented safeguard is app-layer-only.
**Fix:** migration adding `BEFORE UPDATE OR DELETE ON audit_logs` trigger that RAISEs. (Makes the claim true at storage.)

### F-2 — P1 — OIDC callback CSRF / code-injection
`sso.controller.ts:112` + `sso.service.ts:373`: if the session is lost, `expected.state` is `undefined`, and openid-client's `callback()` **skips state verification entirely** when state is omitted → an attacker who intercepts an auth code could complete OIDC login as an arbitrary user.
**Fix:** reject the callback with 400 when `expected.state === undefined`, before calling validateOidcCallback. (Gate: confirm whether any tenant has OIDC enabled — limits live exposure, but fix before enabling for anyone.)

## §10 Auth — B+
- Argon2id (A): consistent params, timing-decoy anti-enumeration, INVITED blocked w/ equal timing, legacy plaintext removed.
- MFA (A): TOTP enroll/verify/disable/backup all audited, rate-limited, password re-auth to disable.
- JWT revocation 3 paths: HTTP guard dual-checks `jwt_revoked_list` (fail-open on Redis-down) + `getTokenInvalidBefore` (fail-CLOSED). SSE/WS check only `sismember`.
- SAML CVE-2025-54419: correctly gated — SUPER_ADMIN to enable, `config.enabled` enforced, denied attempts audited, zero SAML tenants in prod (interim control OK; still migrate per #199).
- P2: `sismember` fail-open when Redis fully disconnected (logout-revoked token could re-auth during outage; documented). P2: SSE/WS skip `getTokenInvalidBefore`. P3: `jwt.strategy.ts:19` omits canTriggerPanic (harmless — manual guard is primary).

## §11 Billing — B+
- Checkout/portal/invoices RBAC-gated + graceful `{enabled:false}` when STRIPE_* unset. `activate-trial` correctly read-only.
- Webhook: signature verified before logic; INSERT-first idempotency via `ProcessedStripeEvent` PK; out-of-order guard (`stripeLastEventCreatedAt`); **AuditLog in the SAME `$transaction` as the License upsert** (all 3 handlers).
- SERIALIZABLE seat-pair tx + 20s timeout + `withDbRetry` (P2034) — seat ceiling provably enforced under concurrency.
- PCI (A): no PAN anywhere; Stripe-hosted card entry; SAQ-A.
- P2: `processed_stripe_events` has no TTL/cleanup cron → unbounded growth (fix: daily DELETE >30d). P2: no dunning email on `invoice.payment_failed` (`stripe.service.ts:634`) — status flips PAST_DUE but no proactive outreach. P3: no 14-day trial expiry (PILOT_SEAT_LIMIT=1000, no expiry). P3: refunds not programmable (SUPER_ADMIN does it in Stripe dashboard).

## §16 Forensic — B
- AuditLog confirmed on: login success/fail/logout, user create/role/delete/panic-flag, invite/signup/password-reset, SSO config/login/SAML-enable-allow-deny, AI key set/clear/test-fail, every Stripe License mutation, License upsert/wipe, asset approve/reject, emergency trigger/clear, MFA enroll/verify/disable/challenge. Atomic-tx on the critical ones.
- Cross-tenant scope: PASS (writes filter `tenantId: req.user.tenantId`; device-JWT lookups use verified id). RBAC spatial scope only when district/school params present → relies on per-controller tenant filters (accepted pattern, authorship dependency).
- Replay: Stripe idempotency + emergency per-eventId dedup. PASS.
- P3: best-effort `.catch(()=>{})` on MFA/AI/logout audit writes swallows failures silently → add a failure counter/metric.

## Fix priority
P0: F-1 audit_logs immutability trigger. P1: F-2 OIDC state check. P2: stripe-events TTL cron, dunning email, sismember boot-warning, SSE/WS getTokenInvalidBefore.
