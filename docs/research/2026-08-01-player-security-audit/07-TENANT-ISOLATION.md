> **Provenance:** single Opus agent under the audit ground rules (read-only, evidence-with-file:line,
> two-methods-for-absence, self-refutation before reporting).
> **Lead review status: NOT independently re-verified.**

# Multi-Tenant Isolation Audit — 2026-08-02

**Scope:** tenant isolation across the whole NestJS API (`apps/api/src`), the district→school hierarchy (`Tenant.parentId`), the TEN-001 static gate and its suppressions, and the archived-tenant soft-delete boundary.
**Method:** read the gate + its baseline + its spec; read `require-tenant.ts`, `rbac.guard.ts`, `jwt-auth.guard.ts`, `jwt.strategy.ts`, `auth.service.ts`, `system-tenant.ts`, `schema.prisma`; wrote two throwaway AST scanners (one for *all* Prisma calls on tenant-owned models with no `tenantId` anywhere in the args — 350 hits, one for a class-level-aware route→guard→roles map of every controller); then hand-read the controllers named in the brief.
**Working tree:** `security/player-fixes-2026-08-01` @ `16be1090`, worktree `agent-ad14c55bb9466c488`. Read-only; nothing written outside the scratchpad.

---

## Posture + rationale

**Isolation here is convention-enforced at the query layer, not framework-enforced.** There is no Prisma middleware, no row-level security, no request-scoped tenant client. Every one of the ~350 tenant-owned Prisma calls in the API is individually responsible for carrying `tenantId` (or for a resolve-then-verify pattern). That is the architecture the TEN-001 gate exists to police.

Given that architecture, the convention is **held remarkably well**. I attempted the classic break-ins and could not land one:

- Every foreign-id binding I traced is pre-validated: `Schedule` → playlist/screen/group (`schedules.controller.ts:81-105`), `PlaylistItem` → asset (`playlists.controller.ts:276-287`), `Playlist` → template incl. the `isSystem` carve-out (`playlists.controller.ts:200-214`), `Tenant.panic*PlaylistId` (`tenants.controller.ts:617-632`), `/emergency/trigger` `overridePayload.playlistId` (`emergency.controller.ts:380-390`), bulk-trigger playlist across *every* targeted screen's tenant (`screen-emergency.controller.ts:546-560`), `TemplateZone.sceneId` (`templates.controller.ts:2468-2485`), floor-plan screen placement (`floor-plans.controller.ts:641-647`), group screen assignment (`screen-groups.controller.ts:268-271`).
- **There are zero Prisma nested `connect` / `connectOrCreate` / `set` writes in the entire API.** Verified two ways: a grep for `connect:|connectOrCreate|set: [` over `apps/api/src` returned only unrelated prose/route-string hits, and my AST scan of every `create`/`update`/`upsert` argument found no relation-object writes. That structurally eliminates the whole "attach their asset to my playlist via nested write" class.
- The emergency subsystem — the highest-severity surface — is the *best*-isolated code in the repo (see "What is already strong").

What I did find is a **second-order class the gate is blind to and the codebase has drifted on: identity-claim freshness and guard coverage on the non-role routes.** Device JWTs live 365 days, carry a `tenantId` claim, are never revoked when a screen leaves a tenant, and are accepted on a handful of routes that trust that claim instead of re-resolving from the live `Screen` row — even though a sibling endpoint in the same file documents exactly that risk and does re-resolve.

## Can one district reach another district's screens or emergency state?

**No — not through any authenticated operator path I could find.** A DISTRICT_ADMIN, SCHOOL_ADMIN, CONTRIBUTOR or RESTRICTED_VIEWER of district A cannot read, trigger, or clear district B's screens, playlists, assets, users, or emergency state. `resolveScopeTenant` (`emergency.controller.ts:267-319`) resolves the owning tenant from the *scope object itself* and 403s on mismatch for every emergency write; the manifest 404s cross-tenant (`screens.controller.ts:2661-2675`); every list endpoint I read is `where: { tenantId }`.

**Two narrower "yes"es, both conditional:**

1. A **stale device token** from a screen that has since moved tenants still reads its *former* tenant's live emergency messages via `GET /api/v1/emergency/status` (TEN-01). It cannot *trigger* or *clear* anything.
2. **Archiving** a tenant does not revoke anything — an archived district's users can still log in and operate it, and its screens still serve (TEN-03). Archived tenants are hidden from the switcher/fleet/lists, so this residual access is invisible to the operator who "retired" the location.

Neither is fleet takeover and neither can fake or suppress an alert on another district's glass.

---

## Findings

### [MEDIUM] TEN-01 — A device JWT's `tenantId` claim is trusted verbatim on `/emergency/status` (and 5 sibling routes), and device tokens are never revoked when a screen leaves a tenant

