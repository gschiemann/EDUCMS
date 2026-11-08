# 2026-11-08 — Manager waves, wave 2: screen Diagnostics (#6, #5, #11, #4)

Decision format. Written by Claude Opus 5.5 (Claude Code, worktree agent) for the Lead. Branch `claude/screen-diagnostics`, cut from `origin/fable/manager-unified-release` (PR #270, still OPEN at hand-off — rebase onto `master` once it merges). Nothing pushed, no PR, no tag. The repository is public: no customer names, no secrets.

## Situation

Inventory items from `docs/handoffs/2026-11-08-manager-deep-dive.md` §5, built as one "Diagnostics" family in the screen drawer (Actions/"Settings" tab):

- **#6 Storage health** — free/total disk, a 64 KiB write test, the WebView origin quota (the FUH43 ~160 MB), and a read-only look at the emergency tier; a pre-degradation warning "Storage almost full: new content may not download".
- **#5 Self-test** — "Run self-test" → a pass/warn/fail verdict card per check with a plain-language next step.
- **#11 Network diagnostics** — inside the self-test: validated/captive-portal, DNS of the API host, TLS chain, Wi-Fi RSSI or Ethernet, masked IP/gateway.
- **#4 Logs on demand** — "Get recent logs": last N minutes of logcat for the Player AND the Manager, redacted twice, short-lived signed upload, audited, retention-limited.

Not built (other waves): Manager health, scheduled reboot, alert-watch watchdog.

## Design

**Transport (CLAUDE.md §6, player rule 6).** A request is ONE row (`screen_diagnostics_requests`) plus three cheap scalars on `screens` (`pending_diagnostics_id/kind/at`). It rides:
1. signed pub/sub `DIAGNOSTICS_REQUEST` on `device:<screenId>` (page handles it, WS + SSE),
2. the manifest's `diagnosticsRequest` (all three manifest branches; spread is `{}` when nothing is open, so ordinary ETags are byte-identical),
3. the native status heartbeat's reply `diagnostics: {id, kind, minutes?}` — reaches a panel whose page is dead or asleep.

Acknowledged by VALUE: the device posts its result for the request id; the page and the APK each persist the id they answered (`edu_diag_done_id`, `diag_done_id`). The server is the authority: an answer is accepted only for a PENDING, unexpired request of that screen in that tenant (`verifyDeviceForScreen`, strict, `allowUnpaired: false`); a forged/stale id gets 404/410 and is marked done on the device.

**Self-test** = native half (Android probes, `apps/player/.../diagnostics/`) + page half (`apps/web/src/app/player/screenDiagnostics.ts`: Chrome major, legacy polyfills, manifest age, page→API round trip, origin quota, emergency tier via the SW's existing STATUS reply — never evicts/writes). Graded server-side (`gradeSelfTest`, pure) into 13 checks in 3 groups. Done when both halves land, or native + 45 s grace, or expiry with any half (lazy finalise on read). 10 min TTL.

**Logs.** Native: `logcat -d -t <since>` (own UID) + PlayerLogger tail; the Manager's own logcat through a NEW signature-gated provider `com.educms.manager.diagnostics` (`ManagerLogProvider`, also enforces `HEALTH_PERMISSION` inside `call()`); an older Manager → `managerStatus: companion-too-old`, never a failure. Redacted on device (`LogRedaction.kt`) and again by the API (`diagnostics-redact.ts`: JWTs, Bearer, URL secrets, secret pairs, Wi-Fi psk/passphrase/SSID, e-mails, opaque runs). "Short-lived signed upload": the device may only talk to the pinned API host (`HostAllowlist` — adding the storage host is a signing-key-class change), so the API mints a 5-minute HMAC ticket bound to (screen, request) (`signUploadTicket`, domain-separated over `JWT_SECRET`), the device posts the bundle with `x-diagnostics-ticket`, the API writes the private bucket `device-logs-private` (created/re-asserted private at boot). Download = 5-minute signed URL. Roles: self-test SUPER/DISTRICT/SCHOOL admin; logs and download SUPER/DISTRICT only (API-enforced, UI hides). Audit rows: `SCREEN_DIAGNOSTICS_REQUESTED` (who, IP, role, support grant — written BEFORE the screen is told; a logs request is refused if it cannot be written), `…_LOGS_UPLOADED`, `…_LOGS_DOWNLOADED` (refused if unaudited), `…_LOGS_PURGED`. Retention: leader-leased hourly sweep (`LEASE.SCREEN_DIAGNOSTICS_RETENTION`) deletes bundles after `SCREEN_DIAGNOSTICS_LOG_RETENTION_DAYS` (default 7) and rows after 90 days.

**Storage health.** Own table `screen_storage_health` (never JSON on the hot `screens` row). Native half: header `x-venueos-storage` on the native heartbeat at most every 30 min (write test capped at 1.5 s there so it cannot eat the heartbeat's 8 s wake lock). Page half: `POST /screens/:id/storage-health` at most every 30 min. Grade: almost-full = disk < 1 GiB or < 5 %, or origin ≥ 90 %; critical = disk < 256 MiB or < 2 %, write test failed, or origin ≥ 97 %. Warning shown in the drawer and as ONE bell notification per screen per day on a rise (existing `NotificationsService`, kind INFO, translated by `notificationCopy.ts`). Never an e-mail (customer alert e-mail is the owner's no-false-positive channel).

**Kill switches (all in `env-schema.ts` → `docs/ENVIRONMENT.md`):** `SCREEN_DIAGNOSTICS_DISABLED` (closed: no new requests, manifest/heartbeat stop carrying one), `SCREEN_DIAGNOSTICS_RETENTION_DISABLED` (open: bundles kept), `SCREEN_STORAGE_WARNINGS_DISABLED` (open: no grade, no bell), `SCREEN_DIAGNOSTICS_LOG_RETENTION_DAYS`.

## Files

| File | Why |
|---|---|
| `packages/database/prisma/schema.prisma`, `migrations/20261108120100_screen_diagnostics/` | 3 nullable scalars on `screens` + 2 new tables; additive, idempotent, `lock_timeout` |
| `apps/api/src/screen-diagnostics/diagnostics-policy.ts` | pure: roles, kinds, wire encoding, manifest spread, upload ticket, sanitisers, grader, read-time life cycle |
| `…/diagnostics-redact.ts` | server-side log redaction (reuses `player-logs-redact`) |
| `…/storage-health.ts` | parse/grade/record storage, bell notifier registry |
| `…/diagnostics-heartbeat.ts` | the native heartbeat half (storage in, request out, expiry) |
| `…/screen-diagnostics.service.ts`, `.controller.ts` | operator + device routes |
| `…/screen-diagnostics-retention.cron.ts` | retention sweep |
| `…/*.spec.ts` | 37 tests: commands, auth, tenant isolation, audit, ticket, retention, storage warning, heartbeat ride, redaction, grader |
| `apps/api/src/screens/screens.controller.ts` | ADDITIVE: 1 heartbeat call + 1 reply spread + 3 manifest spreads + imports |
| `apps/api/src/app.module.ts`, `realtime/leader-lease.service.ts`, `storage/supabase-storage.service.ts` | registration, lease name, private bucket |
| `apps/api/src/screens/device-route-inventory.spec.ts` | SEC-001 inventory row for the new device routes |
| `apps/api/src/config/env-schema.ts`, `docs/ENVIRONMENT.md`, `.env.example` | 4 variables, generated docs |
| `apps/player/app/.../diagnostics/{DiagnosticsPolicy,DiagnosticsProbes,LogCollector,LogRedaction,ScreenDiagnostics}.kt` | native probes, runner, logs, redaction |
| `apps/player/app/.../heartbeat/HeartbeatService.kt` | ADDITIVE: storage header + reply hand-off, each in its own `runCatching` |
| `apps/player/manager/.../diagnostics/ManagerLogProvider.kt`, `manager/AndroidManifest.xml` | the Manager's log provider |
| Kotlin tests `DiagnosticsPolicyTest`, `LogRedactionTest`, `ManagerLogPolicyTest` | parse/run-once/masking/timeouts/storage header/wiring/no-emergency; redaction; provider gate |
| `apps/web/src/app/player/screenDiagnostics.ts` (+ test), `page.tsx` (3 one-line hooks + import), `gatewayPaths.ts` | page half |
| `apps/web/src/components/screens/ScreenDiagnosticsSection.tsx` (+ test), `hooks/use-screen-diagnostics.ts`, `v3/ScreenDetailDrawer.tsx` (1 mount line) | the drawer card (shared `Button`, `StatusPill`, `RoleGate`) |
| `apps/web/src/components/notifications/notificationCopy.ts` (+ test fragment) | bell translation of the storage warning |
| `apps/web/src/i18n/messages/{en,es,zh}.json` | every string in 3 languages |
| `apps/web/tests/e2e/screen-diagnostics.spec.ts` | WebKit e2e + screenshots |

## Validation (run in this worktree)

- `cd apps/api && npx jest src/screen-diagnostics` — 2 suites, 37 passed.
- `cd apps/api && npx jest` (whole suite) — 617 suites passed, 1 failed: `config/env-schema.spec.ts`, **pre-existing on the base branch** (undeclared `MANAGER_SELF_UPDATE_LEGACY_LANE` from #270 and `USB_EXPORT_FOLDER_NAME`; neither is mine). 11,768 tests passed.
- `cd apps/api && npx tsc --noEmit` — no errors outside the pre-existing spec files; `pnpm run build` exit 0 (`dist/screen-diagnostics/` present).
- `node apps/api/tools/check-tenant-isolation.cjs` — OK, 0 unscoped. `node apps/api/tools/check-env-declared.cjs` — only the two pre-existing errors above.
- Migration applied TWICE on a scratch Postgres 16 (stub `screens` table) — both exit 0. `node scripts/check-schema-has-migration.cjs` — OK.
- Kotlin: `./gradlew :app:testDebugUnitTest :manager:testDebugUnitTest :app:lintDebug` — BUILD SUCCESSFUL, 1,618 tests, 0 failures (wrapper + `local.properties` copied in, not committed).
- `cd apps/web && npx tsc --noEmit -p .` — 0 errors. Jest `src/components/screens src/app/player/__tests__` — 165 suites, 2,879 passed; notifications suites pass.
- `check-i18n-parity.cjs` OK; `check-mobile-perf.cjs` clean; `check-inset-serialization.cjs` clean; `node scripts/check-rulebook.cjs` PASS.
- WebKit e2e `tests/e2e/screen-diagnostics.spec.ts` (prebuilt server, `E2E_REBUILD=1`) — 4 passed; also proves reachability from the `/[schoolId]/screens` route through the drawer, no horizontal scroll at 390 px.

Screenshots (gitignored, lead's machine): `docs/research/2026-11-08-manager-waves/wave-2/verdict-{pass,warn,fail}-{1325,390}-webkit.png`, `logs-{1325,390}-webkit.png`.

## NOT verified

- **Nothing ran on hardware.** No probe, logcat call, Manager provider call or storage header has run on a panel. Owed on the glass: one Android 9 (FUH43, WebView 66), one Android 11 (GUQ) and one Android 13 (M43/L55VEC) bench screen — self-test answers within a heartbeat, logcat `-t <time>` works on each ROM, the Manager provider answers (needs the Manager from this branch installed — see Risk), a 64 KiB write test on the FUH43, the origin quota shows ~160 MB.
- The API was not run against a live database or Supabase storage (unit doubles only); the private bucket creation and signed URL path are untested end-to-end.
- No chromium e2e run (WebKit only, per the brief).

## Risk

- **The Manager changed** (`ManagerLogProvider` + manifest). Under the one-release-unit rule `manager.version` must move in the release that ships this, or screens keep the old companion and logs say `companion-too-old`. `check-apk-versions.cjs --base origin/fable/manager-unified-release` reported ok because the base already moved it to 1.1.29; re-check against the release base.
- Heartbeat cost: one storage write per screen per 30 min; while a request is open, one `updateMany` per heartbeat (≤ 10–15 min). Idle screens pay nothing (pinned by a test).
- Logs contain building-network detail even redacted; restricted to org admins, audited, 7-day retention.
- `screens.controller.ts`, `HeartbeatService.kt`, `page.tsx`, `ScreenDetailDrawer.tsx` are shared with other waves — my edits are single lines/blocks for an easy merge.

## Rollback

Revert the four commits. The migration is additive (old build ignores the columns/tables). Without a revert: `SCREEN_DIAGNOSTICS_DISABLED=1` stops the feature; `SCREEN_STORAGE_WARNINGS_DISABLED=1` stops the warning.

## Decision

Lead: review + different-vendor review (touches device auth routes and the heartbeat), decide the `manager.version` move for the release carrying it, and run the on-glass checks above on bench screens before any field window.
