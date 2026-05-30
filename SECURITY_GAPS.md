# Security Gap Register — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against code:** 2026-05-30.
**Audience:** the VenueOS team, security reviewers, district IT due-diligence.
**Companion to:** `SECURITY_BASELINE.md` (the SHIPPED controls) and
`THREAT_MODEL.md` (the attack surface). This file is the **single honest list
of what we have NOT built, have deliberately deferred, or have accepted as a
risk** — so the baseline can point here instead of overstating coverage.

> **Why this file exists.** On 2026-05-21 the lead found that our security docs
> *lied* — they asserted controls (mandatory malware scanning, refresh-token
> rotation, `SameSite=Strict`) that were never built. A doc that claims a
> safeguard we don't have is worse than no doc: it is false assurance to a
> district IT reviewer and the exact "theater" pattern that burned us. The rule
> now: a control is either a **SHIPPED** line in `SECURITY_BASELINE.md` with a
> `file:line` cite, or a **GAP** in this register. Nothing in between, no
> aspirational language written as fact.

**How to read the Status column:**
- **OPEN** — not built; a reviewer will ask about it; mitigation noted.
- **ACCEPTED** — known, deliberately not addressed yet; risk is understood and
  tolerated for the current stage.
- **PENDING** — on the roadmap, partially scaffolded or scheduled.
- **DECISION-NEEDED** — a policy/ownership call the team must make.

---

## 1. Gap register (the whole truth, in one table)

| # | Gap | Status | Mitigation in place today | Tracking / next step |
|---|-----|--------|---------------------------|----------------------|
| G1 | **Upload malware scanning** — no ClamAV / AV engine; uploaded files are not scanned for malware. | OPEN | MIME allowlist + magic-byte sniff + SVG block (upload **and** bucket) + SHA-256 content addressing + 500 MB cap (`assets.controller.ts:39,523`; `supabase-storage.service.ts:57`). Files are served as static media, not executed server-side. | Add an async scan step (ClamAV sidecar or a hosted scan API) before flipping an asset to a publishable state. A district security review **will** ask about this. |
| G2 | **Refresh-token rotation** — none. `rememberMe` issues a flat 30-day access JWT; there is no short-lived access + rotating refresh pair. | OPEN | Single-token revocation set (`jwt_revoked_list`) + per-user "invalid-before" epoch for mass revoke on role/panic downgrade, **fail-closed** in every environment (`jwt-auth.guard.ts:97-126`; `auth.service.ts`). | Implement RT rotation (short access TTL + rotating refresh, reuse-detection). Until then, a stolen 30-day token is valid until logout/epoch-revoke. |
| G3 | **WebAuthn / passkeys** — not built. (TOTP MFA **is** shipped — see note below.) | PENDING | TOTP second factor is fully shipped (`auth/mfa.controller.ts`, `auth/totp.ts`, encrypted secret at rest) and covers the MFA requirement for now. | Add WebAuthn as a stronger phishing-resistant second factor when prioritized. |
| G4 | **Repo is PUBLIC on GitHub** (`github.com/gschiemann/EDUCMS`). Every commit, PR, and issue is world-visible. | DECISION-NEEDED | gitleaks runs in the pre-commit hook **and** CI; `.env` is gitignored; boot-time `requireSecret()` refuses to start in prod on missing secrets (`security/required-secret.ts`). No secret has ever been committed. | Decide public-vs-private deliberately. Public is fine **only** while secret hygiene holds 100%. Flip to private before any sensitive partner/customer code lands. See `docs/SECURITY_HYGIENE.md`. |
| G5 | **In-memory abuse / rate-limit counters are not multi-replica-safe.** The AI free-tier hourly cap, branding-scraper rate limit, and similar live in process memory. | ACCEPTED (single replica) | The API runs as a **single Railway replica** today, so the counters are correct as deployed. | Move load-bearing counters to Redis **before** horizontally scaling the API — otherwise N replicas = N× the intended cap (a security boundary, not just UX). Audit P1-14, `docs/research/2026-05-28-opus48-audit/`. |
| G6 | **No "impossible-travel" / advanced login-anomaly detection.** | ACCEPTED | Login rate limiting + Argon2id cost + audit rows on success/failure give basic abuse resistance. | Backlog. Layer geo/velocity anomaly detection if/when we see credential-stuffing pressure. |
| G7 | **No dedicated staging environment.** `push-to-master = production` (Railway API + Vercel web). | ACCEPTED | `pnpm preflight` + the deploy-reliability CI gates (`docker-build`, `api-build`, `web-build`, `lockfile-check`, `taurus-safety`, `cross-browser`, a11y) run before merge; rollback is a git tag + tarball (`docs/BACKUP_AND_ROLLBACK.md`). | Stand up a staging Railway/Vercel target when budget/scale warrants. Until then, treat every merge as a production change. |
| G8 | **Player-side emergency message verification is a smoke test, not full asymmetric verify.** The player checks that a `signature` *field is present*; it does not independently verify a per-tenant signature. | ACCEPTED (server gate is primary) | The **primary** safeguard is server-side: every Redis fan-out is HMAC-verified at the broadcast gate before reaching the WS gateway or SSE fallback (`redis.service.ts` `verifyWsHmac`; `security/ws-signature.ts`). A forged channel message cannot enter the broadcast bus. | Full per-tenant asymmetric verification *on the player* is a documented follow-up (see `THREAT_MODEL.md` / CLAUDE.md "Emergency System" §3). |
| G9 | **No tenant suspend / disable endpoint.** There is no one-call "freeze this tenant" control; a compromised or abusive tenant is contained by disabling its users / rotating its device tokens manually. | OPEN | License/seat enforcement gates new screens; SUPER_ADMIN can act on users and licenses (`license/super-license.controller.ts`). | Build a SUPER_ADMIN tenant-suspend that blocks login + freezes the fleet in one action (see `INCIDENT_RESPONSE.md` §6). |
| G10 | **DSAR / deletion has no formal SLA.** A deletion path exists (operator account + tenant purge) but the response-time commitment and self-serve export are not formalized. | PENDING | Path exists and is documented (`DATA_RETENTION.md` §4); Clever/POS/streaming disconnect purges OAuth tokens immediately (`clever.service.ts:149`). | Formalize a DSAR SLA + self-serve export in the DPA and a runbook. |
| G11 | **Signed DPA template is not a repo artifact.** | PENDING | `COMPLIANCE.md` + `DATA_RETENTION.md` + this file are the engineering inputs to a DPA. | Required before any **student-roster ingest** (V2 reunification). Do not enable student-roster sync without a signed FERPA "school official" DPA per district. |

