# Wave D — Comms + Auth reality (§9, §10)

**Agent:** CD4 (final pre-launch beta audit, FIND + REPORT only — no source edits)
**Date:** 2026-06-26
**Surface:** NestJS API (`apps/api/src/{email,auth,sso,webhooks,notifications,health}`), Next.js login UI (`apps/web/src/app/login`)
**Scale tier:** Production (live prod web `https://venue-os.app`, API `https://api-production-39a1.up.railway.app/api/v1`)
**Standard Audit Surface §§ covered:** §9 Communications integrations · §10 Auth + identity
**Method:** code-trace (Read/Grep) + lockfile/package.json verification + 4 live-prod curl shape probes. No app run, no live broadcasts, no touch of the Dodgers tenant.

---

## Headline

Both scoped domains are in **honest, launch-credible shape**. There is **exactly one REAL comms channel (Resend email)** and the V2 channels (Twilio / Slack / Teams / push) are now correctly labelled `COMING_SOON` — Task #211 verified landed, no residual costumes. Auth/identity is the strongest area in the app: JWT revocation (single-token + per-user mass-revocation) fails **closed**, Argon2 + TOTP MFA + OIDC SSO are all REAL and wired to live login-page entry points, and SAML is **hard-gated off** (passport-saml genuinely uninstalled) pending the CVE-2025-54419 migration. **Zero P0.** Two P1s are honesty/UX nits, not security holes.

---

## Provider-by-provider classification table

### §9 Communications

| provider / integration | verdict | evidence | notes |
|---|---|---|---|
| **Email (Resend)** | **REAL** | `apps/api/src/email/email.service.ts:383-442` `#dispatch()` POSTs `https://api.resend.com/emails` with bearer key; `isConfigured()` at `:379`; prod **fail-closed** at `:397-404` (throws if `RESEND_API_KEY` unset). Live: integrations-health row `comms-email` (`integrations-health.controller.ts:688-699`). | The one truly-wired channel. ~10 send paths (welcome/reset/invite/asset-review/4× bug-lifecycle). Durable `email_logs` row written before dispatch (`:96-104`). DEFERRED on `RESEND_API_KEY` + verified `EMAIL_FROM` domain (config-only, per CLAUDE.md). |
| **Twilio (SMS / voice)** | **NOT-BUILT** (honestly labelled) | `integrations-health.controller.ts:701-710` status `COMING_SOON`; grep for any Twilio SDK / `messages.create` / `TWILIO_*` across `apps/`+`packages/` returns **only** comment/label strings — **zero send code**. | Task #211 ✅ verified. Message explicitly states "setting TWILIO_ACCOUNT_SID … does NOT enable SMS." No costume. |
| **Slack (webhook outbound)** | **NOT-BUILT** (honestly labelled) | `integrations-health.controller.ts:711-721` `COMING_SOON`; grep for `hooks.slack.com` / `chat.postMessage` / `@slack/` / `SLACK_WEBHOOK_URL` → only label strings, **no POST code**. | Task #211 ✅. "Slack / Teams" share one row, both `COMING_SOON`. |
| **Microsoft Teams (webhook outbound)** | **NOT-BUILT** (honestly labelled) | Same row as Slack (`:713`); grep for `teams.*webhook` / `outlook.office` → 0 hits outside the label. | Honest. |
| **APNs / FCM push** | **NOT-BUILT** (honestly labelled) | `integrations-health.controller.ts:722-730` `COMING_SOON`; grep for `firebase-admin`/`node-apn`/`expo-server-sdk`/`fcm.googleapis`/`messaging().send` → **0 hits** anywhere. | Mobile-panic-page push is V2 spec only. |
| **PagerDuty / OpsGenie** | **NOT-BUILT** (absent) | grep `pagerduty`/`opsgenie`/`@pagerduty` → **0 hits**. Not even a `COMING_SOON` row. | Honestly absent — not sold anywhere in UI. |
| **Sendgrid** | **NOT-BUILT** (legacy comment only) | grep `sendgrid` → only doc-comment in `email.service.ts:10` ("we'll swap this for SendGrid, Resend, or AWS SES") + onboarding comment. **Resend is the real provider, not Sendgrid.** | CLAUDE.md is correct: Resend is the wired email provider. No Sendgrid code. |
| **Outbound webhook (custom integrations)** | **REAL** | `apps/api/src/webhooks/webhook-dispatch.service.ts:196-222` real HMAC-SHA256-signed outbound HTTP (`X-VenueOS-Signature: sha256=…`), `emergency.triggered` delivery, durable persisted row + retry worker (`webhook-retry.worker.ts`), SSRF guard tested (`webhook-dispatch.ssrf.spec.ts`). | This is the one REAL "ops-channel" comms path. Task #177 (retry queue) landed. |
| **In-app notifications (bell)** | **REAL but NOT a comms channel** | `apps/api/src/notifications/notifications.service.ts:4-17` kinds = SCREEN_OFFLINE / SYNC_FAILED / EMERGENCY_TRIGGERED / INVITE_ACCEPTED / INFO / INFRA_EVENT. DB-row + WS only — **no email/SMS/push transport**. | Real product feature; counted as NOT-BUILT for §9 *external* comms since it has no outbound transport. Don't double-count as costume. |

