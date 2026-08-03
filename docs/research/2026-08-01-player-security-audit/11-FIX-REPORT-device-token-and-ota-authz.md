# Fix report — device-token auth (DT-01…DT-08) + OTA server authz (OTA-01…OTA-05)

**Date:** 2026-08-03
**Branch:** `worktree-agent-a5021e84bdb4d6f96` (branched from `security/player-fixes-2026-08-01` @ `c36218f6`)
**Findings addressed:** `05-DEVICE-TOKEN-AUTH.md` DT-01…DT-08 · `06-OTA-SERVER-AUTHZ.md` OTA-01…OTA-05
**Verification:** `tsc --noEmit --project tsconfig.build.json` → clean · `pnpm --filter api test` → **148 suites / 1961 tests green** (baseline 136 / 1847; +12 suites, +114 tests, 0 regressions)

---

## ⚠️ FLEET IMPACT — read this before deploying

There are live screens in schools holding device tokens today. **Nothing in this
change invalidates a single deployed token at deploy time.**

| Change | Deployed-fleet effect |
|---|---|
| `Screen.credentialEpoch` added, defaults **0** | Tokens minted before this wave carry no `ep` claim, which the verifier reads as **0**. Claim and column MATCH for every existing screen → all keep authenticating unchanged. |
| Paired TTL 365 d → **180 d** | Applies only to **newly minted** tokens. Existing 365-day tokens keep their original `exp` and are honoured to the end of it. Screens roll onto 180-day tokens naturally at their next `/screens/register` (boot). |
| Credential **rotation** on register | The register response carries the new token and the web player already persists it (`player/page.tsx:3744`). A lost response is covered by a **24 h grace window** on the previous epoch, so a retry or a double-register race cannot lock a kiosk out. |
| `STRICT_REPAIR_AUTH` legacy branch removed (DT-04) | Prod already runs with the flag **on** (`docs/research/2026-07-18-fast-launch-audit/00-FAST-LAUNCH-GATE.md:27`) and is pinned at player v1.0.63, so live behaviour is unchanged. What changes is the **default** for a re-provision / new region / staging stack / self-hosted install, which previously landed silently on the insecure path. |
| `GET /screens` no longer returns `deviceFingerprint` / `pairingCode` to CONTRIBUTOR / RESTRICTED_VIEWER | The list view renders neither field; the pair modal and per-screen detail route are admin-gated and unaffected. |
| `/player/update-check` + `/screens/status/:fp/ota-state` | **Still anonymous.** No APK change ships here, and the shipped Kotlin workers send no `Authorization` header — requiring auth would take the whole fleet off the update channel. Only the *destructive* writes are gated. See OTA-01. |
| DB migration | `20260803090000_device_credential_revocation` — six additive columns, all nullable or defaulted. No backfill, no data migration, no downtime. |

**Rollback:** revert the code; the six columns are inert (an old build ignores
them, and `credentialEpoch=0` matches every grandfathered token).

---

## Per-finding

### DT-01 [HIGH] — device tokens could not be revoked at all
`Screen.status='REVOKED'` was read in 8 places, written in 0. `jwt_revoked_list`
had one writer (user logout) and a 30-day Redis TTL against a 365-day token.
Deleting the screen row — losing its schedules and history — was the only
working kill switch.

* **New:** `apps/api/src/screens/device-credentials.ts` → `revokeScreenCredentials()`, `rotateScreenCredentialEpoch()`.
* **Store:** `Screen.credentialEpoch` (+ `credentialEpochRotatedAt`, `credentialRevokedAt`). Keyed on the **screen**, not a token string — an operator revoking a dumpstered screen isn't holding its token, and a self-renewing credential mints a new string every cycle, so a denylist can reach neither. Postgres, **no TTL**, so it cannot lapse before the token; unaffected by a Redis outage.
* **Writers:** device-initiated unpair (in the same transaction as the disown), admin re-pair (`pair()`), new `POST /screens/:id/revoke-credential` (SUPER/DISTRICT/SCHOOL_ADMIN, writes `status='REVOKED'`, audited), screen delete (row gone ⇒ every device path 403s).
* **Readers — every device-authenticated route:** the shared verifier (`device-auth.ts`), the global `DeviceIdentityInterceptor` (all `JwtAuthGuard` routes), and an explicit belt-and-braces check in `getManifest`.
* **Durable token-string mirror:** the unpair path (which presents the token) also calls `mirrorRevokedTokenDurable()`, whose expiry derives from the JWT's own `exp` → **180 days for a device token**, not the 30-day user ceiling.
* **Tests:** `device-credentials.spec.ts`, `device-auth.spec.ts`, `screens.credential-revoke.spec.ts`.

