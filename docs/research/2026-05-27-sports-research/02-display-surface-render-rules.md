Confirmed:
- **v2 cinematic celebration widgets** (`CelHockeyGoalWidget`, `CelFootballTouchdownWidget`, etc.) are imported into the ribbon page but NEVER registered as `SCOREBOARD` variants in the template-builder palette.
- **No OBS preset configs** / no scope discrimination — anyone with the gameId can grab the overlay.
- **No anti-burn-in motion** in the scorebug.

I have enough. Here is the audit report.

---

# VenueOS Display-Surface Render Audit
*Pro-venue parity grade — read against Daktronics Show Control, ANC LiveSync, ScoreVision*

## Coverage scope

This audit covers the three game-day surfaces (Scoreboard / Ribbon / Scorebug), the in-venue cue + sponsor + roster pipeline, the per-event auto-render logic in `apps/api/src/sports/sports.service.ts`, and the broadcast overlay path. The "concourse" surface is included as a status check — it is not currently a sport-specific surface, so concourse takeover during a game has no built-in path.

---

## Section 1 — Top 5 visible-on-the-wall gaps

A sports-venue owner walking the building during a live game would clock these in the first 10 minutes:

1. **Status transitions don't fire ANY visual cue.** When `setStatus` is called (LIVE → HALFTIME → FINAL), `apps/api/src/sports/sports.service.ts:2225-2241` writes a `STATUS` GameEvent and updates the row — but no `CUE` is fired and no auto-celebration is dispatched. A real venue's end-of-period buzzer kicks a Q1-end animation, halftime kicks a "Halftime Show" cinematic, final kicks a "FINAL — Winner!" graphic. Today the board just *changes background state* on the next 750ms poll via `HalftimeScene` / `FinalScene` (`apps/web/src/app/board/[gameId]/page.tsx:1363, 1510`). No drama, no motion, no acknowledgment. The board literally just swaps scenes silently.

2. **Sponsor frequency caps are stored but never enforced.** `Sponsor.frequencyCapPerHour` is in the schema (`packages/database/prisma/schema.prisma:1856`), accepted by the API (`apps/api/src/sports/sponsors.service.ts:140,162`), and persisted — but the ribbon/board rotation logic (`board/[gameId]/page.tsx:538-562`, `ribbon/[gameId]/page.tsx:514-521`) builds slots purely off `weight`, never reads `frequencyCapPerHour`, and there is no `lastShownAt` tracking. A Title sponsor with cap=12/hr can air 200 times an hour, and a sponsor whose flight ended 5 minutes ago can keep airing because `listActive()` only filters at the `getBoard` query layer (`sponsors.service.ts:99-122`) — the in-flight rotation never re-checks. **Selling against this is a problem.**

3. **No pre-game player introduction infrastructure.** A `RosterPlayer` model exists (`schema.prisma:1791-1809`) with photoUrl + stats, and the ribbon's `buildLooks` includes a `kind: 'player'` look (`ribbon/[gameId]/page.tsx:522-529`) — but it just cycles them as 7.5s static cards mixed with sponsors. There is no choreographed "starting lineup" sequence on the scoreboard (`board/[gameId]/page.tsx` has zero PlayerIntro scene), no music sync hook, no "next 3 players" preview, no holding-pen-then-dramatic-reveal motion. A high-school basketball intro a parent expects to see does not exist as a code path.

4. **No live-game text overlay widgets exist at all.** Grep for `PenaltyBanner` / `InjuryTimeout` / `ReplayReview` / `END_OF_QUARTER` across the entire widget tree returns zero hits. There is no widget for "HOLDING #44 — 10 YDS — 1ST DOWN," no "OFFICIAL REVIEW IN PROGRESS," no "INJURY TIMEOUT." Penalties exist as a *clock-box* (`board/[gameId]/page.tsx:194-292` — `PenaltyTimers`) but only displays who's in the box, never the reason for the call. Football broadcasts spend half their on-screen time on these strips.