### §10 Auth + Identity

| provider / integration | verdict | evidence | notes |
|---|---|---|---|
| **JWT issuance** | **REAL** | `auth.service.ts` mints `{sub,email,tenantId,role,canTriggerPanic}`; `jwt-auth.guard.ts:81` verifies; per-secret routing user vs device token (`:76-79`). Live: `POST /auth/login` → `401 {"error":true,"code":"Unauthorized","message":"Invalid credentials"}` (curl). | Stable error envelope present. |
| **JWT revocation (`jwt_revoked_list`)** | **REAL** | `auth.controller.ts:176` logout SADDs token to `jwt_revoked_list` (30-day TTL `:179`); guard `jwt-auth.guard.ts:100-103` `sismember` check **fails CLOSED** (`:119-126`), gate runs in **every** env (P1-4 fix, `:90-96`). | Strongest possible posture — Redis outage denies, never bypasses. |
| **Per-user mass revocation (role-staleness)** | **REAL** | `jwt-auth.guard.ts:113-117` rejects tokens with `iat < invalidBefore`; writer `redis.service.ts:219 markUserTokensInvalid`; called on role change + `can-trigger-panic` tighten (`users.controller.ts:90,490`, doc `:70-86,350-357`). | Closes the "demoted user keeps 30-day rememberMe token" gap. `role`/`canTriggerPanic` are JWT-claim-read (not live-DB), but the invalidBefore epoch covers downgrades. |
| **Argon2 password hashing** | **REAL** | `argon2.hash/verify` w/ `cryptoPlatformConfig` (`auth/mfa.controller.spec.ts:266` etc.); login rate-limited 10/min/IP (`auth.controller.ts:29-41`) to blunt argon2-thread DoS. | Verify-side present in auth.service. |
| **express-session** | **REAL** | `main.ts:36,133` configured; consumed by OIDC state/nonce persistence (`sso.controller.ts:94-99,111-112`). | Used as the OIDC CSRF store. |
| **TOTP MFA (authenticator apps)** | **REAL** | `auth/mfa.controller.ts` full surface: `GET status` (`:138`, gated on real col `mfaTotpVerifiedAt`), `POST enroll` (`:154`), `POST verify` (`:230`, `verifyTotpCode` `:279`), `POST disable` (`:323`), `POST backup-codes` (`:372`), `POST challenge` (`:443`). Login-page entry `login/page.tsx:71-160` (mfaToken + backupCode). Live: `GET /auth/mfa/status` unauth → `401` (curl). | Argon2-hashed backup codes; rate-limited challenge. Task #50 lists TOTP as "pending" but **it is shipped** — task list is stale, not the code. |
| **WebAuthn passkeys** | **NOT-BUILT** (honestly absent) | grep `webauthn`/`passkey`/`@simplewebauthn`/`fido` → only a 1-line type comment in `api-types/src/index.ts:311`. No enroll/assert code. | Task #50 Phase 3, honestly deferred. |
| **SSO — OIDC** | **REAL** | `openid-client@5.7.1` **installed** (`apps/api/package.json:58`, lockfile `:7177`). Real Issuer-discovery + code exchange (`sso.service.ts:354-434`). CSRF state/nonce **fail-closed** (`:401-405`), wired from session (`sso.controller.ts:91-99,111-113`). Login entry `login/page.tsx:61-63`. | Task #214 (OIDC state CSRF) ✅ verified enforced. DEFERRED end-to-end only on a tenant providing a real IdP issuer/clientId/secret. |
| **SSO — SAML** | **NOT-BUILT / hard-gated** (DEFERRED on #199) | `passport-saml` **NOT in package.json, NOT in lockfile** (grep both → 0). `require('passport-saml')` always throws → `buildSamlLoginUrl` returns honest **503** (`sso.service.ts:289-294`); callback enabled-gated (`:316`); arming SAML requires SUPER_ADMIN w/ audit (`:109-140`). Prod: **0 SAML-enabled tenants** (documented `:313-315`). | Correct interim control for CVE-2025-54419 (Task #199/#225). Not a costume — fails loudly + honestly. |
| **Google / Okta** | **REAL via OIDC** (no dedicated button) | Both are standard OIDC issuers; work through the generic OIDC path above. No "Sign in with Google/Okta" branded one-click button. | Functional but not a one-tap UX. Minor (P2). |
| **Clever SIS** | **DEFERRED** (deploy creds) | `integrations-health.controller.ts:552-597`: env-gated on `CLEVER_CLIENT_ID/SECRET` + tenant `cleverDistrictId`. Config page `/settings/integrations/clever`. | Honest 3-state (NOT_CONFIGURED / DEGRADED / READY). Tenant-connect flow exists; needs Clever app creds. |
| **Tenant REST API keys (`vos_`)** | **REAL** | `jwt-auth.guard.ts:41-57` hashes+looks-up `TenantApiKey`, synthetic machine identity (userId:null), revocable (`api-keys.service.ts:117-125`). | Machine-identity auth path, audit-attributed. |

---

## Findings table

| # | Sev | area | what | repro | evidence |
|---|---|---|---|---|---|
| 1 | **P1** | §10 task hygiene | Task #50 marks "TOTP authenticator apps" as **pending**, but the full TOTP MFA flow is **shipped and live** (enroll/verify/disable/backup/challenge + login-page challenge UI). Stale task risks someone "building" an already-built feature or telling a customer it's missing. | Read `auth/mfa.controller.ts` (6 endpoints) + `login/page.tsx:116-160`; curl `GET /auth/mfa/status` → 401 (route live). | `mfa.controller.ts:138,154,230,323,372,443`; task #50 |
| 2 | **P1** | §9 push honesty | `comms-push` (APNs/FCM) row says "Coming in V2 — push to the mobile panic page when an emergency fires," but the **mobile panic page itself ships no push registration token capture** — so when push *is* built there's no device-token source yet. Not a launch blocker (it's correctly `COMING_SOON`), but the promise is one layer deeper than the codebase. | grep `firebase-admin`/`expo`/registration-token → 0 hits anywhere. | `integrations-health.controller.ts:722-730` |
| 3 | **P2** | §10 SSO UX | No branded "Sign in with Google / Okta / Microsoft" one-click buttons — operators must know their tenant slug and that it's OIDC. Enterprise buyers expect a vendor logo button. Functional via generic OIDC, weaker UX. | `login/page.tsx:61-63` only a free-text SSO-slug field. | `login/page.tsx` |
| 4 | **P2** | §10 role-staleness residual | `role` + `canTriggerPanic` are read from the **JWT claim** in the guard (`jwt-auth.guard.ts:151,154`), never re-checked against the live DB row per-request. The `invalidBefore` epoch (set on downgrade) is the mitigation and works, but a **privilege WIDENING** (e.g. promote then immediately need it) still requires re-login, and any code path that mutates role/panic **without** calling `revokeUserTokens` would leak a stale capability. Audited call-sites all call it; flagging the architectural fragility, not a live bug. | Read guard `:146-155` + writer call-sites `users.controller.ts:90,490`. | `jwt-auth.guard.ts`, `users.controller.ts` |
| 5 | **P2** | §9 email deliverability footgun | `EMAIL_FROM` defaults to `onboarding@resend.dev`, which Resend only delivers to the account owner — every other recipient is silently dropped. This is documented in CLAUDE.md but is a config-time launch trap (invites/resets to real customers vanish). DEFERRED on verified-domain config. | `email.service.ts:412`; CLAUDE.md `EMAIL_FROM` warning. | `email.service.ts:412` |

