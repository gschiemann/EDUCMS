# 05 — Screen PIN for the on-screen Unpair (player stability gap 6)

Build agent E · branch `claude/operator-pin-gate` · Claude Opus 5.5 (Claude Code, Agent SDK) · 2026-11-09 · unmerged, unpushed.

## What the inventory said, and what was true

Gap 6 said "wire the PIN gate in" (`OperatorPinGate.kt`). That would have been wrong. The gate was detached on purpose on 2026-08-03 (its header says why): it sat on the native step BEHIND the server call, so it stopped nothing, and it failed closed with no way to set a PIN, which disabled "Exit to device home" on every screen. **No Kotlin was touched.** The fix is at the layer that header names: a server-side refusal of a device-initiated unpair without a tenant-set PIN, plus a prompt in the web overlay before the server call.

What already existed and was reused: Argon2id with the platform parameters (`cryptoPlatformConfig`; verification through `verifyReauthPassword`), the remote-first dialog look and key rules (`RemoteDialog.tsx`, rule 15), the `LedPosterStandardCard` card style, the `me/mfa-enforced` route shape (own tenant, org-admin write, audit row in the same transaction).

## What was built

**API**
- `apps/api/src/screens/screen-pin.ts`: PIN rules (4–8 ASCII digits), hash and verify, an in-process per-screen attempt limiter (5 wrong → 15 min lock, doubling to 24 h, reset by a correct PIN, a correct PIN refused during a lock), `enforceDeviceUnpairPin`, and `manifestUnpairPin`.
- `POST /screens/unpair/:fp` (`screens.controller.ts`): after device auth and before any write, calls the gate. With a PIN set: 403 `SCREEN_UNPAIR_PIN_REQUIRED` (no PIN sent), 403 `SCREEN_UNPAIR_PIN_WRONG` + `attemptsLeft`, 429 `SCREEN_UNPAIR_PIN_LOCKED` + `retryAfterSeconds`. Audit rows: `SCREEN_UNPAIR_PIN_REFUSED`, at most one per screen per 15 min, and `SCREEN_UNPAIR_PIN_LOCKED` on each lock start. No PIN set: one indexed read, then exactly the old route.
- `apps/api/src/tenants/screen-pin.controller.ts` (registered in `app.module.ts`): `GET/PUT/DELETE /api/v1/tenants/me/screen-pin`. Own tenant only. GET (SUPER/DISTRICT/SCHOOL admin) returns only `{ set, setAt }`. PUT/DELETE are SUPER_ADMIN/DISTRICT_ADMIN, like `me/mfa-enforced`. The audit rows `SCREEN_PIN_SET`, `_CHANGED` and `_CLEARED` are written in the same transaction. The PIN and its hash never appear in a response, a log or an audit row.
- **No re-authentication.** The comparable org settings (MFA enforcement, emergency enablement, the USB ingest key rotation) take no password step-up, so this route takes none either. This is an owner decision below.
- The manifest: the tenant projection selects `screenPinSetAt` (never the hash). The scoreboard, empty and full branches spread `...manifestUnpairPin(tenant)`. The key is ABSENT when unset, so a tenant with no PIN gets a byte-identical payload and ETag. It is a static column-derived value with no clock (sync rule 4). Tenant is a manifest-fed model, so a change reaches screens on their next poll.

**Schema** (`20261109120000_tenant_screen_pin`, additive, idempotent):
- `tenants.screen_pin_set_at` (nullable, no default).
- A new table `tenant_screen_pins` (tenant_id PK, pin_hash, set_by_user_id, timestamps) with no FK.
- The hash lives outside `tenants` so no existing tenant read can return it.
- Applied twice on a scratch Postgres 16: both runs exited 0. `prisma migrate diff` against master's schema gives the same DDL.

**Web player**
- `unpairPin.ts` (pure): the manifest flag reader (an emergency manifest never moves it; persisted in `edu_unpair_pin_required`), `requestServerUnpair` and `decideUnpairAnswer`.
  - Without a PIN, `requestServerUnpair` sends exactly the old request: no body, bearer only, a 4 s abort. With a PIN, the PIN goes in a JSON body, never the URL.
  - `decideUnpairAnswer` with no PIN known: everything proceeds as today, except a PIN refusal. With a PIN known: only a 2xx (or a 401, a dead credential) proceeds. Offline, a 5xx or a throttle 429 are refused.