5. **No score-zone divergence between Scoreboard cinematic and Ribbon.** A pro flow: scoreboard plays the full TD cinematic for 4 seconds; in parallel the ribbon does a single "TOUCHDOWN — BROWNS 14" crawl; the scorebug just updates 7→14. Today: the SAME `Cue` is dropped on the SAME `CUE` GameEvent (`sports.service.ts:2145, 2417, 2445`) with one `target` field (`BOARD | RIBBON | ALL`, `cleanCueTarget`, line 2325). All three surfaces poll the same 750ms feed, and the cue's payload is identical regardless of which surface plays it. The ribbon ends up rendering the SAME full-bleed celebration as the board (`ribbon/[gameId]/page.tsx:1054-1067, RibbonCueOverlay`). Same animation, same length, on a strip that should be tighter and more in-your-face.

---

## Section 2 — Per-event × per-surface auto-render matrix

| Event | Scoreboard | Ribbon | Scorebug | Concourse |
|---|---|---|---|---|
| **Score increment matching `autoPoints`** (TD, 3-pointer, goal, HR) | ✓ — fires via `maybeAutoCelebrate` `sports.service.ts:2108-2182` on every `incrementScore` and `setScore` path | ✓ — same CUE feed, plays via `RibbonCueOverlay` line 1054 | partial — toast renders (`scorebug/[gameId]/page.tsx:304-335`) but it's a tiny "NICE!" pill, not a real broadcast lower-third | ✗ — concourse not on the game polling fan-out |
| **Score increment NOT matching autoPoints** (a +1 in football where only [6,7,8] are mapped) | ✗ — silently no animation | ✗ — same | partial — scorebug numbers tick | ✗ |
| **Manual quick-button score (+7)** | ✓ — wired via `incrementScore` `actorUserId` path | ✓ | partial | ✗ |
| **Operator-fired cue button** | ✓ — `fireCue` → CUE event → all surfaces poll → `CueOverlay` `board/[gameId]/page.tsx:1708` | ✓ — `RibbonCueOverlay`, ribbon either plays cinematic or burst depending on `pack: 'v1'\|'v2'` | ✓ — toast pill | ✗ |
| **Clock hits 0** (period buzzer) | ✗ — no server-side detection; the clock projects locally on the player. No `CLOCK_EXPIRED` event ever fires. | ✗ | ✗ | ✗ |
| **Period / Quarter advance** (`setSegment`) | ✗ — writes a `SEGMENT` GameEvent (`sports.service.ts` `setSegment` path) but only the chip rerenders; no transition graphic | ✗ | ✗ | ✗ |
| **Status → HALFTIME** | partial — `HalftimeScene` (`board/[gameId]/page.tsx:1363`) swaps in on next poll. No motion to mark the transition. | ✗ — ribbon stays on its rotation; no halftime takeover sequence | partial — same scene swap | ✗ |
| **Status → FINAL** | partial — `FinalScene` (`board/[gameId]/page.tsx:1510`) swaps in with winner color emphasis. Still no celebration cinematic. | partial — `kind: 'final'` look prepended at `dwellMs: 10000` (`ribbon/[gameId]/page.tsx:566-568`), just a static look | partial | ✗ |
| **Shot-clock violation / play-clock zero** | ✗ — same as game clock, no server detection | ✗ | ✗ | ✗ |
| **Timeout called** | ✗ — no `TIMEOUT` endpoint exists. (`grep TIMEOUT` in `sports.controller.ts` returns nothing.) Stats hold a `homeTimeouts` field but no event / cue / scene. | ✗ | ✗ | ✗ |
| **Penalty called** | ✓ — penalty timer appears in `PenaltyTimers` strip on scoreboard. No flash, no reason-of-call banner. | ✗ — ribbon situational does NOT surface penalties | ✗ | ✗ |
| **Spotlight set by operator** | ✓ — `SpotlightBand` at bottom of scoreboard (`board/[gameId]/page.tsx:789, 949`) | ✓ — prepended to rotation as `kind: 'spotlight'` (`ribbon/[gameId]/page.tsx:578-588`) AND overlaid in media-mode (`ribbon/[gameId]/page.tsx:932`) | ✗ — scorebug ignores spotlight | ✗ |
| **Pre-game player intro sequence** | ✗ — no such scene | partial — players just cycle into rotation | ✗ | ✗ |
| **Emergency trigger during game** | ✓ — tenant-wide path takes over via `Tenant.emergencyStatus` | ✓ — same | ✓ — same | ✓ — same |

