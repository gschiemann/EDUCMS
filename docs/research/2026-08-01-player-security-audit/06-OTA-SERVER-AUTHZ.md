> **Provenance:** single Opus agent under the audit ground rules (read-only, evidence-with-file:line,
> two-methods-for-absence, self-refutation before reporting).
> **Lead review status: NOT independently re-verified.**

# OTA Server-Side Authorization Audit — 2026-08-02

**Scope:** server-side authorization for the Player/Manager over-the-air update pipeline — who can publish, target, gate, promote, and roll back a build. Read exhaustively: `apps/api/src/player-ota/*` (all 6 files), `apps/api/src/auth/{rbac.guard.ts,roles.decorator.ts,guards.ts,jwt-auth.guard.ts}`, every OTA-adjacent route in `screens.controller.ts` / `tenants.controller.ts` / `screen-groups.controller.ts`, `security/csrf.middleware.ts`, `security/client-ip-throttler.guard.ts`, `security/client-ip.ts`, `app.module.ts` guard wiring, `packages/database/prisma/schema.prisma` OTA columns, and `.github/workflows/android-player-apk.yml`.

**Out of scope (being fixed separately, factored in but not re-litigated):** device-side OTA host pinning; the `debuggable=true` + public committed debug keystore; the origin-unchecked JS bridge; CONTRIBUTOR template editing.

**Repo state:** worktree `worktree-agent-ad14c55bb9466c488` at `91607468`. All paths absolute-rooted at `/Users/gschiemann/Desktop/EDU CMS/`.

---

## 1. Posture + rationale

**Posture: MODERATE on authorization, WEAK on integrity, WEAK on the anonymous write plane.**

The single most important structural fact about this surface is that **there is no "publish" endpoint in the API at all.** Build publication happens entirely outside the application: a `player-v*` git tag triggers `.github/workflows/android-player-apk.yml`, which attaches an APK to a GitHub Release, and `resolveLatestReleaseInfo()` (`apps/api/src/player-ota/player-ota.controller.ts:1115-1207`) discovers it by polling the public GitHub Releases API. The API's OTA authz surface is therefore *targeting and gating* only — "which of my screens may install whatever the vendor last tagged, and when."

That is a genuinely good design for tenant-facing authz: **no tenant user of any role can choose which bytes land on a screen.** The role check on every control endpoint is real, wired, and tenant-scoped (verified below). TEN-001 is clean on this surface.

The weakness is on the two axes the design does *not* cover:

1. **The anonymous device-facing plane is a write plane.** `POST /api/v1/player/update-check` and `POST /api/v1/screens/status/:fp/ota-state` take **no authentication of any kind** — not even the device JWT the kiosk already holds — are CSRF-exempt, are rate-limited on a client-settable header, write no AuditLog, and between them control (a) whether an operator's pending APK push survives and (b) the sole health signal that gates automatic canary promotion. An unauthenticated attacker who knows one device fingerprint owns that screen's patch pipeline; a `RESTRICTED_VIEWER` can read every fingerprint in the tenant from `GET /api/v1/screen-groups`.

2. **There is no provenance or recall.** The server's SHA-256 "pinning" is computed by fetching the very URL it is about to advertise (`player-ota.controller.ts:1326-1347`), so it proves transport integrity and nothing else — the in-code claim that it "closes the release asset swap attack vector" (line 1290-1293) is false. There is no anti-rollback floor, no version allowlist/denylist, no quarantine, and no per-build kill switch — verified absent by two independent methods. The only version authority in the entire system is "the highest-sorting non-draft `player-v*` tag currently visible on GitHub."

Nothing here rises to CRITICAL on its own: I could not find any path by which a non-repo-writer causes arbitrary bytes to be advertised to the fleet. But OTA-01 and OTA-02 together mean **an unauthenticated attacker can hold the fleet's remediation channel closed** — which is exactly the channel that would be used to ship the fix for the already-confirmed debuggable-APK/token-theft CRITICALs.

---

## 2. "Can anyone but SUPER_ADMIN get code onto the fleet?"

**Plainly: no — nobody, including SUPER_ADMIN, can get *chosen* code onto the fleet through the API. But a SCHOOL_ADMIN can force the vendor's latest build onto every screen in their tenant, and an unauthenticated attacker can stop any build from landing.**

Broken down:

