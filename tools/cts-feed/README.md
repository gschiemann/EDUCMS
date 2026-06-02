# CTS file-feed simulator — edit a file, watch the board + ribbon react live

A dead-simple way to test **everything the sports board brings in from a
scoring console**, without any CTS hardware. You edit `game-state.json`,
hit **save**, and the watcher pushes that state to the *same endpoint a
real CTS bridge uses* — so the scoreboard, scorebug, and **ribbon** update
on the live screen within a second. Bump a score → the **goal celebration
fires** on the ribbon, exactly as it will on game day.

> This pushes to `POST /api/v1/sports/board/:gameId/cts-snapshot` — the
> real bridge path. It writes the **live feed** layer only; it never
> touches the operator's manual score columns, so it's safe to run against
> a real game.

## 1. One-time setup (60 seconds)

You need three things:

| What | Where to get it |
|---|---|
| **API root** | The API the screen's player talks to. Local dev: `http://localhost:8080`. Prod: your Railway API root (no trailing `/api/v1`). |
| **Game id** | Sports → create/open a game. The id is in the URL (`/sports/<gameId>`). |
| **Feed token** | Sports → your game → **feed credentials** (or `GET /api/v1/sports/games/<gameId>/feed-credentials`). Copy the `token`. **Keep it in your shell env — never commit it.** |

```bash
export CTS_API="https://<your-api-root>"      # no trailing /api/v1
export CTS_GAME_ID="<game id>"
export CTS_FEED_TOKEN="<feed token>"
```

## 2. Point a screen at the game

On the screen you want to watch (or just a browser tab):
- Open the **ribbon** for the game: `…/ribbon/<gameId>` (or bind the screen's
  playlist to the CTS ribbon template), **or** open the board: `…/board/<gameId>`.
- Leave it up. It polls the live feed ~every 0.75s.

## 3. Run the watcher

```bash
node tools/cts-feed/feed.mjs
# dry-run first (prints the mapped body, posts nothing):
node tools/cts-feed/feed.mjs --dry-run
```

You'll see a line print every time you save the file:

```
14:22:31 ✓ pushed H 4-3 A  330.0s  P2  shot[30/-]  excl[1/0]  TO[2/1]
14:22:48 ✓ pushed H 4-4 A  312.0s  P2  shot[-/-]   excl[1/0]  TO[2/1]   ⬜ AWAY GOAL → 4
```

## 4. Score a goal (the headline test)

1. Open `game-state.json`.
2. Change `"awayScore": 3` → `"awayScore": 4`. Save.
3. Watch the screen: the away score ticks to 4 **and the ribbon plays the
   goal celebration**. The watcher logs `⬜ AWAY GOAL → 4`.

That's the whole loop — every field below behaves the same way.

## Field-by-field — what each value drives

Everything in `game-state.json` is the **live game-state feed** (the part a
console pushes in real time). Edit any of these and save:

| File field | Type | Drives on the board / ribbon |
|---|---|---|
| `homeScore` / `awayScore` | number | Score readouts. **An increase auto-fires the goal celebration** on the ribbon (CtsCelebrationOrchestrator). A decrease just corrects the number (no cue). |
| `clock` | `"M:SS"`, `"M:SS.t"`, `":SS.t"`, `"SS"` | Game clock. `":24.3"` = last-minute tenths. Converted to ms for you. |
| `clockRunning` | bool | Running vs stopped (drives the clock's running state + cadence-derived shot-clock running). |
| `period` | number | Period / quarter (water polo: 1–4, 5 = OT). |
| `homeShotClock` / `awayShotClock` | string seconds, e.g. `"30"`, `"18"`, `""` | Per-side shot clock. `""` = blank/parked. |
| `homeShotClockRunning` / `awayShotClockRunning` | bool | Whether that shot clock is counting. |
| `homeExclusions` / `awayExclusions` | array of `{ playerJersey, secondsRemaining }` | Water-polo exclusions (penalty box). Up to 3 per side; `[]` = none. Each entry renders a jersey # + countdown. |
| `homeTimeoutsRemaining` / `awayTimeoutsRemaining` | number | Timeouts left per team. |
| `horn` | bool | Set `true` + save to fire the horn one-shot (UIs latch on the rising edge). Set back to `false` after. |

### What is NOT pushed by this tool (set once in game setup, not live)

These come from the Game record / roster / branding, not the live console
feed, so they're configured in the dashboard — not this file:
**team names, team logos & colors, sponsor reels, player rosters, and the
per-player fouls/scorer-recognition channels.** Set those in Sports → game
setup; this tool exercises the real-time scoring layer on top.

## Tips

- **`--once`** pushes a single time and exits (good for scripting a sequence).
- **`--file <path>`** watches a different state file (keep several scenarios:
  `pregame.json`, `last-minute.json`, `overtime.json`).
- Editors that "atomic save" (rename) are handled — the watcher polls mtime.
- Rate limit: the endpoint accepts up to ~40 snapshot POSTs / 10s per game.
  Saving by hand is nowhere near that; a script loop should throttle.
- Prefer a UI instead of a file? `/super/cts-simulator` is the in-app
  simulator. This file tool is for the "edit → save → watch" loop you asked for.

## How it maps to game day

This is the exact same ingest path the **WTTC / Gen 6** bridge uses — the
only difference is where the bytes come from (your file edits here vs. the
console's serial stream at the pool). So a scenario that looks right here
will look right when the real console is plugged in. See
`docs/research/2026-06-01-wttc-water-polo/` and `docs/EP6N_CTS_CABLE.md`.
