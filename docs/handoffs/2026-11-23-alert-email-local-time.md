# Alert emails state the time on the screen's own clock (2026-11-23)

**Status.** Branch `claude/alert-email-local-time`, cut from `origin/master` `9999f1967`. One code commit, `85d34aefd`, then the commit that adds this file. Not pushed, no pull request. Nothing under `apps/api/src/emergency/` changes, so this is not life-safety CHANGE class. It does change the text of a customer email, which is consequential (`docs/governance/AUTONOMY-REGISTER.md`, "Customer email / message", L1). The owner asked for it in writing (below); the copy itself still needs the owner's go on the pull request.

**The owner, after the 2026-11-23 live demo:** "My alert email give me utc time but I want local time of the screen". The rest of that message (a pushed broadcast's banner stayed up through an emergency drill, and after the all-clear the web URL on the MAXHUB L55VEC did not come back until the broadcast was killed) is a separate track and is **not** in this branch.

**Review.** One round in a separate session from the same vendor, under the owner's written waiver ("Don't worry about another model review"): approve, no must-fix. Its points are under "Known limits" and "The owner's decisions".

## What changed

All in `apps/api/src/notifications/customer-alerts/`, plus tests in `apps/api/src/email/`.

- **`alert-time.ts` (new, pure).** `alertTimeLabel(locale, atMs, zone)` formats a moment with the date and the zone always named:
  - en `Mon, Nov 23, 2026, 2:41 PM CST`
  - es `lun, 23 nov 2026, 14:41 hora estándar central`
  - zh `2026年11月23日周一 北美中部标准时间下午2:41`

  Spanish and Chinese name the zone in full, because their short ICU names are only `GMT-6`. A missing, empty or invalid zone formats in UTC and the label says UTC (`8:41 PM UTC`, `tiempo universal coordinado`, `协调世界时`). It never throws. The narrow and non-breaking spaces some ICU versions put before AM/PM become plain spaces, so the text is the same on every runtime.
- **Which zone.** For a screen, exactly its manifest `timeZone` (`manifestTimeZone` in `apps/api/src/screens/screen-time-zone.ts`): `Screen.timezone` > the location's setting > the zone at the nearest saved coordinates (screen, group, location). Where the glass would fall back to the device's own zone, the email uses the nearest location up the chain that has a zone; else UTC, labelled. `Screen.deviceTimeZone` is never used: Goodview panels ship set to Asia/Shanghai. A parity test pins the email's zone to the manifest's whenever the manifest names one, so the email and the glass cannot disagree.
- **Which screens.** On a trigger, the alert's own `screen_emergency_overrides` rows (`alertId` = the alert's id). Group and one-screen alerts write them, and so do school-wide alerts with location-based content. A location in the alert with no row of its own (a plain school-wide alert) has its screens read instead. Both reads are read-only, capped at 1,000 rows and constrained to `tenantId in` the alert's tenants (`check-tenant-isolation` stays at 0). The all-clear reuses the zones the trigger's copy read, because its rows are gone by then; otherwise it uses each location's zone. A failed read still sends, with each location's zone.
- **Several zones.** The lines are grouped by what the clocks *read*, with the alert's own target first. One reading is one line. That is the usual case, and it includes Denver + Phoenix in winter. A district across a zone line gets one line per reading, naming the locations:

  ```
  Time:
    • Mon, Nov 23, 2026, 2:41 PM CST — Springfield District and 2 other locations
    • Mon, Nov 23, 2026, 1:41 PM MST — Mesa Campus
  ```

  Listing was chosen over "the school's zone, and others may differ" because every line is then a true local time, and the one-line case costs nothing.
