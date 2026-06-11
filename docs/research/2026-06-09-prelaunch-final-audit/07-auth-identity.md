# Section 10 — Auth + Identity — Pre-launch Final Audit (2026-06-09)

**Auditor:** fresh frontier-model pass · **Scope:** Standard Audit Surface §10 only.
**Method:** traced every documented safeguard to its real caller; curled the live API (`https://venue-os.app/api/v1`) for cookie/header/throttle/Redis reality; reconciled against the 2026-06-09 full-audit `REPORT.md` (H1/H3/H4) and the 2026-06-08 launch synthesis (P1-8). Where a prior audit's claim no longer matches the code, it's flagged as a **correction** with file:line proof.
**Hard rules honored:** no live emergency, no SUPER_ADMIN login, no live mutation. Bad-cred login probe was a single request (throttle showed `remaining: 9`).

## Coverage / grades

| Lens | Grade | Rationale |
|---|---|---|
| Coverage | **covered** | every §10 bullet traced |
| DESIGN | **A−** | login/MFA/reset flows are clean, branded, no enum leak in UX copy |
| UX | **B+** | TOTP enrollment + reset are <30s operator flows; SSO/SAML are admin-only and gated off |
| FUNCTIONALITY | **A−** | JWT/Argon2/CSRF/reset/signup/OIDC-state all work end-to-end; one latent Redis-less revocation window (P2) |

**Verdict:** The auth spine is genuinely strong and *better than the prior audits credited*. Two of the three §10 items the 2026-06-09 full-audit flagged HIGH (H1 panic staleness "doesn't revoke", H4 Clever "open-redirect") are **stale/overstated** against current code. The only real open item is a narrow, latent **Redis-less revocation window** with no dedicated boot WARN (= launch-synthesis P1-8, reconfirmed). No P0 in this section.

---

## VERIFIED SOLID (do not re-spend effort)

