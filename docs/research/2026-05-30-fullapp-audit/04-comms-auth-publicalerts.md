# §9 / §10 / §13 Audit — Communications · Auth/Identity · Public Alert

**Audit date:** 2026-05-30 · read-only, verified against current code (not the stale synthesis) · fail-closed checks confirmed.

**Bottom line:** every P0/P1 the prior audit flagged in this cluster is fixed and the fixes are real (traced to callers, fail-closed verified). **No exploitable P0/P1 today.** Findings are P2/P3 polish + one documented-but-live CVE risk.

## 1. Coverage table

| § | Domain | D | UX | F | Status |
|---|---|---|---|---|---|
| 9 | Email (Resend) | A | A | **A** | COVERED — real fetch to Resend, fail-closed in prod, durable `email_logs`, 9 send methods with live callers |
| 9 | Generic webhook outbound | A− | B+ | **A−** | COVERED — HMAC-signed + retry worker now BUILT (`FOR UPDATE SKIP LOCKED`, backoff, FSM). Only `emergency.*` events fire (UI honestly lists only those 2) |
| 9 | Twilio SMS/voice | — | C | F | **N-A** — honest COMING_SOON |
| 9 | Slack / Teams outbound | — | C | F | **N-A** — honest COMING_SOON, env probe only |
| 9 | APNs/FCM push | — | — | F | **N-A** — honest COMING_SOON (panic "push" = `router.push()` nav, correctly not claimed as notifications) |
| 9 | PagerDuty/OpsGenie | — | — | F | **N-A** — not present |
| 10 | JWT issuance + revocation | A− | B+ | **A−** | COVERED — fail-closed; env-gate REMOVED (P1-4 fixed); single-token + per-user `tokenInvalidBefore` mass-revoke both real |
| 10 | Argon2 | A | A | A | COVERED — Argon2id, above OWASP |
| 10 | express-session | A | A | A | COVERED — httpOnly, secure(prod), sameSite:none(prod), SESSION_SECRET boot-required |
| 10 | TOTP MFA | A− | A− | A− | COVERED — fully built (enroll/verify/disable/backup codes) |
| 10 | WebAuthn passkeys | — | — | — | **N-A** — not built (honest) |
| 10 | SSO OIDC/SAML | B | B | **B** | COVERED — built, per-tenant, enabled-gated, tenant-scope-asserted. **SAML on passport-saml@3 (CVE) — see F-1** |
| 10 | Clever SIS | B | B | B | COVERED — env-gated, **staff-only scope** confirmed (NOT students) |
| 10 | Role / canTriggerPanic staleness | A− | B | **A−** | COVERED — P1-A FIXED: downgrade calls `revokeUserTokens` → per-user invalid-before epoch, fail-closed |
| 13 | CAP/IPAWS · Raptor · RapidSOS · PA-IP-speaker | — | — | N-A | **N-A (V2)** — zero code; only an honest disclaimer. Nothing sold-but-absent. |

## 2. Findings

**F-1 · MEDIUM (latent, not exploitable today) · §10 SSO SAML · `sso.service.ts:223-230,236` + `package.json:60`** — SAML runs on `passport-saml@3.2.4` (deprecated, **CVE-2025-54419**, signature-wrapping, no patched 3.x). Code documents it + the fix (`@node-saml/passport-saml v5+`). Interim control: callback requires `config.enabled` and the comment claims 0 SAML-enabled prod tenants. **But** any DISTRICT_ADMIN can flip `enabled:true` via `POST /tenants/:slug/sso` (`sso.controller.ts:157`) — self-service, no SUPER_ADMIN gate on the enable — and the moment one tenant enables SAML, the unauthenticated `validatePostResponse` on the vulnerable parser is reachable. **Fix:** migrate to `@node-saml/passport-saml@^5` (task #199) before any tenant enables SAML; until then gate the `enabled:true` write for `provider:SAML` behind SUPER_ADMIN / kill-switch env.

**F-2 · LOW · §10 device-WS revocation env-gate · `realtime.gateway.ts:131`** — device-token `jwt_revoked_list` check still wrapped in `if (NODE_ENV==='production')`, inconsistent with the now-unconditional checks in `jwt-auth.guard.ts:97-118` + `sse.controller.ts:64-73`. Low severity — device tokens only (sub=screenId), and a stronger live-DB check runs immediately after (`:148-160`). **Fix:** drop the env gate to match.

**F-3 · LOW · §9 webhook event coverage** — only `emergency.triggered`/`cleared` dispatch; UI honestly lists exactly those two (prior "advertised but never sent" gap closed). Capability gap (no screen/asset/billing lifecycle events), not a lie. Feature work.

**F-4 · INFO · §9 email config** — `RESEND_API_KEY`+`EMAIL_FROM` now documented with the owner-only-delivery warning. Remaining risk is purely deployment (default `EMAIL_FROM` silently drops non-owner mail). Verify a sender domain at deploy.

**Resolved since 2026-05-28 (verified fixed):** P1-A role/panic staleness; P1-4 JWT-revocation env-gate; P1-5 webhook retry queue; P0-4 login forensic gap (AUTH_LOGIN_SUCCESS/FAILED + logout revoke + 503-on-Redis-down); P0-5 custom-webhook POS 404 (`pos-oauth.controller.ts:319-380`).

## 3. Biggest risk
**The `passport-saml@3` CVE on a self-service-enableable SAML path (F-1)** — harmless at 0 SAML tenants, but a single DISTRICT_ADMIN can arm it and the fix is an API-incompatible major upgrade. Everything else is genuinely hardened or honestly N-A.
