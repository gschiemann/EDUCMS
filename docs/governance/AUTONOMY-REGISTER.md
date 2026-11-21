# Autonomy register — VenueOS

Articles 15, 33, 34; rules in `standard/AUTONOMY.md`. Only the owner raises a level; anyone may lower one; demotion is mandatory the day its trigger is seen. First version 2026-10-31 — levels are the lead's reading of current practice; the owner confirms.

## Life-safety paths (CHANGE ≤ L1 · OPERATE L0 · RUNTIME off the ladder)

| Path | Notes |
|---|---|
| `apps/api/src/emergency/**` | trigger / all-clear endpoints, audit rows, `@AllowPanicBypass` |
| `apps/api/src/realtime/redis.service.ts` (`verifyWsHmac`), the WebSocket signer | the fan-out gate — a forged alert is a life-safety event |
| manifest `emergency` field (`apps/api/src/screens/**`) | the polling backstop |
| `apps/web/src/app/player/**` emergency-first apply, `emergencyInterlock.ts` | RUNTIME rule: cached manifest raises, never releases |
| `apps/player/**` native alert watch, `DisplayEmergency*` | alerts must reach a panel in standby |
| `.github/workflows/emergency-path.yml` and fixtures | a green run with wrong-shaped fixtures hid a fleet-wide drop for months — fixtures are CHANGE class |

## Register A — agent authority

| Category | Level | Ceiling | Evidence | Rollback | Kill switch | Last review | Last demotion |
|---|---|---|---|---|---|---|---|
| Emergency-path change | L1 | L1 | — | revert + drill | — | 2026-10-31 | |
| Live emergency trigger / all-clear in production | L0 | L0 | — | — | — | 2026-10-31 | |
| Schema & migrations (a deploy carrying one) | L2 | L2 | CI gate `check-schema-has-migration.cjs` | additive-only | — | 2026-10-31 | |
| CI/CD workflow definitions | L2 | L2 | — | revert | — | 2026-10-31 | |
| Fleet OTA / field push | L2 | L2 | one class, off-hours; field-build windows table | pin / quarantine | `PLAYER_APK_QUARANTINE` | 2026-10-31 | 2026-10-12 forced 1.1.29 → rule written |
| Player release (tag) | L2 | L2 | hardware qualification gate; override = logged debt | previous APK | — | 2026-10-31 | |
| Fleet-wide reload / broadcast | L2 | L2 | durable per-screen `REFRESH_WEB` is the system's own L4 | — | — | 2026-10-31 | |
| Secret rotation | L1 | L2 | `railway-rotation.mjs finish` refuses an unsafe close | window (`*_PREVIOUS`) | — | 2026-10-31 | 2026-10-23 strand → window rule |
| Merge to `master` | L2 | L2 | branch protection + required checks; lead merges | revert | — | 2026-10-31 | |
| Customer email / message (agent-initiated) | L1 | L2 | — | — | — | 2026-10-31 | |
| Billing & pricing | L1 | L2 | — | — | — | 2026-10-31 | |
| Public content / repository visibility | L1 | L2 | — | — | — | 2026-10-31 | |
| Worktree agents writing code | L1 | L1 | never push; lead reads the diff | discard branch | — | 2026-10-31 | |
| Handoff / memory writes (tracked paths) | L3 | L3 | — | git | — | 2026-10-31 | |
| `CLAUDE.md` / rulebook amendment | L2 | L2 | PR | revert | — | 2026-10-31 | |
| Standard amendment | L1 | L1 | PR in the private repo | — | — | 2026-10-31 | |
| Destructive DB operation | L0 | L0 | `scripts/guard-destructive-db.cjs` | — | — | 2026-10-31 | |
| Platform asset wipe | L0 | L0 | disabled in production | — | `PLATFORM_ASSET_WIPE_ENABLED` unset | 2026-10-31 | |
| CI-failure triage routine (`scheduled-failure-issue.yml` → Claude session) | L1 | L1 | triage and comment only — **GAP: prompt not in the repo, no dedupe** | — | disable the workflow | 2026-10-31 | |
| Weekly review routine (Monday scheduled session; prompt `docs/governance/reviews/WEEKLY-REVIEW-PROMPT.md`) | L1 | L1 | prepares one review PR; reads GitHub + public health only; never merges | close the PR | disable the task in the app | 2026-10-31 | |
| Standing mitigations (revert last deploy; flip a named kill switch; pause OTA / field pushes) | L3 | L3 | subtractive only; logged; owner notified | — | — | 2026-10-31 | |

## Register B — product automations