### DT-02 [HIGH] — a stolen token self-renewed into a fresh 365-day token forever
* Renewal now requires the screen to **exist, still be paired, not be REVOKED, and present a current credential epoch** (`verifyPriorToken` in `screens.controller.ts`).
* Lifetime **bounded at 180 d** (`DEVICE_TOKEN_TTL_PAIRED`). Sized deliberately: it must clear a ~100-day school summer shutdown, or the whole fleet needs hand re-pairing every September. Do not shorten below ~120 d.
* **Rotation:** proving possession bumps the epoch and mints against the new one, so two parties cannot both hold the current credential — the fork becomes visible.
* A **stale** epoch is downgraded to a 1-hour token + `requiresRePair`, **not** 401'd: a hard reject would let whoever rotates first deliberately black out a real screen, and a dark screen is the failure mode this product exists to prevent.
* The `fp` claim was **removed** from the payload — it made the token carry its own renewal key (base64-decode, read the fingerprint, POST it back, get a fresh full-lifetime token, repeat). Nothing in the API reads `fp` off a device principal.
* Renewal now writes `SCREEN_TOKEN_RENEWED` / `SCREEN_TOKEN_DOWNGRADED` AuditLog rows — the chain was previously invisible in forensics.
* **Tests:** `screens.register.spec.ts` (P5-1, P5-1b, P5-1c, P5-1d), `device-auth.spec.ts`.

### DT-03 [HIGH] — roleless routes trusted the `tenantId` CLAIM
Fixed at the principal, once, rather than handler-by-handler: **`apps/api/src/security/device-identity.interceptor.ts`**, registered as the first `APP_INTERCEPTOR` in `app.module.ts`. For `kind === 'device'` it re-derives `tenantId` / `screenGroupId` from the live `Screen` row (and clears the alternate `schoolId` / `districtId` keys several handlers read first), and rejects a missing / REVOKED / stale-epoch screen with 401. Strict no-op for every other principal.

This closes the leak on `/emergency/status`, `/notifications`, `/tenants`, `/license/me`, `/branding/me` and any roleless route added later. `/emergency/status` additionally got the per-scope membership filter its sibling `/emergency/messages` already enforced (DT-10 rider).
* **Tests:** `device-identity.interceptor.spec.ts`, `emergency.device-scope.spec.ts`.

### DT-04 [HIGH] — fingerprint-only re-registration minted a full-lifetime token
* Legacy `STRICT_REPAIR_AUTH=false` branch **deleted**; strict is unconditional.
* `GET /screens` strips `deviceFingerprint` and `pairingCode` for any role below SCHOOL_ADMIN.
* **Tests:** `screens.register.spec.ts` P5-5 (asserts the branch is dead with the flag on, off, and unset), `screens.credential-revoke.spec.ts`.

### DT-05 [MEDIUM] — `verifyDeviceForScreen` skipped checks on 9 routes
Three byte-similar copies (`screens.controller.ts`, `gpio.controller.ts`, `player-logs.controller.ts`) collapsed into one: **`apps/api/src/screens/device-auth.ts`**. It enforces, in order: HS256-only signature (explicit `algorithms` allowlist — DT-12 rider) → `kind` → `sub` → revocation list (**fail closed**) → live row exists → not REVOKED → epoch current → identity returned **from the live row**.

Performance: the live-row read is memoised per screen for 5 s and invalidated explicitly by every revocation writer, so `/game-state` (16 Hz/screen) does not become 16 DB round trips on a `connection_limit=10` pool. Revocation on the acting replica is immediate; worst case elsewhere is one 5 s window.

### DT-06 [MEDIUM] — a device token could fabricate a LOCKDOWN via `/gpio-event`
Two additions, and **the real GPIO feature is preserved**:
1. The route now uses the shared verifier, so an operator revoking a compromised screen genuinely cuts it off the emergency path (`allowUnpaired: false`).
2. A **physical-plausibility gate**: a screen whose `hardwareModel` resolves to a known SKU with `caps.gpioIn === 0` (browser player, TV box, Taurus) has no dry contact to close, so its event is logged but cannot raise an emergency. **Fails OPEN on an unknown/undetected model** — `hardwareModel` is auto-detected and null on plenty of legitimate screens, and refusing those would take a real wall station offline. Refusal reuses the service's existing "no wiring on this pin → log only" branch, so it is still audited.
* **Tests:** `gpio.device-auth.spec.ts`.

### DT-07 [MEDIUM] — cross-tenant USB-ingest audit forgery
`screenId` is now bound to the caller: a device principal must have `sub === screenId`; a roled user must be SUPER_ADMIN or in the screen's tenant; anything else is refused. Tenant is still derived from the screen row.
Deliberately **not** done: making the HMAC `signature` mandatory. The shipped Android client does not send it, so that would break the live USB-ingest audit trail. Noted as follow-up.
* **Tests:** `usb-ingest-authz.spec.ts`.

