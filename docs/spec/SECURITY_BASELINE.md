# Security Baseline & Controls — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against code:** 2026-05-29.
**Supersedes:** `docs/archive/2026-04-original-design/SECURITY_BASELINE.md`
(a 2026-04-13 aspirational fossil that asserted controls VenueOS never built —
e.g. "mandatory malware scanning before READY," "refresh-token rotation,"
`SameSite=Strict`. Those were goals written as facts).

**Rule for this file:** every line is either a **SHIPPED** control with a
`file:line` cite, or a **KNOWN GAP** with a tracking reference. Nothing in
between. A baseline that overstates controls is false assurance to a district
IT reviewer and the exact "theater" pattern that burned us
(`feedback_audits_must_be_exhaustive`, 2026-05-21).

---

## 1. Cryptography & data protection — SHIPPED

- **Password hashing: Argon2id**, `memoryCost 64 MB`, `timeCost 3`,
  `parallelism 4` (~45 ms verify). `auth/crypto.config.ts:7`.
- **Per-password salt** — handled internally by the `argon2` library; the
  stored hash string carries its own salt (`$argon2id$...`).
  `auth.service.ts:40`; verified `auth.service.spec.ts:50`.
- **HTTPS / HSTS** — `helmet` sets HSTS `max-age=31536000; includeSubDomains;
  preload`. TLS terminates at the Railway/Vercel edge. `main.ts:96-100`.
- **Secrets at rest** — TOTP secrets AES-encrypted (`auth/mfa-secret-cipher.ts`);
  Clever + POS OAuth tokens encrypted (`integrations/clever/clever-crypto.ts`,
  `pos.service.ts`); MFA backup codes stored as Argon2id hashes
  (`schema.prisma:388-401`).
- **Boot-time secret validation** — production refuses to start if
  `JWT_SECRET` / `SESSION_SECRET` / `DEVICE_SECRET_KEY` / `DEVICE_JWT_SECRET`
  are missing or < 16 chars. `security/required-secret.ts:30-39`.

## 2. Authentication & sessions — SHIPPED (with one gap)

- **Two token systems** — user JWT (signed `JWT_SECRET`, default TTL **1 h**,
  `auth.module.ts:26`; `rememberMe` → 30 d, `auth.service.ts:174`) and device
  JWT (`kind:'device'`, signed `DEVICE_JWT_SECRET`). The guard selects the
  secret by decoding the unverified header. `jwt-auth.guard.ts:60-81`.
- **Token revocation, fail-closed** — logout SADDs the bearer token to a Redis
  set; the guard checks `jwt_revoked_list` on every request and **denies** if
  Redis can't confirm (no fail-open). Runs in **every** environment (the old
  `NODE_ENV==='production'` gate was removed, P1-4, 2026-05-28).
  `jwt-auth.guard.ts:90-126`.
- **Per-user mass revocation** — an admin downgrade (role / `canTriggerPanic`)
  records an "invalid-before" epoch; any token issued earlier is rejected,
  covering a user's *other* live sessions. `jwt-auth.guard.ts:113-118`.
- **Session cookies** — `httpOnly`, `secure` in prod, `sameSite:'none'` in
  prod (required for Vercel→Railway cross-origin) / `'strict'` in dev, 8 h
  idle with rolling renewal. `main.ts:124-134`.
- **MFA (TOTP)** — enrollment with provisional-secret state machine (no
  lockout on interrupted enroll), single-use Argon2id-hashed backup codes,
  challenge-token step before session issuance. `auth/mfa.controller.ts`;
  `auth.service.ts:141-146`; `schema.prisma:382-401`.
