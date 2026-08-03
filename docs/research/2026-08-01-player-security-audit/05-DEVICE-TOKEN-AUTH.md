> **Provenance:** single Opus agent under the audit ground rules (read-only, evidence-with-file:line,
> two-methods-for-absence, self-refutation before reporting).
> **Lead review status: NOT independently re-verified.**

# Device Token Auth Audit — 2026-08-02

**Scope:** the device-token (`kind:'device'`) authentication surface of the VenueOS API and player, audited on branch `security/player-fixes-2026-08-01` @ worktree `agent-ad14c55bb9466c488`. Strictly read-only pass (Read + `grep`/`find`/`sed` via Bash; no writes, no builds, no server).

**Threat model as given (not re-litigated):** the production APK ships `android:debuggable="true"` and is signed with a keystore committed to a public repo, so `adb shell run-as com.educms.player.debug` yields the app's private data with no root. **Assume the attacker holds a valid, unexpired device token for at least one screen.** This report answers exactly one question: *what does that buy them?*

---

## 1. Posture

### **WEAK**

Rationale, split by the two halves of the problem:

**The authorization half is genuinely good** — better than the rest of this codebase led me to expect. Of the 23 routes a device token can reach, 15 re-derive `screenId` from the token's own `sub` claim (`verifyDeviceForScreen`, `screens.controller.ts:88-119`) and refuse a path param that points anywhere else. The three highest-value data routes (`/emergency/messages`, WS `HELLO`, SSE) deliberately ignore the JWT's `tenantId` claim and re-read the live `Screen` row instead. The TEN-001 `where:{tenantId: undefined}` class that the 2026-07-25 audit found on `/templates/:id/playback`, `/assets/:id/playback` and `/notifications` is **fixed and verified fixed** (`require-tenant.ts`, `templates.controller.ts:816-849`, `assets.controller.ts:1353-1361`). A device token cannot trigger a tenant-wide emergency, cannot clear one, cannot push an OTA, cannot change screen config/pairing/group membership, and cannot inject anything into the signed Redis broadcast bus.

**The credential-lifecycle half is broken.** There is **no revocation path for device tokens — none, in any layer**. `Screen.status = 'REVOKED'` is read in eight places and **written in zero** (verified two ways, §7). `jwt_revoked_list` has exactly one writer — user logout — and carries a 30-day Redis TTL (`auth.controller.ts:182`) that is shorter than the 365-day tokens it would need to hold. Deleting the screen row is the only real kill switch, and it destroys the screen's schedules and history. Worse, the token is **self-renewing**: it embeds its own `fp` claim, so presenting it to `POST /screens/register` mints a fresh 365-day token, forever, defeating expiry entirely. And several roleless routes trust the 365-day `tenantId` *claim* rather than the live row, so a decommissioned screen's token keeps reading its old tenant's live emergency traffic.

Net: a token pulled off one dumpstered screen is, in practice, a **permanent, unrevocable, self-renewing credential** — scoped tightly, but permanent.

---

## 2. What a stolen device token actually buys an attacker

Concretely, holding one screen's device token (screen `S`, tenant `T`):

**Permanent access.** The token lives 365 days (`screens.controller.ts:350`). Before it expires, `POST /api/v1/screens/register` with `{deviceFingerprint: <the token's own fp claim>, priorDeviceToken: <the token>}` returns a **brand-new 365-day token** (`:391-409`, `:454`). The `fp` claim is in the JWT payload — base64, no secret needed to read it. Repeat annually; the credential never dies. Nothing an operator can do in the product stops this short of deleting the Screen row.

**Read a real tenant's live emergency traffic — including after the screen is decommissioned.** `GET /api/v1/emergency/status` scopes on `req.user.tenantId`, which for a device is the **JWT claim** (`emergency.controller.ts:1216`), not the live row. It applies no scope filter unless the caller supplies one, so it returns up to 50 active `EmergencyMessage` rows for the whole tenant — every scope, including per-screen (Sprint 8b) messages addressed to *other* screens — plus `Tenant.emergencyStatus` and the active panic playlist id. Unpairing the screen (`tenantId → null`) does not change the claim. Re-pairing the screen to tenant `U` does not change the claim. For up to a year, a screen that was pulled out of a school still reads that school's lockdown message text and media URLs.

**Read tenant operational intelligence.** `GET /api/v1/notifications` (claim-scoped, `notifications.controller.ts:22`) returns the tenant-wide `userId:null` feed — `SCREEN_OFFLINE` rows carrying screen and location names, and `INFRA_EVENT` rows describing building/WAN outages. `GET /api/v1/tenants` returns the tenant's name, address, lat/lng, `emergencyStatus` and all three panic playlist ids. `GET /api/v1/license/me` returns tier and seat usage. `GET /api/v1/branding/me` returns the brand kit.

**Suppress the operator's alarm badge.** `POST /api/v1/notifications/read-all` marks *every* unread tenant-wide notification read for the whole tenant (`notifications.service.ts:150-160`). Looped on a timer, the operator's "screen offline" and "infra event" indicators never light up while the attacker takes screens down.

**Fake a LOCKDOWN or EVACUATE on its own screen.** `POST /api/v1/screens/:id/gpio-event` (`gpio.controller.ts:133-183`) is device-authenticated and, when the screen's `config.wiring` maps `gpio_in1`/`in2` to `panic_button`/`fire_alarm`, synthesizes a real `ScreenEmergencyOverride` row + signed `OVERRIDE` broadcast on `device:<id>` (`gpio.service.ts:296-303`). Scope is that one screen; the precondition is operator-configured GPIO wiring.

**Disown the screen.** `POST /api/v1/screens/unpair/:fp` (`screens.controller.ts:1352-1428`) clears `tenantId` and `screenGroupId`, **deletes every Schedule row for the screen**, and rotates the pairing code. Destructive, self-scoped, throttled 5/min.

**Poison fleet telemetry for its own screen.** `render-proof` (fakes proof-of-display, masking a freeze), `cache-status` (fakes emergency-cache readiness), `game-state` (16 Hz signed `GAME_STATE` on its own device channel), `orientation/device` (rotates the display).