| Question | Answer | Evidence |
|---|---|---|
| Is there an API endpoint that publishes/uploads/pins a build? | **No.** Publication is a git tag → GitHub Release. The API only *discovers*. | Full read of `player-ota.controller.ts`; only routes are update-check ×2, latest-version ×2, apk redirect ×3. `PLAYER_APK_LATEST_VERSION_CODE`/`PLAYER_APK_URL` version pinning was deliberately removed 2026-05-15 (lines 20-28, 408-418). |
| Can a DISTRICT_ADMIN or SCHOOL_ADMIN push a build? | **Yes — the latest vendor build, to their own tenant only.** `POST /screens/force-update` (tenant-wide) and `POST /screens/:id/force-update`. They cannot select *which* build. | `screens.controller.ts:2296-2298`, `2335-2337` |
| Can they enable unattended auto-install of every future build? | **Yes, SCHOOL_ADMIN and up**, per tenant, with **no AuditLog** (OTA-06). | `tenants.controller.ts:739-747` |
| Can they set the canary percent / soak / auto-promote flag? | **Yes, SCHOOL_ADMIN and up**, own tenant only, audited. | `tenants.controller.ts:871-941` |
| Can a CONTRIBUTOR do any of the above? | **No.** No OTA control endpoint lists `CONTRIBUTOR`. Verified by reading every `@RequireRoles` on the surface. | `screens.controller.ts:2298,2337`; `tenants.controller.ts:740,773,872` |
| Can a CONTRIBUTOR / RESTRICTED_VIEWER read every device fingerprint in the tenant? | **Yes** — and that is the key that unlocks the anonymous write plane (OTA-01/02). | `screen-groups.controller.ts:37` (`@RequireRoles(..., CONTRIBUTOR)`) + `:65` (`deviceFingerprint: true`); `RESTRICTED_VIEWER` reaches it via the GET-passthrough in `rbac.guard.ts:89-97` |
| Can a device token reach any OTA control endpoint? | **No.** `JwtAuthGuard` accepts device JWTs but builds a `req.user` with **no `role`** (`jwt-auth.guard.ts:128-138`), so `RbacGuard` rejects at `jwt-auth.guard`→`rbac.guard.ts:94-108`. | Verified by reading both guards end to end |
| Can a tenant API key escalate into OTA control? | **Only to the role it was minted with**; `SUPER_ADMIN` is explicitly excluded from the mint whitelist. Minting is `SUPER_ADMIN`/`DISTRICT_ADMIN` only. | `api-keys.service.ts:37-42`; `api-keys.controller.ts:19` |
| Can an unauthenticated caller stop a build from landing? | **Yes — indefinitely.** See OTA-01. | `player-ota.controller.ts:71-135` |

---

## 3. Endpoint table

Guards are as *actually wired* — `PlayerOtaController` has **no class-level `@UseGuards`** (verified by full-file read), and the only global `APP_GUARD` in `app.module.ts:254-255` is `ClientIpThrottlerGuard`. There is **no global auth guard**, so an undecorated route is fully anonymous.

| Route | Guard actually running | Min role | Device-token reachable? | Tenant-scoped? | AuditLog? |
|---|---|---|---|---|---|
| `POST /api/v1/player/update-check` | **none** (`@Throttle` 120/60s only) | **anonymous** | yes (token not required or checked) | **no** — global `deviceFingerprint` lookup + `updateMany` | **no** |
| `POST /api/v1/player/manager-update-check` | **none** (`@Throttle` 120/60s) | **anonymous** | yes | **no** — global `updateMany` by fingerprint | **no** |
| `GET /api/v1/player/latest-version` | `JwtAuthGuard`+`RbacGuard` | SCHOOL_ADMIN | **no** (device `req.user` has no `role`) | n/a (global release info) | no |
| `GET /api/v1/player/latest-version-public` | **none** (`@Throttle` 30/60s) | **anonymous** | yes | n/a | no |
| `GET /api/v1/player/apk/latest` | **none** (`@Throttle` 30/60s) | **anonymous** | yes | n/a | no |
| `GET /api/v1/player/apk/v/:vc` | **none** (`@Throttle` 60/60s) | **anonymous** | yes | n/a | no |
| `GET /api/v1/player/manager-apk/latest` | **none** (`@Throttle` 30/60s) | **anonymous** | yes | n/a | no |
| `POST /api/v1/screens/status/:fp/ota-state` | **none** (`@Throttle` 30/60s) | **anonymous** | yes | **no** — global fingerprint lookup | **no** |
| `GET /api/v1/screens/status/:fp` | **none** | **anonymous** | yes | **no** | no |
| `POST /api/v1/screens/force-update` | `JwtAuthGuard`+`RbacGuard` | SCHOOL_ADMIN | no | **yes** (`updateMany where tenantId`) | **yes** `FORCE_APK_UPDATE` |
| `POST /api/v1/screens/:id/force-update` | `JwtAuthGuard`+`RbacGuard` | SCHOOL_ADMIN | no | **yes** (tenant-scoped `findFirst` before bare-id update) | **yes** `FORCE_APK_UPDATE` |
| `GET/PUT /api/v1/tenants/me/auto-update-player` | `JwtAuthGuard`+`RbacGuard` (class-level) | SCHOOL_ADMIN | no | **yes** (`req.user.tenantId`) | **NO** ← OTA-06 |
| `GET/PUT /api/v1/tenants/me/ota-window` | `JwtAuthGuard`+`RbacGuard` | SCHOOL_ADMIN | no | **yes** | **yes** `OTA_WINDOW_UPDATED` |
| `GET/PUT /api/v1/tenants/me/canary-rollout` | `JwtAuthGuard`+`RbacGuard` | SCHOOL_ADMIN | no | **yes** | **yes** `CANARY_ROLLOUT_UPDATED` |
| `GET /api/v1/screen-groups` (leaks `deviceFingerprint`) | `JwtAuthGuard`+`RbacGuard` | **CONTRIBUTOR** (+ RESTRICTED_VIEWER via GET passthrough) | no | yes | no |
| `CanaryAutoPromote.tick()` (internal 5-min timer) | n/a — background service | **system** | n/a | per-tenant loop | **yes** `CANARY_AUTO_PROMOTED` |