---

## 2. What is NOT a gap (so reviewers don't double-count)

These are commonly-asked-about controls that **are** built. Cited to code in
`SECURITY_BASELINE.md`; listed here only to prevent re-flagging:

- **TOTP MFA** — shipped (enroll / verify / disable / backup-codes / challenge),
  RFC 6238, encrypted secret at rest, audit-logged on success **and** failure
  (`auth/mfa.controller.ts`, `auth/totp.ts`, `auth/mfa-secret-cipher.ts`).
- **SSO (SAML + OIDC)** — shipped, per-tenant config with an enabled-gate and a
  test endpoint (`sso/sso.controller.ts`). Off until a tenant configures it.
- **JWT revocation** — runs in **every** environment and **fails closed**
  (the prior `NODE_ENV==='production'` gate was removed, audit P1-4,
  `jwt-auth.guard.ts:90-96`).
- **AuditLog DB-level immutability** — `BEFORE UPDATE`/`BEFORE DELETE` triggers
  raise and roll back (`migrations/20260526010000_audit_log_immutability/`).
- **PCI-SAQ-A** — Stripe-hosted checkout/portal; no PAN anywhere
  (`billing/stripe.service.ts:233`).
- **SSRF defense** on the branding scraper — IP-range reject + rebind pin
  (`branding/safe-fetch.ts`).
- **Webhook delivery retry** — failed `emergency.*` (and other) deliveries are
  re-armed with backoff by a worker, not lost (`webhooks/webhook-retry.worker.ts`).
- **License↔Stripe reconcile cron** — a scheduled pass corrects drift, not just
  event-driven fire-and-forget (`billing/license-reconcile.cron.ts`).

> Some of these (RT rotation, SSO, reconcile cron, webhook retry) appeared as
> *gaps* in older audit snapshots and have since been built or un-gated. If a
> stale doc still lists them as missing, this register is the current truth.

---

## 3. Discipline (how to keep this file honest)

1. **Closing a gap = move the line to `SECURITY_BASELINE.md` with a `file:line`
   cite, and delete it here.** Never leave a "done" gap in this register.
2. **Opening a gap = add a row here with a real mitigation + tracking note.**
   Never describe an un-built control anywhere as if it exists.
3. **Re-verify on every security pass.** Per the 2026-05-21 standard, trace each
   claimed control to its real callers — assumed-working is not working.
4. When a district security questionnaire arrives, answer **from this file plus
   `SECURITY_BASELINE.md`** — not from memory, and not from the archived
   April-2026 design fossils in `docs/archive/` (those overstate controls).