**Forge an audit record against another tenant's screen.** `POST /api/v1/tenants/me/usb-ingest/screens/:screenId/event` takes `screenId` from the **path**, never from the token (`tenants.controller.ts:1032`) — see DT-07.

**What it does NOT buy them:** no tenant- or group-wide emergency; no all-clear / emergency suppression for anyone else; no OTA trigger; no screen rename/config/canvas/location/group change; no other screen's manifest, template, or asset; no cross-tenant template or asset read; no write into the signed WS broadcast bus (the gateway accepts only `HELLO`/`HEARTBEAT`/`ACK`/`TIME_PING`, `realtime.gateway.ts:70-86`); no user, billing, MFA, or API-key surface.

---

## 3. Findings

### [HIGH] DT-01 — Device tokens cannot be revoked at all; `Screen.status='REVOKED'` is never written and `jwt_revoked_list` has no device writer and a 30-day TTL

**Attacker:** anyone holding a device token — the dumpster-diver, the ex-contractor, the `run-as` attacker of the established threat model.

**File:line:**
- `apps/api/src/auth/auth.controller.ts:179-182` — the only writer to `jwt_revoked_list`, on **user logout**, and it re-arms a 30-day TTL on the whole set.
- `apps/api/src/realtime/redis.service.ts:36` — `const REVOKED_MIRROR_TTL_MS = 30 * 24 * 60 * 60 * 1000;` — the durable Postgres mirror expires on the same 30-day clock.
- `apps/api/src/screens/screens.controller.ts:2634` — `if (!screen || screen.status === 'REVOKED') return res.status(403)...` (a read).
- `apps/api/src/screens/screens.controller.ts:2500-2515` — `remove()` deletes the Screen row; it does **not** touch any revocation store.
- `apps/api/src/screens/screens.controller.ts:1389-1418` — device-initiated unpair clears `tenantId`; does **not** revoke the token.

**Evidence quoted** (`auth.controller.ts:179-182`):
```ts
await pub.sadd('jwt_revoked_list', token);
// 30 days = rememberMe ceiling — the JWT itself expires by then, so the
// set never grows unboundedly. Resets each logout (acceptable).
await pub.expire('jwt_revoked_list', 60 * 60 * 24 * 30);
```
The comment's premise ("the JWT itself expires by then") is true for the 30-day user token it was written for and **false for a 365-day device token**. Even if a device-revocation writer existed, the entry would evaporate ~11 months before the token does.

**Attack:**
1. Pull `device_token` from `/data/data/com.educms.player.debug/files/datastore/edu_cms_player.preferences_pb` via `run-as`.
2. Operator notices the screen is missing and clicks whatever "remove screen" affordance exists. There is no "revoke this screen's credential" UI (grep for `revoke` under `apps/web/src/app/[schoolId]/screens` → zero hits).
3. If the operator only **unpairs**, the token still authenticates on 9 `verifyDeviceForScreen` routes and still carries the old `tenantId` claim (see DT-03).
4. If the operator **deletes** the screen, the token is neutralized in practice (every handler re-reads the row and 403/404s) — but at the cost of the screen's schedules and its telemetry history.

**Impact:** there is no proportionate response to a compromised screen. The documented emergency-path safeguards assume a revocation story that does not exist for the device half of the fleet. Combined with DT-02, the credential is effectively permanent.

**Fix (the correct one, not the cheap one):** add a device-credential revocation store keyed on the screen, not on the token string — e.g. a `Screen.credentialEpoch` integer plus an `iat`-vs-epoch check in both `JwtAuthGuard` and `verifyDeviceForScreen`, mirrored into `revoked_credentials` with a TTL derived from the *device* token lifetime (365 d), not the user one. Bump the epoch on unpair, re-pair, delete, and on an explicit operator "Revoke this screen" action; write the `REVOKED` status the manifest already checks. Do **not** solve this by shortening the token to make the problem disappear — kiosks legitimately run offline for days.

**Confidence:** HIGH.
**Verification methods:** (1) targeted grep for `'REVOKED'` across `apps/api/src` — all 8 hits are comparisons/filters, no assignment; (2) repo-wide grep across `apps/api`, `packages/database` (`*.ts`,`*.prisma`,`*.sql`,`*.mjs`) with comparison forms filtered out — only `*.spec.ts` fixtures and the unrelated `REVOKED_KIND_*` constants remain; (3) read `remove()` and `deviceInitiatedUnpair()` in full; (4) read every `sadd`/`mirrorRevokedTokenDurable` call site.

---

### [HIGH] DT-02 — A stolen device token renews itself into a fresh 365-day token indefinitely; expiry is decorative

**Attacker:** holder of any paired screen's device token.

**File:line:** `apps/api/src/screens/screens.controller.ts:344-359` (mint), `:369-386` (`verifyPriorToken`), `:388-424` (graduated-trust branch), `:454` (return).

**Evidence quoted** (`:350-357`):
```ts
const expiresIn = (ttl ?? (isPaired ? '365d' : '15m')) as import('jsonwebtoken').SignOptions['expiresIn'];
const payload: Record<string, unknown> = {
  sub: screenId,
  deviceId: screenId,
  kind: 'device',
  fp: body.deviceFingerprint,
};
```
and (`:369-375`):
```ts
const verifyPriorToken = (screenId: string): 'valid' | 'expired' | 'invalid' | 'absent' => {
  if (!body.priorDeviceToken) return 'absent';
  try {
    const decoded = jwt.verify(body.priorDeviceToken, deviceJwtSecret) as any;
    if (decoded?.kind !== 'device') return 'invalid';
    if (decoded?.sub !== screenId) return 'invalid';
    return 'valid';
```
and (`:408-409`): `if (priorStatus === 'valid') { issuedTtl = '365d'; }`.

**Attack:**
1. Base64-decode the stolen JWT payload (no secret required). It contains `sub` (screenId) and **`fp` (the device fingerprint)** — the mint deliberately embeds the fingerprint at `:355`.
2. `POST /api/v1/screens/register` with `{ deviceFingerprint: <fp>, priorDeviceToken: <stolen token> }`.
3. The handler finds the paired screen by fingerprint, `verifyPriorToken` returns `'valid'` (signature ok, `sub` matches), and it returns a **new 365-day token** at `:454`.
4. Repeat before each expiry. The chain never breaks and no operator action interrupts it (there is no revocation — DT-01).

