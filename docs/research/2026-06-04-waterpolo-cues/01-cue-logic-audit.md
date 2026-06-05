# Water Polo Celebration Cues — Defect Audit (read-only code trace)

> Agent: general-purpose, read-only static analysis. Dispatched 2026-06-04 by the lead
> in response to the water-polo beta customer: *"check the water polo celebration cues we
> have live — they have player names and some don't even work right; we had good ones I
> thought worked."* Verbatim agent output below; lead-verified claims annotated in
> `02-lead-verification.md`.

## Executive Summary

Four confirmed defects, ranked:

1. **[BROKEN-CUE / HARDCODED-NAME — P0] The scoreboard (`/board`) renders water polo cues
   from STATIC HTML files with hardcoded fake names, and CANNOT receive live score or the
   scorer at all.** The board page does **not** use `pickCinematic` / `CelebrationDeckScene`
   / `pickDeckCue`. It uses `CueOverlay` → `celebrationSrc()` → an `<iframe>` to
   `/celebrations/v2/launcher.html?cue=…` (default pack) or `/celebrations/deck.html?cue=…`
   (v1). Those launchers accept **only** `cue`, `format`, `team` — **no channel for score or
   scorer**. The cue registries baked into those static files hardcode `NEWPORT HARBOR 9 — 8
   CORONA DEL MAR`, `#7 RIVERA`, `#1 OKONKWO · GK`, `6 ON 5`, etc. So **every** water polo
   cue on the scoreboard shows fake teams/scores/players regardless of the real game or the
   operator's attributed scorer.
   (`apps/web/src/app/board/[gameId]/page.tsx:1870`, `apps/web/src/lib/celebration-assets.ts:107`,
   `apps/web/public/celebrations/v2/launcher.html:50-84`,
   `apps/web/public/celebrations/v2/cues-waterpolo.js:340-360,358,518,697`,
   `apps/web/public/celebrations/deck.html:51-53`)

2. **[BROKEN-CUE — P0] On the scoreboard, water polo `horn` renders only the generic
   confetti/emoji fallback (no themed cinematic).** `celebrationAsset()` has no mapping for
   `water_polo/horn` → returns null → generic CueOverlay text/confetti with 📯 and no pool
   scene. (`apps/web/src/lib/celebration-assets.ts:14-80`)

3. **[LOST-ANIMATION REGRESSION — P1, dormant] The signature goalie-save animation
   (`save:'x'` + projectile `deflect`) was dropped from the React `CelebrationDeckScene`
   port — but the React deck isn't rendered on either live surface today.** Design engine
   `drawSave()` (team-color X slamming over the goal mouth) + projectile `deflect` (ball
   ricochets off goalie) exist in `scratch/design/celebration-engine.js:147-156,172` and the
   shipped static `deck.html`. The React port (`CelebrationDeckScene.tsx`) + config type
   (`CelebrationDeckCfg`) have **no `save` field and no `projectile.deflect`**. Dormant:
   the board uses the v2 static save (which DOES implement a correct goalie block,
   `cues-waterpolo.js:502-534`); the ribbon uses `RibbonCelebrationStrip`.

