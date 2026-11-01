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
| Customer alert emails (offline / no picture / recovery / emergency copy) | shadow | `CUSTOMER_ALERT_EMAILS_DISABLED=1`; `_MODE=off` | no email; 15-min restart quiet; platform-incident rule | `customer-alert-policy.spec.ts` | owner (shadow copies) |
| Owner fleet alarms (post-restart check; credential-refusal alarm) | on | `POST_RESTART_FLEET_CHECK_DISABLED`, `DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED` | skipped, never guessed | specs in `notifications/fleet-alarms/` | owner |
| Capacity early-warning | on | `CAPACITY_WATCH_DISABLED=1` | a probe that cannot run is omitted, never invented | `capacity/` specs | owner |
| Video probe auto-heal | on | `VIDEO_PROBE_AUTOHEAL_DISABLED=1` | stamp and retry once per probe version | specs | — |
| Fast-start re-mux | on | `VIDEO_FASTSTART_REMUX_DISABLED=1` | a failed re-mux changes nothing; original kept | `video-remux` specs | — |
| Signage transcode (incompatible video converted) | on | **confirm** | original kept when not smaller / failed | `transcode-profile` spec | — |
| Upload content check | on | `UPLOAD_CONTENT_CHECK_DISABLED=1` | **fail open** — a check that cannot run accepts | `upload-content-verdict` specs | — |
| HEIC → JPEG conversion | on | budget `UPLOAD_HEIC_BUDGET_MS` | fail closed (503) | specs | — |
| Playback gate (video a screen cannot play) | warn | `VIDEO_PLAYBACK_GATE=off` | unknown never warns; never for two-sided units | `PlaybackGateService` specs | operator toast |
| Playback demotion (serve the 1080p copy after bad minutes) | on | `VIDEO_PLAYBACK_DEMOTION=off` / `observe` | no lighter copy → keep playing + notify | specs | tenant + platform, once/day |
| AI model catalog sync (adopts new vendor model versions, no deploy) | on | `AI_MODEL_SYNC_DISABLED=1` | catalog stays where it is | canary test on our key | super-admin page |
| Proof-of-play rollup + raw purge | on | `PROOF_OF_PLAY_ROLLUP_DISABLED=1` | purge never ahead of the rollup watermark | sampler specs | — |
| APK delivery via storage redirect | on | `PLAYER_APK_STORAGE_REDIRECT=off` | byte proxy | — | — |
| Vendor backlight standby (Goodview) | on | `PLAYER_VENDOR_BACKLIGHT=-<uuid>`/`off` | a failed ON after our OFF withdraws BLANK, never WAKE | APK tests | — |
| Setup email verification | auto | `SETUP_EMAIL_VERIFICATION=off` | required only when mail is deliverable | `setup-email-code` specs | — |
| Enforced CSP `script-src` | on | `CSP_SCRIPT_SRC_ENFORCE=off` | no header at all (never half-applied) | `check-csp-prerender.cjs` | — |
| Wedge detector → durable per-screen `REFRESH_WEB` | on | **confirm** | render-proof guard (cache report omitted ≠ wedge) | `screen-wedge-detector.spec.ts` | — |

## Standing approvals (written waivers)

| Scope | Granted by | Date | Expiry |
|---|---|---|---|
| Launch-tracker work (`docs/research/2026-10-24-launch-week/00-PLAN.md`): "launch ready, stop asking" — proceed at the levels already in force; nothing in the standard adds a prompt | owner (recorded by the lead from the 2026-10-23 instruction; owner to confirm scope) | 2026-10-23 | end of the launch freeze |

## Freeze

`FREEZE.md` is present: launch.