---

## Coverage — what I could NOT reach, and why

- **Live authenticated OIDC round-trip** — cannot complete without a real tenant + real IdP (Google/Okta) issuer + client secret. Verified the code path, lockfile presence of `openid-client@5.7.1`, the fail-closed CSRF gate, and prod endpoint shapes (404 for unknown tenant, which precedes the CSRF check). Functionality DEFERRED on credentials, not on missing code.
- **Live SAML** — intentionally unreachable (library uninstalled, 0 enabled tenants). Confirmed via lockfile + the always-503 path; did not attempt to arm it.
- **Live email send** — did not POST a real signup/invite (would write `email_logs` rows and, if `RESEND_API_KEY` is set on prod, send mail). Verified dispatch code + fail-closed branch + the `comms-email` health row instead.
- **Whether `RESEND_API_KEY` is actually set on the prod Railway env** — that's a deploy-secret check outside read-only code scope (Greg/config). If unset, prod password-reset/invite **throws** (fail-closed by design) rather than lying — so the UX is honest either way.
- **Did NOT** fire any emergency, touch the Dodgers tenant, or create a throwaway tenant (code-trace + shape curls were sufficient for this scope).

---

## Grade — Greg's 3 lenses

| Lens | §9 Comms | §10 Auth/Identity |
|---|---|---|
| **Design** | B — health dashboard cleanly separates READY / DEGRADED / COMING_SOON; no marketing-orange lies. | A− — clean login, MFA challenge step, SSO field. Missing branded SSO buttons (B+ on that sub-point). |
| **UX** | B+ — "copy the link" fallback when email unconfigured is honest; the `EMAIL_FROM` footgun is the one rough edge (config-time). | A− — TOTP enroll + backup codes + challenge are a complete, non-IT-friendly flow; SSO requires knowing your slug (minor). |
| **Functionality** | A on the one channel that ships (email + outbound webhook are REAL and signed); the rest are honestly absent, not faked. | A — JWT revocation fails CLOSED, role-staleness covered, SAML hard-gated, MFA + OIDC real. Best-hardened domain in the app. |

**Overall: A− / B+.** No costumes in scope. The lead's most-hated pattern (dropdown-with-no-backend) is **absent** here — Task #211 successfully de-costumed Twilio/Slack, and SAML fails loudly instead of handing back a dead stub URL.
