# Open work and pending decisions — inventory (2026-11-14)

Compiled read-only by a sub-agent (git, GitHub reads, handoff files) at master `5d2f9e7`, then checked by the lead session where marked. It did **not** verify anything on Railway, Vercel, Supabase or any device. Session-list facts at the end come from the lead's `list_sessions` read.

## Headlines

- Branch `claude/jolly-newton-on7lv4` holds security and emergency fixes (F1–F4 + the all-clear "Enter in CLEAR" fix) with **no PR**.
- **No penetration-test report exists** on master or any recent branch. The two pen-test sessions started 2026-11-13 ("App penetration test", "Pen test flagging issue") are in a failed state (lead, `list_sessions`).
- PRs #309, #310, #311 are open drafts; none has a different-vendor review.

## (A) Needs the owner's decision

- A1. Disable `com.signway.assistapp` (the panel vendor's remote-control accessibility service) on all 19 screens — RIOT Houston 7, RIOT Cleveland 5, Brookfield 5, ARC IR 3. Recommendation: yes, every unit. Source: `docs/handoffs/2026-11-14-push-channel-gateway.md` (PR #311 branch).
- A2. Merge go for the emergency-path PRs #309, #310, #311 and the unpushed security branch (C1). Each needs the owner's written go, a different-vendor review and a bench drill. Suggested order: #309, #310, #311.
- A3. Waive or require the different-vendor review for the F1–F4 security fixes (auth + emergency path). Recommendation: do not waive; the AUTONOMY-REGISTER waivers (#294/#295 train, #300) are spent. Source: `docs/governance/AUTONOMY-REGISTER.md`.
- A4. Turn customer alert emails on for RIOT and ARC IR (all incidents are `emailed_mode=shadow`, owner only; ARC IR had 4 screens dark up to 35 h, RIOT 5, no customer told). Recommendation: per customer, after confirming the shadow emails reach the owner. Source: fleet audit item 3.
- A5. Session length is 30 days for everyone including owners. Recommendation: 7 days or 24 h for owner and district-admin accounts. Source: `docs/handoffs/2026-11-13-session-handoff.md`.
- A6. `/panic` for teachers: quick fix (restore the remembered session) and a separate "panic device" enrollment — being built as drafts 2026-11-14 (lead).
- A7. Stop scheduling a file to a box class that cannot play it (video stutter); Cleveland HB Portrait: turn off the "4k" playlist for the Flat Panel Displays group (dashboard action). Source: session handoff.
- A8. Gateway mode never returns to direct mid-session; with the WebSocket direct (PR #311), a direct `AUTH_OK` could end it. Design change. Source: push-channel handoff.
- A9. Logging, rulebook and policy: log drain destination and budget (`docs/governance/decisions/2026-11-09-log-drain-options.md`, Decision blank); CODEOWNERS or a quoted-go check (`2026-11-01-codeowners-proposal.md`, recommends Option B); Dependabot alerts #36/#51/#53/#49 dismiss or keep (`2026-11-08-dependabot-alerts-triage.md`); unified field candidate 1.1.66-field.1, retiring `manager-v*` tags, arming a bench window (`2026-11-08-manager-deep-dive.md`); the wave-5 alert-watch watchdog awaits a different-vendor review and a drill.
- A10. Player-stability decisions (`2026-11-09-player-stability/README.md`): play-log retention (30 days) and whether on at merge; screen PIN questions; restart-button behaviour and heartbeat delivery (schema column); storage bell-only; 24 h / 14 day re-pair windows. Not confirmed which are already decided.
- A11. Playlist fallback: ruling recorded (last resort, must notify admin); open: whether the notification also goes by email.
- A12. Security sweep follow-ups (`2026-11-13-security-patch-sweep.md`): a vendor-release check beside `check-node-security.cjs` (CI change); pin Chromium, ffmpeg, openssl in the images; major upgrades (Prisma 7, Nest 12, Sentry 11, simplewebauthn 14, ioredis 6, helmet 8).

## (B) Built, waiting to merge

- B1. PR #309 (draft) — drill grader first-paint race. Required checks green; the aggregate E2E shows failure because shards chromium 2/2 and webkit 4/4 were cancelled after ~30 min (re-run, not a code fix). Blocks: owner's go, different-vendor review, owner-approved bench re-drill.
- B2. PR #310 (draft) — push-dead recovered per outage. Blocks: CI finish, owner's go, review.
- B3. PR #311 (draft) — push channel direct + SSE ticket re-mint. Blocks: CI, different-vendor review, owner's go, on-glass tests.
- B4. PR #307 — merged 2026-11-14 as `5d2f9e7`. Lead verified: `/api/v1/health` commit `5d2f9e7`, Vercel production deploy for `5d2f9e7` READY; master CI & Security run still finishing at time of writing.

## (C) Unfinished or unpushed work

- C1. `claude/jolly-newton-on7lv4`, **no PR**: F1 (revocations lost on a Redis wipe), F2 (bulk-trigger validation), F3 (floor-plan ids tenant-checked), F4 (SSE forwards only signed fields), the all-clear "Enter in CLEAR" fix, built on the owner's "Ok fix everything". Needs a PR, different-vendor review, the Emergency-path CI jobs, a bench drill for F2–F4. Handoff: `2026-11-13-emergency-auth-security-review.md` on that branch.
- C2. `claude/fallback-notify-wip` — being finished by an agent on `claude/fallback-notify` (2026-11-14).
- C3. `claude/playlist-fallback-hold` — held, superseded by C2; carries two OWNER-RULES rows dated 2026-11-13 not on master that bind the work. Decide whether to land those rows on their own.
- C4. `claude/website-draw-proof` — Android website-slide draw proof, no PR. Needs the first Gradle compile (`player-kotlin-check.yml`), an admin-notification gap closed, a different-vendor review (a script runs in third-party pages), a player release with hardware qualification. Never run on a device.
- C5. Older unmerged branches with commits since 2026-11-01 and no open PR: `codex/native-solo-resume-stability`, `codex/native-store-web-discovery`, `codex/fuh-store-enrollment-repair`, `codex/player-offline-remote-recovery`, `codex/player-cache-recovery` (Nov 3–4, player fixes); `codex/hospitality-guest-essentials` (Nov 3), `codex/free-widget-connections` (Nov 7), `widget-truth-picker` (Nov 1), `fix/media-v2-e2e-followup` (Nov 2); `claude/field-1.1.67-fix-only` (Nov 9), `claude/guq55-metabase-sandbox-report` (Nov 8, doc), `fable/alert-watch-watchdog` (Nov 8, doc); `phase1/drill-design`, `phase1/railway-iac`, `phase1/db-restore-drill`, `phase1/supply-chain-scans` (Nov 1). Recommendation: triage each as merge, rebase or delete.

## (D) Shipped but unverified

- D1. Remember-me (PR #301) and passkey button (#306) — never tried on a real phone. Check: sign in with "Keep me signed in" on iPhone, switch apps, return; if signed out, read the Vercel log for `[session] refresh outcome=`. Also passkey-only sign-in on iPhone and laptop.
- D2. PR #307 — see B4.
- D3. PR #300 emergency drill (no schedule, SUPER_ADMIN approval per pass): approve one pass after hours and watch a bench screen.
- D4. Field builds and old releases on customer screens (Cleveland 1.1.55-field.1, Portland 1.1.67-field.1, Houston 1.1.23, ARC IR 1.1.29); Houston units report `hardwareClass GENERIC` though they are Goodview rk3288.
- D5. Production Redis persistence and `maxmemory-policy` unverified (F1).
- D6. Houston Video Wall "nightly" updates at 7:44 AM Chicago — under investigation 2026-11-14.
- D7. 12 daytime reboots (7 AM–5 PM local) not traced; wrong device time zones on several boxes.

## (E) Known problems nobody is working on

- E1. Life safety: GUQ55 persistence FAILs (2 of 2), FUH43-L and M43 once each, M55SAR one delivery FAIL. PR #309 shows the persistence FAILs were the grader's first-paint race (pending the bench re-drill); M55SAR's delivery FAIL is real and unexplained. Also `2026-11-07-fuh-storage-black-after-alert.md` (all-clear meets a cache that cannot finish).
- E2. Life safety: DH43's back face is not on the drill list (skipped 16 times, `pane-not-listed`).
- E3. Security: no penetration-test report exists; the emergency/auth review on `jolly-newton` names what it did not cover (MFA, passkeys, password reset, device pairing and renewal, tenancy outside emergency routes, rate limits, XSS/CSRF, the APK, the renderer).
- E4. Long-silent screens with no incident: LED Poster 1 and 2 (bench, 24 days), VisionCore "Venue-OS Media Player" (22 days).
- E5. Daily push-channel deaths with no known cause (Houston Left and Right, Cleveland Video Wall after standby, bench L55VEC and G75); the dashboard shows no push-channel state or gateway mode.
- E6. Sign-in defects not in #301: throttle keyed on Vercel's egress; no grace window on refresh rotation; first-step passkey ignores the checkbox; `/panic` and legacy pages redirect without restore (A6 covers `/panic`); `docs/CUSTOMER_PILOT_GUIDE.md` says "up to 8 hours of idle time" (code allows 30 days); CSP `connect-src` reports blocking Supabase storage from the assets page and `sw-player.js` (enforcing vs report-only unknown).
- E7. Security sweep still open: advisory gates blind to vendor releases; images' Chromium/ffmpeg/openssl unpinned; Next's vendored React Server Components fix unverified; sanitize-html 2.18.2 not assessed; ws, jose, jszip release notes unread; tolerated alerts (glob, minimatch, zod 3, deepmerge); Android library versions and each panel's System WebView (Chrome 87–116 on Android 7.1.2/11); follow-ups once five days old (next 16.4.6, fast-xml-parser 5.12.1, fast-xml-builder 1.3.2); `docker-compose` uses `growthbook:latest`.
- E8. On `jolly-newton`: the player checks only that a push signature is present (asymmetric KMS signing pending); replay within 120 s accepted.
- E9. Who set `EMERGENCY_DRILL_SCREENS` on Railway is unknown (variable history only in the dashboard's activity feed).
- E10. Cleveland: Free Standing Display went white on a website slide while reporting healthy (C4 would address it); 4 menu boards and double-sided units go offline ~4:20 PM ET daily; `play_log_entries` empty for all 8 screens; 7 days of OTA failures (L55VEC bench ×7, ARC IR Lobby Menu Board ×1); every page reload renews the device token although the rule says only inside the last 14 days.
- E11. Process: nothing checks a PR body for the six elite-standard questions; the database restore has never been drilled (Phase 1).

## Other sessions waiting on the owner (lead, `list_sessions`, 2026-11-14 14:05 UTC)

- "Master founding prompt for autonomous software" — blocked on: log drain destination and budget, the on-call routine's two secrets, Railway apply, org move and private timing, KMS vendor and break-glass, customer "fix shipped" email gate, cost ledger.
- "Wellness check" — blocked on a question to the owner ("Should I add the same safeguard there?").
- "Qwen access" — blocked: needs the EDUCMS folder shared from the Mac mini (Claude desktop → Settings → Claude Code → Remote Control).
- "App penetration test" and "Pen test flagging issue" (2026-11-13) — failed; no report produced.
