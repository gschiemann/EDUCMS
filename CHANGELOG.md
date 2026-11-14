# CHANGELOG — the application rulebook (`CLAUDE.md`)

History of `CLAUDE.md`, newest first, one entry per stamp. It moved here on 2026-11-01 from the "Last Updated" footer of `CLAUDE.md`, which had grown to about 1,800 words in one paragraph; the entries from 2026-10-31 downward are that footer's text verbatim (only the "Previous stamp," / "Earlier stamp," lead-ins and the line wrapping were dropped).

**Keep it current.** When you change `CLAUDE.md`, a nested `CLAUDE.md` or one of the rulebook documents, add an entry here — `CLAUDE.md` carries no footer stamp since 2026-11-01; the entry is the stamp. A stale footer is not cosmetic: `AGENTS.md` carried the IDENTICAL `2026-05-30` stamp while drifting 361 lines from `CLAUDE.md`, which is exactly why nobody noticed it was telling agents to use a forbidden `DATABASE_URL` for three months.

## 2026-11-14

`apps/api/src/emergency/CLAUDE.md`'s drill grader (`drill/synthetic-drill.policy.ts`, life safety CHANGE class — unmerged until the owner's go, a different-vendor review and a re-drill on the bench): a `pending` read or a "no paint proof" row of the SAME alert landing within 3 s of the first paint is one paint reported twice (the page and the app's native layer racing), not a board that dropped. Every persistence FAIL the bench drills recorded on 2026-11-09/10 (GUQ55, FUH43-L, M43) was this race, with a painted proof dated ≥ +60 s following each. Anything later, any other alert, content, or `unconfirmed` is still a FAIL, and the +60 s re-proof is still required.

## 2026-11-10

`apps/api/src/emergency/CLAUDE.md` — the synthetic drill loses its schedule and gains the owner's permission (branch `claude/magical-hawking-85dt29`, life safety CHANGE class — unmerged until the owner's go and a different-vendor review). The owner's rule, given after the drill ran on the bench at 10:30 local on 2026-11-09 and 2026-11-10 with no approval on record: "I need to give permission before a test runs, always", and never in the middle of the day. A pass now runs only when a SUPER_ADMIN approves that pass (Owner console → Emergency test, `/super/emergency-drill`; `drill/synthetic-drill-approval.controller.ts`), now or at a chosen time within 24 h; one approval is one pass; Cancel takes it back and stops a pass before its next screen. Guard 0 in the runner reads the append-only `EMERGENCY_DRILL_APPROVED` / `EMERGENCY_DRILL_APPROVAL_REVOKED` rows fresh in the plan, at the top of every run and again before dispatch; anything absent, spent, revoked, malformed or unreadable is "not approved". `EMERGENCY_DRILL_SCHEDULE` is retired as a schedule (still declared; no value starts a drill); the dead-man check now answers only for a pass the owner approved. No schema change, no new environment variable, no variable that turns guard 0 off. `docs/governance/OWNER-RULES.md`, `docs/governance/AUTONOMY-REGISTER.md` (Register B row) and the design record's 2026-11-10 addendum carry the same change.

## 2026-11-09

`apps/player/CLAUDE.md` gains the page-proof latch on the every-frame bridge (branch `claude/emergency-hold-release-nonce`, life safety CHANGE class — unmerged until a different-vendor review and the on-glass drill): once the player's page has authenticated in a document, an un-authenticated emergency-hold RELEASE on the legacy bridge object is refused and an un-authenticated `heartbeatV2` is a bare liveness tick; a raise is never refused, and a page that cannot authenticate keeps today's behaviour. No environment variable; the web half is a no-op on every APK that lacks the two `*Auth` methods.

`apps/web/src/app/player/CLAUDE.md` rule 4 gains the stale-push recovery (branch `claude/push-stale-reconcile`, player audit findings C and D — web player, deploys fleet-wide on merge): a signed life-safety push refused as stale is still never applied, but now asks the authenticated manifest (pre-empt at most once per 25 s, coalesced in between) and re-measures the server clock offset from `/api/v1/realtime/time`, so a device whose wall clock stepped after sign-in stops refusing every push until its socket reconnects (`staleDropRecovery.ts`). The player also asks the browser once per page load to keep its storage out of automatic clean-up (`requestPersistentStorage` in `storageEstimate.ts`; a request, not a guarantee; Firefox is not asked because it would show a prompt). No environment variable; the gate itself is unchanged.

