> **Provenance:** single Opus agent under the audit ground rules (read-only, evidence-with-file:line,
> two-methods-for-absence, self-refutation before reporting).
> **Lead review status: NOT independently re-verified.**

# Account Takeover & Blast Radius Audit — 2026-08-02

**Scope:** `apps/api/src/auth/**`, `apps/api/src/security/{csrf,client-ip}*`, `apps/api/src/{users,sso,api-keys,onboarding,tenants}/`, `packages/auth-core/`, plus a never-audited-module sweep (`apps/edge/`, `webhooks`, `integrations`, `maintenance`, `hardware`, `notifications`, `feature-flags`, `bugs`, `submissions`, `floor-plans`).
**Method:** read-only. Every claim below cites a file:line I opened. Absence claims used two independent methods (full-file read + repo-wide `grep` via the Bash tool with verified exit status); anything I could not double-confirm is in "Not checked / UNVERIFIED."
**Branch state:** `security/player-fixes-2026-08-01` @ `16be1090`, worktree `agent-ad14c55bb9466c488`.

---

## 1. Posture + rationale

The identity layer is **materially better engineered than most SaaS of this size** — Argon2id at OWASP-plus parameters, a timing-equalised login path, durable (Redis + Postgres) token revocation that fails *closed*, per-user mass-revocation on privilege tightening, envelope-encrypted TOTP secrets, hand-rolled RFC-6238 TOTP with `timingSafeEqual`, a single shared role-assignment rank table wired into **both** user-management paths, and an explicit CVE-driven decision to *uninstall* `passport-saml` rather than ship a vulnerable verifier. There is a visible, disciplined history of closing exactly the classes of bug this audit hunts for.

That makes the headline finding worse, not better: **the one privilege-assignment path that was never routed through `assertCallerCanAssignRole` is the SSO config**, and it hands out `SUPER_ADMIN`. `apps/api/src/sso/sso.service.ts:93` writes an attacker-supplied `defaultRole` straight to the DB with no allowlist, no rank check, and no validation pipe; `sso.service.ts:472` then stamps that string onto a freshly auto-provisioned user; `sso.service.ts:502-510` signs it into a JWT. The endpoint is reachable by `DISTRICT_ADMIN` (`sso.controller.ts:219`), and `DISTRICT_ADMIN` is what **any anonymous internet user gets from one unauthenticated `POST /api/v1/signup`** (`onboarding.service.ts:152`, no email verification anywhere in that file). `openid-client@5.7.1` **is** installed (`apps/api/package.json:61`, resolved at `node_modules/.pnpm/openid-client@5.7.1`), so the OIDC path is live, not a stub. The result is a self-serve path from "nobody" to platform-wide `SUPER_ADMIN` — cross-tenant read/write and a lockdown alert on any district's screens.

The second theme is **session durability outliving the remediation**. There is no self-service password-change endpoint *at all* (verified two ways: full read of `users/users.controller.ts`, and a repo-wide grep for `changePassword|currentPassword|newPassword` that returns only the reset path). The reset path (`onboarding.service.ts:253-288`) does not call `markUserTokensInvalid`. Only two writers of that revocation marker exist in the entire repo (`users.controller.ts:90` and `:501`). So the universal incident-response move — "change the password" — does not end the intruder's session. Ceiling is 30 days (`auth.service.ts:179`), and any tenant switch silently mints a fresh 30-day token regardless of the original session length (`tenants.controller.ts:249`).

The third theme is **MFA that exists but is never required**. TOTP is entirely opt-in per user; the `User.mfaRequired` column that the schema comment says exists for "admin require 2FA for this user" (`schema.prisma:445-446`) is **written and read by nothing** — repo-wide grep returns only unrelated `mfaRequired` response-envelope hits in `auth.service.ts:147` / the login page. For a product where a single credential fires a district-wide lockdown, unenforceable MFA is a launch-blocking posture item even though it is not itself an exploit.

Genuinely strong and worth saying to a district security reviewer: authentication is **Bearer-header only** (`jwt-auth.guard.ts:175-177`; no route reads a credential from a cookie — the only `req.cookies` reads in the API are the two CSRF sites), which structurally removes the CSRF attack surface for authenticated mutations; and multi-tenant scoping on the SSO admin routes, the tenant switcher, and the AI-key surface is correct and defended in depth.

---

## 2. Blast-radius table

"Reachable" = I traced the route, its guard, and its handler.