Every anonymous POST above is explicitly CSRF-exempt: `security/csrf.middleware.ts:48` (`/player/update-check`), `:54` (`/player/manager-update-check`), `:63` (`/screens/status/*/ota-state`). Those exemptions are correct in isolation (native Kotlin `HttpURLConnection` has no cookie jar) — the problem is that *nothing else* was put in their place.

---

## 4. Canary auto-promote: the exact quorum math, and whether it can be gamed

### The math, stated exactly

`apps/api/src/player-ota/canary-auto-promote.ts:60-173`, every 5 minutes (`:47-49`):

1. **Candidate set:** all tenants where `canaryFleetPercent < 100 AND canarySetAt IS NOT NULL` (`:67-82`).
2. **Soak gate:** skip unless `Date.now() − canarySetAt ≥ max(1, canarySoakHours) × 3600000`. Default `canarySoakHours = 24` (`schema.prisma:150`). (`:87-91`)
3. **Human gate:** skip if `canaryAutoPromote === false`. **Default is `true`** (`schema.prisma:149`) — so **there is no human gate unless the operator opts into one.** (`:93-100`)
4. **Cohort membership:** load *all* screens of the tenant, keep those where `isInCanaryCohort(screen.id, canaryFleetPercent)` — FNV-1a 32-bit of the screen UUID, `% 100`, `< percent` (`canary-cohort.ts:29-51`).
5. **Health quorum:** `canaryScreens.find(s => s.lastOtaState === 'ERROR' && (!s.lastOtaAt || s.lastOtaAt >= canarySetAt))`. **If that finds ANY ONE screen, promotion halts. If it finds none, promotion proceeds.** (`:118-134`)
6. **Promote:** `canaryFleetPercent = 100`, `canarySetAt = null`, `AuditLog('CANARY_AUTO_PROMOTED')` (`:137-159`).

So the quorum is: **`errors_in_cohort == 0` → promote to 100% of the tenant fleet.** Not a ratio, not a threshold, not a percentage of successes.

**There is no minimum cohort size.** `canaryScreens.length` is only ever used as a *log/audit detail* (`:154`, `:162`); it is never compared to anything. If the cohort is empty — small percent with no screen hashing below it, a tenant whose screens were all deleted, or a tenant with zero screens — `find()` returns `undefined` and the tenant **auto-promotes to full rollout on zero health evidence.**

**There is no outlier rejection.** One `ERROR` halts everything; zero `ERROR`s promote everything. Nothing in between exists.

**There is no success requirement.** The gate never checks that any cohort screen actually *installed* — no `playerVersionCode` comparison, no `INSTALLED` count. `playerVersionAt` is selected (`:112`) and then never read.

### Can it be gamed?

**Registering N phantom screens does NOT work — refuted.** I checked this specifically because the brief asked. `POST /api/v1/screens/register` is anonymous (`screens.controller.ts:232`), but it creates a `Screen` with **no `tenantId`** (`:523-537` — the create block has no tenant field; `status: 'PENDING'`). A screen only acquires a `tenantId` when an admin claims its pairing code. The cohort query is `screen.findMany({ where: { tenantId: t.id } })` (`canary-auto-promote.ts:106-114`), so phantom rows are invisible to it. There is additionally a 120/min/IP throttle plus a 15-minute per-fingerprint cooldown for unpaired fingerprints (`screens.controller.ts:231`, `:280-293`). **Phantom-screen ballot-stuffing is not a viable path.**

