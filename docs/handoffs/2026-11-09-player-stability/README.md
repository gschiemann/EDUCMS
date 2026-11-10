# Player stability build, 2026-11-09 (lead: claude-fable-5-2, Claude Code desktop)

Owner, in chat, 2026-11-09: "Yes build it but also make sure our player is the best in the business and we have all the functions to ensure it's stable all the time", then, after the gap list: **"Build it all and bypass the codex review because we aren't live yet"**.

Lead's reading: build every gap in `../2026-11-09-player-stability-inventory.md`; the different-vendor review is waived by the owner for this player stability work (#294, #295 and the PRs below). NOT waived, because he did not say so: his explicit "Yes, merge #N" per PR, hardware qualification, the on-glass drill. Record the waiver in `docs/governance/AUTONOMY-REGISTER.md` in the combined PR.

## State
- PR #294 `claude/emergency-hold-release-nonce` open, unmerged (APK only).
- PR #295 `claude/push-stale-reconcile` open, unmerged (web, fleet-wide on merge). Worktree kept at `.claude/worktrees/claude-push-stale-reconcile`.
- Agents (isolated worktrees, never push; rules in `00-AGENT-RULES.md`):
  - wave 1: A `claude/player-process-health` · B `claude/player-app-restart` · C `claude/customer-alert-kinds` · F `claude/device-play-log`
  - wave 2 (after wave 1, Kotlin overlap): D `claude/remote-screenshot` · E `claude/operator-pin-gate`
- Lead then: read each diff, run the checks, combine into one release-train branch (avoids the strict-up-to-date merge treadmill), push, open one PR in the decision format, report. Remove finished worktrees.

## Dispatch log (2026-11-09, ~03:10Z)
- Waiver recorded in the bodies of #294 and #295 (quote + what is NOT waived).
- Running now, each in its own worktree: A process health (Opus) · B app restart (Opus) · C customer alert kinds (Sonnet) · F device play log (Opus) · E screen PIN (Opus). E was re-scoped after reading `OperatorPinGate.kt`'s header: the native gate was detached on purpose (bricked "Exit to device home"); E builds a tenant-set PIN enforced on the server's device-initiated unpair route, no Kotlin, Exit stays ungated.
- Not yet dispatched: D remote screenshot (Kotlin + API + web; wait for B, same command lane and files).
- Not building: captive-portal auto-handling (a portal needs a person), "seamless preload proven on every class" (needs hardware), kiosk lock-task (needs device owner, ruled out).
- When agents return: copy each report here if not already committed on its branch, read the diff, run the checks, combine into `claude/player-stability-train`, push, one PR. Merge nothing without Greg's "Yes, merge #N".

## Lead review log

- **C (customer alert kinds), reviewed by the lead ~03:45Z:** diff read in full for `customer-alert-policy.ts`, `customer-alert-emails.service.ts`, `customer-alert-copy.ts`, the register row and the env row. Accepted as is. Checked: `ScreenAlertIncident.kind` is a `String` column (no enum, so no migration); the new kind rides the same `shadow` default, kill switches, platform gate and restart quiet as the other kinds, so nothing reaches a customer mailbox by default; a failed read returns no candidates; a burst of three or more flips inside 5 minutes is SILENT. The lead has not re-run the specs yet (the agent reports the whole API suite green); they run again on the train branch.
- Owner decisions carried from C: storage stays bell-only? a stored "first offered" time per release and class for an old-version line? 24 h / 14 days for re-pairing?
- A, B, E, F: still running at this entry, no commits on their branches yet. D waits for B.
- **CI read ~03:50Z.** #294: 46 success, 1 skipped, 1 pending; the two E2E shards (chromium 2/2, webkit 4/4) were cancelled at the 30-minute limit after `template-preview-and-startup.spec.ts` (playlist library slideshow, dashboard) failed and retried, so the two E2E summary jobs show failure. That workflow is not one of the nine required checks, the failing tests are dashboard tests the PR does not touch, and the same workflow ends cancelled on `master` pushes and on other branches since 2026-11-09 03:51Z, so it predates this work. #295: 44 success, 1 skipped, the same two shards still running. Not investigated further.

### A — process health (reviewed by the lead, ~04:00Z 2026-11-10)

- Branch `claude/player-process-health`, commit a90e6e5dd, 24 files. Diff read: `ProcessHealth.kt`, `ProcessHealthReport.kt`, the `MainActivity` / `PlayerApp` / `HeartbeatService` / `ProcessExitDiagnostics` hunks, `process-health.ts`, the controller hunks, the env declaration.
- Accepted. Observe-and-report only; the one action is `webView.clearCache(false)` (RAM cache) under real pressure, never while an alert is held or the hold state is unreadable. Header capped at 1,536 chars on the device and 2,048 + strict schema on the server; stored inside `nativeRuntimeReport`, no schema change. Kill switch `PLAYER_PROCESS_HEALTH=off` reaches the device through the heartbeat reply.
- Checked and found fine: the exit description is already reduced to printable ASCII by `ProcessExitPolicy.sanitizeDescription` before it reaches the header, so the strict server schema cannot be tripped by it.
- Hardware fact to state in the PR: Android 14+ no longer delivers the "running critical" trim levels, so the cache free will rarely fire there; the record still does.
- Tests not yet re-run by the lead (the agent reports 1,681 Kotlin tests and API suites passing).

### Plan from here (written at 81 % of the 5-hour limit, resets 06:10Z)