**Key gaps:** clock-zero, period-advance, halftime-transition motion, timeout, and reason-of-call banner — all the "show control" cues a Daktronics All Sport drives are uncovered.

---

## Section 3 — Sponsor proof-of-play readiness

### What we log today (`sponsors.service.ts:183-236` `report()`)

- `totalLiveSeconds` per tenant — summed across every game with a `startedAt`.
- A **calculated** `estimatedSpots` = `cycles × weight` where `cycles = totalLiveSeconds / cycleSeconds`.
- That's it.

### What's missing for a real ad sale

| Required | Status | Code reference |
|---|---|---|
| Per-impression log (who/when/where shown) | ✗ — no `SponsorImpression` table; report is purely arithmetic | `sponsors.service.ts:225` "Estimated" |
| Frequency-cap enforcement | ✗ — `frequencyCapPerHour` stored but never read in rotation | `sponsors.service.ts:140`, `ribbon/[gameId]/page.tsx:514-521`, `board/[gameId]/page.tsx:540-549` |
| Flight-window enforcement during live game | partial — only at `listActive` query time (`sponsors.service.ts:99-122`); a sponsor whose flight ends at half-time keeps airing until the next 750ms poll on a 4-hour-cached server-side viewer |
| Per-event sponsor injection (this TD brought to you by Y) | partial — `fireCue` accepts `sponsorName` + `sponsorLogoUrl` (`sports.service.ts:2375-2376, 2426-2428`) but there is no automated "tag the next celebration with this sponsor" assignment policy. Operator must hand-set it each time. |
| Makegoods | ✗ — no concept of "this sponsor under-delivered, owe them N spots" |
| Co-branded slot ratio (Title vs Community) | partial — `weight` field is honored; `tier` is a free-text label only with no behavioral hook |
| Sponsor delivery report per game | ✗ — `report()` is tenant-wide, not per-game; can't ship a sponsor "your run at the Friday football game" PDF |
| Proof-of-display from screens (heartbeat verify the screen was actually rendering during the spot) | ✗ — board page has no "I rendered sponsor X at time Y" callback to the API |
| Sponsor pacing (front-load vs even-distribute across game) | ✗ — weight-only random |

### To sell this to a $5K-per-game sponsor

You need to be able to ship them a PDF that says:
> "Friday 10/24 Lincoln vs Central. Your logo rendered 87 times across 3 surfaces: 41 on the south end-zone ribbon, 28 on the main scoreboard between innings, 18 on the broadcast overlay. ~28,000 face-seconds of attended exposure. Co-branded with 3 of the 7 touchdown celebrations. Cap of 30/hr was respected. Two makegoods owed (under-delivered Q3 due to halftime show preemption); will run at next game."

That report requires **a `SponsorImpression` write-through** on every sponsor render (board, ribbon, scorebug each post to a lightweight ingest endpoint with `{ sponsorId, surfaceKind, gameId, ts }`), a real **scheduler that respects caps + pacing**, a **per-game report endpoint**, and **screen-side proof-of-display ACK** (which we already have heartbeat infrastructure for — see `Standard Audit Surface §1` in CLAUDE.md).

Estimated build: medium for impression write-through; medium for rotation scheduler refactor (`ribbon/[gameId]/page.tsx` `buildLooks` / `board/[gameId]/page.tsx` `slots`); large for per-game report UI + PDF export.

---

## Section 4 — Streaming overlay (NFHS / Hudl / YouTube) readiness

The scorebug at `apps/web/src/app/scorebug/[gameId]/page.tsx` is the broadcast overlay. Score against a real OBS workflow:

| Need | Status | Notes |
|---|---|---|
| 1920×1080 transparent canvas | ✓ — body bg transparent (`scorebug/[gameId]/page.tsx:245-250`); dashboard nav `.-z-10` decorative gradient hidden | Good. |
| Configurable corner dock | ✓ — `?pos=tl\|tr\|bl\|br` (line 80-88) | Works. |
| Configurable scale | ✓ — `?scale=N` 0.4–4× (line 165-166) | Works. |
| Team-code override | ✓ — `?home=BRN&away=LIN` (line 167-168) | Works. |
| Same `Game.stats` feed as in-venue | ✓ — both poll `/sports/board/:id` | One source of truth via `applyCtsOverlay`. |
| Anti-burn-in motion (subtle drift / pixel shift) | ✗ — score bug is statically positioned. A 4-hour live stream will burn the bug into a viewer's OLED. | High-end broadcast graphics do a ~1px subtle drift every few minutes; ours is dead still. |
| Per-broadcast palette (home stream vs away stream) | ✗ — palette is the operator's tenant brand only. An away-stream operator picking up the same `gameId` cannot inject their own palette. | Would need `?home_color=RRGGBB&away_color=RRGGBB` query params + a `?palette_override=true` flag. |
| OBS recipe / one-click setup screen | ✗ — there is no in-product "How to add as a browser source" panel | URL is just exposed via `SurfacePreview` "Full screen" link. No 800×120 OBS overlay preset. |
| Per-overlay protection (gameId is enough to render — anyone with the URL can scrape) | partial — public design intent (matches CLAUDE.md design). For paid stream productions this is a feature, not a bug — but no rate limit on `/sports/board/:id` means a bad actor can DOS the polling endpoint trivially. |
| Hot reload on graphic edits | ✓ — 750ms poll + cached board endpoint (`sports.service.ts:288-311`) | Good. |
| Custom template scorebug | ✓ — `scorebugTemplateId` triggers `CustomScoreboardScene` (`scorebug/[gameId]/page.tsx:260-272`) | Templated bug works. |
| Lower-third on cue | partial — toast renders above/below bug with cue label (`scorebug/[gameId]/page.tsx:304-335`); fixed 3.6s duration. No real "FINAL — Lincoln 24, Central 21" graphic. |
| Pre-roll / post-roll graphics | ✗ — no concept of "show this sponsor logo on the stream for 30 seconds at game end" |
| Always-on bug variant vs fly-in on score | ✗ — bug is always docked |

Solid bones, mid-tier features. Three medium-effort commits would close the gap with mid-budget broadcast graphics.

---

## Section 5 — Recommended next 10 commits (prioritized)

### P0 — visible-from-the-bleachers

1. **Auto-fire status-transition cinematics** — small. In `setStatus` (`sports.service.ts:2225`), when `status` becomes `HALFTIME` or `FINAL`, emit a synthetic `CUE` event keyed `status:halftime` or `status:final-{home|away|tie}` so the existing CUE feed plays a transition graphic. Add 3 corresponding cinematic widgets in `v2/CelebrationsOtherSportsWidgets.tsx`.

2. **Enforce sponsor frequency cap + flight window in the rotation** — medium. Make the cycle builder in `board/[gameId]/page.tsx:540-549` and `ribbon/[gameId]/page.tsx:514-521` consult a per-game `useRef<Map<sponsorId, lastShownAt[]>>` and drop a sponsor if `lastShownAt[]` in the trailing hour ≥ cap. Also re-filter `sponsor.flightEndAt` client-side every tick so a flight ending mid-game stops the spot immediately.

3. **Per-impression log for proof-of-play** — medium. New `SponsorImpression` Prisma model (`{ sponsorId, gameId, surfaceKind, ts }`); board/ribbon/scorebug pages POST to `/sports/sponsors/:id/impression` every time a sponsor look enters view. Per-game and per-tenant report endpoints aggregate from this table.

### P1 — broadcast credibility

4. **Real-time live-game text overlay system** — medium. New `LIVE_OVERLAY` event type (penalty/injury/review/timeout). Three corresponding banner widgets:
   - `PenaltyOverlayWidget` (3s lower-third: "HOLDING #44 — 10 YDS")
   - `OfficialReviewOverlayWidget` (persistent until cleared)
   - `TimeoutOverlayWidget` (fly-in pill "AWAY TIMEOUT — 2 LEFT")
   Operator panel: a "Call" group in `CueLaunchpad.tsx` next to the existing celebration cues. Auto-clears on next CLOCK start.

5. **Differentiate ribbon vs scoreboard cue rendering** — small. Already have a `target` field; today the `target='RIBBON'` payload renders a full-bleed celebration too. Add a `ribbonStrip` boolean to the cue payload — when true, the ribbon uses `RibbonCelebrationStrip` (text crawl mode only) for ~2.5s instead of `RibbonCueOverlay`'s 4500ms full takeover. Scoreboard gets the full cinematic; ribbon does a tight crawl; scorebug pulses the score box.