**Overwriting the health signal DOES work.** `lastOtaState` is a single last-writer-wins column written by `POST /api/v1/screens/status/:deviceFingerprint/ota-state` — **no authentication, no device token, CSRF-exempt** (`screens.controller.ts:752-841`; `csrf.middleware.ts:63`). Given one fingerprint an attacker gets both directions:

- **Halt forever:** one `{"state":"ERROR"}` POST against any cohort screen sets `lastOtaState='ERROR'` with a fresh `lastOtaAt`, permanently blocking that tenant's auto-promotion (the code only logs a warning and skips, every 5 minutes, forever). Patch rollout to the tenant stops.
- **Erase the halt:** a `{"state":"CHECKING"}` POST overwrites a genuine `ERROR`, clearing the gate so a failing build auto-promotes to 100%.

**And the erase direction happens *without* an attacker.** The player's own worker calls `reportOtaState(..., "CHECKING", ...)` as the **first action of every OTA cycle** (`apps/player/app/src/main/java/com/educms/player/ota/OtaUpdateWorker.kt:144`). Once the 24-hour force-push window lapses (`player-ota.controller.ts:196`, `:317-327`) the server returns `uptoDate`, the worker reports `CHECKING` and exits without ever reaching an `ERROR` branch — so the last state recorded before the (also-24-hour, by default) soak expires is `CHECKING`, and the gate sees a clean cohort. The `lastOtaAt >= canarySetAt` freshness condition (`:123-124`) sharpens this: it *deliberately discards* errors older than the canary stamp.

**Net:** the ERROR gate is a best-effort reliability signal, not a control. It is anonymously writable in both directions, it self-erases on the device's own next poll, it has no minimum cohort, and by default there is no human in the loop.

---

## 5. Findings

### [HIGH] OTA-01 — Unauthenticated `/player/update-check` silently cancels an operator's pending APK push (indefinite patch denial)

**Files:** `apps/api/src/player-ota/player-ota.controller.ts:71-135`, `:137-141`, `:241`, `:329`, `:375-381`

**Attacker:** anyone who knows one device fingerprint. Sources, easiest first: (a) any tenant user down to `RESTRICTED_VIEWER` — `GET /api/v1/screen-groups` returns `deviceFingerprint` for every screen in the tenant (`screen-groups.controller.ts:37` allows `CONTRIBUTOR`, `:65` selects the field; `rbac.guard.ts:89-97` lets `RESTRICTED_VIEWER` through any GET whose role list contains `CONTRIBUTOR`); (b) anyone with 60 seconds of adb on a single kiosk — the fingerprint is `android-<ANDROID_ID>` (`MainActivity.kt:1401-1415`, `manager/OtaWorker.kt:277`), readable via `adb shell settings get secure android_id` or `run-as` (already-established precondition); (c) the fingerprint is passed to the WebView as a `?fp=` URL parameter (`MainActivity.kt:1420`).

**Concrete steps:**
1. Operator clicks "Push APK update" → `screens.controller.ts:2368-2376` sets `forceApkUpdatePendingAt = now()`.
2. Attacker POSTs, with no credentials at all:
   `POST /api/v1/player/update-check` `{"fingerprint":"android-<id>","versionName":"9.9.9","versionCode":<prior+1>}`
3. `persistReportedVersion` reads the prior row (`:99-102`), computes
   `installed = !!(prior && prior.forceApkUpdatePendingAt && vc > prior.playerVersionCode)` (`:103-106`) → **true**,
   and the `updateMany` at `:107-124` writes `forceApkUpdatePendingAt: null, forceApkUpdateOverrideWindow: false`.
4. The real kiosk's next poll takes the `else` branch at `:328-330` (`allowReason = 'no-force-flag'`) and returns `{uptoDate:true}` (`:375-381`).
5. Attacker loops. The flag only re-arms on a fresh operator click; nothing in the codebase re-sets it automatically.

**What they get:** the targeted screen — or, with the fingerprint list, the whole tenant fleet — can never receive an APK update, while the dashboard's own "push pending" chip clears as if the install succeeded (`screens.controller.ts:712-733` derives `forceUpdatePending` from the same nulled column). This is the exact channel that would ship the fix for the confirmed `debuggable=true` / stolen-device-token CRITICALs.

**Why HIGH and not MEDIUM:** the precondition (one fingerprint) is not hard — it is readable by the lowest-privilege role in the product, and by anyone with brief physical access to any one screen. The blast radius is tenant-fleet-wide, the action is unauthenticated, and there is no forensic record.