- Train branch `claude/player-stability-train`, cut from `origin/master` in the lead's worktree `.claude/worktrees/claude-push-stale-reconcile`, merging: `claude/emergency-hold-release-nonce` (#294), `claude/push-stale-reconcile` (#295), `claude/customer-alert-kinds` (C), `claude/player-process-health` (A), then B, F, E and D as each is reviewed.
- B (`claude/player-app-restart`), F (`claude/device-play-log`), E (`claude/operator-pin-gate`) were still running with 0 commits at 04:00Z. D (remote screenshot) is not dispatched; it waits for B.
- Nothing merges without the owner's "Yes, merge #N".

### F — device play log (reviewed by the lead, ~04:25Z 2026-11-10)

- Branch `claude/device-play-log`, commit e0ad6ff4d, 24 files. Read: the migration and schema model, the ingest controller, the rate floor, the read controller's guards and tenant constraints, the `page.tsx` hunk (13 lines), `main.ts`, the lease, the env declarations, the upload failure handling in `playLog.ts`.
- Accepted. Tenant comes from the device credential's screen row, never the body; the read side constrains `tenantId` on every query; the migration is one new table with `IF NOT EXISTS`; alerts and drills are never logged and nothing uploads while one is on glass; a 401 / 429 / 5xx keeps the entries for the next slot inside a 2,000-entry cap.
- Blast radius on merge: every screen starts recording on its next page load (about 144 small requests per screen per day) and the table grows about 35 MB per screen per 30 days. Kill switch `PLAY_LOG_DISABLED=1`.
- Owner decisions: retention (30 days default) and whether it is on at merge. No dashboard page was built (proposal in the report).
- Tests not yet re-run by the lead; merge into the train waits for the running test pass to finish (the worktree is in use).

### E — screen PIN (reviewed by the lead, 2026-11-10)

- Branch `claude/operator-pin-gate`, merged into the train as 69f797c04. Read: `screen-pin.ts` (the gate, the limiter, Argon2id), `screen-pin.controller.ts`, the `deviceInitiatedUnpair` hunk, the migration and schema, the manifest key, `unpairPin.ts`, `UnpairPinPad.tsx`, the `page.tsx` hunk. **Not line-read:** `ScreenPinCard.tsx`, the `use-api.ts` hunk, the i18n hunks, the tests.
- Accepted, nothing blocking. No PIN row = today's behaviour exactly. Checked: the `tx.tenant.update` inside `$transaction` does bump the manifest revision after commit (`wrapTransactionForManifestRev`, `Tenant` is a manifest-fed model), so a screen learns the PIN is set on its next manifest.
- Merge fix by the lead: the player rulebook had two rules numbered 18 (play log and PIN); the PIN rule is now 19.
- Known limits: the wrong-guess counter lives in memory, so it resets on every deploy (five fresh guesses per deploy); the refusal audit write is best-effort; a screen still on an old player bundle unpairs locally after the server's 403; a district's PIN does not cover its schools' screens; no e2e and no hardware pass; the two new migrations share a timestamp prefix (they are independent).
- Owner decisions: (1) "Exit to device home" stays ungated? (2) setting the PIN asks for no password re-check — want one? (3) school admins see but cannot set the PIN? (4) should a district's PIN cover its schools? (5) an offline unpair is refused while a PIN is set — wanted?

### B — app restart (reviewed by the lead, 2026-11-10)

- Branch `claude/player-app-restart`, merged into the train as 54a238d46. Report saved as `02-app-restart.md`. Read: `AppRestart.kt`, `AppRestartPolicy.kt`, the `RelaunchEscalation.kt` and `AndroidManifest.xml` hunks, `display.service.ts`, `scheduled-reboot-policy.ts`, `scheduled-reboot.service.ts`, the `customer-alert-emails.service.ts` hunk, `displayControl.ts`. **Not line-read:** the dashboard drawer files, `packages/api-types/src/display-control.ts`, the tests.
- Accepted, nothing blocking. Refused under an emergency hold on the server and again on the device just before the kill (an unreadable hold counts as held); twelve refusal rules including a 30-minute gap and three per 24 hours; a failed landing switches the capability off for seven days by itself.
- Not proven on hardware. About three seconds with no player code running; the alert watch is back about 3–6 s after the kill, content about 8–20 s. If the relaunch alarm is lost, the 15-minute watchdog is the backstop (up to 15 minutes of dark glass). Needs a per-class bench drill, including an alert raised inside the gap and a panel that is scheduled dark.
- Behaviour change to tell the owner: groups that already opted into scheduled restarts (PR #272, which restarts nothing today) start getting app restarts once their screens run an APK with this capability. `SCHEDULED_REBOOTS_DISABLED` still switches the schedule off.
- Owner decisions: (1) the button is hidden on screens that cannot restart — or show it disabled with a reason? (2) deliver the command through the heartbeat as well (needs a schema column), so a screen with no live connection still gets it? (3) the scheduled-restart change above.

### D — remote screenshot: NOT BUILT (2026-11-10)

- Not dispatched. The 5-hour usage window was at 92 % when B returned; a build agent of B's size would have hit the wall mid-task. It is the one inventory gap still open. It builds on B's command lane and needs a privacy default first (K-12: default deny), short-lived tenant-scoped audited storage, and a hardware note (native video surfaces may capture black).

### Owner's review waiver (2026-11-09)

- Verbatim: "Build it all and bypass the codex review because we aren't live yet". Recorded in `docs/governance/AUTONOMY-REGISTER.md` on the train, scoped by the lead to this player stability work. Not waived: the owner's go to merge, hardware qualification, the on-glass drill.
