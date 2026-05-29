# Security Audit — Secrets + Supply Chain (public repo gschiemann/EDUCMS)

> Opus 4.8 read-only, 2026-05-29. git-history scan + deps + boot validation. Verified.

## Bottom line
**No live secret is committed to the public repo or its history — the highest-risk class is CLEAN.**
The most urgent finding is a **CVSS 10.0 SAML signature-bypass CVE in a reachable, unauthenticated
endpoint** with no fix on the installed major line. The weak prod JWT/SESSION secret is real but
**Railway-env-only (not in the repo)** — rotate, but not a public leak.

## Launch-blockers (ranked)
### P0-1 — passport-saml@3.2.4 SAML signature-verification BYPASS (CVE-2025-54419, CVSS 10.0)
- **Reachable + UNAUTHENTICATED:** `POST /api/v1/auth/sso/:tenantSlug/saml/callback` (`sso.controller.ts:69-76`, NO `@UseGuards`) → attacker-supplied `SAMLResponse` → `saml.validatePostResponse` (`sso.service.ts:214-235`). `SsoModule` live (`app.module.ts:106`).
- **Blast radius:** for any SAML-enabled tenant, tamper a signed assertion → alter `nameID`/email (`sso.service.ts:236`) → **authenticate as an arbitrary EXISTING user.** Callback checks `provider!=='SAML'` but NOT `config.enabled` (looser than login). Mitigating: needs a validly-signed IdP doc to start; `autoProvision` default false (impersonate existing, can't mint new).
- **Fix:** NO patched version on passport-saml 3.x → migrate to `@node-saml/passport-saml` v5+ (API/constructor changed — `MultiSamlStrategy`/`SAML` shape). Stopgap until migrated: force all tenants SAML `enabled=false` / hard-gate the callback on enabled-config.

### P0-2 — Rotate weak prod JWT_SECRET / SESSION_SECRET (NOT a repo leak)
- `JWT_SECRET=super_secure_beta_jwt_secret_2026_xYz` / `SESSION_SECRET=...xYz` = low-entropy guessable placeholders. **These exact strings appear NOWHERE in the repo/history/docs** — Railway-env-only. So weak-in-use, not already-public.
- Protect: JWT signs every auth token (`auth.module.ts:25`, `jwt.strategy.ts:13`, `jwt-auth.guard.ts:79`, `mfa.controller.ts:451`) → guess = forge any user/tenant/role = full takeover. SESSION signs the cookie (`main.ts:110`).
- Rotate to 64-hex (`randomBytes(32).hex`); rotating JWT invalidates all tokens (forced re-login), SESSION invalidates cookies. Schedule as a brief forced-logout. **(Greg's action.)**

### P1-3 — next@16.2.3: 8 CVEs incl SSRF (CVSS 8.6) + middleware bypass (8.1)
- Top-level prod framework of `apps/web` (lockfile-confirmed). SSRF via WS upgrades (CVE-2026-44578, 8.6), dynamic-route middleware bypass (8.1), segment-prefetch proxy bypass (7.5), DoS. No `middleware.ts` softens the bypass CVEs; SSRF/DoS remain.
- **Fix:** one-line bump `next ≥ 16.2.6`.

## High transitive CVEs (no overrides pinned)
| pkg | path | sev | reach | fix |
|---|---|---|---|---|
| tar 6.2.1 ×6 | argon2→node-pre-gyp→tar | 8.2-8.8 path-traversal | LOW (install-time only) | override tar≥7.5.11 |
| @xmldom/xmldom 0.7.13 ×5 | passport-saml→xmldom | 7.5 | via SAML stack | fixed by P0-1 migration |
| basic-ftp 5.2.2 | puppeteer→get-uri→basic-ftp | 7.5 DoS | very low (ftp PAC only) | override ≥5.3.1 |
| fast-uri ≤3.1.0 | sentry→ajv | 7.5 | build-time only | override/ignore |
`pnpm audit --prod`: 1 critical, 22 high, 23 moderate, 3 low — the only internet-facing ones are passport-saml (P0-1) + next (P1-3); rest install/build-time/unreached.

## CLEAN (verified, not assumed)
1. No real `.env` ever committed (only `.env.example`); .gitignore correct.
2. No live tokens in `git log -p --all` (sk-ant-/sk_live/whsec_/re_/AKIA/PEM/JWT) — zero.
3. No real DB/Redis creds in history (only docker-compose self-creds + CI `ci-fake-*`).
4. `.env.example` all placeholders (CHANGE_ME).
5. No hardcoded secret fallbacks for the 4 critical secrets (old `||'default'` pattern gone).
6. Secret-logging hygiene good (logs absence/name only, no values; feed token is a derived truncated HMAC).

## Boot-validation: PASS
`required-secret.ts` throws in prod for JWT/SESSION/DEVICE_SECRET_KEY/DEVICE_JWT_SECRET; dev fallbacks unreachable in prod. SSO crypto migrated to requireSecret. AI/MFA/creds ciphers each prod-throw on missing DEVICE_SECRET_KEY (fail-closed).

## Minor (P3, prod-unreachable but inconsistent)
- `sports/sports-feed-token.ts:29` `||'dev_only_feed_secret_CHANGE_ME'` and `clever/clever.service.ts:16` dev-fallback are **NODE_ENV-ungated** (public literals) — dead in prod only by `DEVICE_SECRET_KEY` boot-gate transitivity. Route through `requireSecret` for consistency.
- `clever-crypto.ts deriveKey()` silently SHA-expands a too-short key (footgun).
- (out of scope, flagged) `redis.service.ts:174` JWT-revocation FAILS OPEN on Redis down — a revoked JWT is honored during outage; conscious risk-acceptance needed given P0-2.

## FIX LIST
1. **passport-saml → @node-saml/passport-saml v5** (or disable SAML stopgap). Check first: how many tenants have SAML enabled (exposure).
2. **next → 16.2.6** (one-line).
3. **Rotate JWT_SECRET + SESSION_SECRET** (Greg).
4. P3: gate sports-feed-token + clever dev fallbacks on NODE_ENV; tar/basic-ftp overrides.
