# HS Signage — Flagship Batch 1 (Replace Manifest)

5 redesigned, approved high-school signage templates, ready to commit. Each file
here replaces the same-named file in the app's `hs/` template directory.

## Drop-in map

| This file | Replaces (in app) | What changed |
|---|---|---|
| `caf-today.html` | `hs/caf-today.html` | Live clock + lunch-block countdown, rotating Special/Tomorrow/Harvest spotlight, per-dish dietary chips + photo thumbnails, auto-fit text, portrait+landscape, safe ticker. |
| `class-nownext.html` | `hs/class-nownext.html` | Focused NOW + flow only (removed clutter), huge live countdown-to-bell, light theme, auto-fit headline/body (no clamping), portrait+landscape. |
| `hall-bulletin.html` | `hs/hall-bulletin.html` | Editorial board, spotlight as one box, corner-peel rotating announcements (Breaking/Principal/Clubs), live bell rail, hero photo slot, auto-fit, safe ticker, portrait+landscape. |
| `ath-gameday.html` | `hs/ath-gameday.html` | Focused single-matchup hero: split team-color wash, giant auto-fit team names, live split-flap countdown to kickoff, record/streak, kickoff/where/tickets strip, portrait+landscape. |
| `hall-wayfinder.html` | `hs/hall-wayfinder.html` | Left column auto-scrolls directional cards; right column flips Floor-1 map → Floor-2 map → directory (architectural floor plans, you-are-here pin, stairs/elevator), live period/bell, portrait+landscape. |

## What every file shares (the "flagship" standard)
- **Auto-fit text engine** — any `data-fit` / `data-fit="single"` element binary-searches its font size to fill its box (bigger when an editor types less, smaller when more) and re-fits live on CMS edits and after webfonts load.
- **20-ft legibility** — hard minimum ~40px on the 3840 stage; no clamped/hidden text (`…`), everything wraps in full.
- **Total editability** — a `[data-widget="theme"]` block exposes every color, all fonts, and a global `--scale`; all copy is `data-field`; images are `data-imgslot` (set `data-img` to a URL).
- **Orientation** — one file does landscape (3840×2160) AND portrait (2160×3840); auto-detects, or force with `?o=portrait` / `?o=landscape`.
- **Live data** — clocks, bell schedules, countdowns, and rotators are driven by small config blocks at the top of each inline script (easy to bind to the CMS).
- **Verified** — zero overflow / no clipping confirmed in both orientations.

## Notes for the committer (Claude Code)
- These are self-contained HTML files (Google Fonts via `<link>`; self-host for offline panels).
- The `data-widget` / `data-field` boundaries match the originals where possible, so existing CMS bindings keep working; new widgets added: `theme`, plus per-template rotators (`spot.*`, `map2`, bell rail, etc.).
- Suggest committing as one batch ("HS signage flagship — batch 1 of N") for clean review + rollback. Batches 2–3 (class-subday, ath-standings, ath-biggame, ath-broadcast, and the remaining HS + MS + ES sets) will follow.