| Identity | Fleet-/emergency-level destructive reach | Evidence |
|---|---|---|
| **SUPER_ADMIN** | **Everything, every tenant.** `RbacGuard` short-circuits `true` for the role before any tenancy check (`rbac.guard.ts:111-113`); `requireTenantId` returns `null` (= no tenant filter) for it (`require-tenant.ts:25`). Trigger/clear emergency on any scope, switch into any tenant (`tenants.controller.ts:216`), archive tenants, delete users, change roles, arm SAML, publish OTA. | rbac.guard.ts:111, require-tenant.ts:25, tenants.controller.ts:216 |
| **DISTRICT_ADMIN** | District-wide lockdown/evacuate/weather + all-clear + text broadcast + media alert (`emergency.controller.ts:356-358, 656-658, 955-957, 1032-1034`); switch into any child school retaining DISTRICT_ADMIN (`tenants.controller.ts:222-229`); create users, invite up to SCHOOL_ADMIN; mint never-expiring API keys (`api-keys.controller.ts:19`); **configure + enable OIDC SSO and set the auto-provision role → see ACC-01, which converts this into SUPER_ADMIN.** | as cited |
| **SCHOOL_ADMIN** | School-scoped emergency trigger + all-clear + broadcast + media alert; invite CONTRIBUTOR/VIEWER; flip `canTriggerPanic`; OTA window / auto-update / canary settings (`tenants.controller.ts:740, 872`). **Cannot** reach SSO config (`sso.controller.ts:219` omits it). | emergency.controller.ts:358, users.controller.ts:366 |
| **CONTRIBUTOR** | `POST /emergency/sos` (`emergency.controller.ts:849`) — reaches the responder path but not a screen override. Can edit a template already bound to a live schedule (established context). No user-management, no SSO. | emergency.controller.ts:849 |
| **RESTRICTED_VIEWER** | Read-only, but broader than it looks: `RbacGuard` grants **GET/HEAD on every route whose `@RequireRoles` includes CONTRIBUTOR** (`rbac.guard.ts:89-97`), and is hard-blocked from the panic bypass regardless of the flag (`rbac.guard.ts:69-75`). Sensitive reads are masked (AI key returns `keyMask`, `ai-key.controller.ts:99-105`). | rbac.guard.ts:69, :89 |
| **Tenant API key (`vos_…`)** | **Assumes the role stamped on it, up to DISTRICT_ADMIN** (`api-keys.service.ts:37-42`) — so a key can fire a district-wide lockdown. Revocation *is* checked live per request (`api-keys.service.ts:181-182`) — good. But the action lands in `AuditLog` with `userId: null` and **no key identity**: `apiKeyId` is assigned at `jwt-auth.guard.ts:55` and read by nothing in the repo. Expiry is optional and defaults to `null`. | ACC-06 |
| **Device token (`kind:'device'`)** | Deliberately narrow: manifest, cache-status, emergency-assets, player logs, OTA state, template/asset device reads (`templates.controller.ts:816`, `assets.controller.ts:1353`, `screens.controller.ts:2663`). It carries `tenantId` (`devices.controller.ts:108`) and is **exempt from per-user mass revocation by design** (`jwt-auth.guard.ts:113`) — meaning a stolen device token (which the established context says is obtainable) is only killable by revoking the screen, not by any user-side control. | as cited |

**Worst single compromise: `DISTRICT_ADMIN`.** Not `SUPER_ADMIN` — because `SUPER_ADMIN` is a small, controlled population, whereas `DISTRICT_ADMIN` is (a) held by every customer's IT lead, (b) **mintable by anyone on the internet in one request**, and (c) via ACC-01 it *becomes* `SUPER_ADMIN`. Every district admin credential is therefore a platform-takeover credential today.

---

## 3. Findings

### [CRITICAL] ACC-01 — Any DISTRICT_ADMIN (including a self-signed-up stranger) can auto-provision themselves `SUPER_ADMIN` through the SSO config

**Where:** `apps/api/src/sso/sso.service.ts:93` (write), `:466-474` (use), `:502-510` (JWT mint); `apps/api/src/sso/sso.controller.ts:217-237` (route + role gate); `apps/api/src/sso/sso.types.ts:15` (`defaultRole?: AppRole` — compile-time only).

**Attacker:** any unauthenticated person on the internet.

**Steps:**
1. `POST /api/v1/signup` with any org name + email + 8-char password. `onboarding.service.ts:147-158` creates the tenant and a `role: AppRole.DISTRICT_ADMIN`, `status:'ACTIVE'` user and returns a live session (`:205`). There is no email-verification, invite-code, or approval step in `SignupInputSchema` (`packages/api-types/src/index.ts:320-343`) or in `signup()`.
2. `POST /api/v1/tenants/<own-slug>/sso` with
   `{provider:'OIDC', enabled:true, oidcIssuer:'https://idp.attacker.example', oidcClientId, oidcClientSecret, autoProvision:true, defaultRole:'SUPER_ADMIN'}`.
   `assertTenantAccess` passes (own tenant, `sso.controller.ts:290`). `upsertConfig` gates **only** SAML-enable behind SUPER_ADMIN (`sso.service.ts:109-140`); OIDC enable is ungated. `defaultRole` is taken verbatim at `sso.service.ts:93`.