- **KNOWN GAP — no refresh-token rotation.** `rememberMe` is a flat 30-day
  JWT; there is no rotating RT. Mitigated by the revocation set + per-user
  epoch. Tracked inline (`auth.service.ts:172`) and in `docs/SECURITY_HYGIENE.md`.
  *(Do NOT re-add the fossil's "RT rotation" claim until it is built.)*

## 3. Defense against abuse — SHIPPED

- **Rate limiting** — `@nestjs/throttler`; aggressive on auth
  (login 10/min/IP, `auth.controller.ts:24`). `trust proxy 1` makes throttles
  per-IP behind Railway's edge instead of global. `main.ts:56`.
- **Anomaly middleware** — request anomaly logging. `security/anomaly.middleware.ts`.
- **MFA brute-force throttle** — per-user TOTP attempt limiter.
  `auth/mfa-rate-limiter.ts`.
- *(The fossil's "impossible-travel / geo-shift detection" is **not built** —
  do not claim it.)*

## 4. Input / output security — SHIPPED (with one gap)

- **CSP** — Helmet: `defaultSrc 'self'`, `scriptSrc 'self'`, `objectSrc 'none'`,
  framed previews allowed for `https:`/`http:`. `main.ts:83-102`.
- **HTML sanitization** — `sanitize-html` allowlist for rich text +
  SVG-shape allowlist in `AssetSanitizerService`. `security/asset-sanitizer.service.ts:1-40`.
- **CSRF — enforced by default** — double-submit cookie+header, constant-time
  compare, audited exempt list. `security/csrf.middleware.ts:164-214`.
- **CORS — fails closed in prod** — boot aborts without `ALLOWED_ORIGINS`.
  `main.ts:144-205`.
- **SSRF guard on all user-supplied outbound URLs** — scheme/port/private-IP
  block + DNS resolve + connect-time rebind pin + redirect re-validation +
  byte caps. `branding/safe-fetch.ts`.
- **Upload mime allowlist + SVG block** — controller and bucket both reject
  SVG (public inline bucket = stored-XSS surface) and unplayable video.
  `assets.controller.ts:39,252`; `supabase-storage.service.ts:57-83`.
- **Asset URLs** — Supabase signed/short-TTL URLs for sensitive assets
  (floor plans, Sprint 7/8b pattern).
- **KNOWN GAP — no malware scanning on upload.** Mime allowlist + magic-byte
  checks + SHA-256 hashing only; no ClamAV/VirusTotal. Accepted risk, tracked
  in `docs/SECURITY_HYGIENE.md`. *(The fossil claimed this was "mandatory" and
  "done" — it never was.)*

## 5. Realtime / emergency integrity — SHIPPED

- **Server-side HMAC fan-out gate** — every signed WS message is
  `verifyWsHmac`-verified at the Redis chokepoint before reaching any client;
  failures dropped + logged. `redis.service.ts:128-144`;
  `security/ws-signature.ts:51-91`.
- **Freshness + replay defense** — 120 s window + clock-skew guard + player
  per-`eventId` dedup. `security/ws-signature.ts:60,71-73`.
- **HTTP-polling backstop** — device-authenticated manifest carries the live
  emergency state if Redis/WS are down. CLAUDE.md safeguard #4.
- **Constant-time signature compare** — `crypto.timingSafeEqual` with
  length-equalization. `security/ws-signature.ts:85-88`.

## 6. SSO / identity federation — SHIPPED behind an enabled-gate

- **SAML + OIDC** with a per-tenant **enabled-gate**: unconfigured tenants
  return `{ enabled: false }` and the callback paths refuse. `sso/sso.controller.ts:45`.
- **SAML assertion-signature** is the authenticity proof; SSO callbacks are
  CSRF-exempt for exactly this reason (IdP POST can't carry our cookie).
  `csrf.middleware.ts:32-33`.
- **Clever SIS** is built and **fetches only `admins`/`teachers`/`staff`** —
  never student rosters. `integrations/clever/clever-http.client.ts:84`. See
  `COMPLIANCE.md` for the FERPA significance.

## 7. Billing / PCI — SHIPPED (SAQ-A)

- **Card data never touches our servers.** Stripe Checkout + Billing Portal
  are **hosted** sessions; we receive only a redirect `url`.
  `billing/stripe.service.ts:233-245,262-266`. PCI-SAQ-A.
- **Webhook signature verified** against `STRIPE_WEBHOOK_SECRET`; the webhook
  path is CSRF-exempt because Stripe POSTs without cookies.
  `billing/billing-webhook.controller.ts`; `csrf.middleware.ts:89`.
- **License↔Stripe reconcile cron** corrects drift if an event call fails
  (`billing/license-reconcile.cron.ts`).

## 8. Audit & forensics — SHIPPED

- **DB-level append-only `audit_logs`** — UPDATE/DELETE raise + roll back.
  `migrations/20260526010000_audit_log_immutability/migration.sql`.
- **Real domain audit rows** on privileged actions (emergency
  trigger/all-clear, auth login/logout, AI-key set/rotate/revoke,
  Stripe→License, submission approve/reject, template/sponsor CRUD, etc.).
  `emergency.controller.ts:441`; grep `auditLog.create`.
- **The global HTTP interceptor is an operational breadcrumb, not the audit
  log**, and it says so in its header. `security/request-log.interceptor.ts:6-36`.
- **Log context** — audit rows carry `tenantId`, `userId` (or `apiKeyId` for
  machine identities), `action`, `targetType`, `targetId`, `details`,
  `createdAt`. `schema.prisma:1024-1043`. *(Before/after diffs are NOT
  universally captured — do not claim full state-diffing.)*

---

## Quick reference — control → callsite

| Control | File:line |
|---|---|
| Argon2id params | `auth/crypto.config.ts:7` |
| Login timing equalizer | `auth.service.ts:56-67` |
| JWT secret selection | `jwt-auth.guard.ts:76-81` |
| Token revocation (fail-closed, all envs) | `jwt-auth.guard.ts:90-126` |
| Per-user mass revocation | `jwt-auth.guard.ts:113-118` |
| Boot-time required secrets | `security/required-secret.ts:30-39` |
| Helmet CSP + HSTS | `main.ts:83-102` |
| Session cookie flags | `main.ts:124-134` |
| CORS fail-closed | `main.ts:144-205` |
| CSRF enforce-by-default | `security/csrf.middleware.ts:164-214` |
| SSRF safe-fetch + rebind pin | `branding/safe-fetch.ts:122-145,309` |
| SVG block (upload + bucket) | `assets.controller.ts:39`; `supabase-storage.service.ts:57` |
| Emergency HMAC fan-out gate | `redis.service.ts:137`; `security/ws-signature.ts:51` |
| SSO enabled-gate | `sso/sso.controller.ts:45` |
| Clever staff-only scope | `integrations/clever/clever-http.client.ts:84` |
| Stripe hosted checkout (SAQ-A) | `billing/stripe.service.ts:233` |
| Audit-log DB immutability | `migrations/20260526010000_audit_log_immutability/migration.sql` |

## Known gaps (tracked, NOT done)

| Gap | Mitigation today | Tracking |
|---|---|---|
| No refresh-token rotation | 30-d JWT + revocation set + per-user epoch | `auth.service.ts:172`; `docs/SECURITY_HYGIENE.md` |
| No upload malware scanning | mime allowlist + magic-byte + SVG block + SHA-256 | `docs/SECURITY_HYGIENE.md` |
| Repo PUBLIC on GitHub | gitleaks pre-commit + CI | `docs/SECURITY_HYGIENE.md` (flip-to-private rec) |
| In-memory abuse counters not multi-replica-safe | single API replica today | audit P1-14 (`docs/research/2026-05-28-opus48-audit/`) |
| No "impossible-travel" anomaly detection | basic anomaly + rate limits | backlog |
