# §10 Auth + §16 Forensics audit — 2026-08-03

**Scope:** §10 Auth+identity, §16 Forensic/audit coverage. Read-only, evidence-cited. HEAD = `cec023ec` (master, ≥ a74c7894). Prior audit `08-ACCOUNT-BLAST-RADIUS.md` (ACC-01..12) and `2026-08-03/00-LAUNCH-READINESS.md` reviewed; claimed ACC-01..08 fixes **spot-checked present at HEAD**. Launch doc was silent on ACC-09..12 — those are the live gaps below.

## Coverage table

| Bullet | Status | D | UX | F | Note |
|---|---|---|---|---|---|
| **§10** JWT issuance + revocation | Covered | – | – | A | Durable Redis+Postgres revocation (`jwt_revoked_list` + per-user invalid-before epoch), **fails closed** on Redis error (`jwt-auth.guard.ts:266-273`). ACC-01 takeover chain closed. |
| Argon2 hashing | Covered | – | – | A | argon2id m=64MiB/t=3/p=4 (`crypto.config.ts:7-12`), OWASP+. Reset tokens: 32-byte, SHA-256 at-rest, 1h TTL, single-use, non-enumerating. No bcrypt for passwords. |
| express-session cookie | Covered | – | – | A- | httpOnly, secure(prod), sameSite none(prod)/strict(dev), 8h rolling (`main.ts:186-193`). Auth is Bearer-only so cookie isn't the credential (minimal CSRF surface). |
| TOTP MFA | Covered | B+ | B | A- | Real: hand-rolled RFC-6238 constant-time, envelope-encrypted secrets, per-account limiter. **Now enforced** via `mfaRequired` (ACC-03, `auth.service.ts:218`) + writer endpoint + enroll-on-required flow. |
| WebAuthn passkeys | N-A | – | – | – | `Passkey` schema model exists but **zero implementation** (2-method: no `passkey` ref in `apps/api/src`; no route). Only an aspirational comment in `signup/page.tsx:181`. Dead schema, not a user-facing costume. |
| SSO OIDC | Covered | – | B | A- | Live (`openid-client@5.7.1`). Gated by ACC-01/04; secrets encrypted at rest (`sso.crypto.ts`). |
| SSO SAML | Deferred | – | – | – | `passport-saml` deliberately uninstalled (CVE-2025-54419); honest 503, arming SUPER_ADMIN-only, callback hard-gated on `enabled`. 0 enabled tenants. |
| SSO Google/Okta | Covered | – | B | B+ | Via generic OIDC (district configures own IdP). |
| Clever SIS | Covered | – | B | B+ | Real OAuth connect/callback/disconnect/sync/preview/status + `clever-sync.cron.ts`. Not a costume. |
| Role staleness | Covered* | – | – | B+ | Claims stale-by-design but every **tightening** (downgrade, panic-off, mfa-on, delete, password change/reset) triggers per-user mass revocation. *ACC-10 gap — see findings. |
| API keys (ACC-06) | Covered | B | B | A | Per-key scopes (default-deny), 90d default expiry / 365d cap, **emergency prefix denied unconditionally**, `apiKeyId` first-class audit column + attribution rows. |
| Device tokens (DT-01..08) | Covered(ref) | – | – | B+ | `20260803090000_device_credential_revocation` migration present; deep-dive owned by player-security audit. |
| Rate limiting (auth) | Covered | – | – | A- | Global `ClientIpThrottlerGuard` keyed on **unspoofable** `clientIpFromRequest` (ACC-08, count-from-right by `TRUSTED_PROXY_HOPS`). Per-endpoint caps on login/change-password/signup/reset; per-account MFA limiter. |
| **§16** AuditLog on every privileged action | **Partial** | – | – | B- | Security/identity/emergency/billing/api-keys/sso **complete**; content domains **thin** (see findings). |
| DB immutability triggers | Covered | – | – | A | UPDATE+DELETE blocked (`20260531000000`), TRUNCATE blocked (`20260717120000`), deduped (`20260609000000`). Row-level + statement-level. |
| Cross-tenant scope (TEN-001) | Covered | – | – | B+ | Gate `check-tenant-isolation.cjs` CI-wired (`tenant-isolation.yml`), baseline **180** (ratchets down only). Spot-checks pass (below). |
| Replay defense | Covered | – | – | A- | Stripe webhook idempotency ledger `processed_stripe_events` (INSERT-first dedup, `stripe.service.ts:359-369`); OIDC state single-use (Redis `del`); emergency eventId dedup (player-audit ref). |
| Cron consistency checks | **Partial** | – | – | B | License↔Stripe: `LicenseReconcileCron` registered + runs (`billing.module.ts:21`). Address↔lat/lng: **manual** endpoint only, not cron. |
| Audit query surface (UI) | Covered | B+ | A- | A | `/api/v1/audit` list/recent/export, tenant-scoped, admin-only, filterable (incl. `apiKeyId`), CSV formula-injection defense; web UI `[schoolId]/audit`. |
| ipAddress correctness | Covered | – | – | A | `clientIpFromRequest` used in throttler, audit rows, request-log, anomaly, guard, screens. |