- The keypad machine `stepPinPad`: parked on 1, arrows, OK presses, typed digits park on OK so Enter submits, Back always escapes even mid-submit, input is ignored while busy.
- `UnpairPinPad.tsx` + `usePinPad`: the same look as `RemoteDialog` (amber ring, scrim, `REMOTE_DIALOG_Z_INDEX`), the PIN shown as dots, Chromium-83 safe (no `inset`, no flex `gap`, no four-sided style object).
- `deviceTokenSession.ts` gains `restore(token)`. It works only right after `invalidate` and never rolls the generation back. It puts back the credential a refused unpair had retired.
- `page.tsx` (small diff):
  - `handleUnpair(pin?)`.
  - `onShowStop` cancels the pad after the question dialog.
  - `onKey` lets Backspace reach the pad.
  - An alert or a surface change closes the pad.
  - One mount after `<RemoteDialog>`.
  - The manifest flag is read next to the time-zone block.
  - The "Exit to device home" comment records why that button stays ungated.

**Offline behaviour (decided):**
- **PIN known:** a failed server call is a refusal ("Cannot reach the server… unpair from the dashboard"), and nothing is torn down. A local-only teardown is not harmless: the screen re-registers by fingerprint, gets a bootstrap credential that every device route refuses, and is off the alert channel all the same.
- **No PIN known:** unchanged. The player tears down locally anyway, as it always has.

**Dashboard.** `ScreenPinCard.tsx` sits in Settings → Organization → "Organization defaults", under `LedPosterStandardCard`.
- Mount proven through the import chain: `app/[schoolId]/settings/organization/page.tsx` → `SettingsOrganizationPage` (`components/settings/cc/OrganizationPage.tsx`, rendered unconditionally by the page; the section is inside its `canEdit` branch) → `<ScreenPinCard />`. This was not checked with a module-graph tool.
- PIN entry: typed twice, masked, digits only. No optimistic success. The card states the recovery path.
- Hooks: `useScreenPin`, `useSetScreenPin` and `useClearScreenPin` in `hooks/use-api.ts`.
- Strings: `playerMenu.unpairPin.*` and `screenPin.*` in en, es and zh.

## Every caller, and why each still works
- **Server route `POST /screens/unpair/:fp`**: its only caller is `handleUnpair` in `page.tsx` (searched `unpair/` across apps, packages and scripts, including `.kt`).
- **Native `unpair()`**, called from:
  - `handleUnpair`: the gated path.
  - The TENANT_CHANGED WS handler (`page.tsx`): untouched, and it never calls the server route (a wiring test pins this).
  - Kotlin: `WebAppBridge.unpair` → `MainActivity.unpairAndRestart` / `FacePlayerHost`. These are reached only from JavaScript, so they are unchanged.
- **Dashboard "Remove screen"** (`DELETE /screens/:id`): never consults the PIN. The spec walks it with a PIN set; it is the forgotten-PIN recovery.
- **Re-pair** (`POST /screens/pair`, which sends TENANT_CHANGED) and **revoke-credential**: untouched.

## Tests run (real counts)
- `apps/api` `screen-pin.spec.ts`: 22/22. It covers two tenants, unchanged behaviour with no PIN, missing / wrong / correct PIN, the lock and the correct PIN refused during it, rate-limited audit rows, no leak of the PIN or hash, dashboard DELETE with a PIN set, the set → change → clear lifecycle with audit rows, the 400 cases, the role metadata, and the manifest flag being absent when unset.
- The whole API jest suite (run twice, while the web suite ran in parallel):
  - Run 1: 627 suites passed, 6 failed, 3 skipped; 11930 tests passed, 86 failed. The failures were upload / storage specs under load; the output kept only the tail, so the suite names were not captured.
  - Run 2: 631 suites passed, 2 failed; 12014 tests passed, 2 failed. The two failures:
    - `two-tenant-role-matrix.spec.ts`: a REAL failure. The new `screen-pin.controller.ts` was not in the matrix. It is now a documented gap with its reason: all its routes are `me`, so there is no foreign id to aim at, and the two-tenant proof is in `screen-pin.spec.ts`. Re-run: 586 → 596/596.
    - `ai/designer-assets.item-photos.spec.ts`: passes alone, so a load flake.