**Refutation attempted:** I checked for a class-level `@UseGuards` on `PlayerOtaController` (none — full-file read, decorators are `@Controller('api/v1/player')` only, line 56). I checked for a global auth guard (`app.module.ts:254-255` registers only `ClientIpThrottlerGuard`; no `useGlobalGuards` in `main.ts`). I checked whether the `vc === 0` fast-path blocks it (`:81` — it only skips the *bootstrap* case, `vc > 0` proceeds). I checked whether CSRF would stop it (explicitly exempted, `csrf.middleware.ts:48`). I checked whether the flag re-arms on its own (`screen-wedge-detector.cron.ts:204` uses `forceApkUpdatePendingAt: null` as a *WHERE filter*, not a write; the only writers are the two `force-update` admin routes and the clearing paths). It stands.

---

### [MEDIUM] OTA-02 — Canary auto-promotion's sole health gate is an anonymously-writable, self-erasing column with no minimum cohort

**Files:** `apps/api/src/player-ota/canary-auto-promote.ts:106-135`, `:118-125`, `:154`; `apps/api/src/screens/screens.controller.ts:752-841`; `packages/database/prisma/schema.prisma:147-150`; `apps/player/.../ota/OtaUpdateWorker.kt:144`

Full math in §4. Three defects compound:

1. **Anonymous write.** `POST /screens/status/:fp/ota-state` requires no auth (`screens.controller.ts:752-757`, CSRF-exempt at `csrf.middleware.ts:63`). One request halts a tenant's auto-promotion forever; one request erases a genuine failure.
2. **Self-erasing signal.** The player reports `CHECKING` at the head of every OTA cycle (`OtaUpdateWorker.kt:144`), overwriting `lastOtaState`. With the default 24 h force-window (`player-ota.controller.ts:196`) equal to the default 24 h soak (`schema.prisma:150`), the state at soak-expiry is routinely `CHECKING`, not `ERROR`.
3. **No minimum cohort, no success requirement.** `canaryScreens.length` is logged but never gated on (`canary-auto-promote.ts:154`, `:162`); an empty cohort promotes on zero evidence. `canaryAutoPromote` defaults to `true` (`schema.prisma:149`), so no human is in the loop by default.

**Attacker & payoff:** with one cohort fingerprint, either (a) block the tenant's promotion indefinitely — an availability attack on the patch pipeline that compounds OTA-01, or (b) strip the last automated safety net so a failing build fans out from N% to 100% of the tenant's screens. The attacker cannot *choose* the build, which is why this is MEDIUM rather than HIGH — the control being defeated is a safety gate, not an authorization boundary. Combined with OTA-01 the pair gives an unauthenticated party full control of a tenant's update lifecycle.

**Refutation attempted:** I specifically tried the phantom-screen path the brief asked about and it does not work — see §4 (registration produces `tenantId: null`; the cohort query filters on `tenantId`). I checked whether the `INSTALLED` guard at `screens.controller.ts:815-823` blocks state writes generally (no — it rejects only `INSTALLED`; `CHECKING`, `DOWNLOADING`, `VERIFYING`, `INSTALLING`, `ERROR` all write freely, `:765-771`, `:825-833`). I checked whether the Manager-noise filter (`:796-804`) would block a crafted payload (it only matches messages starting `Manager v`; omit the message and the write lands).

---

### [MEDIUM] OTA-03 — Server-computed SHA-256 provides zero provenance; the in-code claim that it closes the asset-swap hole is false

**Files:** `apps/api/src/player-ota/player-ota.controller.ts:1288-1320` (Manager), `:1322-1347` (Player), consumed at `:486-494` and `:697-704`

`resolveLatestPlayerReleaseSha(apkUrl)` fetches **the same `apkUrl` the server is about to advertise**, hashes the bytes it receives, and returns that hash to the device (`:501-509`). If the release asset is ever swapped, the server obligingly hashes the *new* bytes and advertises a matching digest. The hash therefore proves only that the device downloaded what the server downloaded — it is a transport-integrity check, not a provenance check.

The comment block at `:1288-1293` states this "Closes the 'release asset swap' attack vector flagged by Plan + Server audits as a P0 — without this, the committed debug.keystore + empty SHA … = anyone with `git clone` can sign + serve a malicious update." That is a **false assurance**, and it is exactly the kind of claim that ends up in a district security questionnaire. The committed debug keystore still means anyone can produce an APK that passes Android's signature-continuity check on update; CI still builds `assembleDebug` and attaches it to the Release (`.github/workflows/android-player-apk.yml:44`, `:93`, `:244-261`). The SHA adds nothing against that.

**What would actually close it:** record the expected digest out-of-band at release time (a signed manifest, or a digest committed to the repo/DB by the release script) and compare, rather than deriving the digest from the artifact being verified; plus release-signing with a non-public key.

**Precondition for exploitation:** GitHub Release write on `gschiemann/EDUCMS` (or a compromised `GH_TOKEN`/Actions token). Hence MEDIUM, not HIGH — but note the fail-closed behaviour at `:486-494` is doing real work for a *different* threat and should not be mistaken for this one.