### DT-08 [MEDIUM] — device tokens in URL query strings — ⚠️ **PARTIAL, see below**
`apps/api/src/screens/stream-ticket.ts` + `POST /screens/:id/stream-ticket`
(device-authenticated, throttled, CSRF-exempt with the Bearer-header rationale)
mint a **60-second, single-scope, epoch-bound HMAC ticket**, exactly as
specified — a short-lived stream ticket from an authenticated POST, not the
long-lived device JWT.
* **Tests:** `stream-ticket.spec.ts` (round-trip, expiry, tamper on screenId / epoch / expiry, nonce uniqueness, junk).

### OTA-01 [HIGH] — unauthenticated `/player/update-check` cancelled a pending push
`persistReportedVersion` clears `forceApkUpdatePendingAt` **only for a
device-authenticated caller**. An anonymous install claim is refused, logged
`[ota][security]`, and written to AuditLog as `OTA_UNAUTHENTICATED_INSTALL_CLAIM`
(the audit noted the cancellation left no forensic record at all).

The real fleet loses nothing: after a genuine install the kiosk reports the new
`versionName`, `semverGte` returns `uptoDate`, so there is **no re-download
loop** — the flag merely lingers until the existing 24 h stale sweep clears it.
Version telemetry stays unauthenticated so the fleet-version chip does not go
blind. `OTA_REQUIRE_DEVICE_AUTH=true` turns the whole route into a hard gate
once a token-sending player build is fleet-wide.
* **Tests:** `update-check-authz.spec.ts`.

### OTA-02 [MEDIUM] — canary auto-promotion's health gate
`evaluateCanaryPromotion()` (pure, unit-tested) replaces the one-line
`find(s => s.lastOtaState === 'ERROR')`:
* **Minimum cohort** — an empty cohort no longer promotes to a 100% rollout on zero evidence (`CANARY_MIN_COHORT`, default 1; deliberately not higher, or small K-12 tenants strand in canary forever).
* **Success requirement** — at least one cohort screen must show a confirmed install during the soak. `playerVersionAt` was previously selected and never read.
* **Outlier rejection** — an *authenticated* error always halts; anonymous errors must exceed a cohort rate (`CANARY_MAX_ERROR_RATE`, default 20%), so one forged ERROR can no longer hold a tenant's patch pipeline closed forever.
* **Non-erasable failure signal** — new sticky `lastOtaErrorAt` / `lastOtaErrorMessage` / `lastOtaErrorAuthenticated`. No non-ERROR state report can clear them, which closes the *self*-erase (the player reports `CHECKING` at the head of every OTA cycle) as well as the deliberate one. Cleared only by a confirmed install or an operator re-push.
* **Tests:** `canary-promotion.spec.ts`, `screens.ota-state-sticky.spec.ts`.

### OTA-03 [MEDIUM] — the false "SHA closes the asset-swap hole" claim
**The comment is fixed** — it now states plainly that hashing the same URL the
server is about to advertise proves transport integrity and *not* provenance,
and that the debug keystore committed to a public repo is the actual hole and is
not fixable from that file.

**The code is fixed as far as it is reachable:** `PLAYER_RELEASE_SHA_PINS` (+ a
`PLAYER_APK_SHA_PINS` env hook for incident-time recall) records the expected
digest **out-of-band**, and `evaluateReleaseForFleet()` fails closed on a
mismatch. An unpinned version still ships but the log line says
`provenance=UNPINNED-transport-integrity-only` rather than claiming a safeguard.
Signing-certificate verification server-side (parsing the APK v2 signing block)
was considered and **not** implemented — see "Not done" below.
* **Tests:** `release-policy.spec.ts` (incl. an explicit swapped-asset-cannot-satisfy-a-pin case).