- `apps/web`:
  - `unpairPin.test.ts` + `UnpairPinPad.test.tsx`: 24/24.
  - `deviceTokenSession.test.ts` + `unpairPinWiring.test.ts` + `remoteDialogWiring.test.ts`: 42/42.
  - `ScreenPinCard.test.tsx`: 5/5.
  - `npx jest src/app/player`: 125/126 suites, 1823/1824 tests. The one failure, `sw-playlist-quota.test.ts`, took 257 s under parallel load. Alone it passes 5/5 in 36 s.
  - `npx tsc --noEmit -p .`: clean.
- `apps/api` `tsc -p tsconfig.build.json`: clean.
- Gates:
  - `check-tenant-isolation`: 0 unscoped, baseline 0/0, unchanged.
  - `check-i18n-parity`: 7537 keys, OK.
  - `check-inset-serialization`: 0 landmines.
  - `check-schema-has-migration` and `check-rulebook`: re-run after the commit (results below).

## NOT proven
- Nothing was tried on hardware or a real WebView: D-pad focus on a Goodview, Chromium 83 on Taurus, a USB keyboard on the APK. There is no e2e spec for the pad yet. The obvious next one is a copy of `tests/e2e/player-unpair-confirm.spec.ts` with a mocked 403.
- The limiter is in process (one API replica). A deploy or restart forgets the counters, which gives at most five fresh guesses per deploy. A Redis-backed copy is a follow-up if the API ever runs more than one replica.
- A page still running the OLD bundle during the deploy window tears down locally after a 403. Only a tenant that set a PIN in that window is exposed, and screens pick up the new bundle through the normal bundle check.
- A PIN is per tenant. A district's PIN does NOT cover its child schools' screens (each screen uses its own tenant's PIN).

## Kill switch and failure direction
- **Kill switch:** clear the PIN (Settings → Organization → Remove PIN, or `DELETE /api/v1/tenants/me/screen-pin`). With no row, every path is today's behaviour. No environment variable was added.
- **Failure direction:**
  - The hash verifier fails closed: a malformed hash means "wrong PIN".
  - The audit insert is best-effort: a failure never turns a refusal into an unpair.
  - Offline with a PIN set, the screen stays paired.
  - An alert closes the pad; the emergency path is untouched.

## Blast radius
- **At merge, for a tenant with no PIN** (every tenant today): nothing changes on any screen.
  - The manifest payload and ETag are byte-identical (the key is absent).
  - The unpair request is identical (no body).
  - The decision is "proceed" for every answer a PIN-less server can send.
  - The only new work is one indexed `tenant_screen_pins` read per device-initiated unpair.
- **Web deploy:** every screen loads the new bundle as usual, and nothing on the glass differs.
- **API boot:** `prisma migrate deploy` adds one nullable column to `tenants` (a catalog-only change, `lock_timeout 5s`) and creates one empty table. The previous build runs against the new schema.

## Overlap with open PRs
- #295 edits `page.tsx` push-gate lines. This diff touches other regions of `page.tsx`: imports, a few lines after `useRemoteDialog`, the dialog surface effect, `onShowStop`/`onKey`, the alert effect, the time-zone block of `applyManifest`, `handleExitApp`'s comment, `handleUnpair` and the dialog mount. A textual conflict is possible only if #295 touches those regions.
- No overlap with #294 (Kotlin).

## Owner decisions
1. **"Exit to device home" stays ungated.** Without device owner, the hardware Home key leaves the app anyway, so a gate adds no security and could strand a technician who must reach Wi-Fi settings on an offline screen.
2. **No password re-authentication to set or change the PIN.** This matches MFA enforcement and the USB key rotation. Say if you want a step-up.
3. **Who may set it:** SUPER_ADMIN and DISTRICT_ADMIN only (like MFA enforcement), not SCHOOL_ADMIN.
4. **District inheritance:** should a district's PIN cover its schools' screens? It does not today.
5. **Offline with a PIN known refuses the local unpair.** Recovery is the dashboard.

## Follow-ups
- `OperatorPinGate.kt`'s header (Kotlin, deliberately untouched) should later point at this work: "the server-side gate it asks for exists, see `apps/api/src/screens/screen-pin.ts`".
- An e2e spec for the keypad (chromium + webkit).
- A hardware pass on a Goodview remote and a USB keyboard.
