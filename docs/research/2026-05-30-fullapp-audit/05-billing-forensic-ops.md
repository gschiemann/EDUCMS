# §11 Billing · §16 Forensic/Audit · §17 Operational/DX

**Audit date:** 2026-05-30 · read-only, current master · the 2026-05-28 synthesis is materially stale for these clusters (its 3 biggest claims — P0-4 forensic theater, P1-8 no reconcile cron, P1-13 unwrapped pair-tx — are all REMEDIATED). Bar = real gap today.

## 1. Coverage table

| § | Domain | D | UX | F | Status |
|---|---|---|---|---|---|
| 11 | Billing + commerce | A | A | **A** | covered — webhook idempotency+ordering+audit, seat-tx wrapped, PCI clean, reconcile cron live. 1 P2 + 1 P3 |
| 16 | Forensic / audit | A | A− | **A−** | covered — synthesis "theater" FIXED; 43 files write durable rows; DB immutability trigger present; cross-tenant checks verified. 1 P2 |
| 17 | Operational / DX | A | A | **A** | covered — health/CI/hooks/secrets/pool real + boot-enforced; AI spend-cap Redis. Multi-replica latent only on non-spend limiters |

## 2. Findings

**Resolved since synthesis (verified real, not costume):** P0-4 forensic theater (renamed `RequestLogInterceptor` w/ honest docs; login writes `AUTH_LOGIN_SUCCESS/FAILED` `auth.controller.ts:46,58`; templates audit every mutation; sponsors audit `sponsors.service.ts:61`). P1-8 reconcile cron (`license-reconcile.cron.ts` daily, idempotent, writes `LICENSE_RECONCILED` doubling as multi-replica dedup). P1-13 seat pair-tx (`screens.controller.ts:1094-1127` Serializable tx wrapped in `withDbRetry`; P2034 transient; LICENSE_EXHAUSTED re-throws clean 402). P1-14 AI cap → Redis. P1-5 webhook retry worker.

| Sev | § | Finding | file:line | Costume? | Fix |
|---|---|---|---|---|---|
| **P2** | 11 | `activate-trial` is a hardcoded stub (`trialDays:14, seatLimit:3`, no DB write, no Setup-Intent) — the 14-day trial lifecycle is cosmetic. Pilot is the no-License default so harmless, but the response *looks* transactional. | `billing/billing.controller.ts:129-140` | mild | persist a real trial License or relabel copy |
| **P2** | 16 | Failed login against an **unknown email** writes NO AuditLog row (only stdout warn) — `AuditLog.tenantId` is NOT NULL, no tenant to attribute. Credential-stuffing recon against non-existent accounts isn't queryable in the durable trail. | `auth/auth.controller.ts:101-108` | no | make `AuditLog.tenantId` nullable for security events, or a sentinel "system" tenant |
| **P3** | 11 | `LicenseService.PILOT_SEAT_LIMIT = 1000` (not documented 3) — deliberate 2026-05-04 testing bump; comment says drop to 3 at first paying customer. Latent free-seat leak if forgotten at GA. | `license/license.service.ts:33` | no | drop to 3 / contracted count at first paid onboarding |
| **P3** | 17 | Multi-replica latency: `BrandingRateLimiter`, `MfaRateLimiter`, `DataSourceRateLimiter` are in-memory Maps → N replicas = N× cap. NOT a live boundary (each has a Redis `@Throttle` per-IP wall in front; only true spend cap (AI) already Redis). | `branding-rate-limiter.ts:38`, `mfa-rate-limiter.ts:33`, `data-source-rate-limiter.ts:33` | no | move to Redis before scaling past ~3 replicas |

**PCI-PAN scan: CLEAN.** No PAN/card/CVV anywhere. All card entry Stripe-hosted; webhook reads only `type`/`data.object`; invoices flatten to amounts + hosted URLs. SAQ-A holds.

**Privileged-path AuditLog gaps: NONE** beyond the unknown-email login. 43 source files write durable rows (auth, billing, license, emergency, templates, sponsors, users/role `users.controller.ts:222`, POS, SSO, streaming, GPIO, USB, floor-plans, webhooks, branding, tenants, devices, assets, playlists, schedules). DB-level immutability enforced (`20260526010000_audit_log_immutability` BEFORE UPDATE/DELETE triggers RAISE EXCEPTION). Cross-tenant scope verified on the one unauthenticated mutating route (sponsor impression checks `sponsor.tenantId === game.tenantId`).

**§17 spot-checks PASS:** health (liveness always-200 w/ 400ms DB budget; readiness 503-on-DB-down; emergency-path verifies WS signer); `connection_limit>=10` + `pool_timeout>=20` **boot-enforced** — API refuses to start otherwise (`main.ts:161-174`); boot-time required-secret enforcement; gitleaks in CI; all named CI gates present; pre-commit blocks lockfile drift + `inset:0`, pre-push runs preflight.

## 3. Biggest risk
**No real P0/P1 in billing/forensics/ops today** — the spine is hardened. The one thing not to forget: drop `PILOT_SEAT_LIMIT` from 1000 to the contracted count before the first paying customer, or that line silently leaks free seats at GA.
