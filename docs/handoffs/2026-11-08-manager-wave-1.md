# 2026-11-08 — Manager wave 1: companion health on the dashboard + signed Manager reports

Decision format. Written by Claude Opus 5.5 (Claude Code, worktree agent) for the Lead. Branch `claude/manager-health-signed-reports`, cut from `origin/fable/manager-unified-release` (PR #270, still OPEN when this was written). Builds items **#1** and **#2** of `docs/handoffs/2026-11-08-manager-deep-dive.md` §5. Nothing pushed, tagged or dispatched. The repository is public: no customer names, no secrets.

## Situation

The dashboard knew only the companion Manager's **version**. It could not tell whether the watchdog was alive, how often it relaunched the Player, whether a rollback fired, or whether an install was waiting for a person. Every Manager report (`ota-state`, `crash-report`) was **anonymous**: the Manager holds no device credential, which is the OTA-01 class.

## What changed

**1 — Health travels Manager → provider → Player's signed heartbeat → `Screen` → drawer.**

- **Manager.** The Manager records its health facts in its own prefs (`health/ManagerHealth.kt`). Each fact is written by one line at the place it happens:
  - the watchdog tick and service start;
  - each relaunch, with its reason: `player-unresponsive` or `after-update`;
  - a rollback;
  - an install that waits for a tap, recorded at `STATUS_PENDING_USER_ACTION` and cleared on success or failure.

  It serves them as one schema-1 JSON row at `content://com.educms.manager.health/manager-health`, which is the contract in `health/ManagerHealthReport.kt`. The row also carries:
  - the quarantine list;
  - `canRequestPackageInstalls()`;
  - the Manager's own version and versionCode;
  - the Manager's clock (`now`).
- **Player.** `ManagerHeartbeatPublisher` reads that row every 30 s, on its own thread, after the heartbeat insert, and caches it (`ManagerReportRelay.readHealth`).
  - `HeartbeatService` sends the cached row as `x-venueos-manager-health`.
  - It sends it only inside the existing `if (nativeAllowed)` block, so only with a device token and an allow-listed host.
  - It drops a copy older than 3 min, and drops anything non-ASCII or longer than 4 KiB.
- **API.** `screens/manager-health.ts` parses the header, but only for a paired screen whose credential is proved.
  - Every device timestamp is converted to the server clock (`receivedAt − (deviceNow − deviceAt)`), so a panel whose clock is off never reads "stale".
  - Unknown relaunch reasons, future timestamps and entries older than 7 days are dropped.
  - The result is stored in `Screen.managerHealthReport` / `managerHealthReportAt`.
  - Only news forces a write: a new relaunch, a rollback, a quarantine, a tap prompt starting or ending, a permission change or a new build. The watchdog tick moves every 30 s and rides the 25 s ping debounce.
  - A Player that reports "no Manager installed" (`mv=''`) clears the health along with the version.
  - The `/screens/fleet?view=operations` rows carry `managerHealth` / `managerHealthAt`.
- **Dashboard.** `components/screens/v3/companionHealth.ts` produces one line, which is rendered as a `companion` row directly under the "Player app" row in the drawer's existing Device card (Technical details). The lines:
  - "Companion healthy".
  - "Companion healthy · restarted the player N times this week (it stopped responding / after an update)".
  - "Waiting for an Install tap on the panel (for 7m)", shown amber.
  - "Companion not reporting since …", shown amber. It appears when the report is fresh but the watchdog tick is more than 5 min old, or when reports stopped while the screen still checks in.
  - "Companion last reported 3h ago", neutral. It appears when the screen itself went quiet; the screen's offline state already says the rest, so the companion is not blamed.
  - A quiet hint for held-back (quarantined) builds, or for a missing install permission ("only needed to recover a player").

  **No report means no row**, so screens on older builds keep the existing version-only line. Strings ship in en + es + zh.

**2 — Signed Manager reports.**

- **Manager.** `health/ManagerReportOutbox.kt` and `ManagerReports.kt` decide where a report goes.
  - **Queued for the Player** when the Player's heartbeat row says `relay=1` and that heartbeat is no more than 5 min old. The queue is bounded at 20, ids only increase, and the crash path uses a synchronous `commit()`.
  - **Posted anonymously, exactly as 1.0.24 does,** in every other case: no Player, an old Player, an unpaired Player, relay switched off, or a dead Player. The bootstrap lane (no Player installed) therefore always posts anonymously.
  - The changed call sites are `OtaInstallReceiver` (install states and the "did not relaunch" error) and `CrashUploader`.
- **Player.** `ManagerReportRelay.drain` runs on the publisher thread.
  - It reads `/reports` and posts each report, at most 5 per round, to `/api/v1/screens/status/:fp/<kind>` with `Authorization: Bearer <device token>`. The body gains `source: "manager"`, `relayedBy: "player"` and `queuedAt`.
  - It acknowledges what it delivered through a provider DELETE carrying the highest acknowledged id. 2xx is acknowledged, and so is 400/404/413/422, because a permanent refusal can never succeed on resend.
  - On 401/403 it stops relaying for 10 min, so the Manager goes back to anonymous posts. On anything else it retries next round.
  - The `relay` column on its heartbeat row tells the Manager whether it relays.
- **API, `ota-state`.** A relayed Manager report is stored as **authenticated**, but it is still the companion speaking.
  - It keeps the Manager-lane noise filters and the needs-tap guard.
  - It can **never hold a push**: `holdFromOtaReport` gets `deviceAuthenticated && !fromManager`.
  - Manager 1.0.24's anonymous posts carry no `source` and take today's path unchanged, under every existing filter. They are stored as unauthenticated, as before (`lastOtaErrorAuthenticated: false`, the ledger and the log line).
- **API, `crash-report`.** The new column `Screen.lastCrashAuthenticated` records whether the caller proved the credential: `true` when relayed, `false` for the legacy anonymous post. The route stays anonymous, and the columns it writes are otherwise unchanged.
- **Kill switch.** `MANAGER_REPORT_RELAY=off` (exactly; unset or any other value means on):
  - the API ignores the health header;
  - every device-authenticated heartbeat reply says `managerRelay: "off"`;
  - the Player stores that and publishes `relay=0`;
  - the Manager then posts anonymously again, which is the 1.0.24 behaviour.

  It is declared in `apps/api/src/config/env-schema.ts`, regenerated into `docs/ENVIRONMENT.md` and `.env.example`, and has a hand-kept row with its failure direction in `docs/ENVIRONMENT.md`.
- **Failure direction:** open. An unparsable report is not stored, and no content, credential, OTA or emergency decision depends on it. On the device, every doubt falls back to today's anonymous post, so a report is never stranded behind a relay that is not there.

## Files

| File | Why |
|---|---|
| `apps/player/manager/.../health/ManagerHealthReport.kt` (new) | The schema-1 health contract (pure; org.json) |
| `apps/player/manager/.../health/ManagerHealth.kt` (new) | Prefs-backed fact store; one-line writers, never throw |
| `apps/player/manager/.../health/ManagerReportOutbox.kt` (new) | Route rule (outbox vs anonymous) and the bounded queue (pure) |
| `apps/player/manager/.../health/ManagerReports.kt` (new) | Outbox store and anonymous fallback POST |
| `apps/player/manager/.../PlayerHealthProvider.kt` | Paths `manager-health` and `reports`, the `relay` heartbeat column, DELETE-acknowledge for reports, `readRelayState` |
| `apps/player/manager/.../WatchdogService.kt` | Tick and start stamps; `forceRestartPlayer(reason)` records each relaunch (Wave 5 also edits this file — my edits are 6 lines) |
| `apps/player/manager/.../OtaInstallReceiver.kt` | Tap-pending note and clear; posts go through `ManagerReports` (Wave 3 also edits this file) |
| `apps/player/manager/.../crash/CrashUploader.kt` | Crash goes to the outbox when the Player relays |
| `apps/player/manager/.../rollback/RollbackInstaller.kt` | `noteRollback` |
| `apps/player/manager/build.gradle.kts` | `testImplementation("org.json:json:20231013")` (test-only) |
| `apps/player/app/.../heartbeat/ManagerReportRelay.kt` (new) | Player-side relay and health cache; pure rules unit-tested |
| `apps/player/app/.../heartbeat/ManagerHeartbeatPublisher.kt` | `relay` column; reads health and drains after each insert |
| `apps/player/app/.../heartbeat/HeartbeatService.kt` | Header on the signed request; reads the `managerRelay` directive |
| `packages/database/prisma/schema.prisma`, `migrations/20261108120000_screen_manager_health/` | 3 nullable columns; additive, `IF NOT EXISTS`, `lock_timeout` |
| `apps/api/src/screens/manager-health.ts` (new) | Parser, change detection, kill switch, relayed-report predicate |
| `apps/api/src/screens/screens.controller.ts` | Heartbeat store and reply; ota-state Manager rules; crash auth column; fleet ops fields |
| `apps/api/src/screens/manifest-hot-cache.ts` | The 3 columns join `SCREEN_TELEMETRY_ONLY_FIELDS` |
| `apps/api/src/config/env-schema.ts`, `docs/ENVIRONMENT.md`, `.env.example` | `MANAGER_REPORT_RELAY` declared and documented |
| `apps/web/src/components/screens/v3/companionHealth.ts` (new) | The drawer line (pure) |
| `apps/web/src/components/screens/v3/ScreenDetailDrawer.tsx`, `screenOps.ts` | Companion row in the Device card; `OpsScreen` fields; `DeviceFact` key |
| `apps/web/src/i18n/messages/{en,es,zh}.json` | `screens.drawer.companion.*` |
| Tests: `ManagerHealthContractTest.kt`, `ManagerReportRelayTest.kt`, `manager-health.spec.ts`, `companionHealth.test.tsx`, `tests/e2e/companion-health.spec.ts` | Provider contract, relay, storage/auth/legacy, drawer line, WebKit screenshots |

## Validation (run in this worktree)

- Kotlin: `./gradlew :app:testDebugUnitTest :manager:testDebugUnitTest :app:lintDebug :manager:lintDebug` passed (BUILD SUCCESSFUL). The new suites have 10 and 7 tests, with 0 skipped, so the source-shape guards did run.
- API:
  - `npx jest src/screens/manager-health.spec.ts`: 18/18 passed.
  - `npx jest src/screens src/player-ota src/config src/device-settings`: 107/108 suites and 1566/1567 tests passed. The one failure is `env-schema.spec.ts`, which flags `MANAGER_SELF_UPDATE_LEGACY_LANE` (`player-ota/manager-update-lane.ts`, from #270) and `USB_EXPORT_FOLDER_NAME`. Both were undeclared before this branch and neither is mine; `node apps/api/tools/check-env-declared.cjs` reports the same two.
  - `pnpm run build`: exit 0.
  - `node apps/api/tools/check-tenant-isolation.cjs`: OK, 0 unscoped.
  - `node apps/api/tools/generate-env-docs.cjs --check`: ok.
- Migration:
  - `node scripts/check-schema-has-migration.cjs --base HEAD~1`: OK.
  - Applied twice on a scratch Postgres 16 (a minimal `screens` table): both applies exited 0, and the second printed "already exists, skipping".
- Web:
  - `npx tsc --noEmit -p .`: 0 errors.
  - `npx jest src/components/screens/v3`: 12 suites, 377 tests passed.
  - `node apps/web/tools/check-i18n-parity.cjs`: OK.
  - `node apps/web/tools/check-inset-serialization.cjs`: clean.
- `node scripts/check-rulebook.cjs`: PASS.
- WebKit e2e and screenshots: see "Screenshots" below.

## Screenshots

Captured with `COMPANION_SHOTS=<dir> E2E_PORT=3117 E2E_REBUILD=1 npx playwright test tests/e2e/companion-health.spec.ts --project=webkit` into `docs/research/2026-11-08-manager-waves/wave-1/`. That directory is gitignored and exists on the Lead's machine only. There is one PNG per state (healthy, restarts, tap, silent, quarantined, legacy) at 1325×758 and at 390×844. The spec opens the real `/<slug>/screens` route and the real drawer, which proves the row is reachable from a route.

## What is NOT verified

- **Nothing ran on hardware.** These are unproven on the glass:
  - the provider paths;
  - the relay;
  - the `commit()` from a dying Manager process;
  - `canRequestPackageInstalls()` on Android 9/11/13.

  The first proof needs a field build on one bench screen per class. On the dashboard, the companion row should appear within about 5 min (the native heartbeat floor). Then kill the Player with `am force-stop` and expect "restarted the player once this week (it stopped responding)".
- The relay posts at most 5 reports per 30 s tick. A burst larger than the 20-entry cap drops the oldest reports, by design.
- The Player's pending-tap state for its own update is reported by the Player (`NEEDS_TAP`), not here. The drawer's tap line covers only installs the **Manager** committed: the bootstrap and the rollback.
- The rollback hint says "holding back N builds". It deliberately does not claim a restore, because the deep dive (§3.5) found that a release-signed, non-device-owner fleet cannot downgrade.

## Rollback

Revert the commits.

- **API.** The change is additive: three nullable columns, and the header is ignored by older APIs. `MANAGER_REPORT_RELAY=off` stops the relay without a deploy of the APK.
- **Device.** Behaviour changes only in the next APK build. An old Player never sets `relay=1`, so a new Manager keeps posting anonymously. A new Player with an old Manager finds no `manager-health` / `reports` path and carries nothing.

## Decision

The owner's go is needed to merge. This is a consequential change: it touches device telemetry and the OTA report route, and it is not on the emergency path. A different-vendor review is recommended.