---

### [MEDIUM] OTA-04 — The advertised APK URL is never validated for scheme or host before being handed to the fleet

**Files:** `apps/api/src/player-ota/player-ota.controller.ts:1186`, `:1195-1206`, `:501-509` (Player); `:1272`, `:708-716` (Manager); `:733-737` (`/apk/latest` env passthrough)

`apkUrl` is taken verbatim from the GitHub JSON field `browser_download_url` and returned to the device as `latest.apkUrl` with no check that it is `https:`, and no host allowlist (`github.com` / `objects.githubusercontent.com`). Note the release-list fetch at `:1132-1134` is **anonymous** — no `Authorization` header, unlike `ensureApkInCache` at `:870-875` — so it is the least-authenticated leg of the chain. `GET /apk/latest` additionally 302s to `process.env.PLAYER_APK_URL` verbatim (`:733-737`).

Server-side this is defence-in-depth only: the device-side pin is the primary control and is being fixed separately. But if the upstream JSON is ever influenced — repo rename/transfer, a mis-set `PLAYER_APK_GITHUB_REPO`, an on-path proxy in front of the unauthenticated `api.github.com` call, or a GitHub response-shaping bug — the server will faithfully advertise an arbitrary URL to every kiosk. There is currently no server-side layer that would refuse. The fix is a three-line allowlist next to the existing SHA fail-closed check.

I confirmed there is **no DB-sourced APK URL** anywhere: `grep -ni 'apkurl|apk_url|otaurl|ota_url|updateurl' packages/database/prisma/schema.prisma` returns nothing, and the only `browser_download_url` reads in `apps/api/src` are the four in this controller. No tenant user can influence the URL.

---

### [MEDIUM] OTA-05 — No anti-rollback floor, no quarantine/denylist, no per-build kill switch

**Files:** whole-surface absence — see verification below. Relevant positive code: `player-ota.controller.ts:464-471` (`semverGte` uptoDate check), `:479` (`derivedVc = Math.max(...)`), `:1155-1181` (tag sort)

The only version authority is "the highest-sorting non-draft, non-prerelease `player-v*` tag currently returned by the GitHub Releases API." Consequences:

- **Forced downgrade is possible via tag, not via API.** Publishing `player-v9.9.9` containing an old vulnerable build downgrades the entire installed base within one poll cycle. `semverGte(callerVn, info.versionName)` at `:464` compares *tag names*, never the actual APK contents; nothing establishes a monotonic floor of known-good builds.
- **No recall.** If a build is discovered to be malicious or broken, there is no operator-reachable mechanism to say "never install `1.0.71`." The only lever is publishing a higher tag and hoping every screen polls.
- **No per-build kill switch.** `canaryFleetPercent = 0` disables *all* OTA for a tenant (`canary-cohort.ts:48`), which is a blunt all-or-nothing instrument, not a build-specific block.

**Absence verified by two independent methods:** (1) `grep -ni 'canary|otaWindow|autoUpdatePlayer|forceApkUpdate|lastOta|playerVersion|pinnedVersion|quarantin|rollback' packages/database/prisma/schema.prisma` — the only OTA columns are the 4 canary fields (`:147-150`), 3 window fields (`:130-132`), `autoUpdatePlayerEnabled` (`:110`), and the per-screen state/version columns (`:806-830`); no pin, floor, denylist, or allowlist column exists. (2) `grep -rni 'quarantin|rollback|antiRollback|pinnedApk|pinVersion' apps/api/src --include='*.ts'` — every hit is either the *template* quarantine denylist (a different subsystem) or the Kotlin watchdog's local rollback discussed in `player-ota.spec.ts:75-115`; no OTA server-side control exists.

Rated MEDIUM as a **missing control** rather than an exploitable bug — but it is the amplifier that converts any GitHub-write compromise into a permanent, un-recallable fleet takeover.

---

### [LOW] OTA-06 — `PUT /tenants/me/auto-update-player` writes no AuditLog

**File:** `apps/api/src/tenants/tenants.controller.ts:739-747`

The single most fleet-affecting OTA toggle in the product — flipping it on makes every screen in the tenant install every future build unattended (`player-ota.controller.ts:238-240`, `allowReason='tenant-auto-on'`) — updates the tenant row and returns, with no `auditLog.create`. Every neighbouring OTA policy write audits: `OTA_WINDOW_UPDATED` (`:816-829`), `CANARY_ROLLOUT_UPDATED` (`:919-933`), `FORCE_APK_UPDATE` (`screens.controller.ts:2322-2331`, `:2397-2406`), `CANARY_AUTO_PROMOTED` (`canary-auto-promote.ts:144-159`). A stolen SCHOOL_ADMIN session can arm unattended fleet-wide installs and leave no trace.