**Impact:** the 365-day ceiling — the only lifecycle control device tokens have — provides no bound at all. A token exfiltrated once is good for the life of the installation. This is the piece that converts every other finding here from "for a year" to "forever". Note it works **regardless of `STRICT_REPAIR_AUTH`** — that flag only gates the *no-token* path.

**Fix:** bind renewal to the same epoch introduced in DT-01 (a renewal must present a token whose epoch matches the live `Screen.credentialEpoch`), and drop the `fp` claim from the token so the credential does not carry its own renewal key. Renewal should also be audit-logged — today a renewal writes no `AuditLog` row at all, so the chain is invisible in forensics.

**Confidence:** HIGH.
**Verification methods:** (1) read `register()` end-to-end (`:232-546`); (2) traced the `existing.tenantId` branch and the `priorStatus` state machine against `screens.register.spec.ts` (cases P5-2 / P5-5 confirm the TTL matrix); (3) confirmed `fp` is in the signed payload and not merely in the request.

---

### [HIGH] DT-03 — Roleless routes trust the 365-day `tenantId` **claim** instead of the live Screen row, so an unpaired / re-homed / dumpstered screen keeps reading its former tenant's live emergency traffic

**Attacker:** holder of a device token for a screen that has since been unpaired, re-paired to a different tenant, or physically decommissioned.

**File:line:**
- `apps/api/src/auth/jwt-auth.guard.ts:132-138` — the device branch populates `tenantId` **from the JWT payload**:
  ```ts
  request['user'] = {
    id: payload.sub,
    sub: payload.sub,
    kind: 'device',
    tenantId: payload.tenantId,
    fp: payload.fp,
  };
  ```
- `apps/api/src/emergency/emergency.controller.ts:1216` — `const callerTenantId = req.user?.schoolId || req.user?.tenantId || req.user?.districtId;` (device → the claim), then `where: { tenantId, clearedAt: null, ... }` with **no scope filter** unless the caller supplies one.
- `apps/api/src/notifications/notifications.controller.ts:22, :33, :38` — `requireTenantIdStrict(req)` returns the claim (`require-tenant.ts:22-27`).
- `apps/api/src/tenants/tenants.controller.ts:519-544` (`getTenantInfo`), `apps/api/src/license/license.controller.ts:13-31`, `apps/api/src/branding/branding.controller.ts:530-535` — same pattern.

**Why this is a real gap and not a theoretical one:** three sibling paths in the same codebase explicitly refuse to trust this claim, and say why. `emergency.controller.ts:1290-1294`: *"Tenant scope: resolved from the LIVE Screen row keyed by `req.user.sub` … A screen re-paired to another tenant carries a stale claim until its 365-day token rotates; reading the live row prevents a cross-tenant leak through an old token."* `realtime.gateway.ts:155-159` rejects the socket outright when `decoded.tenantId !== screen.tenantId`. `sse.controller.ts:73-88` re-reads the row. The routes above are the ones that missed the memo.

**Attack:**
1. Recover the token from a decommissioned/e-waste screen (established context) — or from a screen the district unpaired and re-deployed to a different school.
2. `GET /api/v1/emergency/status` with `Authorization: Bearer <token>`. The claim resolves to the **old** tenant; the query returns up to 50 active, uncleared `EmergencyMessage` rows across `tenant:`, `group:` **and** `device:` scopes, plus `Tenant.emergencyStatus` and `emergencyPlaylistId`.
3. `GET /api/v1/notifications` for the same tenant's outage/location feed; `GET /api/v1/tenants` for its address and lat/lng.
4. Poll indefinitely — DT-02 keeps the credential alive, DT-01 means nobody can cut it off.

**Impact:** cross-tenant / post-decommission read of a life-safety data stream. An attacker sitting on one recovered board learns, in real time, when a school is in lockdown, which rooms are scoped, and the message text and media URLs being pushed to the walls. For a K-12 emergency product this is the highest-consequence read in the system.

**Fix:** for `kind === 'device'`, never populate `req.user.tenantId` from the claim. Either resolve it in the guard from the live `Screen` row (one indexed lookup, already done on the SSE/WS/`/messages` paths), or make `requireTenantId()` refuse to answer for a device principal and force every device-reachable handler through an explicit `resolveDeviceTenant(req)` helper. Additionally, `/emergency/status` should apply the same per-scope membership filter `/emergency/messages` already applies (`emergency.controller.ts:1332-1339`) — see DT-10.

**Confidence:** HIGH for the code path; MEDIUM for the "re-homed screen" step, which requires an operator to have unpaired/re-paired that screen (the decommission variant needs no such step and is sufficient on its own).
**Verification methods:** (1) read the guard's device branch in full; (2) read all five consuming handlers; (3) contrasted against the three call sites that *do* re-read the live row, whose comments independently document this exact threat.

---

### [HIGH] DT-04 — Fingerprint-only re-registration mints a 365-day token by default, and the fingerprint is handed to every CONTRIBUTOR and RESTRICTED_VIEWER

**Attacker:** any authenticated low-privilege user of the tenant (CONTRIBUTOR, or RESTRICTED_VIEWER via the read-through at `rbac.guard.ts:90-97`), or anyone who obtains a screen's `deviceFingerprint` from a URL/log/browser history.

**File:line:**
- `apps/api/src/screens/screens.controller.ts:316` — `const strictRepairAuth = process.env.STRICT_REPAIR_AUTH === 'true';` → **default false**.
- `:415-423` — the `absent` prior-token branch:
  ```ts
  } else {
    // absent
    if (strictRepairAuth) { issuedTtl = '1h'; requiresRePair = true; }
    else {
      // Legacy path: STRICT_REPAIR_AUTH not yet enabled.
      // Issue 365d as before so kiosks ≤ v1.0.33 keep working.
      issuedTtl = '365d';
    }
  }
  ```
