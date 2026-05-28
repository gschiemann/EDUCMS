I have a comprehensive picture. Time to write the audit.

---

# VenueOS Live-Game Console — Pro Operator Audit

**Files in scope:** `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx` (3,717 lines), `CueLaunchpad.tsx`, `RosterPanel.tsx`, `SponsorPanel.tsx`, `RibbonPanel.tsx`, `SurfacePreview.tsx`, `CtsCuePanel.tsx`, `apps/web/src/hooks/use-api.ts:2458-2658` (`useGameControl`), `apps/api/src/sports/sports.service.ts`, `apps/api/src/sports/sports.controller.ts`, `apps/web/src/components/player/CtsBridge.tsx`, `packages/api-types/src/sports.ts`.

Looked at from the back of the room with a Daktronics All Sport on one side and a vMix workstation on the other, this is a 90%-finished scoreboard editor and a 30%-finished broadcast control console. The scoreboard widgetry is clean — the broadcast operator scaffolding (rundown, multi-role layouts, durable undo, surface health) is not yet here.

---

## 1. Top 5 operator-pain gaps (a scorekeeper feels these in 5 minutes)

**1. Segment +/- silently destroys the clock with no confirm and no undo.** `page.tsx:803-820` renders `−` / `+` chips around the segment label that PATCH `/segment` with `{delta: ±1}`. Server-side (`sports.service.ts:1747-1752`) the period change ALWAYS does `data.clockMs = this.segmentStartMs(def); data.clockRunning = false`. A miss-tap during Q2 → 6:42 wipes the clock to 8:00 stopped and there is no way back; segment-undo isn't even possible because the prior clockMs isn't captured anywhere on the client. Pro consoles require a "shift" or "confirm" modifier for period changes for exactly this reason.

**2. Score undo is a single-shot in-memory `useState` (`page.tsx:651`). One re-render, gone.** `lastScore` lives inside `RunMode`. Switch the tab to Setup, fire a cue that re-renders the parent, or get a 4 s poll that swaps the cached game object, and the inverse mutation is no longer reachable. In a real game you need the last 10 actions, not the last 1, and not for 30 seconds.

**3. Team fouls do not auto-reset per period.** Basketball `homeFouls` / `awayFouls` are bounded `min:0 max:30` (`packages/api-types/src/sports.ts:183-184`) but nothing in `setSegment` clears them when a new quarter starts. An NBA/NCAA/HS scorekeeper will tap an extra dozen times per game to clear them, and miss it once per game, which silently breaks bonus logic. Same problem for `homeTimeouts` / `awayTimeouts` between halves.

**4. There is no real-time visibility into what each screen is rendering during the game.** `useGameScreens` (`use-api.ts:2731`) polls every 10s and returns `{name, status, showing, surface}` — no per-screen thumbnail, no "ribbon X is mid-cue, ends in 4s", no "scoreboard 3 lost signal 12 s ago." The two side buttons at `page.tsx:289-308` open `/ribbon` and `/board` in *new tabs*. That is not a control room — that's a tab graveyard. The inline ribbon iframe at `RunRibbonPreview` (`page.tsx:1199-1208`) is fine, but the scoreboard preview is gone in Run mode.

**5. Zero keyboard shortcuts. Zero. Anywhere.** A `grep` for `keydown` against the entire `sports/[gameId]/` tree returns only `e.key === 'Enter'` on clock-edit inputs. Every score, every clock action, every cue requires touching the tablet/mouse. A scorekeeper on a laptop with the keyboard right there cannot tap Space to start/stop, can't hit `h` / `a` to score, can't hit numbers for cues, can't hit `u` for undo. Even a hotkey README mounted on `useEffect(()=>document.addEventListener('keydown', …))` would change the entire feel of running a game.

---

## 2. One-tap audit (Run-mode actions, current taps → recommended)