- **No `(20:41 UTC)` suffix.** The zone is always named, so the instant is unambiguous. The UTC instant stays where an audit or support reader looks: `audit_logs.createdAt` for the trigger/clear row and `email_logs.createdAt` for the send. The suffix would double the one line the owner reads, and triple a multi-zone block.
- **The time is the alert's moment.** `recordEmergency` stamps the time when it is called (right after the action committed). The old code used `new Date()` after the awaited tenant reads, which is the moment the mail left.
- **Screen-problem emails** ("offline since 4:39 PM") use the same resolver. A location that relies on its address (the documented default), a per-screen override, and a school with nothing set (its district's zone) no longer read "UTC". These lines still print a bare local time with no zone name except on the UTC fallback; that is unchanged behaviour (see "Known limits").
- **es copy fix riding along:** "ubicaciones" (the plural read "ubicaciónes").
- **`email_logs`: no code change.** `EmailService` and `PlatformAlertMailer` already store the strings they send. New specs pin that for `ALERT_EMERGENCY`, `ALERT_ALL_CLEAR` (es) and `ALERT_SHADOW_EMERGENCY`.

No schema change, migration or environment variable. The existing kill switches cover all of it: `CUSTOMER_ALERT_EMAILS_DISABLED=1` (hard off) and `CUSTOMER_ALERT_EMAILS_MODE=off`. The default mode is still `shadow`: the owner, through `PLATFORM_ALERT_EMAILS`, gets the English copy a customer would get. Failure direction: when no zone resolves or a read fails, the email still goes, with the time in UTC and labelled UTC. Nothing here can throw into the emergency path: `recordEmergency` stays synchronous, void and swallowing, and runs on a later event-loop turn.

## Why the product failed

`renderEmergencyEmail` (`customer-alert-copy.ts`) had no zone input at all. It formatted `input.at.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'` in all three languages. Its only caller, `sendEmergencyRecord`, passed location names and `at = new Date()` taken after an awaited tenant read. It never looked up a zone, even though `loadTenants` already selected `Tenant.timezone`. `EmergencyRecordInput` carried only tenant ids, so per-screen overrides could not be reached either. In the default shadow mode the owner received that same English render, so the owner saw `Time: 2026-11-23 20:41 UTC`.

The screen-problem emails in the same file did localise their times, but from `Tenant.timezone` only. `loadTenants` fetched no coordinates, so every location that relies on its address for its zone, every per-screen override and every school with nothing set fell back to "UTC" as well.

## Why our system let it reach the owner's demo

1. **The test pinned the defect.** `customer-alert-copy.spec.ts` asserted `'Time: 2026-10-23 15:42 UTC'`. The copy was written UTC-first and the test enshrined that output, not a requirement. No written rule says that a time a customer reads is stated on the screen's clock.
2. **The feature that defined "the screen's time" did not sweep existing customer copy.** The customer-alert emails arrived on 2026-10-23 in `60fc32a28`, a root commit that imported the repository (5,270 files, a commit message about Zod), so their original review is not in git history. One day later, `0542eae5e` (2026-10-24, "automatic per-screen time zones") made the glass and the manifest show local time, with "a location with an address needs no setting". It touched 41 files and none of them was in `customer-alerts/`. On 2026-11-01, `d227c361e` gave the screen-problem emails local "since" times from `Tenant.timezone` alone, instead of reusing `manifestTimeZone`, and left the emergency copy in the same file in UTC.
3. **Nothing mechanical catches it.** No guard flags `toISOString()` or a literal `' UTC'` in customer-facing copy. The owner-only synthetic-drill emails and fleet alarms still print ISO/`Z` times.
4. **Shadow mode worked as designed, slowly.** The register says to move to `on` only after the owner has read the shadow copies for a few days. That reading is what caught this, but it happened in a live demo rather than against a checklist. A short "read a shadow copy against the glass" checklist (zone, date, wording in each language) would have caught it on the first copy.

Proposed, not implemented: a rule in `apps/api/src/notifications/` (prose, or a grep guard in CI) that every time in customer copy goes through `alertTimeLabel` or another formatter that takes the screen's zone. That needs the owner's yes.

## Tests

- `alert-time.spec.ts` (new):
  - Chicago CST in November and CDT in July, in en, es and zh.
  - The spring-forward minute (`1:59 AM CST` and then `3:00 AM CDT`) and the repeated fall-back hour, which only the zone name tells apart.
  - Half-hour and 45-minute offsets: Asia/Kolkata `GMT+5:30` in all three languages; America/St_Johns `GMT-3:30` / `GMT-2:30` (a half-hour offset with daylight saving, in North America); Australia/Adelaide `GMT+10:30` / `GMT+9:30`; Asia/Kathmandu `GMT+5:45`.
  - The date rolling over with the zone.
  - Missing, empty, unknown and malformed zones give UTC, labelled; a non-number moment gives a dash; no narrow or non-breaking space survives.
  - Zone precedence: `Screen.timezone` > the location setting > the address; screen coordinates > group > location; invalid stored ids skipped; a school with nothing set uses its organisation's setting, then its address, then UTC; the device zone is ignored; a parent loop cannot hang the walk.
  - Parity: whenever the manifest names a zone, the email names the same one.
- `customer-alert-copy.spec.ts`:
  - One location gives one local line in en, es and zh, for a trigger, a drill and an all-clear.
  - Clocks that agree give one line; clocks that disagree give one line per reading, target first.
  - Denver + Phoenix give one line in winter and two in summer; a location with two zones is named on both lines.
  - No zone, an unknown zone or no clocks at all give UTC, labelled.
  - The rest of the copy is unchanged. The old UTC assertion is replaced, not loosened: the no-zone case now asserts `Time: Fri, Oct 23, 2026, 3:42 PM UTC`.
- `customer-alert-emails.service.spec.ts`:
  - Zone sources: the location's setting (en and es recipients), the address, the district's zone, nothing (UTC).
  - One screen with its own zone. A stray row naming another tenant's screen is never read.
  - A school whose screens carry another zone. A school-wide alert with no rows, where the read is constrained to the location. A district where only locations without rows are read.
  - A partial read failure, and a district across a zone line, per recipient.
  - The all-clear reuses the trigger's clocks; an all-clear after a restart uses the location's zone; a failed read still sends.
  - The shadow copy carries the local line. The time is the queue moment, not the send moment.
  - Screen-problem emails: the address zone, a per-screen zone with a tenant-constrained read, and the district's zone.
- `email.service.spec.ts` and `platform-alert-mailer.spec.ts`: the `email_logs` row's subject and body equal the dispatched message, for `ALERT_EMERGENCY` (en and zh), `ALERT_ALL_CLEAR` (es) and `ALERT_SHADOW_EMERGENCY`.
- `emergency.alert-emails.spec.ts` (unchanged) still passes: the record copy is queued after the audit rows and cannot throw into the controller.

## Final gates

Run on 2026-11-24, on `85d34aefd`, with a clean tree; this file is the only later change. The run was local, on a 4-CPU / 16 GB machine shared with other workflows. Each heavy command ran alone, through the machine's lock wrapper.

| Gate | Command | Result |
|---|---|---|
| pnpm lockfile drift | `pnpm install --frozen-lockfile --lockfile-only` | pass, lockfile unchanged |
| API + workspace packages build | `prisma generate`, then build `@cms/api-types`, `@cms/scoreboard-cts` and `@cms/signage-design`, then `pnpm --filter api build` | pass, all exit 0 |
| API jest, the touched areas | `jest src/emergency src/realtime src/email src/tenant-isolation src/notifications src/screens/screen-time-zone --ci --maxWorkers=2` | 81 of 81 suites, 2,287 of 2,287 tests |
| API jest, full (the "Build, Lint & Test" command) | `NODE_OPTIONS=--max-old-space-size=4096 jest --ci --maxWorkers=2` | 669 suites pass, 3 skipped, 1 fails; 13,052 tests pass, 56 skipped, 12 fail. All 12 failures are in `src/assets/assets-accept-containers.controller.spec.ts`, with `ffmpeg-failed` from this sandbox's ffmpeg 6.1.1. The same 12 fail in every full run in this sandbox since 2026-11-21, on other branches. `2026-11-21-alert-path-launch-fixes.md` and `2026-11-13-emergency-auth-security-review.md` record them failing identically on `origin/master`. No file under `src/assets` is touched. |
| Web typecheck | `pnpm --filter web exec tsc --noEmit -p tsconfig.json` | clean |
| Web build | `pnpm --filter web build` with `NEXT_PUBLIC_API_URL=http://api.invalid/api/v1` and `NODE_OPTIONS=--max-old-space-size=4096` | pass, 77 of 77 static pages |
| Bundle budget | `check-bundle-budget.cjs` | OK: 2,181 chunks, 20.16 MB, within the ceiling |
| The rest of the web build job | `check-client-sentry` (with `--self-test`), `check-sw-shell`, `check-help-prerender`, `check-brand-contrast`, `check-csp-prerender` | all OK |
| Web jest, full | `pnpm --filter web exec jest --ci --maxWorkers=2` | 724 of 724 suites, 10,726 of 10,726 tests |
| i18n parity | `check-i18n-parity.cjs` | OK. No web string is new. The email's new text comes from `Intl` in en, es and zh; the only copy edit is the es plural. |
| Tenant isolation | `check-tenant-isolation.cjs` | OK: no new unscoped access, 0 grandfathered |
| Environment | `check-env-declared.cjs`, `generate-env-docs.cjs --check`, `check-model-retirements.cjs` | OK: 0 errors, docs match, no dead model |
| Mobile, pills, `inset` | `check-mobile-perf.cjs`, `check-pill-rules.cjs`, `check-inset-serialization.cjs` | OK (pills: 58 legacy, none above the baseline; `inset`: 0 confirmed landmines) |
| `taurus-safety.yml` | `check-taurus-safety`, `check-scene-css`, `check-variant-registry`, `check-board-editability`, `check-widget-truth`, `check-font-ceilings` | all OK, within baselines; no Taurus-shipped file is touched |
| Rulebook | `check-rulebook.cjs --self-test`, then the check; `check-incident-records.cjs`; `check-doc-age.cjs --max-days 180` | PASS, including a rerun with this file in place |
| Request budget | `check-request-budget.cjs --self-test`, then the check; `vercel-ignore-build.test.sh` | OK; no new network call on a screen |
| Schema ships a migration | `BASE_SHA=9999f1967 node scripts/check-schema-has-migration.cjs` (`BASE_SHA` is the merge-base) | OK: schema unchanged |
| Other `ci.yml` steps | `node --test scripts/__tests__/*.test.cjs`, `check-package-tests.cjs`, `check-apk-versions.cjs` | 127 of 127; OK; OK |
| Emergency-path list, Chromium | `emergency-path`, `emergency-drill-paint-proof`, `emergency-instant-board`, `player-native-dual-video` and `player-offline-lazy-renderer`, against the build above, with `CI=true E2E_PREBUILT=1`, `--workers=1`, through a scratch config that points at the preinstalled Chromium 1243 (outside the repo) | 40 passed, 1 skipped, 0 failed, no retries. The skip is the existing Chromium `test.fixme` in `emergency-drill-paint-proof.spec.ts`. The first attempt stopped before any test ran, because port 3000 was held by another workflow's server; the rerun used `E2E_PORT=3147`. No Playwright spec is changed on this branch. |
| ESLint on the changed API files (not a CI gate) | `eslint` on the 8 files, compared with `master`'s versions | Two findings are new apart from formatting: `no-unsafe-assignment` and `no-unsafe-argument` on `this.alertClocks.keys().next().value` (the memo's oldest-first eviction), which is typed `any` by the iterator. The `prettier` counts rise with the added lines; `master`'s versions of these files already fail `prettier`, which is not enforced. |
| Docker build + boot smoke test | not run | no Docker daemon in this sandbox; CI is its gate |
| WebKit | not run | not installed; CI's `webkit · Emergency path` is its gate |