- `:931-932` — `GET /api/v1/screens` is `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN, CONTRIBUTOR)`.
- `:942-947` + `:1017` — the handler selects the **whole** Screen row and strips only two columns: `const { lastCrashStack: _stack, lastSelfTestReport: _self, ...rest } = s as any;`. `deviceFingerprint` and `pairingCode` are in `...rest`.
- Contrast — `apps/api/src/devices/devices.controller.ts:56-64` removed exactly this path and documented why:
  > *"the deviceFingerprint-only fallback path … has been removed. An attacker who can guess/recover a device fingerprint could otherwise mint a fresh 365-day device JWT for any screen in the fleet — effectively a takeover of the kiosk without ever going through an admin."*

**Attack (role escalation, no external access needed):**
1. Log in as CONTRIBUTOR (or RESTRICTED_VIEWER) → `GET /api/v1/screens` → harvest `deviceFingerprint` for every screen in the tenant.
2. For each: `POST /api/v1/screens/register {deviceFingerprint}` (public, no auth, 120/min/IP) → a 365-day device token per screen.
3. Now hold device control of the entire tenant's fleet: `POST /screens/unpair/:fp` on every screen (wipes each screen's schedules, clears `tenantId`, rotates the pairing code — a tenant-wide outage a CONTRIBUTOR must not be able to cause); `POST /:id/gpio-event` to fake LOCKDOWN on every GPIO-wired screen (DT-06); poison every screen's render-proof so the fleet map reads healthy while it is dark.

**Mitigating fact, reported honestly:** `docs/research/2026-07-18-fast-launch-audit/00-FAST-LAUNCH-GATE.md:27` records `STRICT_REPAIR_AUTH=true` in the production Railway env as of 2026-07-18. I cannot verify live env from a read-only pass, and the variable is **absent from `.env.example` and from the CLAUDE.md env table**, so a re-provision, a new region, a staging stack, or any self-hosted install lands on the insecure default silently. Even with the flag on, the fingerprint remains a semi-secret shipped to CONTRIBUTOR-level users and pasted into the player URL as `?fp=` (`apps/web/src/app/player/page.tsx:1342-1346`), where it reaches Vercel access logs and WebView history.

**Impact:** with the flag off — CONTRIBUTOR → full device-level control of every screen in the tenant, including a destructive tenant-wide unpair. With the flag on — reduced to a 1-hour token, which still reaches every `verifyDeviceForScreen` route long enough to fire GPIO emergencies and unpair screens.

**Fix:** delete the legacy branch. `STRICT_REPAIR_AUTH` was a fleet-migration ramp for kiosks ≤ v1.0.33; prod is pinned at v1.0.63 per the same launch-gate doc, so the ramp is finished — make strict the unconditional behavior and remove the flag. Separately, drop `deviceFingerprint` and `pairingCode` from the `GET /screens` list projection for non-admin roles (the list view does not render them; the pair modal can fetch them from the per-screen detail route).

**Confidence:** HIGH on the code; MEDIUM on live production exposure (env unverifiable from here — treat the flag as a control that must be asserted, not assumed).
**Verification methods:** (1) read the full `register()` branch matrix and `screens.register.spec.ts` case P5-5 which pins the insecure default as intended legacy behavior; (2) read `list()` end-to-end and confirmed the destructure at `:1017` is the only field stripping; (3) confirmed `.env.example` contains no `STRICT_REPAIR_AUTH` line.

---

### [MEDIUM] DT-05 — `verifyDeviceForScreen` skips the revocation and REVOKED-status checks that the `JwtAuthGuard` path enforces, on 9 routes

**Attacker:** holder of a device token that has been (or, post-DT-01-fix, could be) revoked.

**File:line:** `apps/api/src/screens/screens.controller.ts:88-119` and the byte-identical copy at `apps/api/src/screens/gpio.controller.ts:77-108`.

**Evidence quoted** (`screens.controller.ts:92-100`):
```ts
const secret = requireSecret('DEVICE_JWT_SECRET', { devFallback: 'dev_only_device_jwt_secret_CHANGE_ME' });
const decoded = jwt.verify(token, secret) as any;
if (decoded?.kind !== 'device') return { ok: false, reason: 'wrong_token_kind' };
if (decoded?.sub !== screenId) return { ok: false, reason: 'subject_mismatch' };
return { ok: true, sub: decoded.sub };
```
Signature + `kind` + `sub` only. No `sismember('jwt_revoked_list', …)` (the `JwtAuthGuard` does this at `jwt-auth.guard.ts:100`, SSE at `sse.controller.ts:70`, WS at `realtime.gateway.ts:141`). No `screen.status === 'REVOKED'` check (the manifest does this at `:2634`). No live-row tenant-rebind check (WS does this at `:155-159`).

**Routes affected:** `unpair/:fp`, `PUT :id/orientation/device`, `POST :id/game-state`, `POST :id/cache-status`, `POST :id/render-proof`, `GET :id/emergency-assets`, `GET :id/menu`, `POST :id/gpio-event`, and the mirror in `player-logs.controller.ts:64-79`.

**Attack:** any future revocation mechanism — including a manual `UPDATE screens SET status='REVOKED'` an incident responder might reach for — silently fails to stop these nine routes, including the two that matter most (`gpio-event` → fake emergency, `unpair` → destroy schedules). Today it is a latent gap because nothing revokes at all (DT-01); the moment DT-01 is fixed in the guard only, this becomes an active bypass.

**Impact:** defence-in-depth gap now, an authorization bypass the day revocation ships. Also an inconsistency a district security questionnaire will find: the same credential is checked against the revocation list on some routes and not others.

**Fix:** collapse the two copies into one shared `device-auth.ts` helper that performs signature + `kind` + `sub` + revocation + live-row `status`/tenant checks, and route all nine (plus `player-logs`) through it. The extra DB read is already paid on most of these handlers.

**Confidence:** HIGH.
**Verification methods:** (1) read both copies of the helper in full; (2) enumerated all nine call sites by grep and read each handler's first 10 lines to confirm no compensating check.

---

### [MEDIUM] DT-06 — A device token can fabricate a LOCKDOWN or EVACUATE on its own screen via `/gpio-event`

**Attacker:** holder of a device token for a screen whose operator has wired GPIO IN.

**File:line:** `apps/api/src/screens/gpio.controller.ts:133-183` (auth is `verifyDeviceForScreen` only); `apps/api/src/screens/gpio.service.ts:264-303` (`handleInputEvent` → `triggerScreenEmergency`).