| Action | Current taps | Where | Recommended |
|---|---|---|---|
| Score home +1 / +2 / +3 | 1 | `ScoreTile` `page.tsx:986-997` | OK |
| Score away ditto | 1 | same | OK |
| Score −1 (fix mis-tap) | 1 | `page.tsx:998-1005` | OK — but only −1; no −2 / −3 |
| Start / Stop clock | 1 | `page.tsx:833-844` | OK |
| Reset clock to segment start | 1 | `page.tsx:846-852` | OK but no confirm — destructive |
| ±1 s clock nudge | 1 | `page.tsx:853-868` | OK; add ±10 s |
| Set clock to MM:SS | 3 (tap clock → type → enter) | `page.tsx:2588-2597` | OK |
| Shot-clock reset to 30 / 20 | 1 each | `page.tsx:1127-1141` | OK |
| Shot-clock start / stop | 1 | `page.tsx:1142-1153` | OK |
| Advance to next period | 1 (DESTRUCTIVE — wipes clock) | `page.tsx:812-819` | Should be **hold-to-confirm** like the panic page |
| Score & celebration on the SAME play | 2 minimum (score tile + cue button) | scattered | Add an "auto-celebrate on score" mode: scoring fires the goal cinematic if `def.celebrations[*].autoPoints` includes the delta |
| Set "1st & 10" (football new series) | 1 | `page.tsx:2063-2073` | OK — great pattern |
| Foul on team | 1 tap on stat row | `ScoreTile` 1010-1049 | OK; but no per-player attribution flow |
| Send a player to penalty box | 4 (open popup → pick team → optional jersey# → pick duration) | `page.tsx:537-565`, `PenaltyBoxControl` `1716-1846` | Combine with the inline roster bar — tap a player tile → already opens menu with `Send to box` (`page.tsx:1499-1507`) at preset[0] only. Need to surface all preset durations inline. |
| Release a player from box | 2 (open popup → tap Release) | `page.tsx:1822-1834` | Add a release strip under the clock tile so the operator never has to dig |
| Spotlight a player | 2 (open inline roster → tap player → tap ★) | `PlayerActionMenu` 1471-1481 | OK |
| Clear spotlight | 2 (tap player again or popover) | same | OK |
| Fire generic celebration | 1 (inline cues bar) | `RunInlineCuesBar` 1591-1617 | OK |
| Fire celebration to SCOREBOARD only (not ribbon) | 3 (open Cues popup → pick target → tap tile) | `CueLaunchpad.tsx:38-71` | Add target chips inline on the cues bar, or right-click for "Board only" |
| Timeout home / away | **No dedicated control**; only the `homeTimeouts` stepper | `ScoreTile` sideStats | Needs a dedicated "T.O." button per team that also flashes the scoreboard timeout overlay |
| Possession change (football/basketball) | 1 | `PossessionToggle` 2159-2189 | OK |
| Substitution (any sport) | Not supported | — | Roster panel only — no live sub UI |
| Mark game FINAL | 2 (Setup tab → status pill) | `page.tsx:362-378` | Destructive transition; no confirm |
| Switch ribbon/scoreboard layout mid-game | 3 (Setup tab → Layouts → dropdown) | `LayoutsPanel` 3049-3199 | Should also be reachable from a Run-mode "swap surface" button |
| Open the public board to verify | 1 (opens new tab) | `page.tsx:299-308` | OK but should also have inline 16:9 preview in Run mode |

**Worst offenders:** segment advance (destructive, 1 tap), penalty release (2 taps from a buried popup), surface target on cues (3 taps), timeouts (no first-class control), FINAL transition (2 taps hidden in Setup).

---

## 3. Multi-role view recommendation

The console is one giant page. There is no role split — every operator sees every surface. Three personas:

**A. Scorekeeper view** (default on a 10" tablet). Top half = the `RunInteractiveScoreboard` block at `page.tsx:759-893`. Bottom half = clock controls and stat tray for the sport. Hide entirely: the cues bar, the roster bar, the ribbon preview, the spotlight popover. Add: penalty-box release strip (sports with one), team-fouls counter, timeouts-remaining counter. This is the only view a non-tech volunteer scoring a JV game should ever see. **Wire a `?view=score` query param** that hides everything else.

**B. Show-caller view** (the second person at the table on a second tablet). Top half = ribbon + scoreboard iframe thumbnails side-by-side (the `SurfacePreview` already exists at `SurfacePreview.tsx:33-87` — re-use it). Middle = the `CueLaunchpad` always-on (not a popup). Bottom = spotlight roster bar. Hide entirely: every clock control, every score control, every stat field. The show caller can crash the scoreboard with a bad tap today; this prevents it. `?view=show`.

**C. PA / announcer view** (a phone or third tablet). Top = current spotlight (read-only). Middle = the roster with one-tap spotlight + intro reel (no clock, no score control, no cues). Bottom = a rundown/script panel (which we'd need to build — see §6). `?view=pa`.

Implementation note: the `mode` state at `page.tsx:148` already gates Run vs Setup; extending to a `view` query param is mechanical. The deeper change is making the destructive mutations role-aware on the server — today every CONTRIBUTOR has the full `useGameControl` toolkit (`sports.controller.ts:264-330` — every PATCH allows CONTRIBUTOR through the same `@RequireRoles` list).

---

## 4. Undo / event-replay recommendation

We have the durable storage: `GameEvent` (schema.prisma:1815-1826) records every SCORE / CLOCK / SEGMENT / STAT / CUE / STATUS mutation with `payload` + `createdAt`. The console reads them ONCE — at `sports.service.ts:366` — and only for type=`CUE` for the public board's cinematic playback. Nothing surfaces this log to the operator.

**What a real "last N events" panel looks like.** A collapsible 320px right rail in Run mode showing the most-recent 25 events:

```
14:38:12  Q3 6:42   Score   Eastside  +1   [↶ Undo]
14:38:09  Q3 6:45   Cue     GOAL!     ALL  [↶ Undo]
14:38:01  Q3 6:53   Stat    homeShots 12→13 [↶ Undo]
14:37:42  Q3 7:12   Clock   stop @ 7:12       [↶ Undo]
14:37:18  Q3 7:36   Penalty #8 → Exclusion :20 [↶ Release]
14:36:55  Q3 7:59   Cue     Save              [↶ Undo]
14:30:00  Q3 begin            (system, no undo)
14:29:55  Q2 end   final 7-5
```

Each row holds the payload and is invertible:
- SCORE `{team, delta}` → fire `score.mutate({team, delta: -delta})`
- STAT `{key, oldValue, newValue}` → write `oldValue` back (needs server to start capturing `old` in the GameEvent payload; today only `new` is stored)
- CLOCK `{action, prevMs, prevRunning, newMs, newRunning}` → re-anchor to `{prev*}` (needs `prev*` capture)
- SEGMENT `{from, to, prevClockMs}` → set `segment=from, clockMs=prevClockMs, clockRunning=false` (needs `prevClockMs` capture — see gap #1)
- CUE — there's no broadcast-side "undo a cue"; mark it as REDACTED in the log but the cinematic already aired

System-driven transitions (auto-advance from clock-expiry at `sports.service.ts:1771`) are flagged non-undoable. New endpoint: `GET /sports/games/:id/events?limit=25` and `POST /sports/games/:id/events/:eventId/undo`. The Undo button is *not* a new mutation type — it's a synthesized inverse using the same existing PATCHes, written as a new GameEvent with `payload.undoOf=<eventId>`.

This also gives the customer the "incident replay" feature the lead has been talking about for V2 — same data shape, different consumer.

---

## 5. Other gaps worth fixing (in order of severity)

**Real-time feedback.** Mutation success is silent. There is no toast. `useToast` / `sonner` returns zero hits in this tree. When you score, the `lastAction` text appears INSIDE the scoreboard tile area (`page.tsx:660-661`) but never renders anywhere — `lastAction` is set but `RunMode` doesn't read it back. The cue tiles have a tiny `✓ FIRED` flash for 1500 ms (`RunInlineCuesBar` 1605-1614) which is the only consistent confirmation in the app. Everything else relies on the operator watching the iframe.

**Broadcast state visibility — per-surface health.** `useGameScreens` reports `{status: 'ONLINE'|other, showing, surface}` for paired screens — but only on the Setup tab inside `ScreenPushPanel` (`page.tsx:3262-3306`). In Run mode you have no idea if a scoreboard went dark. Recommend a fixed status pill row pinned to the top toolbar: `🟢 Scoreboard · 🟢 Ribbon · 🔴 Concourse-3 (offline 14s)`.

**No rundown / script.** Operator has to remember what to fire at first-Q timeout, at halftime, before the player-of-the-game spotlight. We have all the primitives (cues, sponsors, spotlights, sponsor rotation weights). A `GameRundown` table — `{ gameId, sequenceOrder, triggerType ('manual'|'timeoutN'|'segmentStart'|'segmentEnd'|'final'), cueId|spotlightPayload|sponsorId, notes }` — gives the show caller a pre-game checklist they can drive top-down on game night and that auto-fires at known stoppages. Cheap to add.

**Cue popup target picker doesn't carry through the inline cue bar.** `RunInlineCuesBar.fire` (`page.tsx:1558`) hardcodes `target: 'ALL'`. The full `CueLaunchpad` allows BOARD / RIBBON / ALL but it's behind the modal. Result: from the fast path you can never fire a celebration to the ribbon only.

**Penalty popup destroys flow.** `livePenalties` runs at 250 ms inside the popup (`page.tsx:1696-1699`), but the popup is the only place where penalties are visible in Run mode. The expiry alert "0:01" doesn't draw on the scoreboard preview or the clock tile. A power-play indicator (one team in box = the other team shows "POWER PLAY 0:42") doesn't exist — see `def.celebrations[*]: powerPlay` is a celebration cue (fire-and-forget), not a state indicator. Hockey, lacrosse, water polo desperately need this on the BOARD widget, not just in the popup.

**Game-state recovery.** Every operator action PATCHes the server (`useGameControl` `use-api.ts:2458-2658`), and `useGame` polls every 4 s with `staleTime: 0`. A second tablet that opens the same `/sports/<gameId>` URL gets the live state on first paint. That part is solid. But the operator's local state (the `lastScore` undo buffer in `useState`, the `showCues`/`showHighlights`/`showPenalties` popup state) is purely client-side and lost on reload. None of this matters for game state — but the lost undo buffer means a tablet swap during a game means no undo of the last action that happened before the swap.

**Cue and score don't share an attribution flow.** If you score Home +1, then tap GOAL! in the cues bar, the scorer attribution depends entirely on whether someone is currently spotlit (`RunInlineCuesBar` 1546-1573). Score-then-celebrate is the most common sequence and it doesn't auto-attribute. Recommended: when `def.celebrations[*].autoPoints` includes the score delta (and a player is currently in spotlight), auto-fire that celebration with attribution. Today `autoPoints` is declared in `sports.ts:340-344` but never consumed anywhere in `RunMode`.

**Stream Deck wiring is read-only and minimal.** `CtsBridge.tsx:224-249` accepts only `CUE <key> [target]` and `SCORE <delta> <home|away>`. No clock control, segment, timeouts, spotlight, penalty box, status. And it runs ON THE PLAYER, not on the operator's laptop console — meaning a remote operator on a tablet can't use a Stream Deck at all. A proper WebHID/USB Stream Deck driver in the operator console mapped against the same `useGameControl` API is a 1-2 day build and unlocks the "$150 Stream Deck instead of $3K Daktronics console" pitch in CLAUDE.md §4. Today it cannot deliver that.

**Mid-game template swap requires going to Setup mode** (`page.tsx:472-474`, `LayoutsPanel` 3049-3199). The dropdown filtering by aspect ratio + category (3092-3103) is good, but the swap is invisible to the operator — there's no preview before-apply and no "auto-revert in N seconds" option. Operator picks "CTS Water Polo Ribbon" mid-game and instantly the ribbon changes; if they wanted "celebration-board for 8 s then back", they have to swap, wait, swap back. That's the canonical broadcast pattern and we don't support it.

**Sponsor proof-of-play exists on the ad-ops side (`useSponsorReport`) but no operator-facing "this sponsor played N times tonight" widget.** Useful in real time so the operator can over-rotate a sponsor who's under-delivered.

---

## 6. Recommended next 10 commits (prioritized)

**1. Capture pre-state on every destructive mutation, surface a 10-event undo rail.** (Medium) Add `prevClockMs`/`prevRunning`/`prevSegment`/`oldValue` to each `record()` call in `sports.service.ts`. Build a `GameRecentEvents` panel that polls `GET /sports/games/:id/events?limit=25` and renders Undo per row. Solves §1, §2, gap "team fouls don't reset" (auto-record a SEGMENT→reset event for each cleared stat so it's individually undoable).

**2. Hold-to-confirm on the period +/- chips, and on FINAL.** (Small) Same pattern as the mobile panic page. 800 ms hold animates a ring around the chip; release before complete = no-op. Eliminates the worst mis-tap class in 50 lines of code.

**3. Per-surface health row pinned to the top toolbar.** (Small) Reuse `useGameScreens` data, render a pill per screen with status dot + name + "last seen Xs ago". Click pill = open that surface in a side-by-side iframe drawer. Solves §5 row "Broadcast state visibility."

**4. Keyboard shortcuts everywhere.** (Small) Wire a single `useEffect` document key listener: `Space`=start/stop, `h`/`a`=score +1 home/away, `Shift+H`/`Shift+A`=−1, `1`-`9`=fire cue tile N, `u`=undo, `r`=reset clock (with confirm), `t`=timeout home, `T`=timeout away, `?` opens a shortcut cheat sheet modal. Add `view=score` / `view=show` / `view=pa` query-param gates so shortcuts that don't apply to your role are no-ops.

**5. Build the rundown / game-script table + UI.** (Medium) New Prisma model `GameRundownItem`. New `RundownPanel` in the Show-caller view: drag-drop sequence, trigger types (manual, segmentN-start/end, timeoutN, post-final), each item resolves to a fire-cue / fire-spotlight / set-template payload. Auto-fires on the matching event; the operator can mark each item DONE inline. Solves "no rundown" and unlocks the pre-game prep loop competitors already have.

**6. Per-team timeout button as a first-class control + scoreboard overlay.** (Small) Add a dedicated `Timeout` button per team that decrements `home|awayTimeouts` AND fires a TIMEOUT cue with the team's color. The cue takes the scoreboard for a 30-60 s "TIMEOUT — EASTSIDE" overlay using the same cue plumbing already in place. Currently a glaring omission for basketball / football / hockey / volleyball.

**7. Auto-celebrate-on-score using the existing `autoPoints` field.** (Small) When `score.mutate({team, delta})` succeeds and `def.celebrations[*].autoPoints.includes(delta)`, fire that celebration with the currently-spotlit player as the scorer. Operator can disable via a per-game `stats.autoCelebrateOnScore` flag. Already half-built; just needs the wiring in `RunMode` next to the score mutations.

**8. Inline score-board preview in Run mode AND target chips on the inline cues bar.** (Small) Drop a `SurfacePreview` iframe row above `RunRibbonPreview` showing the live 16:9 board. Add Board/Ribbon/All chips inline on `RunInlineCuesBar` so the fast path can target a single surface. Two related UX wins, one commit.

**9. Power-play / penalty state indicator on the scoreboard widget + a release strip in Run mode.** (Medium) Add a `PenaltyBox` widget the ribbon and scoreboard read from `game.stats.penalties`. When team A has more players in the box than team B, render "POWER PLAY 0:42 — opposing team" with a countdown to the next box exit. In the operator console, render the box-release strip BELOW the clock tile so a power-play goal can release in 1 tap instead of 4. Solves the hockey/water polo/lacrosse usability hole.

**10. Proper Stream Deck (WebHID) driver in the operator console.** (Medium) Map every `useGameControl` mutation to a hardware button via the Web HID API (Chromium browsers — fine for the operator laptop / desktop). Persist mappings per-tenant. Today's RS232-on-the-player path stays for venues that wire it; the WebHID path is the broader market. Earns the "$150 Stream Deck replaces a $3K console" claim.

**Stretch (commit #11 if time):** add `?view=score` / `?view=show` / `?view=pa` query-param-driven layouts (§3). It's purely a layout / hide-by-css commit on top of #4 and #5, no schema changes.

---

**One-line summary for the lead:** the scorekeeper UX is good, the multi-role show-caller UX is missing, and the things that hurt most in a real broadcast — durable undo, period-change confirms, per-surface health, a rundown, keyboard shortcuts, timeouts as a first-class concept — are all 1-2 day builds on top of the data we already have. Ship commits #1, #2, #3, #4 before the next live game; everything else is a 2-3 sprint roadmap.
