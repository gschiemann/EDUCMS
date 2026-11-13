# Session handoff — 2026-11-10 to 2026-11-13

Written because the session was about to hit its usage limit. Everything below is on the remote; nothing lives only in a container. Read `docs/governance/OWNER-RULES.md` first — two rows dated 2026-11-13 on the branch `claude/playlist-fallback-hold` are not on `master` yet and they bind this work (the elite standard and its six questions).

## Live on production (merged, deployed, each still unproven on a real device)

| PR | What | Owner's test still owed |
|---|---|---|
| #300 | Emergency drill has no schedule; every pass needs a SUPER_ADMIN approval (Owner console → Emergency test) | Approve one pass after hours, watch a bench screen |
| #301 | Remembered session survives leaving the browser on a phone | Sign in with "Keep me signed in", switch apps, come back |
| #306 | "Sign in with a passkey" button on both sign-in steps | Sign in with a passkey on iPhone and laptop without typing a password |

## In flight

| Branch on origin | State | Next step |
|---|---|---|
| `claude/magical-hawking-85dt29` → **PR #307** | Security patch sweep (Next 16.4.5, undici 7.30.2, Node 22.23.5, three smaller) plus this handoff. Auto-merge armed | Confirm it merged and `/api/v1/health` reports the merge commit; `docs/handoffs/2026-11-13-security-patch-sweep.md` lists what is still open |
| `claude/playlist-fallback-hold` | Playlist fallback v1 (web player) + the two owner-rule rows. **HELD by the owner's ruling:** a fallback must be the last resort and must notify the admin | Do not merge as is. Superseded by the WIP below once that is finished |
| `claude/fallback-notify-wip` | **Unfinished, unverified snapshot** of the rework on top of the fallback: two-minute last-resort dwell, the player reports the fallback on its telemetry post, a `Screen.playlistFallback` column + migration, audit rows, a notification through `NotificationsService`, an amber dashboard state. Taken mid-work from a sub-agent's worktree | Review every file; finish; run the checks in its brief (below); answer the six questions in the PR; owner's go; different-vendor review (schema + player) |
| `claude/website-draw-proof` | Website slide draw proof: the Android app checks a website slide drew something, reloads a blank page (bounded), reports the truth to the dashboard. Record: `docs/handoffs/2026-11-13-website-draw-proof.md` on that branch | Open a PR to get the first Gradle compile (`player-kotlin-check.yml`); close the gap "no admin notification"; different-vendor review (one read-only script now runs in third-party pages); then a player release with hardware qualification — it reaches no screen without one |

### The brief the notification rework was given (so it can be finished)

A) Last resort: the card must be up two minutes continuously before the switch; the timing rule lives in `apps/web/src/app/player/playlistFallback.ts` with tests; the e2e stays fast through an existing test seam or `page.clock`, never a URL parameter a device could be given.
B) Notify and show the truth: the player includes `playlistFallback: { fromPlaylistId, toPlaylistId, sinceMs }` (ids only) on `POST /api/v1/screens/:id/telemetry` while on a fallback; the API validates both playlists against the screen's tenant, looks names up server-side, stores the state on the screen (one nullable JSON column, additive idempotent migration, added to `SCREEN_TELEMETRY_ONLY_FIELDS`), writes `PLAYER_PLAYLIST_FALLBACK` / `_ENDED` audit rows on the transitions, raises one notification per screen + playlist per UTC day through `NotificationsService.notify`, and the dashboard shows an amber "showing backup playlist" state in en + es + zh. Whether that notification also reaches people by email was to be reported, not built.

## Open items the owner knows about

- **RIOT Cleveland (customer tenant `riot-cleveland`, 8 screens), 2026-11-11:**
  - "Cleveland High Brightness Portrait" was on `idle:content-unavailable`: two active schedules on its group, and the newer "4k" playlist (one 187 MB video) outranks "HB PT PL"; the rk3288 box cannot play it. Quick fix is turning "4k" off for the Flat Panel Displays group in the dashboard — not done (no dashboard session; a direct database write would skip the manifest cache invalidation).
  - "Free Standing Display" went white showing `https://playlist.cpl.org/` while reporting healthy; cause unproven (see the website record).
  - Four screens (menu boards, double-sided) go offline together about 4:20 PM ET daily, classed as a daily pattern; the Video Wall goes to standby at 4:16 PM. Probably end-of-day power-down; not confirmed.
  - All eight run player 1.1.55-field.1 — a field build on customer screens.
  - `play_log_entries` has no rows for any of them; not investigated.
- **Who armed the drill:** unknown. `EMERGENCY_DRILL_SCREENS` is set on the Railway `api` service; Railway's tools do not expose variable history; only the dashboard's activity feed does.
- **Mobile sign-in root cause:** not proven; the fix covers both candidates and logs each session-route outcome. If it recurs, read the Vercel log for `[session] refresh outcome=`. Record: `docs/handoffs/2026-11-10-mobile-remember-me-logout.md`.
- **Session length:** 30 days for everyone including owners; recommended 7 days (or 24 h) for owner and district-admin accounts — not decided.
- **Panic button:** `/panic` sends a teacher to the sign-in page without trying the remembered session; proposed a quick fix and a separate "panic device" enrolment — not approved, not built.
- **Proposed and not approved:** acting on unresolved video stutter (stop scheduling a file to a class of box that cannot play it).
- **Alert emails** are in shadow mode (owner only).
- **Content-security-policy reports** in the Vercel log for uploads to storage from the media library page — owner believes the upload problem was the drill; not investigated.
- **Standard gap:** nothing checks a PR body for the six questions.
- **Unrelated test noise on this machine:** 12 failures in the API real-file video-transcode spec; web `mp4-inspect.test.ts` does not load; `player-never-interrupt` case 5 fails against a dev server.

## Review waivers on record

Different-vendor review was waived by the owner, per PR only, for #300, #301 and #306. Nothing is waived for the fallback, the website proof, or any later change.

## Session tooling notes

- Supabase, Vercel and Railway connectors dropped mid-session on 2026-11-13; all three had worked earlier (Supabase project `bhdaxzfalaycfopvcopm`, Vercel project `educms`, Railway project `graceful-embrace`).
- Playwright here needs `launchOptions.executablePath: '/opt/pw-browsers/chromium'`; the pinned version does not find the preinstalled browser.
- The pre-push hook runs a long preflight; a push can take several minutes.

Models: Claude Fable 5.2 (Anthropic, Claude Code on the web), lead session with four sub-agents.
