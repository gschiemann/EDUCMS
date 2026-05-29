# Auth + Identity Audit (Standard Audit Surface §10)

> Opus 4.8 read-only, 2026-05-28 (Wave 3). Verified against real code, deps, lockfile,
> schema, UI wiring — not comments. Verdict: WORKS / PARTIAL / NOT-BUILT / COSTUME.

## Headline
NOT barebones. Core auth is production-grade, and — surprisingly — **SSO (SAML + OIDC)
and Clever SIS are REAL, fully-wired, end-to-end backends with working admin UIs + a
working login entry.** Libs (`passport-saml@3.2.4`, `openid-client@5.7.1`) declared AND
installed. **ZERO costumes.** The one notable gap is the INVERSE: a complete, audited
**MFA/TOTP backend with NO frontend** to drive it.

## Status table
| Capability | Verdict | Evidence | Gap |
|---|---|---|---|
| Argon2id hashing | ✅ WORKS | `auth.service.ts:39-46` argon2id + timing decoy `:21-27` | none |
| JWT issuance | ✅ WORKS | `auth.service.ts:158-188`; 1h/30d `auth.module.ts:30` | none |
| JWT revocation (`jwt_revoked_list`) | ✅ WORKS | logout SADD `auth.controller.ts:154`; guard fails-CLOSED on Redis error `:119-126`; all envs (P1-4) | none |
| Password reset | ✅ WORKS | enumeration-safe `onboarding.service.ts:184-192`; `PasswordResetToken` schema:451; Resend | none |
| Login attempt audit | ✅ WORKS | SUCCESS+FAILED rows, IP/UA, email hashed `auth.controller.ts:77-125` | none |
| Role staleness (`canTriggerPanic`, P1-1) | ✅ WORKS | read `jwt-auth.guard.ts:113-118`; write `users.controller.ts:295,415`→`revokeUserTokens():88`. Both sides wired | none |
| **SSO SAML 2.0** | ✅ **WORKS** | `sso.controller.ts:58-79`; `sso.service.ts:176-248` via passport-saml (installed); `TenantSSOConfig` schema:335; encrypted certs `sso.crypto.ts` | `testConnection` doesn't ping IdP (disclosed) |
| **SSO OIDC (Google/Okta/Azure/any)** | ✅ **WORKS** | `sso.controller.ts:84-122`; `sso.service.ts:254-323` via openid-client; issuer discovery + code exchange + nonce/state | no 1-click vendor preset (admin pastes issuer URL) |
| SSO login UI entry | ✅ WORKS | `login/page.tsx:65-89,284-326` "Sign in with SSO"→slug→config-public→302 IdP. Real, not dead buttons | none |
| SSO admin config UI | ✅ WORKS | `settings/sso/page.tsx:105,163` GET/POST `/tenants/{slug}/sso` Bearer; tenant-scope gate `sso.controller.ts:206-239`; audit | none |
| SSO auto-provisioning | ✅ WORKS | `sso.service.ts:334-381` domain+INVITED-gated, cross-tenant guarded | none |
| **Clever SIS (OAuth + roster sync)** | 🟡 PARTIAL (~90%) | full impl `clever.service.ts`; real fetch `clever-http.client.ts:41-85`; HMAC state; encrypted token; connect/callback/sync/preview/status; UI `settings/integrations/clever/page.tsx` | **never DEACTIVATES departed users** — `toDisable` counted but no `User.disabled` column (`clever.service.ts:280-283`). Offboarding gap. Untested vs live Clever |
| **TOTP MFA** | 🟡 PARTIAL — **backend WORKS, NO UI** | full backend `mfa.controller.ts` (enroll/verify/disable/backup/challenge); RFC-6238 `totp.ts`; encrypted secret; rate limiter; login branch `auth.service.ts:141-146`; cols schema:399-401 | **ZERO frontend** — `mfaRequired`/`/mfa/enroll`/`/mfa/challenge` absent in apps/web (grep empty). No one can enroll; `login/page.tsx:108` only checks `access_token` → would silently fail an `{mfaRequired:true}` response. Unreachable today |
| WebAuthn passkeys | ⚪ NOT-BUILT (honest) | reserved `Passkey` model schema:479-492 only; no dep/endpoint/UI | unbuilt, not surfaced — honest |

## Bottom line
Core auth = above-bar for K-12 (Argon2id, fail-closed revocation, role-staleness fix genuinely complete, enumeration-safe). Enterprise identity (the 5 named): **2 built-and-working (SAML, OIDC), 1 built-but-incomplete (Clever de-provisioning), 1 built-backend-no-UI (MFA), 1 honestly-absent (passkeys). ZERO surfaced-but-fake.**

**K-12 sales severity: LOW-to-MODERATE — far better than CLAUDE.md "(pending)" implies.** SSO SAML+OIDC are real + demoable; the login page has a working SSO entry. Procurement gaps:
1. **MFA cannot be enabled (no UI)** — districts with MFA mandates block here. Backend done; ~1-day frontend (enroll modal + login challenge step). **Highest-priority fix.** Also fix `login/page.tsx:108` to handle `{mfaRequired:true}`.
2. **Clever doesn't offboard departed users** — add `User.disabled` column + wire de-provisioning. FERPA/security review flag.
3. No 1-click "Sign in with Google/Okta" branding — cosmetic (OIDC supports them via issuer URL).
4. No passkeys — rarely hard-required in K-12; disclose as roadmap.

## Costumes: NONE
Hunted for dead Google/Okta buttons, a "Set up 2FA" row with no endpoint, a passkey toggle with no server — found zero. Every surfaced control resolves to a real authenticated backend. MFA + passkeys aren't surfaced at all (can't be costumes). Closest to a "lie": homepage `page.tsx:366` "Google, Microsoft, SSO — sign-in works out of the box … Clever rostering with staff sync built in" — overstates "out of the box" (admin must paste IdP config) + "staff sync" (no de-provision). Soften for accuracy.

## ACTIONABLE FIX LIST
1. **MFA frontend** — enroll modal (QR + verify + backup codes) in settings/security + handle `{mfaRequired,mfaToken}` challenge step in `login/page.tsx:108`. Backend is production-ready and waiting. Highest priority.
2. **Clever offboarding** — add `User.disabled` (additive migration) + wire `toDisable`→disable in `clever.service.ts:280`.
3. Soften homepage SSO/Clever marketing copy `page.tsx:366` for accuracy.