The reviewer ran its own checks on the same head: 10 suites and 289 tests in the touched specs, `tsc --noEmit -p tsconfig.build.json`, tenant isolation and the rulebook, all green.

## Known limits (from the review; none blocks)

- **A school-wide alert with location-based content where only some screens got rows:** the other screens' per-screen overrides are not read, because the location counts as having rows. This is rare. The fix is to read the whole location for every tenant-scope alert.
- **A group or one-screen alert whose rows are not found** (replaced within milliseconds, or the read raced a very fast all-clear): the code reads every screen at the location, so the email can name a zone of a screen the alert never reached. The fix needs the alert's scope in `EmergencyRecordInput`, which only the controller knows (CHANGE class, below).
- **The all-clear's zones come from an in-process memo keyed by the alert id.** After an API restart, or if the all-clear is handled before the trigger's reads finish, the all-clear states each location's own zone and can differ from the trigger email. Passing the reached screen ids from `emergency.controller.ts` (two additive lines after dispatch, inside the existing try/catch) would remove both this and the limit above. That edit is under `apps/api/src/emergency/**`: life-safety CHANGE class, so it needs its own PR, review and on-glass drill.
- **One location with screens in two zones:** both lines name only the location (`... CST — Lincoln`, `... EST — Lincoln`). This is correct, but the lines do not say which screens.
- **Screen-problem emails** still print a bare local time ("offline since 2:41 PM") with no zone name, except on the UTC fallback. That is unchanged behaviour; add the abbreviation in a follow-up.
- **A new recurring read:** `problemClockZones` adds one bounded, tenant-constrained screen read (at most 1,000 ids) on each scan tick that has something to send or hold, including all night while a digest is held. It could skip ticks where nothing will be rendered.
- **Still UTC:** the owner-only synthetic bench-drill emails (`apps/api/src/emergency/drill/synthetic-drill.copy.ts`, `Sent <ISO>Z`; CHANGE class, separate PR), the fleet alarms (`Z`), and the non-alert emails for a new sign-in and break-glass support access.