**TEN-001 spot-checks (5 diverse):** `audit.controller.ts:86` (tenantId filter), `users.controller.ts:103` (tenantId), `sso.controller.ts:281` (`assertTenantAccess` incl. parent/child), `api-keys.service.ts:181` (tenantId), `emergency` (scope-resolved). All tenant-scoped.

## Findings

**[P1] ACC-09 — Cross-tenant account hijack via `createUserDirect` (still OPEN; recommended fix never applied).**
Evidence: `onboarding/onboarding.service.ts:572-601`, esp. `:582` `const patch = { role, status:'ACTIVE', passwordHash, tenantId: input.tenantId }`. The existing-user lookup is by **global email** (`:572`) and only rejects `status === 'ACTIVE'` (`:573`); a victim-tenant `INVITED` placeholder falls through and its `tenantId` is **rewritten to the attacker's tenant**. The cross-tenant guard (`:562`) only checks `inviter.tenantId === input.tenantId` (attacker's own tenant → passes). Route `POST /api/v1/onboarding/users` is reachable by DISTRICT_ADMIN (`onboarding.controller.ts:76-78`), which anyone gets from unauthenticated `POST /signup` (`onboarding.service.ts:187-193`, no email verification). `acceptInvite` (`:664-668`) never asserts `invite.tenantId === user.tenantId`, so when the genuine invitee later clicks their link they are logged into the **attacker's** tenant (`:685`). Preconditions: self-signup + knowledge of a victim's pending-invite email. Impact: cross-tenant integrity break — steals the victim's email slot and lands the real invitee in the wrong tenant. The prior audit noted it becomes CRITICAL if invite-cleanup is ever added (the `UserInvite.userId @unique` constraint that blocks the `createInvite` variant is load-bearing-by-accident). **KNOWN(ACC-09).** Fix (from prior audit, unimplemented): in `createInvite`+`createUserDirect` refuse when `existing.tenantId !== input.tenantId` regardless of status; `acceptInvite` assert tenant match.

**[P2] ACC-10 — A DISTRICT_ADMIN/SCHOOL_ADMIN cannot revoke a departing employee (still OPEN).**
Evidence: `users.controller.ts:267-268` (`PUT /:id/role` → `@RequireRoles(SUPER_ADMIN)`) and `:561-562` (`DELETE /:id` → `@RequireRoles(SUPER_ADMIN)`). No deactivate/suspend path exists (2-method: full read of controller; only `status` non-ACTIVE write is `'INVITED'`). A customer's own admin can create/invite users but cannot demote, delete, or disable one — they must contact the vendor. The revocation machinery (`revokeUserTokens`, `:88`) is built and correct but unreachable by the people who need it. For a life-safety product this is a real operational gap. **KNOWN(ACC-10).** Fix: allow DISTRICT/SCHOOL_ADMIN to deactivate + demote strictly-below-own-rank (`assertCallerCanAssignRole` already expresses the policy), routed through the existing revoke path.