**Evidence quoted** (`gpio.service.ts:290-296`):
```ts
// Active state on a mapped pin → trigger the matching emergency
// type. We persist a ScreenEmergencyOverride row (device-scope, ...)
const emergencyType = mapping === 'fire_alarm' ? 'EVACUATE' : 'LOCKDOWN';
const overrideId = await this.triggerScreenEmergency({ screenId, tenantId, type: emergencyType, mapping, pin: event.pin });
```

**Attack:**
1. `POST /api/v1/screens/<own screenId>/gpio-event` with `{"pin":"in1","state":"edge_rising"}` and the stolen Bearer token.
2. If `Screen.config.wiring.gpio_in1` is `panic_button` or `fire_alarm`, the API persists a real `ScreenEmergencyOverride` and publishes a **signed** `OVERRIDE` on `device:<screenId>` — indistinguishable downstream from a genuine wall-station press.
3. Rate limit is 10/min/screen (`GPIO_INPUT_RATE_LIMIT`), so one alert per minute sustained.

**Impact:** a fake life-safety alert on one screen, sourced from the platform's own signed broadcast path and shown in incident review as a genuine GPIO trigger. Scope is one screen (the manifest's per-screen override branch precedes the tenant-wide one), and the hard precondition is operator GPIO wiring — which is why this is MEDIUM and not CRITICAL. It is nonetheless a fake emergency, which is the failure mode this product exists to prevent.

**Fix:** GPIO edge reports should carry a per-screen shared secret provisioned at install time alongside the wiring config (the EP6N install is already a touch-the-hardware step), or at minimum require the short-lived `X-Device-Auth` HMAC rather than accepting the long-lived JWT. Also add the revocation/`REVOKED` checks per DT-05 so a compromised screen can be cut off from the emergency path specifically.

**Confidence:** HIGH on the code path; the wiring precondition is stated, not measured.
**Verification methods:** (1) read the controller and `handleInputEvent`/`triggerScreenEmergency`; (2) confirmed a device token cannot set its own `config.wiring` — `PUT /screens/:id` is `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)` at `:1431-1433`, which is what keeps the precondition genuinely out of the attacker's reach.

---

### [MEDIUM] DT-07 — Cross-tenant USB-ingest audit-record forgery: `screenId` comes from the path, not the token

**Attacker:** any authenticated principal, including any device token from any tenant.

**File:line:** `apps/api/src/tenants/tenants.controller.ts:1016-1032` (route + `const screenId = req.params?.screenId;`), class guard at `:12-13` (`@UseGuards(JwtAuthGuard, RbacGuard)`), and **no `@RequireRoles` on this handler** — so `RbacGuard` short-circuits at `rbac.guard.ts:27-29` and a roleless device principal passes.

**Evidence quoted** (`:1032-1044`):
```ts
const screenId = req.params?.screenId;
...
// ten-ok: device-reported telemetry — the screen row IS the tenant resolver; ...
const screen = await this.prisma.client.screen.findUnique({ where: { id: screenId }, include: { tenant: {...} } });
...
tenantId: screen.tenantId,           // trusted, derived from Screen lookup
```
The route comment claims *"the screenId derivation alone closes the IDOR."* It closes the **tenantId** IDOR (the tenant is derived, not supplied) but not the **screen-targeting** IDOR — nothing ties `:screenId` to the caller's `sub`.

**Attack:** with a device token for screen `S` in tenant `T`, and a known screen UUID `X` in tenant `U` where `usbIngestEnabled` is on, `POST /api/v1/tenants/me/usb-ingest/screens/X/event` with `{"outcome":"..."}` writes a `UsbIngestEvent` row attributed to tenant `U`, screen `X`, with attacker-chosen `deviceSerial`, `bundleVersion`, `assetCount`, `outcome`, `reason`. Throttle is 6/min/IP. The HMAC `signature` field is verified **only if the attacker supplies it** (`:1052-1069`) — omitting it skips verification entirely.

**Impact:** forged entries in another tenant's forensic USB-ingest trail — the record an incident reviewer consults to answer "what content was sideloaded onto this screen and by whom." Preconditions (known screen UUID, `usbIngestEnabled` on the target tenant) keep this out of HIGH.

**Fix:** require `req.user.kind === 'device' && req.user.sub === screenId` (the pattern every other device telemetry route already uses), and make the HMAC signature **mandatory** when the tenant has a `usbIngestKey` rather than opt-in.

**Confidence:** HIGH on the code path; MEDIUM on practical exploitability (UUID discovery is the gate).
**Verification methods:** (1) read the handler end-to-end; (2) confirmed class-level guards and the absence of `@RequireRoles` with a decorator-context scan across every controller; (3) confirmed `RbacGuard` returns `true` for `requiredRoles === undefined`.

---

### [MEDIUM] DT-08 — Device tokens travel in URL query strings, land in access logs and WebView history, and a `?token=` param is persisted to `localStorage` verbatim

**Attacker:** anyone with read access to Vercel/Railway HTTP request logs, an on-path proxy that logs URLs, an Android shell (`logcat`/`dumpsys`, trivial given `debuggable=true`), or anyone who can get a browser-based player to open one URL.

**File:line:**
- `apps/api/src/realtime/sse.controller.ts:39-44` — `@Get('sse') async sseStream(@Query('token') token: string | undefined, …)`; the design note at `:17-25` acknowledges the exposure and accepts it.
- `apps/web/src/app/player/page.tsx:4817` — `const url = \`${getApiRoot()}/api/v1/realtime/sse?token=${encodeURIComponent(token)}\`;`
- `apps/web/src/app/player/page.tsx:475-483` — `getDeviceToken()`:
  ```ts
  const fromUrl = qp('token');
  if (fromUrl) {
    try { localStorage.setItem(LS_TOKEN, fromUrl); } catch {}
    return fromUrl;
  }
  ```
- `apps/web/src/lib/menu/device-menu.ts:100-110` — same URL-first precedence.
- Contrast — `apps/web/src/app/[schoolId]/screens/page.tsx:1651-1657` uses a URL **fragment** for the admin JWT precisely *"because fragments don't get logged by servers, sent in referrer headers, or captured in proxy access logs."* The device token does not get that treatment.

