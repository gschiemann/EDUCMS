# Sports console stat-control audit — every sport, every stat (2026-06-21)

> Greg: "check all the other sports and make sure we got the correct functions and not just blank text fields."
> Triggered by water-polo Shots/Exclusions rendering as blank type-in boxes. Audited every stat in
> `packages/api-types/src/sports.ts` against its render path in the Run console (`page.tsx`).

## Render paths
- **Per-team stats** (`scope: home|away`) → `ScoreTile` rows: `isText`→free-text · `ridetime`→`m:ss` ·
  numeric→**`−value+` stepper** (tap-to-type value). Fixed in `ee70e5d` (was: range>8 → blank type-in).
- **Game-scope stats** (`scope: game`, not tray-owned) → `GameScopeStatEditor`: `serving`→Home/Away toggle ·
  text→free-text · numeric→**`−value+` stepper** (tap-to-type value). Fixed THIS pass (was: range>8 → blank
  `StatNumberField` type-in).
- **Tray-owned game stats** (down/distance/ballOn/balls/strikes/outs/half/on1B-3B/possession) → dedicated
  controls: `CompactDownControl` (down picker), `New set` 1-tap, `PossessionToggle`, `BaseTrayBall`, half via
  `advanceBaseballHalf`. Football `To Go`/`Ball On` use `StatNumberField` → now stepper-with-typein too.

## Verdict per stat class
| Class | Examples | Control | Correct? |
|---|---|---|---|
| Per-team counter | shots, fouls, hits, errors, yellow/red cards, penalties, ground balls, corners, team points, athletes | `−value+` stepper (tap-to-type) | ✅ fixed `ee70e5d` |
| Ride time | wrestling home/awayRideTime | `m:ss` entry | ✅ correct (caught before stepper) |
| Game counter / advance | golf `currentHole`, wrestling `boutNumber`, soccer `addedTime`, XC `finishers` | `−value+` stepper (tap-to-type) | ✅ fixed this pass |
| Typed reading | baseball `lastPitchMph` | type-in + nudge | ✅ type primary, nudge added |
| Yard fields | football `distance` (To Go), `ballOn` | type-in + nudge | ✅ type primary, nudge added |
| Home/Away enum | `serving` (volley/tennis/pickle), `possession` (fb/bball) | Home/Away toggle | ✅ already correct |
| Top/Bottom enum | baseball `half` | tray half-advance | ✅ already correct |
| Down enum | football `down` | 1st/2nd/3rd/4th picker | ✅ already correct |
| Descriptive text | event/apparatus/division/weightClass/pitchType/leadRunner/par/routine | free-text field | ✅ correct (no enum to pick) |

## Conclusion
After `ee70e5d` (per-team) + this pass (`StatNumberField` game-scope), **no sport has a bare blank type-in box
for a counter**. Every counter is a `−value+` stepper (with the number still tap-to-type for big corrections);
enums are toggles/pickers; only genuinely free-form descriptive values (event/division/par/routine) and typed
readings (pitch mph, yards) keep a text/number entry — which is correct. Possible later polish (not blank-field
bugs): gymnastics `currentApparatus` and wrestling `weightClass` could become pickers from a known list.