1. **Argon2id params exceed OWASP floor.** `crypto.config.ts:7-12` — argon2id, memoryCost 65536 (64 MB), timeCost 3, parallelism 4. OWASP minimum is m=19 MB/t=2. ✅
2. **User-enumeration timing decoy is real and correct.** `auth.service.ts:21-27,61-66,79-83` — a module-load dummy argon2 hash is verified on both the user-miss and non-ACTIVE-status branches so all three branches take ~equal time. ✅
3. **Login error envelope leaks nothing.** Live: `{"error":true,"code":"Unauthorized","message":"Invalid credentials"}` — same for unknown email and wrong password. ✅
4. **JWT revocation fails CLOSED in every env (single-token + per-user epoch).** `jwt-auth.guard.ts:97-126` — the prior `NODE_ENV==='production'` gate is removed; `getTokenInvalidBefore` throws on Redis error → guard's catch denies with "Auth check unavailable" (`redis.service.ts:237-252`). SSE (`sse.controller.ts:70`) and WS gateway (`realtime.gateway.ts:135`) check the revoked-list too. ✅
5. **Logout is server-side, honest on Redis-down.** `auth.controller.ts:156-205` — SADDs the bearer to `jwt_revoked_list`; returns **503** (not fake success) when Redis publisher is absent; writes an `AUTH_LOGOUT` audit row. ✅
6. **Login is audited both ways with correct tenant attribution + PII hygiene.** `auth.controller.ts:46-67,86-147` — `AUTH_LOGIN_SUCCESS`/`AUTH_LOGIN_FAILED`; unknown-email recon lands on `SYSTEM_TENANT_ID` with `unknownAccount:true`; email stored as SHA-256(16-char) prefix, never cleartext. ✅
7. **Cookie + header hygiene (live-verified).** Login sets only `csrf-token` (double-submit pattern → intentionally not HttpOnly; `Secure; SameSite=None`). Session cookie config `main.ts:125-128` = `httpOnly:true, secure:(prod), sameSite:'none'(prod)`. Response carries HSTS `max-age=31536000; includeSubDomains`, `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, CSP `frame-ancestors 'self'`. ✅
8. **Login throttle is per-client-IP (not a global bucket behind the proxy).** `main.ts:57` sets `trust proxy = 1`, so `ThrottlerGuard` (`app.module.ts:158,217`) keys on the real client IP. Live headers: `x-ratelimit-limit: 10, remaining: 9, reset: 60` → **10/min/IP confirmed live**. ✅
9. **Comprehensive auth rate limits.** `onboarding.controller.ts` — signup 5/min, **password-reset/request 3/hour** (tight anti-enum/spam), password-reset/complete 10/min, invite-accept 5/min, invite GET 20/min. Login 10/min/IP. ✅
10. **Password reset is textbook-secure end-to-end.** `onboarding.service.ts:201-247` — 32-byte `randomBytes` token, **only the SHA-256 hash is stored** (`hashToken`), TTL expiry, **single-use via `usedAt`** (rejects reused link), tx-marked on completion. Anti-enumeration: returns identical `{ok:true,emailConfigured}` whether the user exists or not (lines 205/210/222), gated by `emailService.isConfigured()`. ✅
11. **Signup creates an isolated tenant — no injection/escalation.** `onboarding.service.ts:64-180` — rejects both duplicate slug (`ConflictException` :130) and duplicate email (:131) **before** creating; Tenant + first DISTRICT_ADMIN minted in one tx. Invite paths verify `tenant.parentId === inviter.tenantId` (:316,:464) for cross-tenant scope. ✅
12. **OIDC state/nonce CSRF check is REAL (AUDIT-P1-1 fixed).** `sso.controller.ts:96-100,112` persists `state`+`nonce` in a short-lived session cookie and passes them as `expected`; `sso.service.ts:401-405` **fails CLOSED** (throws) if either is missing, and passes them into `client.callback(...,{state,nonce})` (:417-420) so openid-client verifies and throws on mismatch (caught → 401 at :430-432). ✅
13. **SAML CVE-2025-54419 is NOT reachable.** `passport-saml`/`@node-saml` are **not installed** (verified: absent from `pnpm-lock.yaml`, `apps/api/package.json`, and `node_modules`). `sso.service.ts:8-18` documents the intentional uninstall; `require('passport-saml')` always falls through to a safe stub, and SAML is hard-gated (0 enabled tenants). Productionizing it is gated behind task #199 (install maintained `@node-saml/passport-saml` v5+). ✅
14. **TOTP MFA is shipped AND wired (task #50 "pending" is stale for TOTP).** Server: `mfa.controller.ts`, `totp.ts`, `mfa-secret-cipher.ts`, encrypted secret, `mfaTotpVerifiedAt` source-of-truth gating login (`auth.service.ts:141-146`) → returns a challenge envelope, not a session. Web: `components/settings/MfaCard.tsx`, `settings/security/page.tsx`, `login/page.tsx` MFA-challenge flow (+ tests). Real operator-usable feature. ✅
15. **WebAuthn/passkeys are honestly ABSENT — no UI pretends.** Repo-wide grep: the only "passkey" hit is a code comment (`signup/page.tsx:177`); the only "security keys" string (`settings/page.tsx:461`) is the **USB sneakernet / offline-content** feature, not FIDO2 auth. No fake passkey enrollment button anywhere. (Copy nit: "USB security keys" could be misread — see P3.) ✅
16. **Privilege-tightening DOES revoke live tokens (corrects full-audit H1).** `users.controller.ts:434-436` (canTriggerPanic true→false) and `:314-316` (role downgrade) both call `revokeUserTokens` → `redis.markUserTokensInvalid` → per-user `jwt_invalid_before:<uid>` epoch the guard enforces (`redis.service.ts:219-232`). Widenings correctly skipped. ✅

---

## FINDINGS

### KNOWN-OPEN: Redis-less deploy is a silent revocation black hole (P2)
**= launch-synthesis P1-8, reconfirmed; supersedes the "doesn't revoke" half of full-audit H1.**
The flip paths *do* revoke (see SOLID #16), but `revokeUserTokens` is **best-effort** and swallows the throw `markUserTokensInvalid` raises when there's no Redis publisher (`users.controller.ts:88-97`). On a Redis-less / Redis-down deploy:
- mass-revocation marker never gets written → `getTokenInvalidBefore` returns `null` → **no enforcement** (`redis.service.ts:240-247`);
- single-token revoked-list check `sismember` **fails OPEN** (returns false) (`redis.service.ts:172-183`);
- so a demoted user or a user whose `canTriggerPanic` was just removed keeps the elevated JWT claim until natural expiry — **up to 30 days** (rememberMe ceiling).

There is **no dedicated boot WARN** that "token revocation is non-functional" — only the generic `Redis disabled … HTTP-polling fallback` (`redis.service.ts:29-30`), and the boot guard does **not** require `REDIS_URL` (CLAUDE.md: "API boots anyway").
**Live reality check:** prod `/health` currently shows `redis:"ok"`, so the window is **latent, not active today.** That's why this is P2, not P1 — but it's a security boundary the instant Redis blips or a misconfigured deploy ships without `REDIS_URL`.
**Fix:** in prod, either (a) require `REDIS_URL` at boot (revocation is a security control, not an optional realtime nicety), or (b) emit a loud dedicated boot WARN "JWT revocation DISABLED — REDIS_URL unset" AND re-read `canTriggerPanic`/`role` from the live DB row inside the `@AllowPanicBypass` branch so the emergency path can't fire on a stale claim. Evidence: `users.controller.ts:88-97`, `redis.service.ts:172-183,219-247`, `jwt-auth.guard.ts:113-118`.

### CORRECTION — full-audit H4 "open-redirect on Clever callback" is overstated → P3
`clever.controller.ts:81` redirects to `process.env.CLEVER_POST_CONNECT_URL ?? '/'` — a **server-set env var, not an attacker-controllable parameter.** The `state` query param is HMAC-signed and only decodes to a tenantId (`:74-80`), never to a redirect target. This is **not** an open redirect.
Residual P3 (real but minor): `redirectUri()` (`:27-32`) falls back to `req.headers.host` for the OAuth `redirect_uri` when `CLEVER_REDIRECT_URI` is unset — host-header reflection into the redirect_uri. Mitigated because (a) Clever validates redirect_uri against registered URIs server-side, and (b) prod should set `CLEVER_REDIRECT_URI`. **Fix:** set `CLEVER_REDIRECT_URI` in prod; optionally assert `CLEVER_POST_CONNECT_URL` is a relative path. (Clever is also fully gated: `/connect` 503s when unconfigured, `:44-52`.)

### CORRECTION — full-audit H3(b) "ApiKeysService @Optional silently disables key verification" → fails CLOSED, downgrade to P3
`jwt-auth.guard.ts:23,41` — if `ApiKeysService` is absent, a `vos_`-prefixed token skips the API-key branch (`&& this.apiKeys` is false) and falls into JWT `verifyAsync`, which **rejects** it (not a valid JWT) → 401. A module-load failure therefore **rejects** API keys, it does not bypass auth. Not an auth-bypass. (Making it required in prod is still good hygiene — P3.)

### KNOWN-OPEN: guard never asserts `tenantId` non-empty after decode (P2/P3, full-audit H3(a))
`jwt-auth.guard.ts:146-155` assigns `tenantId: payload.tenantId` with no non-empty check. Low reachability today (every issued token includes a real `tenantId` — `auth.service.ts:158-164`), but it's the load-bearing defense-in-depth gap: a token with an empty/undefined `tenantId` would make a downstream `where:{ tenantId: undefined }` Prisma query match **all tenants' rows**. **Fix:** throw `UnauthorizedException` when a non-device principal decodes without a non-empty `tenantId`. Cheap, closes a cross-tenant footgun permanently.

### OBSERVATION — rememberMe = 30d JWT, no refresh-token rotation (P3, accepted)
`auth.service.ts:166-174` — a stolen rememberMe token is valid 30 days with no rotation/refresh path; logout revokes it (when Redis is up) but there's no proactive rotation. Documented as a follow-up sprint in-code. Acceptable for launch; note in SECURITY_GAPS.md so a district reviewer hears it from you first.

### P3 — "USB security keys" copy could be misread as WebAuthn
`settings/page.tsx:461` "Manage USB security keys + offline content delivery" describes the USB **sneakernet/offline-content** feature, not FIDO2. Reword to "USB content drives" to avoid implying passkey support that isn't there.

---

## Per-bullet coverage (§10)
- JWT issuance + revocation (jwt_revoked_list + per-user epoch + Redis env-gate) — **covered**; revocation un-gated across envs & fails closed (SOLID #4-5,#16); Redis-less window = P2 finding above.
- Redis-less deploy behavior + boot WARN — **covered**; gap = no dedicated revocation-disabled WARN (P2).
- Argon2 params — **covered**, exceeds OWASP (SOLID #1).
- Cookie flags (curl) — **covered**, live-verified (SOLID #7).
- CSRF state — **covered**; double-submit `csrf-token` cookie + `CSRF_ENFORCE` (CLAUDE.md); enforced by `security/csrf.middleware.ts`.
- TOTP/WebAuthn absent — **covered**; TOTP shipped+wired (SOLID #14), WebAuthn honestly absent (SOLID #15).
- OIDC state-check (AUDIT-P1-1) — **covered**, verified fixed (SOLID #12).
- SAML CVE-2025-54419 reachability — **covered**, NOT reachable (SOLID #13).
- Clever SIS — **covered**; gated, HMAC-signed state, H4 corrected to P3.
- canTriggerPanic staleness (H1) — **covered**; flip paths revoke (SOLID #16); exact remaining gap = Redis-less window (P2).
- Password reset end-to-end — **covered**, textbook-secure (SOLID #10).
- Signup tenant isolation — **covered**, isolated, no injection (SOLID #11).
- Auth rate limiting — **covered**, comprehensive + per-IP (SOLID #8-9).