4. **[WORKFLOW / NAME-ATTRIBUTION — P1] Three of four operator trigger surfaces never
   attach a scorer, and the AUTO-fire path never does either.** Only `RunInlineRosterBar`'s
   player-tap popover (`onFire`) and `RunInlineCuesBar` (when a player is spotlit) attach
   `scorerName`/`scorerNumber`. The full-grid `CueLaunchpad.fireBuiltin`, the
   `ShowCallerView` launchpad, the `CtsCuePanel` manual path, and the server's
   `maybeAutoCelebrate` (goal-delta / CTS auto-fire) all fire with **no scorer**. Even when a
   scorer is attached, it only reaches the **ribbon v1 strip** — the board (defect #1) and
   the v2 ribbon launcher can't display it. So "we had good ones I thought worked" = the
   ribbon strip with a spotlit player looked right; the same cue on the scoreboard showed
   fake names.

## Architecture correction (load-bearing)

There are **four** celebration code paths, not two:
- **Board** (`/board/[gameId]`): `CueOverlay` → `celebrationSrc()` → static HTML `<iframe>`
  (`/celebrations/v2/launcher.html` or `/celebrations/deck.html` or a `*-marquee*.html`).
  Does NOT use `pickCinematic`/`CelebrationDeckScene`/`pickDeckCue`. (`page.tsx:1779-1897`)
- **Ribbon** (`/ribbon/[gameId]`): `RibbonCueOverlay`. If `pack==='v2'` → static
  `/celebrations/v2/launcher.html` iframe (`page.tsx:2878-2935`); else → `buildRibbonStripConfig`
  → `RibbonCelebrationStrip` (`page.tsx:2950-2996`). `pickCinematic` is imported but
  DEPRECATED + not called by `RibbonCueOverlay`.
- The React `CelebrationDeckScene` + `pickDeckCue` are referenced **only** inside
  `ribbon/[gameId]/page.tsx`, and only via the dead `pickCinematic`. **Not rendered on either
  live surface today.**
- **Pack default:** both surfaces default to `'v2'` unless `Game.stats.celebrationPack ===
  'v1'` (`board page.tsx:2543`, `ribbon page.tsx:1006-1010,1151-1155`).

## Task 1 — Per-cue resolution trace

### BOARD `celebrationSrc(sport='water_polo', key, teamHex, pack, 'scoreboard')`
| Cue | v2 default | v1 | Result |
|---|---|---|---|
| `goal` | `v2/launcher.html?cue=waterpolo-goal` | `waterpolo-goal.html` | ⚠️ correct cinematic, hardcoded `Newport Harbor 9 / Corona del Mar 8 / #7 RIVERA`; no live score/scorer |
| `save` | `cue=waterpolo-save` | `deck.html?cue=waterpolo-save` | ⚠️ correct save animation, hardcoded `#1 OKONKWO · GK` (v2) / `#1 GK` (v1) |
| `exclusion` | `cue=waterpolo-penalty` | `deck.html?cue=waterpolo-exclusion` | ⚠️ renders, hardcoded `6 ON 5 / #7 EXCLUDED`/`#14` |
| `powerPlay` | `cue=waterpolo-powerplay` | `deck.html?cue=waterpolo-powerplay` | ⚠️ renders (camelCase key resolves via `${sport}/${key}` literal lookup), hardcoded `MAN ADVANTAGE / 6 ON 5` |
| `horn` | none | none | ❌ no themed cinematic → generic confetti 📯 |

### RIBBON v2 (default): same static launcher iframe as board → same hardcoded names, no scorer.
### RIBBON v1 (`buildRibbonStripConfig` → `RibbonCelebrationStrip`): the ONLY surface that renders all 5 correctly with real names + live scoreline + scorer.
| Cue | Title | Subtitle (no scorer) |
|---|---|---|
| `goal` | `GOAL!` | live scoreline + scorer if attached |
| `save` | `SAVE!` | `NO GOAL` |
| `exclusion` | `EXCLUSION` | `20-SECOND PENALTY` |
| `powerPlay` | `POWER PLAY` (`.toLowerCase()`→`powerplay` matches) | `MAN ADVANTAGE` |
| `horn` | `HORN` | `{segmentLabel} END` / `PERIOD OVER` |

Since `pack` defaults to **v2**, the customer's live ribbon is ALSO on the broken static path unless `celebrationPack:'v1'` is set.

## Task 2 — Design-vs-port regression diff (the 3 React deck cues; dormant)
- `waterpolo-save`: design has `save:'x'` (engine `drawSave()` = 3-layer team-color X with
  `easeOutBack` pop + impact jolt, `celebration-engine.js:147-156`) + projectile
  `deflect:[-1.1,-0.7]` (ball ricochets up-left off goalie + gravity, `:172`). React port
  (`celebrationDeckCues.ts:129-138`) dropped both; `CelebrationDeckCfg` (lines 55-75) has no
  `save`/`deflect`; `CelebrationDeckScene.tsx` has no `drawSave`, projectile only handles
  in-flight + lands-at-impact (`:883-891`). `impactPt` moved `{1440,592}`→`{960,540}`, added
  `motif:'glove'`. **The React save = ball flies to a centered glove + stops dead.**
- `waterpolo-exclusion` / `waterpolo-powerplay`: copy changes are **intentional improvements**
  (hardcoded "6 ON 5" wrong for 6v4/5v4; `motifText 6v5→PP` non-numeric). No animation lost.
- `CelebrationDeckScene` DOES read `motifText`, `impactPt`, `projectile` (no deflect).

## Task 3 — Hardcoded names that leak
1. **Board — every WP cue, always** (static launchers, no snapshot/scorer passed): v2 goal
   `Newport Harbor 9 / Corona del Mar 8 / #7 RIVERA`; v2 save `#1 OKONKWO · GK`; v2
   exclusion/pp `CDM — EXCLUSION / #14 / 6 ON 5`; v1 deck `NEWPORT HARBOR 9 — 8…`. The
   `liveSub1`/`scorerLine` overrides exist only in the dead `pickCinematic`.
2. **Ribbon v2 launcher** — same static files, same leak, on default pack.
3. **Other sports** ride the same files: `#23 OKAFOR`, `#24 CRUZ`, `MATER DEI 61-58…`, `#17
   NOVAK`, etc.
4. **Builder/CTS preview** (`edu:cts-celebration-preview`, `PropertiesPanel.tsx:3294` →
   `CtsRibbonWidgets.tsx:1466-1500`) renders CEL_* library with its own sample names.

Clean: ribbon v1 `RibbonCelebrationStrip` (real `snapshot` + `scorerName`,
`RibbonCelebrationStrip.tsx:124-132,295-342`); `cueSnapshot` server helper
(`sports.service.ts:2876-2910`).

## Task 4 — Scorer attribution per trigger surface
Mutation accepts `scorerName/Number/PhotoUrl/Id` (`use-api.ts:2682-2689`); server `fireCue`
persists into the CUE GameEvent (`sports.service.ts:3012-3015,3091-3094`); board feed carries
them — but only ribbon v1 strip displays them.

| Surface | File:line | Scorer? | Player chosen how |
|---|---|---|---|
| `RunInlineRosterBar` player-tap popover `onFire` | `page.tsx:2262-2278` | ✅ | tapped player |
| `RunInlineCuesBar` (inline cue bar) | `page.tsx:2435-2453` | ⚠️ only if spotlit | reads `g.spotlight`, matches roster |
| `CueLaunchpad.fireBuiltin` (full grid; Run + Show) | `CueLaunchpad.tsx:164-168` | ❌ | none |
| `CueLaunchpad.fireCustom` | `CueLaunchpad.tsx:169-173` | ❌ | none |
| `ShowCallerView` launchpad | `page.tsx:1316` | ❌ | none |
| `CtsCuePanel` manual | `CtsCuePanel.tsx:77-102` | ❌ | none (CEL_* path) |
| AUTO goal-delta `maybeAutoCelebrate` | `sports.service.ts:2698-2772` | ❌ | none |
| AUTO CTS ingest | `sports.service.ts:4086` | ❌ | none |
| AUTO set-win/strikeout | `sports.service.ts:2387,2516,2839,2858` | ❌ | none |

## Task 5 — Roster data source (for the picker)
- Hook: `useGameRoster(gameId)` (`use-api.ts:3064-3070`), key `['sports-roster', gameId]`.
- Endpoint: `GET /api/v1/sports/games/:gameId/roster` → `SportsService.listRoster` →
  `prisma.client.rosterPlayer.findMany({where:{gameId},orderBy:[{team},{sortOrder}]})`
  (`sports.service.ts:1077-1081`). Flat array of both teams; filter client-side on `.team`.
- Player shape (`RosterPlayer`, `use-api.ts:3054-3062`):
  ```ts
  { id:string; team:string /* 'home'|'away' */; name:string; number:string|null;
    position:string|null; photoUrl:string|null; stats:Record<string,string> }
  ```
  Water polo `stats` keys seeded from `PLAYER_STATS['water_polo'] = ['G','A','ST','EXC']`.
- Mutations: `useRosterMutations(gameId)` (`use-api.ts:3072-3109`).
- **Existing player-picker precedent to copy:** `RunInlineRosterBar` (`page.tsx:2104-2214`) →
  `PlayerActionMenu` popover (`page.tsx:2216-2400`) with ★ Spotlight + per-cue `onFire(cueKey)`
  that attaches the tapped player. The gap: other trigger surfaces don't use it.

## Fix-spec implications (most impactful first)
- **#1 board hardcoded names:** the board must stop rendering WP cues from param-less static
  HTML. Either (a) extend `launcher.html`/`engine.js`/`deck.html` to accept
  `&sub1=&sub2=&home=&away=&hs=&as=&scorer=` and have `celebrationSrc`/`CueOverlay` pass the
  live `snapshot` + cue `scorerName`, OR (b) route the board through the same React component
  path the ribbon v1 strip uses. Until then, no board WP cue can show real names.
- **#1b board horn:** add a `water_polo/horn` entry (or generic horn cinematic) to
  `celebration-assets.ts`.
- **#4 attribution:** add scorer attach to `CueLaunchpad.fireBuiltin`/`ShowCallerView` and
  `maybeAutoCelebrate`; for the requested **player-picker popup** reuse `useGameRoster` +
  `PlayerActionMenu` pattern.
- **#3 React save regression:** only worth restoring when the board/ribbon is migrated to the
  React deck; today the v2 static save is correct.