### OTA-04 [MEDIUM] — advertised APK URL never validated
`isAllowedApkUrl()`: `https:` only, no embedded credentials, host must match a
built-in GitHub release-asset allowlist (exact or dot-boundary suffix, so
`github.com.evil.example` is refused) or `PLAYER_APK_HOST_ALLOWLIST`. Applied to
the Player path, the Manager path, and the `PLAYER_APK_URL` `/apk/latest`
passthrough (which 302'd to the env value verbatim).

### OTA-05 [MEDIUM] — no anti-rollback floor, quarantine, or kill switch
`MIN_SUPPORTED_PLAYER_VERSION` (anti-rollback floor) and
`QUARANTINED_PLAYER_VERSIONS` + `PLAYER_APK_QUARANTINE` (per-build kill switch,
build-specific unlike `canaryFleetPercent=0` which disables all OTA for a
tenant). Both are **committed code with a subtractive env hook**, deliberately:
the 2026-05-15 env-var version pinning was removed because a stale value
silently pinned the fleet to an old build *twice*. These fail the other way —
they can only ever refuse to advertise a build, never force an old one, and a
refusal is loud.

---

## Not done / still open — stated plainly

1. **DT-08 is NOT closed in production.** The ticket minting and verification
   are complete and tested, but the **consuming** side is one `if` in
   `apps/api/src/realtime/sse.controller.ts` (try `?ticket=` before falling back
   to the `?token=` device JWT), and `apps/api/src/realtime/**` is outside this
   change's ownership boundary. Until that hook lands, SSE still accepts
   `?token=` and the device credential still travels in the URL. `verifyStreamTicket()`
   is import-ready; the caller must additionally compare the returned
   `credentialEpoch` against the live `Screen` row.
2. **DT-03's guard-level fix is not applied.** The root cause is
   `apps/api/src/auth/jwt-auth.guard.ts:132-138` populating `tenantId` from the
   claim; `apps/api/src/auth/**` is fenced off. The global interceptor
   *functionally* covers every guard-protected route, but the guard itself still
   writes the stale value one step earlier. Anyone who later adds a guard-level
   consumer that runs *before* interceptors would reopen it.
3. **`RedisService` has no public `sadd`**, so a revoked device token is not
   added to the hot `jwt_revoked_list` set — only to the durable Postgres
   mirror, which `sismember` consults on the Redis-down path. This is
   belt-and-braces only; the load-bearing control is `Screen.credentialEpoch`.
   Completing it is a one-line helper in `realtime/redis.service.ts`.
4. **OTA-03 certificate pinning was evaluated and rejected for this pass.**
   Verifying the APK's v2 signing certificate server-side means parsing the ZIP
   central directory and the APK Signing Block — a meaningful amount of new
   binary-parsing code on a fleet-critical path, and it still would not fix the
   underlying problem (CI signs with a debug keystore committed to a public
   repo, so a "valid" signature proves nothing). The out-of-band digest pin
   gives most of the benefit for none of the risk. **Release-signing with a
   non-public key remains the real fix and is not addressed here.**
5. **DT-07's HMAC signature is still optional**, as noted above.
6. **`/player/update-check` and `/screens/status/:fp/ota-state` remain
   anonymous** for the read/telemetry paths. Closing that needs an APK that
   sends its device token; `OTA_REQUIRE_DEVICE_AUTH` is the switch waiting for it.
7. **Not in scope, not fixed:** DT-09 (`/notifications/read-all` reachable by a
   device), DT-10 beyond the `/emergency/status` scope filter, DT-11 (geocode
   cost abuse), OTA-06 (`auto-update-player` writes no AuditLog), OTA-07
   (X-Forwarded-For-keyed throttles), OTA-08 (no canary leader election across
   replicas). Also unexamined: `GET /screens/status/:fp` returns a `pairingCode`
   for an arbitrary fingerprint — it is load-bearing for the pairing splash, so
   it needs a design decision, not a patch.

---

## Files

**New:** `screens/device-auth.ts`, `screens/device-credentials.ts`,
`screens/stream-ticket.ts`, `security/device-identity.interceptor.ts`,
`player-ota/release-policy.ts`, migration
`20260803090000_device_credential_revocation`, + 10 spec files.

**Modified:** `screens/screens.controller.ts`, `screens/gpio.controller.ts`,
`screens/manifest-hot-cache.ts`, `player-logs/player-logs.controller.ts`,
`player-ota/player-ota.controller.ts`, `player-ota/canary-auto-promote.ts`,
`emergency/emergency.controller.ts`, `tenants/tenants.controller.ts`,
`security/csrf.middleware.ts`, `app.module.ts`,
`packages/database/prisma/schema.prisma`, `screens/screens.register.spec.ts`.

## New env vars (all optional, all safe unset)

| Var | Effect when unset |
|---|---|
| `OTA_REQUIRE_DEVICE_AUTH` | update-check stays anonymous (current fleet behaviour) |
| `PLAYER_APK_HOST_ALLOWLIST` | built-in GitHub hosts only |
| `PLAYER_APK_QUARANTINE` | no extra quarantined versions |
| `PLAYER_APK_SHA_PINS` | committed pins only |
| `CANARY_MIN_COHORT` | 1 (cohort must merely be non-empty) |
| `CANARY_MAX_ERROR_RATE` | 0.2 |

`STRICT_REPAIR_AUTH` is now **ignored** and can be deleted from Railway.