**Absence verified two ways:** direct read of the full handler body (`:739-747`, 9 lines, no audit call) and `grep -rn 'AUTO_UPDATE|AUTOUPDATE' apps/api/src --include='*.ts'`, whose only hit is the unrelated error code string `TENANT_AUTO_UPDATE_CONFIG_NOT_FOUND` at `:735`.

---

### [LOW] OTA-07 — Every rate limit protecting the anonymous OTA write plane is keyed on a client-controlled header

**Files:** `apps/api/src/security/client-ip-throttler.guard.ts:60-64`; `apps/api/src/security/client-ip.ts:47-52`

`getTracker()` returns `clientIpFromRequest()`, which takes the **leftmost `X-Forwarded-For` entry verbatim** from the request headers — the source file explicitly acknowledges this is "client-settable … attacker-influenceable" (`client-ip.ts:28-33`). That trade-off was accepted for the login throttle, where Argon2 is the primary control. Here there is **no primary control**: the throttle is the *only* thing standing between an anonymous caller and `POST /update-check` (120/60s) or `POST /ota-state` (30/60s). Rotating the header per request removes the cap entirely, which turns OTA-01 into a trivially-automatable loop and makes each request an unauthenticated `findFirst` + `updateMany` against the `connection_limit=10` pool. The `vc === 0` fast-path (`player-ota.controller.ts:81`) closes the bootstrap DB-spam amplifier but not the `vc > 0` one.

---

### [INFO] OTA-08 — `CanaryAutoPromote` has no leader election across API replicas

**File:** `apps/api/src/player-ota/canary-auto-promote.ts:42-51`

Each replica starts its own 5-minute `setInterval` in `onModuleInit`. The in-process `running` flag (`:61`) guards only against overlap *within* a replica. On a multi-replica Railway deploy, two replicas can promote the same tenant in the same window, producing duplicate `CANARY_AUTO_PROMOTED` audit rows. The `tenant.update` is idempotent (`canaryFleetPercent = 100`), so there is no state corruption — this is a forensic-noise and (marginal) DB-load note, not a vulnerability. Flagged because the CLAUDE.md operational standard calls for Redis coordination when an in-memory scheduler is load-bearing.

---

## 6. What is already strong

Cite these in a district security questionnaire — each is verified at the line given.

- **No API publish path at all.** Environment-variable version pinning (`PLAYER_APK_LATEST_VERSION_CODE` / `PLAYER_APK_URL`) was deliberately removed on 2026-05-15 after twice pinning the fleet to a stale build (`player-ota.controller.ts:20-28`, `:408-418`). There is now no runtime-mutable knob that selects a build — a strictly better security posture than the version it replaced.
- **Device tokens cannot reach any OTA control endpoint.** `JwtAuthGuard` routes `kind:'device'` tokens to `DEVICE_JWT_SECRET` and constructs a `req.user` with **no `role` field** (`jwt-auth.guard.ts:128-138`); `RbacGuard` then denies (`rbac.guard.ts:94-108`). A stolen device token — which the established context says an attacker has — buys **zero** OTA authority.
- **Tenant isolation is clean across this entire surface (TEN-001).** `forceUpdateOne` performs a tenant-scoped `findFirst({ where: { id, tenantId: req.user.tenantId } })` before the bare-id update (`screens.controller.ts:2343-2346`, `:2368`); `forceUpdateAll` is `updateMany({ where: { tenantId } })` (`:2306-2308`); every canary/window/auto-update write keys on `req.user.tenantId` and offers no way to name another tenant (`tenants.controller.ts:707`, `:743`, `:807`, `:909`). I found **no** bare-id write on a tenant-owned model on this surface.
- **Fail-closed SHA gate.** If the digest cannot be computed, the server returns `uptoDate` rather than advertising an unverifiable APK — for both Player (`:486-494`) and Manager (`:697-704`). The reasoning in the comment is sound even though the threat it claims to close is not the one it closes (OTA-03).
- **No auto-downgrade through the normal path.** `semverGte(callerVn, info.versionName)` returns `uptoDate` when the caller is at or past the latest tag (`:464-471`), so deleting the newest release does not roll the fleet back.
- **Update gating defaults to OFF.** `autoUpdatePlayerEnabled` defaults `false` (`schema.prisma:110`) and `canaryFleetPercent` defaults `100`; with no operator action a screen receives *nothing* — every install requires either an explicit tenant opt-in or an explicit per-screen push (`player-ota.controller.ts:143-161`).
- **Install confirmation requires proof.** The force flag is deliberately *not* cleared when a URL is handed out; only a genuine `versionCode` bump clears it (`:386-406`, `:99-130`) — this is the fix for the "16 versions in and OTA never worked" incident and it is the right design. (OTA-01 abuses the proof, it does not remove it.)
- **Stalled-install and stale-flag auto-recovery.** An install stuck at `INSTALLING`/`ERROR` for >10 min clears the flag rather than looping forever (`:259-277`); flags older than 24 h are swept (`:317-327`).
- **Maintenance-window gate with per-push override and safe defaults.** `isInsideMaintenanceWindow` (`:1379-1411`) handles wraparound windows, validates via `Intl`, and defaults to "inside" on malformed config so a bad timezone cannot lock an operator out of pushing. Input is validated server-side (`HH:MM` regex + `Intl` timezone probe, `tenants.controller.ts:785-799`).
- **Canary cohort is deterministic and monotonic.** FNV-1a bucketing means a given screen never *drops out* of the cohort as the percent rises — locked by test (`canary-cohort.spec.ts:53-66`), so widening a rollout never rolls an already-updated screen back.
- **Canary percent/soak inputs are bounds-checked.** `0..100` and `1..720` with explicit 400s (`tenants.controller.ts:883-902`).
- **ABI-correct asset selection with a non-x86 fallback**, preventing an `INSTALL_FAILED_NO_MATCHING_ABIS` brick on armeabi-v7a Rockchip hardware (`:1070-1113`).
- **API keys cannot escalate to platform owner.** `SUPER_ADMIN` is explicitly excluded from the mint whitelist (`api-keys.service.ts:37-42`) and minting itself is `SUPER_ADMIN`/`DISTRICT_ADMIN` only (`api-keys.controller.ts:19`).
- **`/latest-version` was correctly locked down** after finding player-008 — admin roles + throttle, with a deliberately minimal `/latest-version-public` twin that returns version digits only, no `apkUrl` and no SHA (`:516-596`). The reasoning documented there is good security thinking.
- **`/update-check` was hardened against the bootstrap DB-spam amplifier** (`vc === 0` short-circuit, `:76-81`).
- **Registration anti-enumeration.** 120/min/IP throttle plus a 15-minute per-fingerprint cooldown that applies *only* to unpaired/unknown fingerprints, so a legitimate kiosk re-registering after an OTA install is never locked out (`screens.controller.ts:231`, `:271-293`).