Customer alert emails gain one kind (`CUSTOMER_ALERT_EMAILS_*` row, branch `claude/customer-alert-kinds`, report `docs/handoffs/2026-11-09-player-stability/03-customer-alert-kinds.md`): a screen whose credential needs re-pairing (`authState = REPAIR_REQUIRED` for at least 24 h, still pinging, two consecutive scans; "still playing, needs attention soon", never an outage; recovery note when trust is back; en + es + zh; same shadow default, kill switch, flap, hourly cap and digest as the other kinds; three or more screens flipped within five minutes are SILENT, the platform's credential alarm owns that). No schema change (`screen_alert_incidents.kind` is a string), no new environment variable. Storage nearly full stays a bell notification (`screen-diagnostics/storage-health.ts` already decided "never an email"), "stuck on an old version" is not built (the server stores neither when a build became available nor per-class availability, and updates are opt-in) and "render proof failing" is the existing not-showing-content rule.

`apps/player/CLAUDE.md` gains "Process health" (branch `claude/player-process-health`, unmerged): the APK now answers memory-pressure callbacks (records every level except UI_HIDDEN; on RUNNING_CRITICAL / COMPLETE / low-memory drops only the player WebView's RAM cache, at most every 10 minutes, never under an emergency hold), runs a main-thread liveness probe (observe and report only, no restart rung), and carries both plus the previous process's OS exit records and the thermal status on the signed native heartbeat (`x-venueos-process-health` → `nativeRuntimeReport.processHealth`); an ANR or native crash is posted once to the crash-report route with the device credential. `docs/ENVIRONMENT.md` gains the kill switch `PLAYER_PROCESS_HEALTH` in the generated section.

`apps/web/src/app/player/CLAUDE.md` gains rule 18, the device play log (player stability gap 7, branch `claude/device-play-log`): the web player records one entry per playlist item on glass (ids and times only, `playLog.ts`), bounded in memory and in localStorage, uploaded every 10 minutes to the device-authenticated `POST /api/v1/screens/:id/play-log`, never while an alert is on glass and never from a preview tab; alerts and drills stay with the audit log. `packages/database` gains `play_log_entries` (migration `20261109120000_play_log_entries`); `docs/ENVIRONMENT.md` gains `PLAY_LOG_DISABLED` (kill switch) and `PLAY_LOG_RETENTION_DAYS` (default 30) in the generated section; `docs/governance/AUTONOMY-REGISTER.md` Register B gains the play-log row.

`apps/web/src/app/player/CLAUDE.md` gains rule 19, the screen PIN for the on-screen Unpair (player stability gap 6, branch `claude/operator-pin-gate`, unmerged): a tenant may set an optional 4–8 digit PIN (Settings → Organization); the device-initiated `POST /screens/unpair/:fp` refuses without it (server-verified Argon2id hash in `tenant_screen_pins`, per-screen lockout, rate-limited audit rows); the manifest carries only the static `unpairPinRequired: true`, absent when unset; with a PIN known the player refuses an offline local-only unpair; the dashboard's "Remove screen", TENANT_CHANGED and "Exit to device home" are never gated. No PIN set = today's behaviour on every path. The native `OperatorPinGate.kt` stays detached. Report: `docs/handoffs/2026-11-09-player-stability/05-screen-pin.md`.

`apps/player/CLAUDE.md` gains the remote app restart (branch `claude/player-app-restart`, unmerged): the APK can end its own process and bring itself back through the existing relaunch ladder without device owner or root; it reports `appRestart: 'relaunch' | 'none'` in its display verdict (auto-detected, no setting), refuses during an emergency hold, an OTA, pairing, setup or user standby, is rate-limited (30 min apart, 3 per day, never in a process younger than 5 minutes), and acknowledges by action id in the native heartbeat. The API's new `APP_RESTART` display action (audit `SCREEN_DISPLAY_APP_RESTART`, refused under an emergency hold like a blank) is what the scheduled restart now sends where a device reboot is unavailable, and an app restart counts as maintenance for customer alert emails. No schema change, no new environment variable.

## 2026-11-08

`apps/player/CLAUDE.md` gains the companion Manager's alert-watch watchdog (Manager wave 5, branch `fable/alert-watch-watchdog`, life safety CHANGE class — unmerged until a different-vendor review and the on-glass drill in `docs/player/ALERT-WATCH-WATCHDOG-DRILL.md`): the native alert watch stamps the Manager's provider after every pass, the Manager judges the stamp while the panel is dark and can only START the watch (re-arm, then restart its host), never the Activity, the hold or a reboot; bounded, persisted, one ladder per device. `docs/ENVIRONMENT.md` gains `MANAGER_ALERT_WATCH_WATCHDOG` (unset = today; `observe` / `on` per screen) by hand and in the generated section.

## 2026-11-01

Rulebook restructure — `CLAUDE.md` becomes the always-loaded core (under 3,000 words) and the detail moves, verbatim, to where the work happens: nested rulebooks in `packages/database/`, `apps/api/src/emergency/`, `apps/web/src/app/player/`, `apps/player/`, `apps/web/public/templates/` and `apps/web/`; documents of the same authority in `docs/ENVIRONMENT.md`, `docs/DEPLOY.md`, `docs/ORIENTATION.md`, `docs/governance/AUDIT-SURFACE.md` (six new sections, 22–27, not yet audited), `docs/governance/AGENT-DISPATCH.md` and `docs/product/CONCIERGE.md`; the Template Design Workflow is kept for history in `docs/design/TEMPLATE-DESIGN-WORKFLOW-LEGACY.md`. Twenty-one incident stories left the rules for `docs/incidents/`, each rule keeping its operative sentences and a link. `CLAUDE.md` no longer carries a footer stamp: this file is the history. `scripts/check-rulebook.cjs` (workflow `rulebook.yml`, no `paths-ignore`) fails CI on a dead path, a code-line pointer, an oversize core or a template count that no longer re-derives. No rule changed; the move map is `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`.

Truth fixes from two independent audits of the rulebook — facts corrected in place, no rule changed. `@AllowPanicBypass` is described as the code behaves (it widens access: `apps/api/src/auth/rbac.guard.ts`). CI is no longer described as blocking: only four build checks are required to merge, the other gates run and report, and Railway and Vercel deploy on push (`docs/governance/decisions/2026-10-31-required-checks-ruleset.md`). The merge recipe and the player release rule are rewritten to the standard's shape — branch `<vendor>/<topic>` → PR → `gh pr checks --watch` → different-vendor review → the Lead merges → tag the merged commit; nobody pushes to master. The hardware gate's scope (release tags only) and state (0 PASS, 945 OVERRIDE) are stated. Counts are re-derived (537 presets, 330 boards, shim V16) and the editability sweep that could no longer fail now points at `apps/web/tools/check-board-editability.cjs`. Domain-model facts (24 per-incident playlist ids, `role` is a string, the Asset statuses, VenueOS staff), the health / deploy-proof / backup recipes (`/health/started`, the `commit` field, no Vercel cron, no `.env` in a tarball, rollback by revert or redeploy, `db-backup.yml`), the Concierge economics and the stale Audit Surface entries are corrected. Pointers into the gitignored research folder, into private memory and at line numbers are removed. The founding-presets list and the Template Design Workflow loop are retired (the latter replaced by a pointer to the binding spec), and this footer's history moved here.

## 2026-10-31

the Foundry Standard adopted (v1.0.0, vendored at `docs/governance/standard/`, pinned by `standard.lock`): `AGENTS.md` now opens with the one-page North Star every model reads first and this file imports it (`@AGENTS.md`, line 1); `docs/governance/` holds the VenueOS profile, the owner rules, the two autonomy registers, the launch freeze and the mechanism map; the old "Model tier" rule in For AI Assistants is replaced by cost-first routing.

## 2026-10-25

customer alert emails, two owner rules (`CUSTOMER_ALERT_EMAILS_*` row): "didn't come back on at its scheduled on time" (a screen dark in its on/off schedule's OFF window and not back at the switch-on is an outage from that switch-on) and a remote power-off excuses only while it really holds on the glass (refused / undelivered never; ends at a schedule switch-on, a wake, a page boot for the soft BLANK); on/off schedule rows now govern their own tenant's screens only; still shadow mode.

## 2026-10-23

owner fleet alarms (`POST_RESTART_FLEET_CHECK_DISABLED` / `DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED` row): a post-restart fleet check (+10 / +20 min, ≥ 3 screens not back) and a device-credential refusal alarm (≥ 3 screens refused 10 min, hourly at most, recovery note), owner-only; the customer alerts' platform-incident owner alert no longer waits out the restart quiet.

Earlier the same day — retired signing key: screens that had not re-registered inside a `DEVICE_JWT_SECRET` rotation window were refused (`401 SCREEN_TOKEN_MISMATCH`) on every re-register after it closed and stayed dark; a prior token naming the screen that no current key verifies is now graded `unverifiable` and gets the same 1-hour credential + `requiresRePair` as no token at all (`isUnverifiableDeviceTokenForScreen`, `screens.register-retired-key.spec.ts`); token-issue audit rows carry a non-secret `mintKeyId`, and `scripts/railway-rotation.mjs finish` refuses to close a window while a live screen has no token on the new key (`DEVICE_*_PREVIOUS` row, `docs/SECRET-ROTATION.md` A-4/A-5).

Earlier the same day — customer alert emails (`CUSTOMER_ALERT_EMAILS_*` row): screen offline / not showing content / back, and an emergency record copy, to each organisation's admins in their language — shadow mode by default (only the owner sees what would have gone out), every false-positive rail tested in `customer-alert-policy.spec.ts`; additive migration `20261023120000_customer_alert_emails`.

## 2026-10-22

player 1.1.51 field candidate (launch blockers; report `docs/research/2026-10-17-player-rock-solid/30-player-1-1-51-launch-blockers.md`): the push channel always comes back (`apps/web/src/app/player/wsSupervisor.ts` — a state-driven tick re-arms the WebSocket when `onclose` never fires: CONNECTING/CLOSING stuck, OPEN but never AUTH_OK'd, silent; same failure counter, same 1–30 s backoff, SSE/HTTP ladder, no give-up; `window.__eduRealtime`); alert paint proof accepts a real WebView (a null background drawable is opaque — `setBackgroundColor` never sets one) and a vendor wake that BLOCKS is bounded to 2 s off the hold path; the back face of a double-sided unit is watched for alerts on its own manifest; a screen that was OFF (dashboard Turn off / hard BLANK, soft schedule) goes back to OFF after the all-clear (`RestoreBlankAfterAlertPolicy`, `SoftScheduleRunner.alertTookOverlayDown`); a native-first face whose manifest is unreachable at start plays its persisted last authenticated selection from the verified disk copy, emergency first (`media/OfflineSelection.kt`); the one content store is wired, dark behind `PLAYER_CONTENT_STORE` (row above); NEEDS_TAP names a staged commit vs an open dialog, an unanswered dialog expires at 30 min on a timer and moves the push to EXPIRED on the API; refused field offers log their reason. The double-post decision is never invisible (0b — M43 on 1.1.50 reported `requested.doublePost` with no answer: the APK's verdict lived only in `timing.doublePost`, which the page's reader and the API's strict schema dropped; now `experiments.applied.doublePost` carries a verdict code on every path — pending / guard-disabled / session-ended / no-surface / the result — the web reader and the API schema accept it, and the delayed decision resolves the session's CURRENT host and surface; L55VEC's missing native report was content — its active schedule is a six-PNG playlist). Nothing hardware-qualified yet.

## 2026-10-22

secret-rotation windows for `DEVICE_JWT_SECRET` / `DEVICE_SECRET_KEY` (`_PREVIOUS` companions, `security/key-ring.ts`; verify/decrypt accept primary then previous, mint/sign/encrypt always primary; leader-leased re-wrap of every stored credential envelope + `POST /super/key-rotation/rewrap`; runbook in `docs/SECRET-ROTATION.md`) after the 2026-10-21 Railway env leak.

## 2026-10-19

player 1.1.43 field candidate (`PLAYER_NATIVE_VIDEO_EXPERIMENTS` row): the pacing behaviours are automatic, no setting — vsync snap on for every solo session with a grid-sized release lead (0.5 P on a 60 Hz grid), the same-resolution ~60 Hz mode asked once per process behind a safety net that reverts an unproven switch and blocks the unit for 24 h, nothing touching the display mode under an emergency hold; the `vsync-snap` / `prefer-60hz` tokens became lead-only kill switches that can only remove behaviour; failure grading phase 0 (network, storage, auth and manifest ends never block native for a day; a web test holds the page's table to the APK's); the panel firmware's own display tables on the device report — report `docs/research/2026-10-17-player-rock-solid/10-apk-1-1-43-defaults.md`; nothing hardware-qualified yet.

## 2026-10-18

player 1.1.42 field candidate (`PLAYER_NATIVE_VIDEO_EXPERIMENTS` row, tokens `vsync-snap` / `prefer-60hz`): vsync-snapped release on a Choreographer-measured grid with a bounded media-clock slew, a same-resolution ~60 Hz mode request at a native session boundary (default OFF — a mode switch can blank the panel), every supported display mode logged per session and on the device report, `keepScreenOn` observed on the native runtime report — report `docs/research/2026-10-17-player-rock-solid/07-apk-1-1-42-pacing.md`; nothing hardware-qualified yet.

## 2026-10-17

player 1.1.41 field candidate (`PLAYER_NATIVE_VIDEO_EXPERIMENTS` row): one compositing contract (the WebView is opaque black in every state; solo native AND positioned slots are composed above the window or refused with `composition-unavailable`; a template zone another zone overlaps stays web, `zone-overlap`), the in-APK device-class policy table (native on every AVC class, Taurus web-only, update path `installer-of-record` or `tap` — the Manager is never device owner), the render-callback interval histogram + persisted timing ledger (reboot-aware), and the three M43 experiments — report `docs/research/2026-10-17-player-rock-solid/02-apk-1-1-41.md`; nothing hardware-qualified yet.

## 2026-10-13

verified template publication: 493 unique presets / 286 HTML boards, including the retail workflow and three reviewed portrait registrations.

## 2026-10-12

per-face native video engine (`PLAYER_NATIVE_VIDEO` row): independent hardware-surface sessions per face, default on for double-sided units only, unqualified on glass.

## 2026-10-06

first-login setup now proves the new email with an emailed 6-digit code (`SETUP_EMAIL_VERIFICATION` row; auto-enforced once the sending domain is verified); the required passkey step can no longer hang on a browser that never opens its sheet; "Copy all codes" says whether it copied.

## 2026-10-05

MOV, AVI, MKV, WMV, MPG, 3GP, TS and HEIC uploads are accepted and converted (videos to MP4 after upload, HEIC to JPEG before the asset exists; one shared format table; `UPLOAD_HEIC_BUDGET_MS` row).

Earlier the same day — uploads are checked by content, not by name (`UPLOAD_CONTENT_CHECK_DISABLED` row): damaged and fake files are refused at upload, a check that cannot run accepts; a publish names the file it cannot prepare.

## 2026-10-04

compatibility before size: a video that is not screen-safe is converted and replaces the original at any size (`processingMeta.screen` is the verdict; delivered video ≤ 30 fps; the colour chain needs ffmpeg ≥ 8, Dockerfile-checked).

Earlier today — Template System counts re-derived (482 presets, 282 boards, shim V14) and the preset-count command repaired (it printed 126 after `system-presets.ts` gained a runtime import).

## 2026-09-29

continuous repetition is the default for every existing and newly paired screen (unset/empty or `PLAYER_LOOP_CONTINUOUS=all`), with player eligibility and native fallback preserved.

Earlier today — sync is decided by the playlist alone (a screen group's `syncMode` is ignored) and the video sync servo no longer seek-loops on slow panels (`sync/videoServo.ts`); the `PLAYER_LOOP_TWODECK` row carries the first real-hardware results.

## 2026-09-26

Player Reliability rule 17 rewritten to what ships: a big file downloads WHOLE in chunked, verified, resumable steps and only THEN plays — readiness-gated playback (`mediaReadiness.ts`; free-run skips an unready slot, a synced group HOLDS it; a new playlist with nothing ready is deferred behind the content on glass), NO 1080p stand-in (Greg's rule, the `bdb3f59a` fallback path deleted), legacy cache entries adopted by hashing on disk instead of re-downloaded, and the emergency tier's large-file lane (≥ 8 MiB only, `tier: 'emergency'`, own staging namespace, set-hash commits only after the confirm pass) — the customer's 4K cache-fill incident, `docs/research/2026-09-26-4k-cache-fill/`; the shared emergency-content check now guards asset and playlist deletion (a Codex ba1a8ed regression); the media-publication sweep is leader-leased and ignores errored rows.

## 2026-09-24

an MP4 whose index sits at the end is now re-muxed to fast start automatically: losslessly, original kept, never for emergency content (`VIDEO_FASTSTART_REMUX_DISABLED` row).

Earlier the same day — video encode grading: every upload is ffprobe'd (probe version 2), graded against the kiosk-safe target in `@cms/api-types` and warned about in the Media Library, the playlist editor and the New Playlist wizard; legacy videos are graded by the `VIDEO_PROBE_AUTOHEAL_DISABLED` cron or on demand; the player's dropped-frame sample lands on `Screen.lastVideoReport` (migration `20260924120000_screen_video_playback`) so the screen Overview can say whether the last clip stuttered.

## 2026-09-23

Railway config-as-code is deprecated (cutoff 2026-12-01): the root `railway.json` lost its `build` section, the API's dashboard mirrors it, and a second service (`renderer`) is wired through the Dockerfile-path setting + `RAILWAY_DOCKERFILE_PATH`.

## 2026-09-22

AI models are catalog DATA that upgrade themselves daily, AI on our key is metered in dollars against an allowance per paired screen (`AI_INCLUDED_USD_*`, `AI_MODEL_SYNC_DISABLED` rows), and our key is now per-vendor with per-job routes and a one-hop failover (`OPENAI_API_KEY` / `GEMINI_API_KEY` row — board design prefers GPT-6 Sol).

## 2026-09-19

added the "a schema change ships a MIGRATION FILE" rules under Database Commands: production runs `prisma migrate deploy` at boot (it has since 2026-05-04), `db:push` is local-only, and the 2026-09-16 fleet incident was a schema change with no migration file — now a CI gate (`schema-has-migration`).

## 2026-09-14

repo back to PUBLIC (cost: Actions spending limit + halved runners), `LICENSE` = source-available notice, rule #5 rewritten.

## 2026-09-13

template-builder rules from the pre-Codex audit: selection is a chrome overlay (never hoist a zone's z-index), an idle hotspot press must still drag, canvas frame sizing in `canvas-frame-style.ts`, presets carry no literal countdown dates; plus the harness + sandbox Playwright config pointers.

## 2026-09-12

added the Meta (`INSTAGRAM_APP_ID/SECRET`, `META_APP_ID/SECRET`) and Google Reviews env rows: the four "Coming soon" Apps tiles are real integrations now, dormant until those keys exist.

## 2026-09-11

corrected the Template System section, which was wrong by an order of magnitude in the file every agent and auditor reads first: **17 → 459** system presets (across SEVEN preset files, not one) and **~107 → 250** EXTERNAL_HTML boards (across five subdirectories, not four — `school/` was missing entirely). Widened the click-to-edit sweep from 191 boards to all 250, fixed the shim version (V5 → V13), and added a re-derivation command for every number so the next person can CHECK rather than trust. Rule 9 now carries the "green test ≠ mounted component" case (`AddSidebar`, deleted here, and `BottomToolbar`).
