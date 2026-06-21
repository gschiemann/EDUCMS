# Sports-Venue Setup-Menu Revamp — research + execution dossier

Greg's directive (2026-06-16): full revamp of the confusing/ugly sports Setup menu —
"best in the world, use as many agents as needed" — plus a HIGH-PRIORITY functional
auto-sizing bug (team names cut off on a real 4K TV; ribbon score-ticker resolution
wrong). Do AFTER the touch/template editor flagship work.

## Files
- **[PUNCHLIST.md](PUNCHLIST.md)** — Greg's verbatim-in-intent A–M punch list (the requirements).
- **[01-REDESIGN-SPEC.md](01-REDESIGN-SPEC.md)** — multi-agent research synthesis (6 best-in-class
  teardowns: Daktronics, ChyronHego, Ross XPression, ScoreVision, Singular/vMix, WireSpring) →
  new Setup IA (6-card pre-game checklist) + per-area (A–M) redesign + build order.
- **[02-ADVERSARIAL-CRITIQUE.md](02-ADVERSARIAL-CRITIQUE.md)** — code-verified corrections to the
  spec. **Read before implementing.** Relocates the scroll-speed bug to `ribbon/page.tsx:2234`,
  rescopes item L (de-dupe `useScaleToFit`; defer abbrev schema), drops the fabricated
  "est. impressions" sponsor number, flags the CJK + measure-timing + scale(0) traps.

## Execution status (lead-owned) — resume anchor

**SHIPPED + CI-green (commit `9716595`, all 10 checks):**
- **Item L (auto-fit / "names cut off on 4K") — DONE.**
  - Hardened the universal `FitOneLine`/`FitBox` measure scheduler (`scheduleFit()`): deferred
    re-measures on the next 2 frames + 80/300/1200ms, and a 500ms poll that watches BOTH the box
    AND the text dimensions (a late webfont changes content size, not the box — the old box-only
    poll missed it) + `fonts.ready`/window-`load`. A cold 4K WebView can no longer stick a
    too-large scale that the `overflow:hidden` zone clips. Downscale-only → zero regression.
  - `MainScoreboardWidget` (monolithic board): team name was fixed 90px + `textOverflow:ellipsis`
    (the literal cut-off) → `FitOneLine` bounded box; score also → `FitOneLine` (3-digit basketball
    no longer overflows the 620px block).
  - Legacy `BoardScene` team name: fixed 54px text-wrap → `FitOneLine` (short names unchanged, long
    shrink). `RibbonScorebugWidgets` already used `FitOneLine` + abbreviations — no change needed.
- **Item E1 (ribbon scroll speed didn't apply) — DONE.** Per the critique the bug was the
  sponsor-marquee crawl at `ribbon/page.tsx:2234` (hardcoded `/120`, ignored `data.ribbonSpeed`);
  the main ticker already honored speed. Now scaled by `1/speedMult`. Verify on the *sponsor-marquee*
  look specifically.

> **Still needs the operator's real-surface confirmation** per the testing trap: load standalone
> `/board/[gameId]` at 3840×2160 + `/ribbon/[gameId]` with a long name ("Academy of the Sacred
> Heart"). CI green ≠ pixel-verified on a 4K TV.

**SHIPPED + CI-green (commit `<G-slice>`):**
- **Item G (Sponsors de-jargon) — DONE.** New shared `sponsor-frequency.ts` maps the API's numeric
  fields to plain language (single source of truth = the number, per the critique). "Rotation weight
  5/2/10" slider → "How often it appears: Occasionally / Normal / Often" (both the `SponsorPanel`
  editor modal and the `SponsorScheduleRow`). "Max per hour" raw textbox → "Don't show more than"
  dropdown (No limit / once every 5·10·15·30 min), preserving any pre-existing custom value.
  "Flight start/end" jargon → "Show from / Show until" + "Auto-starts and auto-stops" helper. Row
  display + section copy de-jargoned to match. (Proof-of-play already shows measured plays + airtime,
  no fabricated impressions — left as-is.) Deferred to a later slice: fold the two sponsor cards into
  one, `caption`/`creatives[]` (net-new, cut per critique).
- **Items J + K + C/E2/F/M (clarity pass) — DONE.**
  - **J (shot clock):** `ShotClockSetup` keeps its sport-specific presets + hints and gains a Custom
    input (1–90s) + Set; a non-preset live value shows as "Using Ns". The configure mutation already
    accepted any value — this just exposes it.
  - **K (CTS):** plain explainer above the CTS console pill so a non-CTS venue isn't staring at a
    cryptic status. (Sport-gating deferred — needs a real capability flag; hiding it could remove a
    control a first-time CTS venue needs. "Copy feed URL" already had a good explainer.)
  - **C/E2/F/M:** plain helper lines under the cryptic Setup section headers — "Displays & layouts"
    intro, "The design each screen shows" (was "Templates per surface"), "What rides the reel & how
    fast" (was "Content & scroll speed"), "Crowd messages", "Your graphics & logos" (with the
    paid-vs-unpaid note pointing sponsors to their own section).