---

## 7. Not checked / UNVERIFIED

State these plainly rather than assuming.

1. **GitHub-side authorization.** Who holds `contents: write` on `gschiemann/EDUCMS`, whether tag protection or environment approval gates `player-v*` pushes, whether branch/tag rulesets exist, and the blast radius of `GH_TOKEN` on Railway. This is *the* real publish boundary for this surface and it lives outside the repo. **Unverified — recommend it be the next thing checked.**
2. **Kotlin-side enforcement.** I read `OtaUpdateWorker.kt` only for the `reportOtaState` call sequence (line 144 etc.). Whether the client actually verifies the advertised `sha256` before install, and what it does on mismatch, is **unverified here** — and per the standing note the Kotlin is uncompiled in this tree, so I could not test it. The server-side finding (OTA-03) holds regardless of what the client does.
3. **The `serveLatestArtifactApk` fallback** (`:915-954`) pulls the newest non-expired workflow artifact named `edu-cms-player-apk` via `GH_TOKEN` and serves the bytes. I confirmed the workflow does **not** trigger on `pull_request` (`android-player-apk.yml:11-28` — `push` to master/main + tags, plus `workflow_dispatch`), so a fork PR cannot inject an artifact. I also confirmed this path feeds only `GET /apk/latest` (the human download button), **never** `/update-check`. I did **not** exhaustively verify that no other workflow in `.github/workflows/` publishes an artifact under that name.
4. **`GET /screens/status/:fp` returning `pairingCode` for an arbitrary fingerprint** (`screens.controller.ts:716-720`) looked concerning while tracing fingerprint reach, but it is a device-auth/pairing surface, not OTA. Flagged for whichever agent owns pairing; **not analysed here.**
5. **Live production behaviour.** Everything above is static analysis. No request was issued against the live API, no server was started, no build was run (read-only mandate). I did not confirm which `canaryFleetPercent` / `autoUpdatePlayerEnabled` values real tenants currently hold, so I cannot say how many tenants are presently exposed to OTA-02's promotion path versus sitting at the safe `100` default.
6. **Frontend surface.** I did not audit whether the dashboard exposes the canary/auto-update controls to roles the API would reject, or vice-versa. The API is the boundary and it is correct; UI-side gating is unverified.
7. **`AuditLog` immutability at the storage layer** (DB triggers blocking UPDATE/DELETE) is claimed in CLAUDE.md §16 but was not re-verified as part of this surface.