# Celebration + Clock Defects — Root-Cause Diagnosis (2026-06-15)

Hands-on, code-verified diagnosis of the 7 defects Greg reported. Every cause cites file:line.
No fix is claimed "done" until it is verified by **triggering** the celebration/clock — not by a
screenshot of a static board.

## The 7 defects

### 1. "The images are like test HTML" — celebrations show FAKE placeholder data
**ROOT CAUSE (confirmed).** The v1 celebration pack (`deck.html` + `celebration-engine.js`,
the default for every sport) renders headline/score/scorer from **hardcoded placeholder strings**:
- `deck.html:47` — `'soccer-penalty':{... sub1:'HUNTINGTON BEACH  2 — 1  NEWPORT', sub2:"78' · PENALTY · #9 RIVERA"}`
- `waterpolo-goal.html:207` — `ctx.fillText('NEWPORT HARBOR  9 — 8  CORONA DEL MAR', ...)`

`deck.html` reads only `?cue` and `?team` from the URL — it **never reads `?d`** (the live game
data the board already builds via `celebrationLiveDataFromCue`). Only the **v2 launcher** reads `?d`,
and v2 only covers `water_polo` (`V2_KEYS`). So every celebration on every sport (and even water polo
unless opted into v2) shows demo names + a fake score. That is the "test html."

### 2. Celebrations look SQUISHED on the ribbon
**ROOT CAUSE (confirmed).** `ribbon/[gameId]/page.tsx:3297` calls
`celebrationSrc(sport, cue.key, teamHex, 'v2', 'ribbon', …)` — always pack `'v2'`. For any sport
without a v2 cue (everything except water polo) this **falls back to the 16:9 v1 HTML**, which is then
stretched to fill a short/wide ribbon segment iframe → squish. The `format='ribbon'` arg only changes
layout for true v2 cues; v1 art has no ribbon-aspect rendering at all.

### 3. "I can change the celebration color but you can't" — color control is wired to nothing
**ROOT CAUSE (confirmed).** The only celebration-color control is `PropertiesPanel.tsx:3468-3469`
("Home/Away celebration color"), which writes to the **template-widget config** (`cfg.homeColor` /
`cfg.awayColor`). The live board/ribbon routes never read `cfg` — they compute
`teamColor = cue.color || data.homeColor/awayColor` (board `page.tsx:3354` region). So the control the
operator sees changes a value no live celebration consumes. Separately, the v1 *engine* honors `?team`
strongly (glow/headline/shockwave) but a few bespoke marquee files hardcode the dominant element
(e.g. waterpolo ball = gold), so even a correct color barely shows on those.

### 4. Horn cue says "HORN" but plays no sound
**ROOT CAUSE (confirmed).** The horn cue is `{ key:'horn', label:'Horn', emoji:'📯' }` in
`sports.ts` (8 sites) with **no `audioUrl`**. There are **zero audio files anywhere in the repo**
(`find apps/web/public -iname '*.mp3' -o -wav -o -ogg` → empty). The board has a
`new Audio(next.audioUrl)` path but nothing ever populates `audioUrl`. → text only, silence.
**Fix without a download:** synthesize a stadium air-horn with the Web Audio API in the engine (CC0
by construction, no file, offline-safe on Taurus). Celebration iframes also need `allow="autoplay"`.

### 5. Celebrations "not firing on the scoreboard"
**PARTIALLY confirmed — needs a live fire to pin the exact runtime cause.** The fire filter is fine:
`cuePlaysHere(target) = target !== 'RIBBON'` (board `page.tsx:186`) and every auto/manual cue uses
`target:'ALL'` (sports.service.ts) — so the board *should* accept them and `<CueOverlay>` mounts on
`activeCue` in both the custom-template path (4156) and the legacy path (4234). Leading hypotheses:
the board defaults `pack='v2'` and the v2 file path renders a dark scrim with no visible content for a
non-water-polo sport, OR `celebrationSrc` returns null and the generic fallback is invisible, OR a
remount resets `firstLoad` so the pump skips every poll. **Must reproduce by firing a real cue in a
board harness.**

### 6. Play clock + game clock "impossible to sync — you gave them no dependency"
**ROOT CAUSE (confirmed).** On the board each clock is projected by its **own** `useEffect`, each
reading its **own** `skew = serverTime - Date.now()` at its **own** time, each on its **own** 100ms
interval, from its **own** anchor (`clockUpdatedAt` for the game clock, `stats.playClock.at` for the
play clock) with its **own** `running` flag (board `page.tsx:856-940`). They are never projected from
a shared "now," so they tick on different frames and drift; and nothing makes the play clock follow the
game clock's run/stop state on the client. Server-side `syncPlayClockToGameClock` exists
(sports.service.ts:1883) but the client renders them as two independent timers. **Fix:** one shared
clock tick (single now/skew read) projecting all clocks together, plus the play-clock run-state
following the game clock per sport rules. Verify with both clocks live in a harness.

### 7. "You left old stuff in the final celebration"
**LIKELY (confirm on render).** `FinalScene` (board `page.tsx:3069+`) shows **two** "FINAL" labels —
the header pill (top-right, 3164) AND the center divider wordmark (3311) — on top of the newer
"WINNER <TEAM>" champion banner (3188). The center "FINAL/TIE" wordmark is the pre-winner-banner
design left in; it duplicates the header and competes with the banner. Confirm by rendering a FINAL
board and strip/redesign the redundant element.

## Fix order (each verified by triggering, not static screenshots)
- **E1** live data into v1 (`deck.html` + marquee files read `?d`; remove fake team strings) — verify by rendering with `?d`.
- **E3** color: route the operator's chosen color to the live celebration (`Game.stats.celebrationColor` → board reads it); strengthen dominant-element tint in marquee files — verify two colors render differently.
- **E4** horn: synthesize air-horn (Web Audio) at impact; add `allow="autoplay"` to celebration iframes — verify oscillator scheduled + audible path.
- **E2** ribbon: stop requesting v2-only; render v1 art in a ribbon-native layout (no stretch) — verify at ribbon aspect.
- **E5** board fire: reproduce in harness, fix the real mount/pack/null cause — verify mid-celebration screenshot.
- **E6** clocks: unify projection onto one tick; wire play↔game dependency — verify both live.
- **E7** final: strip the redundant FINAL wordmark / leftover — verify FINAL render.

## Verification harness
- v1 art (E1/E2/E3/E4): static file server on `apps/web/public/celebrations` + Playwright at 16:9 and ribbon aspect, varying `?team`/`?d`.
- board (E5/E6/E7): prod build + route-mock `/board/:id` (board route does not hydrate under `next dev` Turbopack), fire a cue, run both clocks.