- **Item I (MP3 horn UPLOAD) — DONE.** The backend already accepted `audio/mpeg|wav|ogg|mp4` (3 mime
  caps already in sync: `supabase-storage.service.ts` + `assets.controller.ts`). Added an `'audio'`
  kind to `AssetPicker` (filter + accept + a Music-icon tile so audio doesn't render a broken
  `<img>`), and wired the celebration-sound field in `PresentationSettingsSection` to an **Upload MP3**
  button + a ▶ inline `<audio>` preview + Remove (URL paste still works). Uploads return absolute
  Supabase URLs, so playback on `/board`/`/ribbon` is unchanged.

- **Items A + 0 (IA restructure) — DONE.** Grounded + designed via an 8-agent workflow, then
  **adversarially reviewed** (4 lenses → verdict **ship**, 2 false positives dropped: the
  `react/no-unescaped-entities` "build break" — `→`/`—` live in `{...}` string expressions, not JSX
  text; and "PRE_GAME orphaned" — it's server-set + intentionally one pre-live tier, board renders
  PRE_GAME == SCHEDULED).
  - **Caught what the spec missed:** Run mode had NO status control at all (`StateBar` is dead code),
    so this is a **relocation**, not a deletion. New `RunStatusControl` in Run (always-visible,
    before `SurfaceHealthPills`, in every view) gives the live game-state transitions
    (Go Live / Halftime / Resume / Final-hold / Reopen-hold), reusing `ctl.status.mutate` (T1-1) so
    the cinematics+horn (T1-5) + durable undo (T1-2) fire for free.
  - **Setup** drops the dead 5-state stepper → a read-only "Tonight's game" status chip (aria-live) +
    a bottom **Go Live** CTA (`GoLiveBar`) that runs Scheduled→LIVE via the same mutation then opens
    Run. `Section` gained a positive-only "Configured ✓" badge (Displays/Sponsors), and a one-shot
    ref-guarded effect lands pre-live games in Setup / live games in Run.
  - Two review nits applied: Reopen-from-Final is now hold-to-confirm; badge says "Configured" not
    "Ready" (so optional sections don't read as required). web tsc + mobile-perf guard clean.
  - Deferred (needs Greg's visual review on real surfaces): collapsible cards, full section reorder
    to the spec's 6-card order, per-section completion for roster/ribbon.
- **Item D (per-target real-resolution preview) — DONE.** `SurfacePreview` gains a resolution picker
  (Fit · 1080p · 4K · wide ribbon 3840×256 · tall ribbon · portrait · Custom W×H). A chosen resolution
  sets the preview box's true aspect AND — for the ribbon (which renders at native window size) — forces
  the scene canvas via the route's existing `?canvas=WxH` override, so the in-app preview clips/sizes
  IDENTICALLY to the screen (closes the "verify on the real surface" gap). Board is a fixed 1920×1080
  contain-scaled scene → same at any 16:9 res; a non-16:9 target correctly pillar/letterboxes.
  Resolution stamped; "Open on screen" deep-link carries `?canvas=` for the ribbon. Frontend-only,
  verified (ribbon `?canvas=` regex confirmed). Deferred: pull the operator's REAL per-screen
  `canvasW×canvasH` from the manifest into the presets.
- **Item B (Pregame Intro clarity) — DONE.** Answers the operator's "where's the photo?": the intro
  content IS the roster. `PregameIntroPanel` now (a) explains what it is, that it auto-returns, and
  that photos/names come from the roster above; (b) shows per-team readiness (player + photo counts,
  amber if 0) via the shared `useGameRoster` cache; (c) disables a team's Intro button until that
  roster has players (with a "add players above first" tooltip). Frontend-only, web tsc clean.
  Deferred (needs a small backend add — the `/cue` endpoint doesn't accept inline `mediaUrl`): a
  standalone "takeover graphic" upload separate from the per-player lineup.

**QUEUED (per the spec build order — lead does these sequentially; the Setup page is one 7k-line
file so it isn't safely parallelizable across agents):**
- Phase 3 — clarity: C/D (named surface cards + per-target real-res preview), B (pregame content
  slots), F (paid/unpaid split + entrance/dwell/exit).
- Phase 4 — sponsor model + polish: G (de-jargon `SponsorPanel.tsx`: weight→plain, max-per-hour
  textbox→dropdown, flight→"Show from/to", caption, 15s default; proof-of-play = plays + airtime,
  NO fabricated impressions; cut `creatives[]` from v1), E2/E3, H (preset gallery), I (MP3 upload —
  all 3 mime caps must agree), J (custom shot clock + per-sport defaults), K (CTS gating + feed-URL
  explainer), M (logo fuzzy-pair + consistency sweep).

**Workspace note:** the local `origin/master` ref is stale (we push via a fresh-clone workaround and
never fetch back), so `git diff origin/master` locally over-reports changes that are already on the
real remote HEAD (e.g. the task #258 Run-mode console refinements are already shipped). Each
clone-push is taken against the true remote, so it carries ONLY genuine new work — verified per push.

> Verification trap (memory): the operator tests the standalone `/board` `/ribbon` routes on a real
> 4K TV, NOT the in-app previews. Verify item L on the real routes at real resolutions.
