# CHANGELOG — the application rulebook (`CLAUDE.md`)

History of `CLAUDE.md`, newest first, one entry per stamp. It moved here on 2026-11-01 from the "Last Updated" footer of `CLAUDE.md`, which had grown to about 1,800 words in one paragraph; the entries from 2026-10-31 downward are that footer's text verbatim (only the "Previous stamp," / "Earlier stamp," lead-ins and the line wrapping were dropped).

**Keep it current.** When you change `CLAUDE.md`, add an entry here and bump the date in its two-line footer. A stale footer is not cosmetic: `AGENTS.md` carried the IDENTICAL `2026-05-30` stamp while drifting 361 lines from `CLAUDE.md`, which is exactly why nobody noticed it was telling agents to use a forbidden `DATABASE_URL` for three months.

## 2026-11-01

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