## What is unverified

- **Production ICU.** The exact es and zh strings were produced on local Node 22.23.4 (ICU 78.3). Production runs `node:22.23.5-alpine`. Official Node images ship full ICU, but that has not been checked here, and a different CLDR could word a zone name slightly differently. The production image could not be checked here: this sandbox has no Docker daemon, so neither the boot smoke test nor an `Intl` probe inside `node:22.23.5-alpine` ran (CI runs the smoke test). A one-line assertion there, that `Intl.DateTimeFormat('es', {timeZone:'America/Chicago', timeZoneName:'long'})` yields `hora estándar central`, would settle it; that is a CI-definition change, so it is the owner's call.
- **WebKit.** No web file changes. The web gates were run for completeness, but WebKit is not installed here; CI's `webkit · Emergency path` is the gate.
- **Real screens and a real inbox.** No email was sent from this sandbox, and no screen was touched. Whether the email's time matches the clock on a bench screen's glass is unverified until the owner's drill below.
- **The MAXHUB L55VEC.** The demo screen's zone (its own override, its location's setting or the address) has not been looked at. The broadcast-banner and web-URL symptoms on it belong to the other track.
- **Deploy.** "Done" needs the merge SHA on `master`, CI green, and `/api/v1/health` reporting `commit` equal to it.