**Attack A (log harvesting):** every kiosk SSE connect writes a full device token into the API's HTTP access log; the APK's WebView URL (`/player?token=…&fp=…`) writes another into Vercel's. Whoever can read those logs holds credentials for the whole fleet. This is not hypothetical access — the project's own debugging playbook routinely reads Railway HTTP logs.

**Attack B (identity injection):** get any browser-based player — including the dashboard's "Open Screen in Browser" surface — to load `https://<host>/player?token=<attacker's device token>`. Line 480 persists it to `localStorage` **permanently**, replacing that machine's identity. The screen then polls the attacker's screen's manifest and reports telemetry as the attacker's screen. This is structurally identical to the `?api=` trust-anchor bug (R-01) that was just closed on this branch with `trustGuards.ts` — the token param never got the same treatment.

**Impact:** fleet-wide credential exposure through a channel nobody thinks of as sensitive, plus a one-click screen-identity hijack on browser players.

**Fix:** move the SSE token to a `Sec-WebSocket-Protocol`-style handshake or a short-lived single-use ticket minted by an authenticated POST (`EventSource` cannot set headers, but it can carry a 60-second ticket instead of a 365-day credential). Pass the APK's token to the WebView via the fragment or `postMessage`/bridge rather than the query string, mirroring the admin-preview pattern already in the codebase. Apply the R-01 treatment to `?token=`: accept it only when no stored token exists, never persist a URL-supplied token whose `sub` disagrees with the stored `screenId`.

**Confidence:** HIGH on the code paths; the log-retention/access side is inferred from the transport, not measured.
**Verification methods:** (1) read the SSE controller and both player token resolvers; (2) grepped `apps/web` and `apps/player` for `?token=` construction sites; (3) confirmed `Referrer-Policy: strict-origin-when-cross-origin` is set globally in `apps/web/next.config.ts:53`, which **closes** the Referer-leak variant of this — see "already strong".

---

### [MEDIUM] DT-09 — A device token can mark the whole tenant's notifications read, suppressing the operator's outage alerts

**Attacker:** holder of any paired device token in the tenant.

**File:line:** `apps/api/src/notifications/notifications.controller.ts:36-38`; `apps/api/src/notifications/notifications.service.ts:150-160`.

**Evidence quoted** (`notifications.service.ts:150-158`):
```ts
async markAllRead(tenantId: string, userId: string) {
  const res = await this.prisma.client.notification.updateMany({
    where: { tenantId, isRead: false, OR: [{ userId }, { userId: null }] },
    data: { isRead: true },
  });
```
For a device, `userId` is the screenId (no match) but the `{ userId: null }` branch survives — that is the **tenant-wide** feed every admin reads.

**Attack:** `POST /api/v1/notifications/read-all` on a 30-second loop. Every `SCREEN_OFFLINE` and `INFRA_EVENT` notification is marked read within half a minute of creation, so the dashboard's unread badge never lights. Run this while physically removing or bricking screens.

**Impact:** degrades the operator's primary outage-detection channel across the whole tenant — the one that fires when screens go dark, which for a life-safety product is the signal that matters. It does not delete the rows (they remain queryable), which is why this is MEDIUM.

**Fix:** device principals have no notification inbox — reject `kind === 'device'` on all three notification routes outright. (This is strictly a removal of unintended reach; no player code calls these endpoints — verified by grepping `apps/web/src/app/player` and `apps/player` for `notifications`.)

**Confidence:** HIGH.
**Verification methods:** (1) read controller + service; (2) confirmed `requireTenantIdStrict` returns the device's claim rather than throwing; (3) confirmed no player-side caller.

---

### [LOW] DT-10 — `/emergency/status` returns every scope for the tenant, unlike `/emergency/messages` which filters to the device's own scopes

**Attacker:** holder of any paired device token.

**File:line:** `apps/api/src/emergency/emergency.controller.ts:1225-1237` (no scope filter unless `scopeType`/`scopeId` are supplied by the caller) vs `:1332-1339` (the `/messages` handler builds `scopeOr` from the live screen's `tenantId`, `screenGroupId`, and own id, and comments: *"This stops a per-screen (Sprint 8b device-scoped) message for screen B from leaking onto screen A in the same tenant."*).

**Attack:** `GET /api/v1/emergency/status` with a device token → all 50 most recent active messages for the tenant, including `device:`-scoped messages addressed to other rooms.

**Impact:** within-tenant leak of per-room emergency messaging to a screen that was not addressed. LOW because it stays inside the tenant — but it directly contradicts the isolation `/messages` was built to enforce, and it is the same handler DT-03 abuses for the cross-tenant case.

**Fix:** apply the `/messages` scope filter to `/emergency/status` when the principal is a device.

**Confidence:** HIGH.
**Verification methods:** read both handlers side by side.

---

### [LOW] DT-11 — Device tokens can drive the paid Google Geocoding proxy

**File:line:** `apps/api/src/geocoding/geocoding.controller.ts:17-24, :59-61` — class-level `@UseGuards(JwtAuthGuard)`, no `@RequireRoles`, on `GET /api/v1/geocode` and `/geocode/reverse`.

**Attack:** a stolen device token drives arbitrary geocoding lookups against `GOOGLE_MAPS_API_KEY`. Cost abuse / free-oracle; the key itself is never returned (server-side proxy, per the CLAUDE.md env note).

**Fix:** add `@RequireRoles` (the callers are the screen-location and signup address pickers — both operator UI, no player caller).

**Confidence:** HIGH. **Verification:** read the controller; grepped `apps/web/src/app/player` for `geocode` — no hits.

---

### [LOW] DT-12 — No explicit algorithm allowlist on any device-JWT verify (safe today only by library default)

**File:line:** `screens.controller.ts:94`, `gpio.controller.ts:83`, `sse.controller.ts:58`, `realtime.gateway.ts:129`, `player-logs.controller.ts:71`, `devices.controller.ts` (sign side), `jwt-auth.guard.ts:81` — all call `jwt.verify(token, secret)` / `verifyAsync(token, { secret })` with **no `algorithms` option**.

**I tried to turn this into an `alg:none` / key-confusion finding and could not.** `node_modules/.pnpm/jsonwebtoken@9.0.3/node_modules/jsonwebtoken/verify.js:117` returns `JsonWebTokenError('please specify "none" in "algorithms" to verify unsigned tokens')` — unsigned tokens are rejected unless explicitly opted in. `:134` defaults `options.algorithms = HS_ALGS` when the key is a plain secret string, so an attacker cannot force an RS/ES path either. **Not exploitable.** Reported at LOW purely because the guarantee lives in a library default rather than in our code, and a `jsonwebtoken` major bump or a switch to another library silently removes it.

**Fix:** pass `{ algorithms: ['HS256'] }` at all seven sites. One line each, zero behavior change.

**Confidence:** HIGH (that it is currently safe). **Verification:** read the library's `verify.js` alg-handling block and every call site.

---

## 4. Route table — every route a device token can reach

| Route | Guard / auth path | Tenant-scoped? | screenId from token or param? | Risk |
|---|---|---|---|---|
| `POST /screens/register` | **public** (mint) | n/a | fingerprint (body) | **DT-02 / DT-04** — mints 365 d |
| `GET /screens/:id/manifest` | `JwtAuthGuard` (+revocation) | live row | **token** (`sub === screen.id`, `:2662`) | OK |
| `POST /screens/unpair/:fp` | `verifyDeviceForScreen` | live row | **token** (`sub === screen.id`) | Destructive but self-scoped; DT-05 |
| `PUT /screens/:id/orientation/device` | `verifyDeviceForScreen` | live row | **token** | Self-scoped; DT-05 |
| `POST /screens/:id/game-state` | `verifyDeviceForScreen` | n/a | **token** | Self-scoped; DT-05 |
| `POST /screens/:id/cache-status` | `verifyDeviceForScreen` | n/a | **token** | Telemetry spoof (self); DT-05 |
| `POST /screens/:id/render-proof` | `verifyDeviceForScreen` | n/a | **token** | Telemetry spoof (self); DT-05 |
| `GET /screens/:id/emergency-assets` | `verifyDeviceForScreen` | live row | **token** | OK; DT-05 |
| `GET /screens/:id/menu` | `verifyDeviceForScreen` | live row + POS location | **token** | OK; DT-05 |
| `POST /screens/:id/gpio-event` | `verifyDeviceForScreen` | live row | **token** | **DT-06** — fake single-screen emergency |
| `POST /player-logs/:screenId` | inline device verify | live row | **token** | OK |
| `GET /templates/:id/playback` | `JwtAuthGuard`, no roles | **live row** | **token** | OK (2026-07-25 fix verified) |
| `GET /assets/:id/playback` | `JwtAuthGuard`, no roles | **live row** | **token** | OK (fix verified) |
| `GET /emergency/messages` | `JwtAuthGuard`, no roles | **live row** + scope filter | **token** | OK — the reference implementation |
| `GET /emergency/status` | `JwtAuthGuard`, no roles | **JWT claim**, no scope filter | n/a | **DT-03 / DT-10** |
| `GET /notifications` | `JwtAuthGuard`, no roles | **JWT claim** | n/a | **DT-03** |
| `POST /notifications/:id/read`, `/read-all` | `JwtAuthGuard`, no roles | **JWT claim** | n/a | **DT-09** |
| `POST /tenants/me/usb-ingest/screens/:screenId/event` | `JwtAuthGuard`+`RbacGuard`, no roles | target screen's tenant | **PARAM** | **DT-07** — cross-tenant write |
| `GET /tenants` (info) | `JwtAuthGuard`+`RbacGuard`, no roles | **JWT claim** | n/a | DT-03 (info) |
| `GET /tenants/accessible` | same | **JWT claim** (own only) | n/a | Low |
| `POST /tenants/switch` | same | — | — | 403 (role undefined) — OK |
| `GET /license/me`, `/current`, `/tiers` | `JwtAuthGuard`+`RbacGuard`, no roles | **JWT claim** | n/a | Low (tier/seat disclosure) |
| `GET /branding/me` | `JwtAuthGuard` | **JWT claim** | n/a | Low |
| `POST /branding/derive-palette` | `JwtAuthGuard` | n/a | n/a | None (pure math) |
| `GET /feature-flags`, `GET /hardware/catalog` | `JwtAuthGuard` | n/a | n/a | None |
| `GET /geocode`, `/geocode/reverse` | `JwtAuthGuard`, no roles | n/a | n/a | **DT-11** (cost abuse) |
| `POST /analytics/touch-events` | `JwtAuthGuard`, hand-rolled device check | claim | **token** (`user.sub`, explicit) | OK — exemplary |
| `POST /auth/logout` | `JwtAuthGuard` | n/a | n/a | Self-revocation only |
| `GET /billing/status` | `JwtAuthGuard`+`RbacGuard`, no roles | n/a | n/a | None (boolean) |
| `GET/POST /auth/mfa/*` | `JwtAuthGuard`, no roles | — | — | 401/404 (no `User` row) — OK |
| `GET /users/me`, `PUT /users/me` | `JwtAuthGuard`+`RbacGuard`, no roles | — | — | 404 (no `User` row) — OK |
| `GET /realtime/sse?token=` | inline verify + revocation | **live row** | **token** | OK; DT-08 (token in URL) |
| WS `/realtime` `HELLO` | inline verify + revocation + tenant-rebind check | **live row** | **token** | OK — strongest device auth in the codebase |

---

## 5. What is already strong

Worth stating plainly for a district security questionnaire — these are real, verified controls, not paperwork:

1. **Boot-time secret enforcement is real and eager.** `assertRequiredSecretsAtBoot()` is called from `apps/api/src/main.ts:44`, before `app.listen()`, and iterates `BOOT_REQUIRED_SECRETS` (`required-secret.ts:55-60`) including `DEVICE_JWT_SECRET` and `DEVICE_SECRET_KEY`. In production a missing or `<16`-char value **throws and the container exits** (`:30-39`). The 2026-07-16 "lazy validation" gap (S14) is closed. **No hardcoded device-secret fallback survives into production** — the `devFallback` argument is unreachable when `NODE_ENV=production`.
2. **`DEVICE_JWT_SECRET` is genuinely distinct from `JWT_SECRET`**, and the guard selects the secret by token kind before verifying (`jwt-auth.guard.ts:76-81`). A user token cannot reach a device-only route (`emergency.controller.ts:1310-1313` hard-requires `kind === 'device'`; `verifyDeviceForScreen` rejects `wrong_token_kind`), and a device token cannot masquerade as a user (it carries no `role`, so `RbacGuard` denies every `@RequireRoles` route). **Cross-token-type confusion: I looked for it specifically and could not find a path.**
3. **`alg:none` and algorithm-substitution are not exploitable** (see DT-12 for the library-level proof).
4. **Screen-scope binding is the norm, not the exception.** 15 of the 23 reachable routes derive `screenId` from the token's `sub` and refuse a mismatched path param. `analytics.controller.ts:126` goes out of its way to document *why* it binds to `user.sub` instead of the body ("A client-supplied screenId let a malicious player rotate it on every batch to bypass the per-screen rate limit").
5. **The July-2026 TEN-001 cross-tenant device holes are genuinely fixed** — `require-tenant.ts` exists and is wired, `/templates/:id/playback` restricts a tenant-less caller to `isSystem` presets only (`:844-847`), `/assets/:id/playback` requires `status:'PUBLISHED'` plus a tenant match, `/notifications` calls `requireTenantIdStrict`. I re-tested each by reading the current handler, not by trusting the changelog.
6. **The realtime layer is the best-hardened device surface in the codebase.** The WS gateway re-reads the live `Screen` row, rejects a token whose `tenantId` claim disagrees with the DB (`realtime.gateway.ts:155-159`), sources group membership from the live row rather than the claim, checks `jwt_revoked_list` fail-closed, and enforces a 10-second auth timeout. The gateway accepts only four inbound message types — a device cannot inject anything into the signed broadcast bus. SSE mirrors this and re-checks revocation on an *open* stream (`sse.service.ts:82-92`).
7. **Fail-closed revocation with a durable mirror.** `JwtAuthGuard` denies when the revocation check itself fails (`jwt-auth.guard.ts:119-126`), and `redis.service.ts:225-256` falls back to a Postgres `revoked_credentials` table when Redis is down. The plumbing DT-01 needs already exists — it simply has no device-side writer.
8. **`Referrer-Policy: strict-origin-when-cross-origin` is set on every route** (`apps/web/next.config.ts:53`). I specifically hunted the "CONTRIBUTOR points a WEBPAGE widget at an attacker host and harvests the player URL's `?token=` from the `Referer` header" chain. **Refuted** — cross-origin subresource requests send origin only.
9. **`/devices/pair` requires a fresh pairing code**; the fingerprint-only fallback there was removed and the removal is documented (`devices.controller.ts:56-64`). Pairing codes come from `crypto.randomInt` over a 32-char alphabet (`screens.controller.ts:63-73`) and the endpoint is throttled 10/min/IP.
10. **The manifest hardening from the 2026-07-31 incident holds** — `Cache-Control: no-store` on every branch including 304s (`:2608-2609`), and a `REVOKED`/missing-screen 403 before any content is assembled.

---

## 6. Not checked / UNVERIFIED

- **Live production environment values.** I cannot see Railway env from a read-only worktree. `STRICT_REPAIR_AUTH=true` (DT-04) is asserted by `docs/research/2026-07-18-fast-launch-audit/00-FAST-LAUNCH-GATE.md:27`, dated 2026-07-18 — **treat as a control to be re-asserted, not a fact**. Actual secret entropy for `DEVICE_JWT_SECRET`/`DEVICE_SECRET_KEY` is likewise unverified (prior audits flag rotation as still-open).
- **No dynamic testing.** Every finding is a static trace. I issued no HTTP requests, ran no server, and touched no database — so no live proof-of-exploit exists for DT-02, DT-03, DT-04, DT-07 or DT-09. Each was traced end-to-end through code I read in full, and I attempted to refute each before reporting.
- **`apps/api/src/proxy/proxy.controller.ts`** — `@Controller('api/v1/proxy')` with `@Get('web')` and **no guards at all**. That is an unauthenticated surface, out of my device-token scope, and it is one of the files another agent is concurrently editing. Flagging for whoever owns the SSRF/proxy surface; I did not audit it.
- **Concurrently-edited files** (`apps/web/src/components/widgets`, `apps/web/next.config.ts`, `apps/api/src/proxy`, `apps/api/src/templates`, `apps/api/src/playlists`) — read for context only. The `next.config.ts:53` Referrer-Policy citation in §5 item 8 could be invalidated by in-flight edits; re-confirm before relying on it.
- **`DeviceStore.kt` storage class — partially verified.** `apps/player/app/src/main/java/com/educms/player/DeviceStore.kt:10` uses `preferencesDataStore(name = "edu_cms_player")` — Jetpack Preferences DataStore, i.e. an **unencrypted** protobuf file in app-private storage. Not `EncryptedSharedPreferences`, not Keystore-wrapped. Given `debuggable="true"`, `run-as` reads it directly. I did **not** enumerate every other place the Kotlin/JS side may copy the token (e.g. `WebAppBridge.kt`, `CrashUploader.kt`, `HeartbeatService.kt`, OTA workers) — a full player-side token-handling sweep is a separate surface and was not in my scope. I did confirm the API side never writes a token to a log line (grep for `console.*token` across `apps/api/src`: zero non-spec hits).
- **Multi-replica behavior of the in-memory gates** (`_registerFpCooldown`, `_gameStateRateMap`, `_inputRateMap`) — each replica keeps its own map, so effective limits are N× the stated values. Noted, not developed into a finding.
- **`remove()` with an undefined `req.user.tenantId`.** `screens.controller.ts:2504-2506` does `findFirst({ where: { id, tenantId: req.user.tenantId } })`; a principal whose `tenantId` is undefined would have that filter dropped by Prisma. Only `SUPER_ADMIN` can reach that state on this route (device tokens are blocked by `@RequireRoles`), so it is not device-token-reachable and I did not pursue it — but it is the same TEN-001 pattern and belongs to whoever owns that sweep.