3. `GET /api/v1/auth/sso/<slug>/oidc/login` → redirect to the attacker's own IdP → authorize → callback.
4. `validateOidcCallback` succeeds (real `openid-client`, state/nonce are the ones we issued). `resolveOrProvisionUser` finds no user for the fresh email, `autoProvision` is true, `allowedEmailDomain` is null, so it creates a user with `role: config.defaultRole` = `'SUPER_ADMIN'` (`sso.service.ts:466-474`).
5. `mintJwtForUser` signs `{role:'SUPER_ADMIN'}` (`sso.service.ts:502-510`) and the controller hands it back in the redirect fragment (`sso.controller.ts:322`).

**What they get:** `RbacGuard` returns `true` for every route (`rbac.guard.ts:111`) and `requireTenantId` returns `null` = no tenant filter (`require-tenant.ts:25`). Cross-tenant read/write on every district; `POST /api/v1/emergency/trigger` against **any** tenant/group/device scope; user deletion and role changes (both SUPER_ADMIN-only endpoints); SAML arming; OTA controls.

**Refutation attempts (all failed to block it):**
- *A global validation pipe rejects the role?* No. The only global `APP_PIPE` is `SanitizationPipe` (`app.module.ts:258-260`), which returns any string containing no `<`/`>` untouched (`sanitization.pipe.ts:48`). The controller uses a bare `@Body() dto: SsoConfigDto` (`sso.controller.ts:222`) — **no `ZodValidationPipe`**, unlike every onboarding route.
- *The DB constrains it?* No — `TenantSSOConfig.defaultRole String @default("RESTRICTED_VIEWER")` and `User.role String`, both free strings (`schema.prisma`).
- *`assertCallerCanAssignRole` covers this path?* No. Repo-wide grep: it is imported only by `users/users.controller.ts:12` and `onboarding/onboarding.service.ts:6`. The SSO module never calls it.
- *SAML being disabled saves us?* No — this is the OIDC path, explicitly noted as unaffected by the SAML gate (`sso.service.ts:106-107`), and `openid-client` is installed and resolvable.
- *`assertTenantAccess` blocks it?* No — the attacker targets their own tenant.
- *Is `SsoModule` actually mounted?* Yes, `app.module.ts:124`.

**Correct fix (not the cheap one):** route `defaultRole` through `assertCallerCanAssignRole(actorRole, dto.defaultRole)` inside `upsertConfig` *and* add a `ZodValidationPipe` with a `z.enum` over `AppRole` on the route, *and* gate `enabled:true` for OIDC on the same "can this actor arm a login path" question SAML already asks. `SUPER_ADMIN` must never be assignable from a tenant-scoped surface — mirror `ApiKeysService.ALLOWED_ROLES` (`api-keys.service.ts:37-42`), which already gets this right.

---

### [HIGH] ACC-02 — A password reset does not end the attacker's session; there is no password-change endpoint at all

**Where:** `apps/api/src/onboarding/onboarding.service.ts:253-288`; revocation writers at `apps/api/src/users/users.controller.ts:90` and `:501` only.

**Attacker:** anyone holding a stolen operator JWT (XSS on the dashboard, a shoulder-surfed device, a leaked log, a phished session).

**Steps:** Steal a `rememberMe` token (30-day TTL, `auth.service.ts:179`). The victim notices, follows "forgot password", sets a new one. `completePasswordReset` updates `passwordHash`, marks the token used, writes the audit row — and stops. It never calls `RedisService.markUserTokensInvalid`. The attacker's token is not in `jwt_revoked_list` (only `POST /auth/logout` SADDs, `auth.controller.ts:179`) and has no `invalid-before` marker, so `JwtAuthGuard` (`jwt-auth.guard.ts:100-118`) passes it. The session survives the remediation for the remainder of its TTL.

**What they get:** up to 30 more days of the victim's full role — for a `DISTRICT_ADMIN`, that includes `POST /api/v1/emergency/trigger` on the whole district.

**Aggravating:** there is no self-service "change my password" route to fall back on. Verified two ways — full read of `users/users.controller.ts` (509 lines; endpoints are `GET /`, `GET|PUT /me`, `POST /`, `PUT /:id/role`, `PUT /:id/can-trigger-panic`, `DELETE /:id`) and a repo-wide grep for `changePassword|currentPassword|change-password|newPassword` returning only the three `onboarding.service.ts` reset lines. Likewise, disabling MFA (`mfa.controller.ts:362-371`) does not revoke sessions either.

**Refutation attempted:** *does the guard re-read the user row per request?* No — `jwt-auth.guard.ts:146-162` populates `req.user` entirely from JWT claims; `role` and `canTriggerPanic` are stale-by-design and only corrected by the explicit revocation marker, which this path never sets.

**Correct fix:** call `markUserTokensInvalid(userId)` inside the `completePasswordReset` transaction's success path (and on MFA disable, and on `acceptInvite` for a re-used row). Treat a Redis failure the way `auth.controller.ts:175` treats logout — surface it, don't silently continue.

---

### [MEDIUM] ACC-03 — MFA is unenforceable: `mfaRequired` is a dead column, and the SSO login path skips the MFA check entirely