## The owner's bench drill (after merge and deploy; a drill on the internal test tenant only, never a live alert)

1. Confirm `/api/v1/health` reports `commit` equal to the merge SHA.
2. Pick one bench screen on the internal test tenant (the L55VEC is a good choice). Note its location's time zone (Locations: the time zone setting, or "automatic" from the address), any time zone set on the screen itself, and the clock the screen shows.
3. From the dashboard, start a **DRILL** lockdown on that one screen (not the synthetic drill runner: its own drills get no record copy by design).
4. Within about a minute, the shadow copy reaches `PLATFORM_ALERT_EMAILS`: "[shadow] would have sent to N admins at …: VenueOS: Lockdown drill started at …". Check its `Time:` line: the weekday, the date, the local time to the minute as the glass showed it when you pressed, and the zone abbreviation (e.g. `CST`).
5. End the drill. The all-clear shadow copy states the same zone.
6. Optional: set the screen's own time zone to another zone (for example America/New_York), repeat steps 3 to 5 and expect `EST` in both copies, then put it back.
7. Optional, for a school-wide check: a DRILL on the whole test location gives one line (or one line per zone, if its screens show different zones).

## The owner's decisions

1. **The copy** (consequential, L1): the three sample lines above, the multi-zone layout, no UTC suffix, and the es "ubicaciones" fix. The pull request body shows the full rendered emails.
2. **Option B, a separate CHANGE-class PR:** pass the reached screen ids from `emergency.controller.ts` so trigger and all-clear always agree, even across a restart. Recommended, with a different-vendor review (or your waiver) and an on-glass drill.
3. **Follow-ups:** the zone abbreviation on the screen-problem times; the owner-only synthetic-drill and fleet-alarm times; the sign-in and support-access emails; the production ICU assertion in the Docker smoke test; the proposed rule that customer-facing times go through the screen's zone.

## Rollback

Revert the commit. No schema, no stored state, no environment variable. The emails go back to `Time: <UTC>`. To stop the emails entirely without a deploy: `CUSTOMER_ALERT_EMAILS_MODE=off`, or `CUSTOMER_ALERT_EMAILS_DISABLED=1`.