| Behaviour | Mode | Kill switch (subtractive) | Failure direction when it cannot run | Test | Alerts whom |
|---|---|---|---|---|---|
| Customer alert emails (offline / no picture / needs re-pairing / recovery / emergency copy) | shadow | `CUSTOMER_ALERT_EMAILS_DISABLED=1`; `_MODE=off` | no email; 15-min restart quiet; platform-incident rule | `customer-alert-policy.spec.ts`, `repair-required-policy.spec.ts` | owner (shadow copies) |
| Owner fleet alarms (post-restart check; credential-refusal alarm) | on | `POST_RESTART_FLEET_CHECK_DISABLED`, `DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED` | skipped, never guessed | specs in `notifications/fleet-alarms/` | owner |
| Capacity early-warning | on | `CAPACITY_WATCH_DISABLED=1` | a probe that cannot run is omitted, never invented | `capacity/` specs | owner |
| Video probe auto-heal | on | `VIDEO_PROBE_AUTOHEAL_DISABLED=1` | stamp and retry once per probe version | specs | — |
| Fast-start re-mux | on | `VIDEO_FASTSTART_REMUX_DISABLED=1` | a failed re-mux changes nothing; original kept | `video-remux` specs | — |
| Signage transcode (incompatible video converted) | on | **confirm** | original kept when not smaller / failed | `transcode-profile` spec | — |
| Upload content check | on | `UPLOAD_CONTENT_CHECK_DISABLED=1` | **fail open** — a check that cannot run accepts | `upload-content-verdict` specs | — |
| HEIC → JPEG conversion | on | budget `UPLOAD_HEIC_BUDGET_MS` | fail closed (503) | specs | — |
| Playback gate (video a screen cannot play) | off | `VIDEO_PLAYBACK_GATE=off` | unknown never warns; never for two-sided units | `PlaybackGateService` specs | API response only |
| Playback demotion (serve the 1080p copy after bad minutes) | on | `VIDEO_PLAYBACK_DEMOTION=off` / `observe` | no lighter copy → keep playing + notify | specs | tenant + platform, once/day |
| AI model catalog sync (adopts new vendor model versions, no deploy) | on | `AI_MODEL_SYNC_DISABLED=1` | catalog stays where it is | canary test on our key | super-admin page |
| Proof-of-play rollup + raw purge | on | `PROOF_OF_PLAY_ROLLUP_DISABLED=1` | purge never ahead of the rollup watermark | sampler specs | — |
| Device play log (web player records items on glass, uploads every 10 min; hourly chunked retention) | on | `PLAY_LOG_DISABLED=1` (route accepts and discards, player drops its queue and stands down 6 h); `PLAY_LOG_RETENTION_DAYS≤0` stops the purge | every failure drops the entry, playback and the alert path untouched; no upload during an alert; a purge that cannot run deletes nothing | `play-log.spec.ts`, `playLog.test.ts` | — |
| APK delivery via storage redirect | on | `PLAYER_APK_STORAGE_REDIRECT=off` | byte proxy | — | — |
| Vendor backlight standby (Goodview) | on | `PLAYER_VENDOR_BACKLIGHT=-<uuid>`/`off` | a failed ON after our OFF withdraws BLANK, never WAKE | APK tests | — |
| Setup email verification | auto | `SETUP_EMAIL_VERIFICATION=off` | required only when mail is deliverable | `setup-email-code` specs | — |
| Enforced CSP `script-src` | on | `CSP_SCRIPT_SRC_ENFORCE=off` | no header at all (never half-applied) | `check-csp-prerender.cjs` | — |
| Wedge detector → durable per-screen `REFRESH_WEB` | on | **confirm** | render-proof guard (cache report omitted ≠ wedge) | `screen-wedge-detector.spec.ts` | — |
| OTA emergency hold — no APK install offered while the screen or any side of its double-sided unit, its tenant or an ancestor has an alert or drill, a pushed message of any severity (INFO/WARN banners included) is live, or a side's render proof shows an alert (`apps/api/src/player-ota/ota-emergency-hold.ts`, FLT-04) | on | `OTA_EMERGENCY_HOLD_DISABLED=1` | **fail closed** — unreadable state holds the install; a held push stays pending and is offered after the all-clear | `ota-emergency-hold.spec.ts` | — (API log `decision=uptoDate-held-for-emergency`) |
| Synthetic emergency drill on bench glass (`apps/api/src/emergency/drill/`; design `decisions/2026-10-31-synthetic-emergency-drill-design.md`) | dark (no screens listed); `shadow` when armed; **never autonomous since 2026-11-10 — no schedule, each pass needs a SUPER_ADMIN approval of that pass (Owner console → Emergency test), which no variable can waive** | `EMERGENCY_DRILL_CRON_DISABLED=1` (beats all); unset `EMERGENCY_DRILL_SCREENS`; `EMERGENCY_DRILL_MODE=off`; the owner's Cancel (revoke) | no approval in force, or approvals unreadable → nothing dispatched; cannot run → nothing dispatched, `SKIPPED` row if the DB is writable; cannot verify → `INCONCLUSIVE`, all-clear still sent; in doubt never trigger, always clear; a live alert aborts it; no Redis → no drill | `synthetic-drill.{config,policy,runner,integration}.spec.ts` | owner, `alert` / `on` only (`PlatformAlertMailer`); never a customer |