**Where**
- `apps/api/src/screens/screens.controller.ts:344-359` — `mintDeviceJwt` puts `tenantId` in the payload; `expiresIn` is **`365d`** when paired (line 350).
- `apps/api/src/auth/jwt-auth.guard.ts:128-138` — device branch populates `request.user = { id, sub, kind:'device', tenantId: payload.tenantId, fp }` straight from the claim.
- `apps/api/src/auth/jwt-auth.guard.ts:113` — the per-user mass-revocation epoch check is explicitly **skipped** for device tokens (`if (unverifiedKind !== 'device' && …)`). The single-token `jwt_revoked_list` check (line 100) does apply, but nothing ever adds a device token to it.
- `apps/api/src/screens/screens.controller.ts:1389-1418` — device-initiated unpair clears `tenantId`, deletes schedules, mints a new pairing code — and **does not revoke the outstanding device JWT**. Same for the re-pair path at `1261-1315` (it publishes `TENANT_CHANGED` on the *old* tenant's Redis channel, which is a best-effort client-side wipe, not server-side revocation).
- `apps/api/src/emergency/emergency.controller.ts:1203-1218` — `@Get('status')` has **no `@RequireRoles`**, so `RbacGuard` short-circuits at `rbac.guard.ts:27-29` and a device token reaches it. Line 1216: `const callerTenantId = req.user?.schoolId || req.user?.tenantId || req.user?.districtId` — the **claim**.
- Contrast `apps/api/src/emergency/emergency.controller.ts:1290-1326` — the device-only `/messages` twin deliberately resolves tenant from the **live `Screen` row**, with a comment naming this exact threat: *"A screen re-paired to another tenant carries a stale claim until its 365-day token rotates; reading the live row prevents a cross-tenant leak through an old token."* `/status` is the un-hardened twin of a route whose hardening rationale is already written down.

**Same stale-claim pattern, same reachability (no `@RequireRoles`, guard passes device tokens):**
`POST /api/v1/analytics/touch-events` (`analytics.controller.ts:119` `const tenantId = user.tenantId` → `touchEvent.createMany` at :178 — cross-tenant analytics **write**); `GET/POST /api/v1/notifications/*` (`notifications.controller.ts:22,33,38`); `GET /api/v1/branding/me` (`branding.controller.ts:530`); `GET /api/v1/license/me|current` (`license.controller.ts:13,22`); `GET /api/v1/tenants` (`tenants.controller.ts:519-521`, returns the tenant's panic playlist ids + `requireContentApproval`).

**Attack.** The attacker holds one Android player. Per established context they extract the app's private data with `adb shell run-as` and recover the 365-day device JWT. Later the screen legitimately leaves district A — it is unpaired and re-sold, RMA'd, or transferred to another district; this is a normal lifecycle event the product explicitly supports (`POST /screens/unpair/:deviceFingerprint`, then `POST /screens/pair` under the new tenant). The captured token keeps verifying. `curl -H "Authorization: Bearer <old device jwt>" https://api/api/v1/emergency/status` returns district A's active `EmergencyMessage` rows for up to 365 days. `EmergencyMessage.textBlob` for an SOS is built at `emergency.controller.ts:879-881` as `SOS from <staff email> — <physical location>` — so the attacker gets a live feed of who pressed panic, where in the building, and the incident severity, for a district they no longer belong to.

**Second, weaker leg (no tenant change required):** `/status` also has no per-scope filter, so a *current* device token receives `EmergencyMessage` rows scoped `device:<otherScreenId>` — the Sprint-8b per-room messages. `/messages` filters these (`emergency.controller.ts:1331-1344`); `/status` does not. Same-tenant, low value, but it confirms `/status` was never brought up to the device-safe contract.

**Refutation attempts.** I checked whether device tokens are blocked from `/status` by RBAC (no — `@RequireRoles` is absent and `RbacGuard` returns `true` before it even inspects `user`). I checked whether unpair or re-pair revokes the token (grepped `revokedCredential`/`jwt_revoked_list` writers in `realtime/redis.service.ts:283-421` — all are user-token paths; no caller passes a device token). I checked whether the token expiry is short (it is 365d). I checked whether `TENANT_CHANGED` is a server-side revocation (it is a Redis publish consumed by the client; a token already exfiltrated is unaffected).

**Why MEDIUM and not HIGH.** It is genuine cross-tenant data access of life-safety content, which the anchor puts at HIGH — but it sits behind two compounding preconditions (token capture *before* the move, plus an actual tenant change). Without the tenant change it degrades to a same-tenant scope leak. The fix is small and already written elsewhere in the same file: make `/status` (and the analytics/notifications/branding/license/tenants routes) resolve `tenantId` from the live `Screen` row when `req.user.kind === 'device'`, exactly as `/messages` does, and add the device token to `jwt_revoked_list` in the unpair and cross-tenant re-pair transactions.

---

### [MEDIUM] TEN-02 — `NotificationsController` has no `RbacGuard`; a device token can read and mark-read the tenant's entire admin notification feed, including emergency and infrastructure alerts

**Where**
- `apps/api/src/notifications/notifications.controller.ts:8-9` — `@Controller('api/v1/notifications')` `@UseGuards(JwtAuthGuard)`. **`RbacGuard` is absent from the class**, and none of the three routes carries `@RequireRoles`.
- `notifications.controller.ts:22,33,38` — all three call `requireTenantIdStrict(req)`, which (`auth/require-tenant.ts:35-39`) only rejects a token with **no** `tenantId`. A paired device JWT **has** a `tenantId` claim (`screens.controller.ts:357`), so it passes.
- `apps/api/src/notifications/notifications.service.ts:126-135` — `markAllRead(tenantId, userId)` does `updateMany({ where: { tenantId, isRead: false, OR: [{ userId }, { userId: null }] }, data: { isRead: true } })`.
- `notifications.service.ts:88-98` — `listForUser` uses the same `OR: [{userId}, {userId: null}]`.
- `notifications.service.ts:4-18` — the `userId: null` (tenant-wide) rows are exactly `SCREEN_OFFLINE`, `SYNC_FAILED`, **`EMERGENCY_TRIGGERED`**, `INVITE_ACCEPTED`, `INFO`, **`INFRA_EVENT`** (the >50%-of-fleet-dropped WAN-cut signal).

**Attack.** Attacker recovers one screen's device JWT (established: `run-as` on the debuggable prod APK). `GET /api/v1/notifications` → the district's full operator notification feed: which screens are down, which emergencies fired, WAN-outage events, invite-accepted names. Then `POST /api/v1/notifications/read-all` → every tenant-wide notification flips `isRead: true` in one call. The dashboard's unread badge clears for **every admin in the tenant**; a real `EMERGENCY_TRIGGERED` or `INFRA_EVENT` notice arrives already-read. Repeat on a timer and the district's notification pager is permanently silent. This does not suppress the alert *on the screens* (the manifest/WS path is independent), but it defeats the operator-facing detection channel — and it is a device credential mutating an admin surface, which no part of the design intends. Combined with TEN-01's stale claim it becomes cross-tenant.

**Refutation attempts.** I checked whether `RbacGuard` is applied globally (it is not — `app.module.ts:253-256` registers only `ClientIpThrottlerGuard` as `APP_GUARD`). I checked whether `requireTenantIdStrict` filters device tokens (it does not — it filters *tenant-less* tokens, which is the 2026-07-25 bug it was written for; the doc comment on `require-tenant.ts:8-13` names notifications as the destructive case, so the intent was there but the check is one notch too loose). I checked whether `markRead`/`markAllRead` are scoped to the caller's own rows (they are not — `userId: null` rows are shared by design).

---

### [MEDIUM] TEN-03 — `Tenant.archivedAt` is a UI filter, not an access boundary: archived tenants' users can still log in, their screens still serve, and a DISTRICT_ADMIN can still switch into an archived child

**Where — `archivedAt` is checked in exactly 6 read queries and nowhere else** (enumerated via grep over `apps/api/src`, cross-checked against the AST scan):
`playlist-distribution.service.ts:92`, `super-license.controller.ts:56`, `tenants.controller.ts:33,49,82`, `screens.controller.ts:1147`, `pos/menu-admin.service.ts:151,169`.

**Where it is absent:**
- `apps/api/src/auth/auth.controller.ts:38-68` → `apps/api/src/auth/auth.service.ts:133-193` — login resolves the tenant (`auth.service.ts:157-160`) purely to read `slug`/`vertical`/`name`. **No `archivedAt` check.** A user of an archived tenant authenticates normally and receives a 30-day JWT scoped to it.
- `apps/api/src/tenants/tenants.controller.ts:203-231` — `POST /tenants/switch` looks the target up with `findUnique({ where: { id: targetId } })` and authorises on `target.id === districtId || target.parentId === districtId`. **No `archivedAt` filter**, so a DISTRICT_ADMIN can mint a fresh JWT scoped to an archived child that the switcher (line 49) deliberately hides.
- `apps/api/src/screens/screens.controller.ts:2622-2675` — the manifest never consults `archivedAt`; an archived tenant's screens keep pulling content and emergency state.
- `emergency.controller.ts:267-319` — `resolveScopeTenant` never consults `archivedAt`; an archived tenant can still be put into lockdown.

**Attack / operator harm.** The product presents archiving as *the* supported retire path — `tenants.controller.ts:438-442` tells the operator "Location archiving is the supported path" when a hard delete is FK-blocked, and `tenants.controller.ts:449-455` documents it as the retire/cleanup mechanism. Per the repo's own history, 120 test/demo tenants were archived in the 2026-07-23 cleanup. An administrator who closes a school, ends a pilot, or offboards a customer and archives the location reasonably believes access ended. It did not: every account in that tenant still logs in, still reads assets/playlists/users/audit, and still triggers emergencies on any screens that remain paired — and because the location is filtered out of the switcher, `/tenants/children`, and `/screens/fleet`, the surviving access is **invisible in the UI that would otherwise surface it**. That invisibility is what makes this more than a naming quibble.

**Refutation attempt.** I considered that archive may be intentionally cosmetic. The code comments support "hide from lists" as the design goal, and I found no doc claiming archive revokes access — so this is a gap between an operator's reasonable expectation and the implementation rather than a violated invariant. That is why it is MEDIUM, not HIGH. The minimal correct fix is a check in `auth.service.login` and in `switchTenant`; whether archived screens should keep playing is a product call (arguably yes, so a re-activated location comes back intact).

---

### [LOW] TEN-04 — Unauthenticated cross-tenant `Screen` writes keyed on `deviceFingerprint`, including cancelling a pending forced APK update

**Where**
- `apps/api/src/player-ota/player-ota.controller.ts:56-57` — `@Controller('api/v1/player')` with **no class-level `@UseGuards`**; `POST update-check` (:137) and `POST manager-update-check` (:650) declare none either. Confirmed by the AST route map (they appear in the `NOAUTH` set) and by reading the decorators.
- `player-ota.controller.ts:107-124` — `screen.updateMany({ where: { deviceFingerprint: fp }, data: { playerVersion, playerVersionCode, playerVersionAt, ...(installed ? { forceApkUpdatePendingAt: null, forceApkUpdateOverrideWindow: false } : {}) } })`, where `fp` is `body.fingerprint` (line 72) and `installed` is true whenever the reported `versionCode` exceeds the stored one (lines 103-106).
- `player-ota.controller.ts:661-671` — same shape for `managerVersion`.

**Attack.** Anonymous POST with a known foreign `fingerprint` and a large `versionCode` writes a false player version onto another tenant's screen row and clears `forceApkUpdatePendingAt` — i.e. cancels an admin's "Push update" on that screen. In a fleet being patched (say, to remediate the debuggable-APK issue), that silently pins the target screen on the vulnerable build while the dashboard shows the new version number.

**Why LOW.** `Screen.deviceFingerprint` is `@unique` (`schema.prisma:685`) so `updateMany` touches at most one row, and the fingerprint is `Settings.Secure.ANDROID_ID` (~64 bits) for APK players or `device-<Date.now()>-<8×base36>` for browser players (`apps/web/src/app/player/page.tsx:1318-1358`). At the 120/min throttle that is not enumerable, and I found no endpoint that discloses another tenant's fingerprint. Real bug, hard precondition.

---

### [LOW] TEN-05 — `POST /tenants/me/usb-ingest/screens/:screenId/event` lets any authenticated principal write a `UsbIngestEvent` row into another tenant

**Where** `apps/api/src/tenants/tenants.controller.ts:1016-1089`. The class carries `@UseGuards(JwtAuthGuard, RbacGuard)` (:13) but this route has **no `@RequireRoles`**, so any token — a device JWT from a *different* tenant, or any low-privilege user — passes. `tenantId` is correctly derived from the `Screen` row (:1038-1043, :1077), which closes the *body*-supplied-tenantId IDOR the 2026 fix targeted — but there is **no check that the caller owns `screenId`**. The HMAC at :1052-1068 is verified **only when `body.signature` is present**, so an attacker simply omits it.

**Attack.** Given a foreign screen UUID and a target tenant with `usbIngestEnabled`, an attacker writes arbitrary `UsbIngestEvent` rows (deviceSerial, bundleVersion, outcome, reason) attributed to the victim tenant — forensic pollution of the USB-sneakernet trail surfaced at `GET /tenants/me/usb-ingest/events`. Rate-limited 6/min/IP. LOW because it needs a foreign UUID and a tenant with the feature on.

---

### [LOW] TEN-06 — `POST /notifications/help` is unauthenticated and injects attacker-controlled text into any tenant's operator notification feed

`apps/api/src/notifications/notifications.controller.ts:53-94`. No guard (confirmed in the AST `NOAUTH` set). `tenantId` is correctly resolved from `screenId` — but that means an attacker with a foreign screen UUID posts a 120-char `title` plus a 500-char `body` (:82-83) straight into the victim district's admin pager, throttled 10/min. A plausible phishing/social-engineering primitive ("Security alert — call IT at 555-…"). LOW: needs a foreign UUID, and the content is plain text with no link control beyond a hardcoded `/screens`.

---

### [LOW] TEN-07 — 403-vs-404 discrepancies confirm the existence of foreign object ids

- `apps/api/src/templates/templates.controller.ts:1042` returns 404 `TEMPLATE_NOT_FOUND` for an id that does not exist, while `:1046-1047` returns **403 `TEMPLATE_NOT_OWNER` ("Not your template")** for an id owned by another tenant. Reachable from `POST/PUT/DELETE /templates/:id/scenes*` via `assertOwnedTemplate`.
- `apps/api/src/playlists/playlist-distribution.service.ts:109` throws 404 "One or more screens not found" *before* the ownership check at `:110-112` throws 403 "not in your locations" — so the two error strings distinguish "no such screen" from "someone else's screen".

Object ids are v4 UUIDs, so this is an oracle without an enumeration path. Worth noting because the codebase elsewhere is deliberate about this — the manifest (`screens.controller.ts:2672`) and `templates.controller.ts:859-862` both comment that they return 404 rather than 403 specifically to avoid the existence leak. These two are inconsistent with that house rule.

---

### [INFO] TEN-08 — `RbacGuard`'s tenancy-scope block is dead code

`apps/api/src/auth/rbac.guard.ts:115-141` validates `params/query/body.districtId` and `.schoolId` against `typedUser.districtId` / `typedUser.schoolId`. Verified two independent ways that this never fires:

1. **The claims are never signed.** `auth.service.ts:162-168` signs `{ sub, email, tenantId, role, canTriggerPanic }` and `tenants.controller.ts:241-247` (switch) signs the same set — neither includes `districtId` or `schoolId`. `jwt-auth.guard.ts:159-160` therefore sets `districtId: undefined` and `schoolId: payload.schoolId || payload.tenantId` (i.e. `schoolId === tenantId`).
2. **No route carries those params.** `grep -rn "Param('districtId')\|Param('schoolId')\|:districtId\|:schoolId" apps/api/src` (excluding specs/comments) returns **zero** matches — `[schoolId]` is a Next.js *frontend* URL segment only.

It fails closed (an unexpected `body.districtId` produces a 403), so this is not exploitable. It matters because it is a **safeguard that looks load-bearing and is not** — the thing actually isolating tenants is the per-query `tenantId` convention plus `requireTenantId`. `sso.controller.ts:257-258` already documents this gap in passing. A future engineer reading `RbacGuard` could reasonably conclude the framework validates tenancy and skip a `where: { tenantId }`.

### [INFO] TEN-09 — `GET /screens/sync-trim-suggestions` cross-tenant aggregate: suppression is justified, one caveat

`apps/api/src/screens/screens.controller.ts:1089-1119`, `// ten-ok: intentional CROSS-TENANT numeric aggregate`. The raw SQL returns only `(hardware_model, median_trim_ms, sample_count)` with `HAVING count(*) >= 3` — no tenant ids, no screen ids, no names. I confirmed by reading the query that no attributable column is projected. **Verdict: justified.** Caveat: the `hardware_model` grouping key is device-reported and therefore attacker-writable, so a tenant with 3+ screens can inject a synthetic model string or skew a real model's median (poisoning a *suggested* trim value, which an operator can override). No cross-tenant read. Accept as-is; not worth a change.

---

## Audit of the TEN-001 gate

**What it is.** `apps/api/tools/check-tenant-isolation.cjs` (267 lines), run by `.github/workflows/tenant-isolation.yml`, unit-tested by `apps/api/src/security/tenant-isolation-gate.spec.ts`. Current live numbers (I ran it):

```
Tenant-isolation scan: 53 tenant-owned models, 180 unscoped bare-id access(es),
                       27 reviewed-safe (ten-ok) in apps/api/src.
OK: no new unscoped tenant-resource access (baseline ratchets down only).
```

Baseline `count: 180` matches `tenant-isolation-baseline.json:3` — consistent, not drifted. (Down from 214 per the 2026-07-20 burn-down.) Note 28 `ten-ok` comments exist in non-spec source but the gate counts 27; the 28th is `screens.controller.ts:1093`, which annotates a `$queryRaw` the gate does not inspect at all.

### What it catches

A call `<expr>.<tenantOwnedModel>.(findUnique|findFirst|update|delete|upsert)({ where: { id: … } })` where the top-level `where` has an `id` key and no key matching `/tenant/i`. Model set is derived live from `schema.prisma` (`tenantOwnedAccessors`, lines 71-84) with a parser-drift tripwire (`<10 models → exit 2`, line 194-197). Fingerprints are line-independent (path + model.method + hash of the `where` text, line 137-143), so refactors don't spuriously fail. Crashed analyzer exits 2, never 0. All of that is good engineering.

### What it structurally cannot catch

1. **Child models with no `tenantId` column.** The accessor set is derived from `/\btenantId\b/` in the model body, so 14 models are invisible: `Tenant, PasswordResetToken, Passkey, ProcessedStripeEvent, EmailLog, PlaylistItem, TemplateZone, TemplateScene, FloorZone, ProcessedPosEvent, MenuSyncCursor, GameEvent, SponsorImpression, RevokedCredential`. **Six of those are tenant-owned transitively** — `PlaylistItem`, `TemplateZone`, `TemplateScene`, `FloorZone`, `GameEvent`, `SponsorImpression`. `prisma.playlistItem.delete({ where: { id: itemId } })` is a pure IDOR and the gate would never see it. *(I hand-audited every access to those six — see "already strong" #4 — and they are all correctly guarded today. The gate is not why.)*
2. **Any `where` without a literal `id` key.** `whereIsUnscopedById` (line 101-118) requires `hasId`. So `schedule.deleteMany({ where: { playlistId: id } })`, `screen.updateMany({ where: { deviceFingerprint: fp } })` (TEN-04 above), `screenEmergencyOverride.findUnique({ where: { screenId } })`, `tenantApiKey.findUnique({ where: { prefix } })` are all invisible.
3. **Bulk methods.** `RISKY_METHODS` (line 66) omits `findMany`, `count`, `aggregate`, `groupBy`, `createMany`, `updateMany`, `deleteMany`, `create`. That is the entire response-side-leak class (`findMany` with a missing `where`) and the bulk-mutation class. My broader scan found **350** calls on tenant-owned models with no `tenantId` anywhere in the arguments — 180 of which the gate sees; the other ~170 it does not.
4. **A `where` built in a variable.** `findMany({ where })` where `where` is assembled earlier defeats the AST test entirely — e.g. `audit.controller.ts:90`, `submissions.controller.ts:192`, `assets.controller.ts:537`, `screen-emergency.controller.ts:540`. All four are correctly scoped, but by luck of review, not by the gate.
5. **`$queryRaw` / `$executeRaw`.** Not inspected. `screens.controller.ts:1099-1111` is a genuine cross-tenant raw query.
6. **Route-level authz.** Out of scope by design, but worth stating plainly: the gate says nothing about a missing `@UseGuards`, a missing `@RequireRoles`, or a claim being stale — which is where every finding in this report actually lives.
7. **Stale baseline entries are only detected in aggregate.** A fingerprint that no longer exists stays in the JSON silently; only a *new* fingerprint fails. Not a security hole, but the file will bit-rot.

### Review of the riskiest suppressions

27 annotated sites. I read every one in context. Bucket verdicts:

| Sites | Location | Verdict |
|---|---|---|
| 11 | `auth/mfa.controller.ts:147,171,198,246,304,341,361,392,432,482,572` | **Justified.** Spot-read `:138-152` (`/status`) and `:452-497` (`/challenge`): every lookup is `where: { id: reqUser.id }` from the verified JWT, or `payload.sub` from a signature-verified, purpose-checked MFA challenge token (`:470-486`). The id *is* the principal; there is no narrower scope. |
| 4 | `emergency/emergency.controller.ts:281,291,335,343` | **Justified.** `:282-303` reads only `{ tenantId }` and the caller-ownership 403 fires at `:312-316` before any mutation. `:336,:344` are the read-path audit-tenant resolver, which per `:327-331` grants nothing. |
| 1 | `emergency/emergency.controller.ts:1129` | **Justified.** `:1130` reads the message; `:1137-1143` 403s on tenant mismatch; the subsequent write at `:1151-1152` is re-scoped by `{ id, tenantId: existing.tenantId }` — belt *and* braces. |
| 1 | `emergency/emergency.controller.ts:1314` | **Justified — and it is the right pattern.** Device self-lookup by `u.sub` (HMAC-signed screenId), used precisely to defeat the stale-claim problem. This is the fix TEN-01 asks for, applied here and nowhere else. |
| 1 | `emergency/screen-emergency.controller.ts:207` | **Justified.** Reached only when `requireTenantId` returned `null`, which `:185-191` proves happens only for SUPER_ADMIN. There is also a defence-in-depth re-check at `:216-221`. |
| 2 | `users/users.controller.ts:380,411` | **Justified.** `:381-388` resolve-then-403; the write at `:412` follows it inside the same handler. |
| 2 | `users/users.controller.ts:121,175` | **Justified.** `/users/me` self-lookup/self-update. |
| 1 | `tenants/tenants.controller.ts:234` | **Justified.** Self-lookup of `req.user.userId` while building its own switch payload; the *target*-tenant authorisation happens above at `:216-231`. |
| 1 | `tenants/tenants.controller.ts:1037` | **The annotation is accurate about the tenant resolver but silent about the missing caller check — see TEN-05.** The `ten-ok` reason ("the screen row IS the tenant resolver") is true and closes the body-supplied-tenantId IDOR; it does not, and does not claim to, establish that the caller owns the screen. This is the one suppression where the annotation gives more comfort than the code earns. |
| 1 | `screens/screens.controller.ts:1093` | **Justified** (TEN-08 above), though the gate never counted it. |
| 1 | `templates/templates.controller.ts:841` | **Justified.** `:842-853` scope via `OR: [{tenantId: scopeTenantId}, {isSystem:true}]`, and the tenant-less branch is restricted to `[{isSystem:true}]` only — the comment at `:845-849` documents the 2026-07-25 fix of exactly the wider version. |
| 2 | `templates/ensure-system-presets.ts:724,732` | **Justified.** Boot-time reconciliation of `tenantId = NULL` system presets. |

**Bottom line on the gate: no suppression is hiding a bug outright.** One (`tenants.controller.ts:1037`) sits next to a real, separate authorization gap that the annotation's scope does not cover — which is the failure mode worth watching, because a reviewer scanning `ten-ok` lines would read "verified directly below" and move on.

**Recommended gate hardening, in value order:** (1) add the six transitively-owned child models to the accessor set with an "owner-relation must appear in `where` or `include`" rule; (2) add `deleteMany`/`updateMany` and flag a `where` with **no** tenant-ish key at all, not just one carrying `id`; (3) add a companion check for `findMany` with a variable `where` that reports rather than fails, to force a human read.

---

## What is already strong

Worth quoting verbatim in a district security questionnaire.

1. **Emergency write path — single, provable access gate.** `emergency.controller.ts:267-319` `resolveScopeTenant` resolves the owning tenant from the scope object (`tenant` id, `ScreenGroup.tenantId`, or `Screen.tenantId`), 400s on an unknown `scopeType` (never guesses), 404s on a missing scope, and 403s on tenant mismatch — before any mutation or Redis publish. It is called by `/trigger` (:373), `/all-clear` (:668), `/broadcast` (:966), `/media-alert` (:1049); `/messages/:id/all-clear` uses the equivalent inline resolve-then-403 (:1130-1143); `/sos` (:855) uses the caller's own tenant only.
2. **Cross-tenant playlist injection into an emergency is closed at three independent points.** `tenants.controller.ts:617-632` (panic settings), `emergency.controller.ts:380-390` (`/trigger` override), `screen-emergency.controller.ts:546-566` (bulk-trigger validates the playlist against **every** targeted screen's tenant, so even a SUPER_ADMIN multi-tenant lasso cannot cross content over). Emergency media URLs go through `assertAllowedEmergencyMediaUrl` (`:369`, `:862`).
3. **Device-token stale-claim defence exists and is documented — where it was applied.** `emergency.controller.ts:1290-1326` (`/messages`), `templates.controller.ts:812-865` (`/:id/playback`), `assets.controller.ts:1349-1386` (`/:id/playback`) all resolve tenant from the live `Screen` row keyed on the HMAC-signed `sub`, reject `status === 'REVOKED'`, and restrict a tenant-less caller to system presets. `/messages` additionally filters to the scopes the device actually belongs to (`:1331-1344`).
4. **The gate's biggest blind spot is nonetheless clean in practice.** Every access to the six tenant-less child models is guarded by a hand-written relation check: `panic-content.controller.ts:263-272` loads `playlistItem` with `include: { playlist: { select: { tenantId … } } }` and 404s unless `item.playlist.tenantId === req.user.tenantId` **and** the protected-kind matches; `templates.controller.ts:933,992,1009,2476` scope every `templateScene` by `templateId` after `assertOwnedTemplate`; `branding.controller.ts:841` updates only zones reachable from a `tenantId`-scoped template (`:760-763`); `assets.controller.ts:1214-1237` and `playlists.controller.ts:291` key on an already-verified parent.
5. **Ownership checks are paired with re-scoped writes** in the privilege-sensitive paths — `users.controller.ts:294-297` (`updateMany({ where: { id, tenantId } })` and a `count !== 1` abort) and `emergency.controller.ts:1151-1152` both deliberately use `updateMany` with a compound predicate rather than `update({ where: { id } })`, specifically to survive a re-parent race. That is more rigour than the gate asks for.
6. **`requireTenantId` / `requireTenantIdStrict`** (`auth/require-tenant.ts`) codify the Prisma `undefined`-drops-the-filter trap with an explicit, correct write-up, and return `null` only for SUPER_ADMIN. `screen-emergency.controller.ts:185-191` reimplements the same contract locally with the same semantics.
7. **Hierarchy authority is asymmetric and read-only where it crosses.** `GET /screens/fleet` (`screens.controller.ts:1131-1163`) is `SUPER_ADMIN|DISTRICT_ADMIN`, reads **direct children only**, is `Cache-Control: no-store`, and never mutates. Fleet publishing (`playlist-distribution.service.ts`) does not write into a child cross-tenant — it **copies** the playlist and its assets down into the child's own library (`:226-277`) so the child ends up scheduling its *own* rows, working with the cross-tenant guard rather than around it (:14-18), and it refuses custom (tenant-scoped) templates outright (:82-87) precisely so nothing dangles cross-tenant.
8. **Manifest tenant-scoping is explicit and 404s rather than 403s** to avoid the existence leak (`screens.controller.ts:2654-2675`), with three enumerated caller classes and a device-token `sub === screen.id` binding.
9. **Zero nested Prisma relation writes** in the API (verified two ways), eliminating the `connect`-based cross-tenant attachment class entirely.
10. **Owner-only surfaces are class-gated, not route-gated.** `super-license.controller.ts:24-26` and `efficiency.controller.ts:25-27` carry `@RequireRoles(AppRole.SUPER_ADMIN)` at the class level, so the genuinely fleet-wide operations — including `POST /super/storage/wipe-all-assets`, which does `playlistItem.deleteMany({})` + `asset.deleteMany({})` across every tenant (`:406-413`) — cannot be reached by a tenant admin. That endpoint additionally requires `{ confirm: 'YES_WIPE_ALL_ASSETS' }` and writes a pre-wipe audit row.
11. **Pairing cannot steal a screen.** `screens.controller.ts:1239-1241` refuses to pair a screen already owned by another tenant; the claim runs in a `SERIALIZABLE` transaction with seat enforcement (`:1261-1294`); a cross-tenant re-pair publishes `TENANT_CHANGED` to the *previous* tenant so the device wipes its local emergency cache (`:1303-1315`); device-initiated unpair requires a device JWT bound to that exact screen (`:1369-1372`).
12. **Hierarchy has no depth over-reach.** `districtId = me.parentId ?? me.id` (`tenants.controller.ts:46,80,140,226,380`) resolves at most one level up, so in a hypothetical 3-level tree a leaf reaches its parent and siblings but **not** its grandparent. No off-by-one that widens scope. Note the consequence, which is intentional per the comment at `:220-221` but easy to under-appreciate: **a DISTRICT_ADMIN provisioned on a single child school holds authority over the parent district and every sibling school** — including `POST /tenants/switch` into them and `POST /tenants/children` to create new ones. There is no such thing as a school-scoped DISTRICT_ADMIN. That is a provisioning hazard rather than a code defect, and worth stating in the RBAC docs.
13. **The system sentinel tenant** (`security/system-tenant.ts`) is a well-reasoned solution to the "no natural tenant" audit-attribution problem: a fixed nil UUID with a distinct slug, created idempotently, that owns nothing operationally — so credential-stuffing recon lands in the durable trail without corrupting a real tenant's audit history.

---

## Not checked / UNVERIFIED

- **Runtime confirmation.** Every finding is source-derived. I did not start the API, mint tokens, or issue a single HTTP request — instructions were strictly read-only. TEN-01 and TEN-02 in particular deserve a live two-token repro before remediation is signed off.
- **Database layer.** I did not inspect Postgres RLS policies, grants, or the audit-immutability triggers referenced by `audit-immutability.spec.ts`. If RLS exists it could independently backstop some of the ~170 bulk calls the gate cannot see; I have **no evidence either way** and did not assume any.
- **`apps/api/src/sports/**` in depth.** 79 of the 180 baseline entries live in `sports.service.ts` / `sports-stats.service.ts` / `sponsors.service.ts` (`game.*`, `rosterPlayer.*`, `team.*`, `sportsPerson.*`, `customCue.*`). I read the public `sports-board.controller.ts` surface (feed endpoints are HMAC-token-gated with a per-game revocable `feedTokenVersion`; `POST /:id/cts-cue-fired` is deliberately unauthenticated with a documented rationale and a 40/10s cap) but did **not** trace the service-layer ownership checks behind the ~79 baseline sites. **Cross-tenant isolation in the sports domain is UNVERIFIED.** It is the single largest unreviewed concentration in the baseline and the obvious next target.
- **`pos/**` multi-location menus.** `menu.service.ts:140-167` scopes catalogs by a `catalogWhere` built upstream and joins `menuLocationOverride` on `locationTenantId`; `pos.service.ts:629,669` sweep `posProviderConnection` by `providerId` with no tenant filter. Franchise parent→location menu scoping is **UNVERIFIED** — it needs the same treatment as sports.
- **`ads/`, `streaming/`, `imports/`, `data-source/`, `feeds/`, `stats/`, `player-logs/`, `floor-plans/` (upload path), `webhooks/`, `billing/`** — covered only by the automated scans plus the route/guard map, not by line-by-line reading. Nothing anomalous surfaced, but absence of a finding here is **not** a clean bill of health.
- **Concurrent churn.** `apps/web/src/components/widgets`, `apps/web/next.config.ts`, `apps/api/src/proxy`, `apps/api/src/templates`, `apps/api/src/playlists` were being edited by other agents. Line numbers cited in `templates.controller.ts` and `playlists.controller.ts` are accurate as of my read but may drift.
- **`RevokedCredential` semantics under Redis outage.** I read `redis.service.ts:227-421` enough to confirm device tokens are never added to the revocation set; I did not verify the Postgres-mirror fallback's correctness or its 30s cache window.
- **Frontend.** No `apps/web` authorization review — the API is the trust boundary and that is where I looked.