**Where:** `packages/database/prisma/schema.prisma:445-446` (column + its "admin require 2FA" comment); `apps/api/src/auth/auth.service.ts:145-151` (the only MFA gate — keyed solely on the user's own `mfaTotpVerifiedAt`); `apps/api/src/sso/sso.service.ts:526-555` (`completeSsoLogin` → `mintJwtForUser`, no MFA branch).

**Two verified sub-claims:**
1. **No enforcement mechanism exists.** Repo-wide grep for `mfaRequired` across `apps/` + `packages/` returns only the login *response envelope* (`auth.service.ts:147`, `auth.controller.ts:65`, `login/page.tsx:212`) and specs — **zero reads or writes of the `User.mfaRequired` column**. There is no tenant-level policy field in `schema.prisma` either. So an admin cannot require 2FA on the account that can lock down a district; it is purely voluntary, per user.
2. **SSO bypasses MFA.** `completeSsoLogin` calls `mintJwtForUser` directly rather than `AuthService.login`, so the `mfaTotpVerifiedAt` challenge at `auth.service.ts:145` is never consulted. A user who enrolled TOTP in VenueOS gets a full session from an OIDC assertion with no second factor from us.

**The API-vs-UI question you asked:** the challenge is enforced on the **token-issuing path**, not just the UI — `AuthService.login` returns `{mfaRequired, mfaToken}` *instead of* an `access_token` (`auth.service.ts:146-150`), so calling `/auth/login` directly cannot skip it. The challenge token is user-bound (`sub`), purpose-tagged (`purpose:'mfa_challenge'`, checked at `mfa.controller.ts:470`), and 5-minute TTL (`mfa-challenge-token.ts:25`). The rate limiter **is per-account** (keyed on `userId`, 5 failures/min → 5-min lockout, `mfa-rate-limiter.ts:45-85`) with a per-IP `@Throttle` on top. That part is correct.

**Severity rationale:** rated MEDIUM rather than HIGH because it is a missing control rather than a bypassable one — but it is the single highest-value remediation for a life-safety product, and I would not sign a district security questionnaire without it.

---

### [MEDIUM] ACC-04 — Disabling OIDC SSO does not disable OIDC login

**Where:** `apps/api/src/sso/sso.service.ts:392` (`if (!config || config.provider !== 'OIDC')`) and `:531-534` (`completeSsoLogin` checks provider match, not `enabled`).

**Attacker:** whoever controls the tenant's configured IdP after the tenant has *turned SSO off*.

**Steps:** The SAML equivalent is explicitly hard-gated on `enabled` with a long comment explaining why (`sso.service.ts:302-318`). The OIDC callback has no such check. A tenant that responds to an IdP compromise by flipping `enabled:false` in the VenueOS UI has closed `buildOidcLoginUrl` (`sso.service.ts:356`) and the public config probe (`sso.controller.ts:96`) — but `GET /api/v1/auth/sso/:slug/oidc/callback` still validates a code and mints a session, as long as the attacker drives a login round-trip that produces a valid `state`/`nonce` pair. Since the login-initiation endpoint is what issues those, the practical path is a callback replayed inside the 10-minute Redis state TTL (`sso.controller.ts:49`) or a session-cookie flow started before the flag flip — a narrow but real window, and precisely the window an incident responder believes they just closed.

**Fix:** add `|| !config.enabled` to `sso.service.ts:392` and to `completeSsoLogin`'s guard, matching the SAML gate.

---

### [MEDIUM] ACC-05 — Archiving a tenant does not disable its users' logins or their emergency-trigger capability

**Where:** `apps/api/src/tenants/tenants.controller.ts:486` (the only `archivedAt` writer); `apps/api/src/auth/auth.service.ts:53-103` (`validateUser` checks `deletedAt` and `status`, not the tenant).

**Attacker:** a user of a district that was offboarded, or of one of the ~120 test/demo tenants archived on 2026-07-23.

**Steps:** `POST /tenants/:id/archive` sets `Tenant.archivedAt`. Every consumer of that field filters *lists and fleet views* (`tenants.controller.ts:33, 49, 82`, `screens.controller.ts:1147`, `playlist-distribution.service.ts:92`). Nothing in the auth path consults it — verified two ways: full read of `auth.service.ts` (no tenant lookup other than the slug/vertical fetch at `:157`), and a grep for `archivedAt` across `apps/api/src` returning zero hits under `auth/`, `emergency/`, or the JWT guard. Existing sessions are never revoked (archive does not call `markUserTokensInvalid`). So an archived tenant's admin can still log in and still `POST /emergency/trigger` against their own tenant's screens, which still exist.

**Fix:** reject login and fail the guard for a user whose tenant is archived, and revoke that tenant's users' tokens inside the archive transaction.

---

### [MEDIUM] ACC-06 — An API key can fire a district-wide lockdown, never expires by default, and is forensically anonymous

**Where:** `apps/api/src/api-keys/api-keys.service.ts:37-42` (roles up to `DISTRICT_ADMIN`), `:80` (`expiresAt: opts.expiresAt ?? null`); `apps/api/src/auth/jwt-auth.guard.ts:46-57`; `apps/api/src/emergency/emergency.controller.ts:358` + `:515`.

**Steps:** A `DISTRICT_ADMIN` mints a key with `role:'DISTRICT_ADMIN'` and no `expiresAt` (the controller only sets one if the caller supplies a parseable date, `api-keys.controller.ts:36-39`). `JwtAuthGuard` attaches `{role:'DISTRICT_ADMIN', tenantId, userId:null, apiKeyId}`. `RbacGuard` sees a satisfying role and admits the request to `POST /emergency/trigger`. The audit row is written with `userId: req.user?.id` = **null** (`emergency.controller.ts:515`) and no key reference.

**The attribution is safeguard theater.** `jwt-auth.guard.ts:38-40` and `:49` promise "AuditLog rows for API-key-driven actions carry userId:null + apiKeyId for forensics." Repo-wide grep for `apiKeyId` returns **three hits, all in `jwt-auth.guard.ts`** (two comments and the assignment at `:55`). Nothing ever reads it. So "who fired the lockdown" for an API-key-driven emergency is unanswerable.

**Fix:** persist `apiKeyId` into `AuditLog.details` at every privileged write; default API keys to a bounded expiry; and decide explicitly whether a machine identity should be able to reach `/emergency/*` at all (I would exclude it).

---

### [MEDIUM] ACC-07 — Every tenant switch silently upgrades a 1-hour session to a 30-day one

**Where:** `apps/api/src/tenants/tenants.controller.ts:249` — `this.jwtService.sign(payload, { expiresIn: '30d' })`, unconditional.

A user who deliberately declined "remember me" holds a 1-hour token (`auth.module.ts:26`). One `POST /api/v1/tenants/switch` — a routine navigation action for any district admin — replaces it with a 30-day token. Combined with ACC-02 (no revocation on password reset), this maximises the blast window of every stolen token for exactly the population with the most privilege. The authorization logic in the same handler is otherwise sound (`:216-229`), and it correctly re-reads `role`/`canTriggerPanic` live from the DB (`:235-238`).

**Fix:** carry the original session's remaining lifetime (or its `rememberMe` intent) into the switched token; never lengthen a session as a side effect of navigation.

---

### [MEDIUM] ACC-08 — Every per-IP brute-force cap, and the forensic IP on an emergency trigger, is one spoofed header away

**Where:** `apps/api/src/security/client-ip.ts:47-52` (leftmost `X-Forwarded-For`), consumed by `client-ip-throttler.guard.ts:63` (the global `APP_GUARD`, `app.module.ts:254-256`) and by `auth.controller.ts:100` / `:207` for `AuditLog`.

This is **documented and consciously accepted** (`client-ip.ts:28-33`, `client-ip-throttler.guard.ts:38-44`), and I want to be fair to that decision: the leftmost-XFF change genuinely fixed a live bug where the caps never fired at all. But the accepted-risk rationale ("Argon2 makes online guessing infeasible") does not hold for the two attacks that matter here:

- **Credential stuffing** tests one known password against many accounts. The Argon2 cost is paid by *our server*, not the attacker. With `X-Forwarded-For` rotation, the login cap (10/min, `auth.controller.ts:37`), the password-reset cap (3/hr, `onboarding.controller.ts:37`) and the signup cap (5/min, `:25`) are all unbounded — which is also what makes ACC-01's "mint a DISTRICT_ADMIN tenant" step unthrottleable.
- **Forensics.** The file's own opening paragraph says the reason it exists is that "who triggered an emergency, from what IP" must be trustworthy for a life-safety product. As implemented, that field is attacker-chosen.

The MFA challenge is *not* affected — its real limiter is per-account and in-memory (`mfa-rate-limiter.ts:45`), correctly.

**Fix:** with `trust proxy: 1` behind a single known edge, derive the client from `req.ips` counting from the *right* (the last untrusted hop) rather than blindly leftmost, or have the Cloudflare worker overwrite `X-Forwarded-For` with `CF-Connecting-IP` before proxying. Add a per-account failed-login counter so login brute-force does not depend on IP at all.

---

### [MEDIUM] ACC-09 — Cross-tenant hijack of a pending invite; permanent email squatting on another district

**Where:** `apps/api/src/onboarding/onboarding.service.ts:524-553` (`createUserDirect`), specifically `:534` — `const patch = { role, status:'ACTIVE', passwordHash, tenantId: input.tenantId }`.

**Attacker:** anyone with a self-signed-up `DISTRICT_ADMIN` who knows an email address with an outstanding invite at a victim district.

**Steps:** `POST /api/v1/users` with `{email:'superintendent@victim.k12.us', role:'CONTRIBUTOR', password:'…'}`. The existence check only rejects `status === 'ACTIVE'` (`:525`); a victim-tenant `INVITED` placeholder row (`:368-378`) is not ACTIVE, so the code falls through to `:537` and **updates that row's `tenantId` to the attacker's tenant**, sets a password the attacker chose, and marks it ACTIVE. The cross-tenant guard above (`:514-522`) only validates *inviter → target tenant*; it never checks the tenant of the row being mutated.

**What they get:** the victim district permanently loses that email — every future `createInvite`/`createUserDirect` for it now hits `ConflictException` "A user with that email already exists" (`:354`, `:525`), pointing at a row the victim cannot see (their user list filters on `tenantId`, `users.controller.ts:104`). And the still-live `UserInvite` token, when the real person clicks it, calls `acceptInvite` → `user.update` without touching `tenantId` (`:617-620`) → the genuine invitee lands in the **attacker's** tenant.

**Refutation that succeeded (worth recording):** I initially believed the *`createInvite`* path gave full cross-tenant account takeover (attacker invites the victim-tenant row into their own tenant, receives `acceptUrl` in the response at `:466`, accepts it, and `authService.login(user)` at `:637` mints a JWT carrying the **victim's** `tenantId` and role). That is blocked — but only incidentally, by `UserInvite.userId String? @unique` (`schema.prisma`), which makes the second `userInvite.create` for the same user row violate the unique constraint. Since every `INVITED` row is created in the same transaction as its invite (`:365-415`) and no code path anywhere deletes a `UserInvite` (grep for `userInvite.` returns exactly four sites, all create/find/update), that constraint holds today. **It is load-bearing security relying on an unrelated schema constraint** — if anyone ever adds invite cleanup or a re-send that deletes the old row, this becomes a CRITICAL cross-tenant takeover.

**Fix:** in both `createInvite` and `createUserDirect`, refuse when `existing.tenantId !== input.tenantId` regardless of status; and have `acceptInvite` assert `invite.tenantId === user.tenantId`.

---

### [MEDIUM] ACC-10 — A district admin cannot revoke a departing employee's access

**Where:** `apps/api/src/users/users.controller.ts:254` (`PUT /:id/role` → `@RequireRoles(SUPER_ADMIN)`) and `:448` (`DELETE /:id` → `@RequireRoles(SUPER_ADMIN)`).

A `DISTRICT_ADMIN` can *create* users and *invite* them, but can neither demote nor delete one. There is no deactivate/suspend path either — verified two ways: the full read of `users.controller.ts` above, and a grep for writes of `status` to any non-`ACTIVE` value across `apps/api/src`, which returns exactly one hit (`onboarding.service.ts:374`, `'INVITED'`). The only lever a district admin has is `PUT /:id/can-trigger-panic` (`:366`).

So when a school fires an IT staffer, the customer's own administrator **cannot end that person's access** — they must contact the vendor for a `SUPER_ADMIN`, and until then the ex-employee's 30-day token keeps working (ACC-02). For a life-safety product this is both a security gap and a customer-trust problem; the revocation *machinery* (`revokeUserTokens`, `users.controller.ts:88-97`) is already built and correct — it is simply unreachable by the people who need it.

**Fix:** allow `DISTRICT_ADMIN`/`SCHOOL_ADMIN` to deactivate and to demote users strictly below their own rank (`assertCallerCanAssignRole` already expresses exactly this policy, `role-assignment.ts:26-34`), routed through the existing revoke-on-tightening path.

---

### [LOW] ACC-11 — TOTP codes and the MFA challenge token are replayable for ~90 seconds

**Where:** `apps/api/src/auth/totp.ts:141-152` (±1 step, no used-step tracking); `apps/api/src/auth/mfa.controller.ts:452-598` (`challenge` does not mark the `mfaToken` consumed).

`verifyTotpCode` accepts the current step ±1 and nothing records the last-consumed step, so one 6-digit code stays valid across its whole ~90-second window. The challenge token is valid for 5 minutes (`mfa-challenge-token.ts:25`) and is not single-use. An attacker who observes one `(mfaToken, code)` pair — a real-time phishing proxy, a shared screen, an over-logged request — can redeem it again for an additional independent session within that window. The password is not needed for the replay.

**Fix:** persist the last-consumed TOTP step per user and reject `step <= lastUsed`; mark the `mfaToken` consumed on first successful redemption (a `jti` in the existing durable revocation table would do it).

---

### [LOW] ACC-12 — Using one password-reset link does not invalidate the user's other outstanding reset links

`completePasswordReset` marks only `record.id` used (`onboarding.service.ts:272-275`). Token generation is strong (32 random bytes, base64url, SHA-256 at rest, 1-hour TTL, single-use per token — `:22-28`, `:229-235`, `:262-266`) and the request endpoint is correctly non-enumerating (`:217-251` always returns `{ok:true}`; `validateUser` even runs a dummy Argon2 verify on the miss branch to equalise timing, `auth.service.ts:60-72`). But if a user requests three resets and an attacker intercepts the first email, the victim completing the third does not burn the attacker's still-live token.

**Fix:** `updateMany` all of that user's unexpired, unused reset tokens to `usedAt: now` in the same transaction.

---

## 4. `apps/edge/` findings

**Nothing security-relevant. Here is what it is.** A ~528-line Cloudflare Worker (`apps/edge/src/index.ts`) that reverse-proxies the Railway API, edge-caches three anonymous GETs, and proxies Supabase Storage objects under `/cdn/assets/*` with a 1-year immutable header.

What I checked and found sound:
- **Cache never sees authenticated data.** `shouldNeverCache` (`index.ts:118-129`) bypasses cache for any non-GET/HEAD, and for *any* request carrying `authorization` or `cookie`, before the path allowlist is even consulted. `/api/v1/auth/`, `/api/v1/sso/`, `/api/v1/emergency/`, per-device manifests and status are additionally on the never-cache list (`:77-86`). The whitelist is three paths (`:98-102`).
- **No SSRF in the asset proxy.** `buildUpstreamUrl` (`:184-188`) concatenates onto `ASSET_ORIGIN`; because it starts from `new URL(req.url).pathname`, dot-segments are already normalised away by the URL parser (a `/cdn/assets/../x` request never matches `CDN_PREFIX`), and percent-encoded traversal stays literal through `fetch`, so it cannot escape the bucket path or reach another host. `handleAsset` rejects non-GET/HEAD (`:293-298`).
- Minor, non-exploitable notes: the origin fetch uses `redirect: 'follow'` (`:341`) so a redirecting origin object would be cached under the requested key — harmless for a public bucket, but I'd pin it to `manual`; and the catch-all falls back to a raw passthrough on any worker exception (`:511-520`), which is the right availability trade for a life-safety fleet.
- **It is not the production entry point.** `wrangler.toml` has the production route block commented out, `workers_dev = true`, and `ASSET_ORIGIN = ""` (which makes every `/cdn/assets/*` request a 503 by design, `index.ts:302-307`). Treat it as staged-but-not-cut-over.

**One cross-cutting note it creates:** if/when this worker *is* cut over, it forwards `req.headers` verbatim to origin (`index.ts:147`), which means the leftmost-`X-Forwarded-For` value the API trusts (ACC-08) remains fully client-controlled. The cutover is the natural moment to overwrite `X-Forwarded-For` with `CF-Connecting-IP` in `proxyToOrigin` and close ACC-08 for free.

### Sweep of the other never-audited modules

`webhooks`, `integrations`, `hardware`, `feature-flags`, `bugs`, `submissions`, `floor-plans`, `maintenance` — I mapped every route decorator in each controller. All are behind `@UseGuards(JwtAuthGuard, RbacGuard)` at class level with sensible `@RequireRoles` (webhooks and bugs are admin-only; submissions correctly splits create/read at CONTRIBUTOR and approve/reject at SCHOOL_ADMIN+; floor-plans mutations are SCHOOL_ADMIN+). `maintenance/` contains no controller at all — one boot-time backfill function. The single unauthenticated route in the set is `POST /api/v1/notifications/help` (`notifications.controller.ts:53-95`), and it is defended correctly: the tenant is resolved server-side from `screenId` (`:69-76`) so the caller cannot address a tenant they have no screen on, an unknown screen silently no-ops to deny a probe signal, title/body are coerced-then-truncated, it is throttled 10/min, and a 5-minute dedupe bucket caps the notification volume. **Nothing to report from this sweep.** (`webhook-dispatch.ssrf.spec.ts` exists, indicating outbound-webhook SSRF was already treated; I did not re-verify it — out of scope, noted below.)

---

## 5. What is already strong

State these to a district security reviewer without hedging:

- **Password hashing.** Argon2id, m=64 MiB / t=3 / p=4 (`auth/crypto.config.ts:7-12`) — at or above the OWASP 2024 recommendation, applied uniformly to passwords, MFA backup codes (`mfa.controller.ts:102-107`) and invite placeholders.
- **No user enumeration.** A precomputed dummy hash is verified on both the user-not-found and the not-ACTIVE branches so all three outcomes take the same time (`auth.service.ts:21-27, 60-72, 79-88`), with matching generic messages; password-reset always returns `{ok:true}` (`onboarding.service.ts:221, 226`).
- **Revocation that fails closed.** `JwtAuthGuard` denies on any Redis error rather than admitting the token (`jwt-auth.guard.ts:119-126`), and the environment gate that once made this a no-op outside production was deliberately removed (`:90-96`). Logout 503s rather than lying when Redis is unreachable (`auth.controller.ts:175-185`). Both the single-token set and the per-user epoch are mirrored to Postgres so they survive a Redis flush (`redis.service.ts:314-345, 374-400`).
- **Privilege-escalation policy in one place.** `role-assignment.ts` is the single rank table, wired into `POST /users` (`users.controller.ts:203`), `PUT /:id/role` (`:265`), `createInvite` (`onboarding.service.ts:330`) and `createUserDirect` (`:509`) — the exact drift that a previous audit found in onboarding is closed. A `SUPER_ADMIN` also cannot demote a peer `SUPER_ADMIN` (`users.controller.ts:279-285`).
- **`RESTRICTED_VIEWER` can never trigger an emergency**, even with `canTriggerPanic` set, enforced at both the guard (`rbac.guard.ts:69-75`) and the writer (`users.controller.ts:396-401`).
- **MFA secrets are envelope-encrypted** (AES-256-GCM per-row data key wrapped with `DEVICE_SECRET_KEY`, `mfa-secret-cipher.ts`), enrollment is two-phase so an interrupted setup cannot lock a user out, re-enrollment on an already-enabled account is refused (`mfa.controller.ts:188-193`), and disable/regenerate require password re-auth (`:350`, `:412`).
- **TOTP verification is constant-time** (`totp.ts:146-150`) and the challenge rate limiter is **per-account**, not just per-IP (`mfa-rate-limiter.ts:45-85`).
- **Authentication is Bearer-only**, so CSRF cannot reach an authenticated mutation; CSRF nonetheless defaults to *enforce* with only an explicit off-switch (`csrf.middleware.ts:178-180`), uses `timingSafeEqual` (`:160-165`), and every exemption carries a written justification. The session cookie is `httpOnly`, `secure` in production, with an 8-hour rolling idle timeout (`main.ts:186-195`).
- **Boot-time fail-closed configuration:** production refuses to start without `JWT_SECRET`/`SESSION_SECRET`/`DEVICE_SECRET_KEY`/`DEVICE_JWT_SECRET` (`main.ts:44`), without `ALLOWED_ORIGINS` (`:206-210`), or with a pgbouncer URL lacking a sane pool config (`:218-240`).
- **Supply-chain discipline:** `passport-saml` is genuinely absent from `apps/api/package.json` and from the installed tree (verified both ways), the SAML login path fails with an honest 503 instead of a stub URL (`sso.service.ts:289-293`), the unauthenticated SAML callback is hard-gated on an enabled config (`:316`), and arming SAML is restricted to `SUPER_ADMIN` with *both* the allowed and denied attempts audit-logged (`:109-140, 189-205`).
- **Audit coverage on identity events is real**, not aspirational: login success *and* failure (including unknown-email recon, attributed to a sentinel tenant with a hashed email rather than plaintext PII — `auth.controller.ts:87-144`), logout, every MFA call, user create/role-change/panic-flag/delete, tenant switch, and every SSO config mutation, most inside the same transaction as the state change.
- **API keys** are 128-bit random, SHA-256 at rest with an indexed prefix, never re-displayed, `SUPER_ADMIN` deliberately excluded from the mintable set, and revocation is checked live on every request (`api-keys.service.ts`).
- **AI BYOK keys are never exposed** to lower roles — masked value, health flag, and even `setByUserId` withheld from CONTRIBUTOR/VIEWER (`ai-key.controller.ts:99-128`).

---

## 6. Not checked / UNVERIFIED

- **Runtime confirmation of ACC-01.** The chain is traced end-to-end in source and every blocking hypothesis I could construct was refuted by reading the relevant file, but I was read-only — no request was issued and no test run. Rated CRITICAL on code evidence; a 10-minute staging repro would settle it definitively.
- **`apps/web/` token storage.** I relied on the API side only; I did not open the dashboard auth store, so "the JWT lives in localStorage and is therefore XSS-extractable" is stated from prior session notes, **UNVERIFIED here**. It matters for ACC-02's realism, not for its existence.
- **Passkeys.** A `Passkey` model exists on `User` (`schema.prisma`) but I did not trace whether any controller implements WebAuthn. UNVERIFIED.
- **Clever SIS** (`integrations/clever/`) — listed in the sweep directory but not read; `User.cleverId`/`cleverRole` exist and could be an alternate identity path. UNVERIFIED, and it is the one remaining place I would expect another `defaultRole`-shaped bug.
- **Outbound webhook SSRF** — `webhook-dispatch.ssrf.spec.ts` indicates prior treatment; I did not re-verify the allowlist.
- **Multi-replica assumptions.** `MfaRateLimiter` is in-memory per replica and explicitly assumes `numReplicas: 1` (`mfa-rate-limiter.ts:1-20`). I did not verify the deployed replica count on Railway. If it is >1, the per-account MFA lockout weakens by a factor of N and should move to Redis.
- **`AuditLog` immutability triggers** are referenced in comments and in `security/audit-immutability.spec.ts`; I did not inspect the live DB to confirm the triggers are installed in production.
- **The concurrently-edited paths** (`apps/web/src/components/widgets`, `apps/web/next.config.ts`, `apps/api/src/{proxy,templates,playlists}`) were excluded per instruction; nothing in this report depends on them.