## Standing approvals (written waivers)

| Scope | Granted by | Date | Expiry |
|---|---|---|---|
| Launch-tracker work (docs/research/2026-10-24-launch-week/00-PLAN.md): "launch ready, stop asking" — proceed at the levels already in force; nothing in the standard adds a prompt | owner (recorded by the lead from the 2026-10-23 instruction; owner to confirm scope) | 2026-10-23 | end of the launch freeze |
| Different-vendor review, for PR #300 only (the emergency drill loses its schedule and needs the owner's approval per pass): "Merge and approval to skip second vendor review". **Not waived:** the on-glass drill of the approved path, and the review for any later emergency-path change | owner, in chat (recorded by the lead) | 2026-11-10 | spent — PR #300 merged 2026-11-10 |
| Different-vendor review, for the 2026-11-09 player stability work only (PRs #294, #295 and the `claude/player-stability-train` PR): "bypass the codex review because we aren't live yet". **Not waived:** the owner's explicit go to merge each PR, hardware qualification before any APK ships, and the on-glass drill on a bench screen | owner, in chat (recorded by the lead; scope is the lead's reading, owner to confirm) | 2026-11-09 | when those PRs are merged or closed; lapses for all later work, and at first customer go-live |
| Different-vendor review, for the 2026-11-15 cost work only (PRs #321, #311 and #322): "don't worry about the second audit for now just get it done", in answer to "Second-vendor review and a bench drill for #311 and #322, then merge". **Not waived:** the on-glass drill of the gateway return path on a bench screen, which needs the owner's approval of each alert test, and the review for any later emergency-path change | owner, in chat (recorded by the lead) | 2026-11-15 | when those PRs are merged or closed; lapses for all later work |
| Different-vendor review for one more pull request: the same-day correction of #321's build-skip rule (branch `claude/ignore-build-fetch-by-url`; the Vercel ignore script, its test and one CI step; no product runtime change). **This is the lead's reading, not a new statement by the owner:** the row above lapsed when its three PRs merged, and the lead applied the owner's same sentence ("don't worry about the second audit for now just get it done") to the correction of a defect found in that work within the hour, and said so to the owner in the same report. It reaches nothing else | lead, on the owner's sentence of 2026-11-15 | 2026-11-15 | when that PR is merged or closed |
| Different-vendor review **and** the on-glass drill / bench test before merge, for the 2026-11-16 release train only (PRs #309, #310, #312, #313, #315, #316, #317, #318, #319, merged as `claude/release-train-2026-11-16`): "finish all of those PR's", then, asked whether to merge #309/#312/#315/#318/#319 now or hold them for a different-vendor review and a real-hardware test, the owner chose "Merge now, waive both". **Not waived:** the on-glass checks still run after deploy (an owner-approved bench drill, the panic-phone setup on a real iPhone, the fallback on a bench screen), and the review for any later emergency-path change | owner, in chat (recorded by the lead) | 2026-11-16 | when the train merges; lapses for all later work |
| Different-vendor review, for the 2026-11-18 wrap-up only: the release train #336 (PR #332 the picomatch gate waiver, the second half of PR #312, PR #327 the device message poll, and the browser-install mirror rewrite in five workflow files) and the installer move from pnpm 9.0.0 to 10.34.9. The owner wrote "Wrap up everything all PR's"; the lead answered that everything left touched security gates, sign-in code, the alert path or CI and asked for one word: "waive" = merge it all today without that review, same as Monday, #327 stays switched off until a bench drill you approve; "hold" = only the weekly review document merges. The owner answered "Waive". **Not waived:** the on-glass bench drill before `EMERGENCY_MESSAGES_FAST_304` is set for any screen, which needs the owner's permission for that test, and the review for any later consequential change | owner, in chat (recorded by the lead) | 2026-11-18 | when those pull requests are merged or closed; lapses for all later work |
| Different-vendor review, for the invitation delivery fix only: the pull request that makes the People page always show the one-time invitation link and offer "Send again", takes the inviter's address out of the invitation subject and adds an HTML part, and records what the mail provider reported (one additive migration on `email_logs`). The lead listed those three parts and wrote that it touches sign-in code, so say "go, waive" (same review waiver as this morning). The owner answered "Go waive". **Not waived:** the review for any later consequential change | owner, in chat (recorded by the lead) | 2026-11-18 | when that pull request is merged or closed; lapses for all later work |

## Holds on a class of change

None. The launch-week hold was lifted by the owner on 2026-11-01 ("we need to finish all our development"). A hold, when one exists, is a row here with its lift condition — there is no separate file.
