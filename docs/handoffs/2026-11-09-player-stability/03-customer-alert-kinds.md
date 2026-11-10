# 03 — Customer alert kinds (build agent C, 2026-11-09)

Branch `claude/customer-alert-kinds`, cut from `origin/master` (58ec24c25). API only. Nothing pushed.

## Verdict per requested kind

| # | Kind | Decision | Why |
|---|---|---|---|
| 1 | Storage nearly full | **Not built as email. Stays a bell notification.** | Already exists and was already decided: `screen-diagnostics/storage-health.ts` grades `almost-full` / `critical` from the native heartbeat header and the page's origin quota, shows it in the screen drawer and sends one bell per screen per day; its header says "never an email: customer alert email is the owner's no-false-positive channel and this signal has not earned it". Kill switch `SCREEN_STORAGE_WARNINGS_DISABLED`. Building a second path would duplicate it. Open decision: if the owner wants an email, the only defensible rule is "`critical` still true after 24 h", because the player's own eviction heals the transient cases. |
| 2 | Needs re-pairing | **Built** (`REPAIR_REQUIRED` + `REPAIR_RESTORED`). | `Screen.authState` / `authStateChangedAt` are stored, and the flip time is written on the transition only (screens.controller register, `repair-required-stamp.ts`), so the age is exact. No customer-facing alert existed (only the fleet chip, a credential timeline event and the owner-only refusal alarm). |
| 3 | Stuck on an old version | **Not built. Signal gap.** | The server stores `playerVersion` / `playerVersionCode` / `playerVersionAt`, but nothing records when a build became available, or per hardware class. The latest release is discovered by polling GitHub at request time (`player-ota.controller.ts`), not stored. "Available for long enough" cannot be computed without inventing a signal. Also updates are opt-in (`autoUpdatePlayerEnabled` default off; operator push), so an email would nag about a choice. Android 11 or older needs an Install tap (`silentUpdateReadiness`), which would have to be the whole email. If wanted later: store `firstOfferedAt` per release and class, then a platform-digest line, not a customer email. |
| 4 | Render proof failing | **Not built. Already covered.** | The existing NO_CONTENT rule is exactly this: pinging, content assigned, `deriveRenderTrustGrade` says `not-painting` (last proof 5 min to 48 h old) or `content-unavailable`, for 20 min on two scans, with video-telemetry and web-page-content exclusions. `repair-required` is deliberately excluded from it (`noContentVerdict`) because a credential refusal looks like a render fault (the 2026-09-04 bug); that is the case kind 2 now covers separately. |

## What already existed that alerts about a screen (found by searching all of `apps/api/src`; read in depth only where noted)

- `notifications/offline-screen-scanner.ts` + `notifications.service.ts`: offline scan, bell `SCREEN_OFFLINE`, owner email, hands rows to the customer alerts (read).
- `notifications/customer-alerts/`: OFFLINE, NO_CONTENT, recovery notes, "didn't come back on at its scheduled time", emergency record copy (read).
- `notifications/fleet-alarms/`: owner-only post-restart fleet check and device-credential refusal alarm (header read).
- `screen-diagnostics/storage-health.ts`: storage bell (read). `storage/storage-watchdog.service.ts` and `capacity/capacity-watch.service.ts`: platform-level owner alerts (names only).
- `notifications/screen-attention/`: dashboard "Screens down" bucketing, no email (read).
- `emergency/drill/synthetic-drill.copy.ts`, `efficiency/efficiency-alerting.service.ts`, `health/platform-health-monitor.service.ts`: owner/platform emails (names only).
- `security/repair-required-stamp.ts`: stamps the state and writes a credential timeline event, no alert (read).

## What I built (kind 2)

Policy (`customer-alert-policy.ts`, pure, specs in `repair-required-policy.spec.ts`):
- `repairCandidate`: due only when `authState = REPAIR_REQUIRED`, marked 24 h to 14 days ago, and pinging now. Not-yet (< 24 h: the 10-minute re-register and the server's one-shot restore window may still heal it; a state the system heals itself never asks the operator), too-old (> 14 days: never emailed on first sight, no flood on deploy), not-online (an OFFLINE matter), missing or future flip time (silence), revoked/pending (never).
- `sharedCredentialEvent`: 3 or more screens flipped within 5 min = one shared cause (the 2026-10-23 key rotation shape); SILENT, owner's credential alarm owns it.
- `repairRecovered`; `ProblemKind` gains `REPAIR_REQUIRED`, so the existing `intendedDowntime` defers apply (maintenance, just installed, remote power-off, standby, update window, synthetic drill), asked of "now" because the state is a day old.

Service (`customer-alert-emails.service.ts`), same flow as the other kinds: two-consecutive-scan confirmation (`repairDue`), DEFER reasons counted in `result.deferred`, SILENT incident rows (`shared-credential-event`), platform gate and restart quiet reset the count, flap (one email per screen per 6 h), per-org hourly cap then digest, one email per location per scan, recovery note after trust has held 5 min and only when the problem email went out, same incident table (`kind` is a string, no schema change), same shadow default and kill switches. A repair problem is excluded from the minutes-wide platform-incident cluster.

Copy (`customer-alert-copy.ts`, en + es + zh): subject, intro, line, "Restore trust" / "Restaurar confianza" / "恢复信任" (matching the web strings), digest label, recovery note. Says plainly the screen is still playing; claims only "so it can report what it is showing again".

## Files changed
`apps/api/src/notifications/customer-alerts/{customer-alert-policy,customer-alert-copy,customer-alert-emails.service}.ts`; specs `repair-required-policy.spec.ts` (new), `customer-alert-emails.service.spec.ts` (mock branch + 14 end-to-end tests); `CHANGELOG.md` (`## 2026-11-09`), `docs/governance/AUTONOMY-REGISTER.md` (existing customer-alert row extended), `docs/ENVIRONMENT.md` (hand-written row sentence), this report.

## Tests run
- `npx jest --no-watchman src/notifications/customer-alerts`: 5 suites, 184 tests pass. Whole `src/notifications` before my service-spec additions: 15 suites, 329 pass.
- Whole API jest suite (`npx jest --no-watchman` in `apps/api`): 633 suites passed, 3 skipped; 12,025 tests passed, 30 skipped, 0 failed.
- `check-tenant-isolation.cjs`: 0 unscoped, no baseline change. `generate-env-docs.cjs --check`: ok. `check-rulebook.cjs`: PASS. `tsc` on non-spec `src/notifications`: clean.

## Kill switch and failure direction
No new variable. `CUSTOMER_ALERT_EMAILS_DISABLED=1` and `_MODE=off` stop it; unset mode is shadow (owner only). Failure direction: a failed screen read returns no candidates, a failed facts read defers, a restart restarts the confirmation. All can only delay or suppress, never add an email.

## Not proven
Nothing on hardware; this is a server rule. The 24 h threshold and 14-day cap are my judgement from the player's 10-minute re-register cadence, not measured against fleet data: the owner should read a few days of shadow copies before `on`. Not checked against production data for how many screens are currently `REPAIR_REQUIRED` and old enough (first shadow pass will show it).

## Overlap with #294 / #295
None (no Kotlin, no web player files).

## Open decisions for the owner
1. Storage email: stay bell-only (recommended) or add "critical for 24 h"?
2. Old-version nag: do we want `firstOfferedAt` per release and class stored (a small additive migration) to enable a platform-digest line?
3. Confirm 24 h / 14 days for re-pair.