6. **Pre-game starting lineup sequence** — large. New `pregame-intro` cue mode that, when fired from the operator panel, takes over the scoreboard for a choreographed 30-second sequence: per-player 3.5s slots from `RosterPlayer` (photo + name + number + position + 1 stat line) with team-color brand shim. Music sync via the existing custom-cue `audioUrl`. Skippable. Add a `?intro=1` query param so it can be triggered from a tablet without typing into the panel.

### P2 — production polish

7. **Scorebug anti-burn-in subtle drift** — small. Add a `useEffect` in `scorebug/[gameId]/page.tsx` that adjusts the inner container's `transform: translate()` by ±2px on a 90-second cycle. Imperceptible to a viewer, saves a $4K OLED.

8. **Scorebug palette override + OBS recipe panel** — small. Accept `?palette_home=RRGGBB&palette_away=RRGGBB` query params in `scorebug/[gameId]/page.tsx`. Add an in-product `/[schoolId]/sports/[gameId]/broadcast` page that shows a copy-paste OBS browser-source URL + a screenshot of where to dock it.

9. **Per-event sponsor co-branding rules** — medium. Add a `Sponsor.celebrationCobrand` JSON column (`{ rotate: true, weight: 1, sportCueWhitelist: ['touchdown', 'fieldGoal'] }`). When `maybeAutoCelebrate` builds the cue payload, automatically inject the next eligible sponsor's `sponsorName`/`sponsorLogoUrl` so the operator doesn't have to set it manually. Audit logs the assignment.

### P3 — moat

10. **Geo-routed concourse takeover during incidents and scoring** — large. Today concourse displays just run their normal playlist during a game. Wire a new `Schedule.gameScopeId` so a concourse playlist can opt in to "during this game, briefly show score updates every 4 minutes" — a 6-second flyover graphic with the live `Game.homeScore`/`Game.awayScore` between regular concourse content. Builds on the existing playlist/schedule system; doesn't touch the game cue feed.

---

## Verification & file-citation summary of every claim

| Claim | File:line |
|---|---|
| `STATUS` transition writes no cue | `apps/api/src/sports/sports.service.ts:2225-2241` |
| Frequency cap stored but never enforced | `packages/database/prisma/schema.prisma:1856`, `apps/api/src/sports/sponsors.service.ts:99-122,183-236`, ribbon rotation `apps/web/src/app/ribbon/[gameId]/page.tsx:514-521`, board rotation `apps/web/src/app/board/[gameId]/page.tsx:540-549` |
| Auto-celebrate only on score-delta match | `apps/api/src/sports/sports.service.ts:2108-2182` |
| Cue target is `BOARD|RIBBON|ALL`, payload identical | `apps/api/src/sports/sports.service.ts:2325-2328, 2445-2459` |
| No PenaltyBanner / InjuryTimeout / ReplayReview widgets exist | grep result, 0 hits |
| No pre-game intro sequence | grep for `playerIntro|PreGameIntro`, 0 hits |
| Scorebug transparent canvas works | `apps/web/src/app/scorebug/[gameId]/page.tsx:245-250` |
| Scorebug bug is statically positioned | `apps/web/src/app/scorebug/[gameId]/page.tsx:293-301` — no drift transform |
| Per-impression log absent | `sponsors.service.ts:225` reads "Estimated" — purely arithmetic |
| No `TIMEOUT` endpoint | grep `apps/api/src/sports/sports.controller.ts` returns nothing |
| Sponsor `weight`-only random rotation in `slots` | `apps/web/src/app/board/[gameId]/page.tsx:541-549` |
| RibbonCueOverlay plays full 4500ms cinematic on ribbon — same as scoreboard | `apps/web/src/app/ribbon/[gameId]/page.tsx:636-637, 1054-1067` |
| v2 cinematic celebration widgets imported but not registered as SCOREBOARD variants | `apps/web/src/components/widgets/variants-register.ts` grep for `CelHockey|CelSoccer|CelFootball` returns 0 |
| Spotlight ignored by scorebug | `apps/web/src/app/scorebug/[gameId]/page.tsx` no spotlight check |