**[P2] §16 — Content mutations are largely unaudited (NEW characterization).**
Systematic sweep of all 48 mutation-bearing controllers vs distinct audit actions per domain:
- `templates/` — **25 mutation handlers, 2 distinct audit actions**. Template create/update/delete/zones/versions leave no forensic row.
- `playlists/` — 6 handlers / 2 actions. `assets/` — 14 / 5 (approval audited; folder/asset CRUD partial). `streaming/` — 5 / 2. `floor-plans/` — 5 / 2. `tenants/` — 16 / 7.
A change to a live template/playlist/schedule directly alters what shows on thousands of screens — a "privileged action" a forensic reviewer would expect under §16's "AuditLog row on EVERY privileged action." Impact: post-incident "who changed this board" is unanswerable for content. **NEW.** Fix: add `auditLog.create` (or the `auditActorFields` interceptor) to content-mutating write paths.

**[P2/LOW] ACC-11/ACC-12 — MFA/reset replay window (ACC-12 confirmed OPEN; ACC-11 unverified).**
ACC-12: `completePasswordReset` marks only `record.id` used (`onboarding.service.ts:312-315`); a user's other outstanding reset tokens stay live. Confirmed still open. ACC-11 (TOTP ±1-step / challenge-token replay) — `totp.ts` step-tracking not re-read at HEAD, so **UNVERIFIED** (likely still open per prior audit). Low severity; short windows, strong tokens otherwise.

**[P3] §16 — Zero audit coverage on several mutating endpoints (NEW).**
`fitness/stick-control.controller.ts` (create/delete stick + **`POST :stickId/command`** — physical equipment control, the notable one), `sample-data.controller.ts` (incl. **`DELETE all`**), `data-source`, `music`, `notifications` (read/read-all). Mostly low-sensitivity; stick-control command driving physical hardware with no forensic row is the one worth closing. **NEW.**

**[P3] §16 — Address↔lat/lng consistency is a manual job, not a cron (NEW).**
`geocode-backfill/geocode-backfill.controller.ts:38` — "NOT wired to any cron/scheduler"; it's a manual `POST /api/v1/admin/geocode-backfill` (SUPER_ADMIN). The License↔Stripe consistency check runs on a self-scheduling interval; the geo one does not. Minor deviation from §16's "cron-triggered consistency checks." **NEW.**

**Informational (not findings):**
- API-key `verify()` uses `!==` string compare, not `timingSafeEqual` (`api-keys.service.ts:260-261`) — documented, defensible for SHA-256 of 128-bit random.
- `sameSite:'none'` in prod (`main.ts:189`) — necessary for cross-origin Vercel→Railway; acceptable given Bearer-only auth.
- Self-signup mints DISTRICT_ADMIN with no email verification (`onboarding.service.ts:187`) — by-design self-serve, but it is the enabler for ACC-09's attacker account and allows spam tenants. Worth a product decision (email verification / approval).
- The `20260531` immutability migration comment references a hard `tx.user.delete` that is now soft-delete — stale comment only, trigger still correct.

## What is strongly done (state to a reviewer)
ACC-01 is closed in **four independent layers**: Zod enum at the edge (`sso.types.ts:66`, SUPER_ADMIN excluded), rank gate in service (`sso.service.ts:108`), provisioning-time clamp (`:655-670`), and a build-time drift guard (`sso.types.ts:25-33`). ACC-02 (change-password endpoint + reset revocation), ACC-03 (mfaRequired enforced), ACC-04 (OIDC `enabled` gates the callback), ACC-05 (archived-tenant blocked at login+guard+SSO), ACC-06 (scopes+expiry+emergency-deny+attribution), ACC-07 (switch caps at remaining TTL), ACC-08 (unspoofable client-IP) — **all verified present at HEAD**. Audit immutability (UPDATE/DELETE/TRUNCATE), billing idempotency ledger, and the tenant-isolation CI gate are real and enforced.

## Unverified / open questions
- **ACC-11** (TOTP step-reuse / challenge single-use) — not re-read at HEAD; UNVERIFIED.
- **Device-token (DT-01..08)** internals — accepted by reference to the player-security audit; not independently re-traced here.
- **Emergency per-eventId dedup** — confirmed by reference (CLAUDE.md + player R-findings), not re-traced in this pass.
- **Runtime confirmation** — read-only; no requests issued. ACC-09 is traced end-to-end in source (route→guard→`:582` rewrite→`acceptInvite`), rated on code evidence; a staging repro would settle it.
- **Multi-replica MFA limiter** — `MfaRateLimiter` is in-memory per replica; deployed replica count not verified (weakens lockout by factor N if >1).
