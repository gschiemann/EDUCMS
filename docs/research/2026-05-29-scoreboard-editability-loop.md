# Scoreboard editability — one-at-a-time fix loop (2026-05-29)

Operator runs this as: **fix one issue → make it beautiful + editable →
he tests → we apply what we learn to the next.** This file is the running
record so each fix's lesson carries forward.

## The template under test
- **🏟️ Main Scoreboard** — system preset `preset-main-scoreboard`, opened
  via the gallery (system presets open read-only in the builder, "Save as
  copy" to make it editable). Builder URL pattern: `/{tenantSlug}/templates/builder/{id}`.
- It is a **13-zone COMPOSED board** — each zone is a `SCOREBOARD`-type
  *element* widget with a `cfg.variant` (e.g. `sb-team-logo-home`,
  `sb-team-name-home`, `sb-shot-clock`, `score-home`, `game-clock`).
  It is **NOT** the monolithic `scoreboard-main` → `MainScoreboardWidget`.
  ⚠️ Verify against the ACTUAL zone variant the operator clicked, not a
  same-named sibling widget. (Burned twice assuming `scoreboard-main`.)

## THE REUSABLE PATTERN (apply to every element + the next template)
Composed element widgets render from **live game state** with a **hardcoded
sample fallback** and often **no config override** → they look fine but
aren't editable. To make any element editable:
1. **Widget reads an override**: add the key to `ElCfg`
   (`apps/web/src/components/widgets/sports/SportElementWidgets.tsx`) and
   render `override || liveValue || sample`.
2. **Properties writes that exact key**: in `PropertiesPanel.tsx` `case
   'SCOREBOARD'` → `isSportEl` branch, gate a field by the variant prefix
   (`sbVariant.startsWith('sb-...')`) and `setField({ <sameKey>: v })`.
3. **Field type**: image → `AssetPickerField kind="image"` (upload from
   desktop + pick from Assets + URL paste); text/number → `TextField` /
   `NumField`.
4. **Verify** against the real rendered zone (screenshot / live), not an
   assumption. The builder re-renders the zone live on `setField`.

## Issue log
- **#1 Team logo = URL-only** (`dc29b48`, then real fix `e600c5b`). The
  field is on `sb-team-logo*` (logoUrl) + `sb-sponsor` (imageUrl) — swapped
  both to `AssetPickerField`. ✅ operator-confirmed working.
- **#2 Team name not editable** (this commit). `sb-team-name*` /
  `sb-team-abbr*` → `TeamNameWidget`/`TeamAbbrWidget` rendered a hardcoded
  `EAGLES`/`TIGERS` with no editable field. Added `ElCfg.teamName`
  override (widget reads override > live > sample) + a "Team name"
  TextField in Properties writing `cfg.teamName`. Placeholder shows the
  sample name so the operator sees what they're overriding.
- **#3 Long name overflows + layer Name editable** (`b634f36`).
  - AUTO-FIT: text element widgets rendered at a fixed `config.fontSize`, so
    a long value (BROWNS / GOLDEN BEARS) overflowed/clipped.
    ⚠️ FIRST tried `FitText` (binary-search) — it FLAKED on long single-line
    text: stayed stuck at max, scrollWidth 700 in a 372px box (the imperative
    width-set fights React re-renders). Confirmed via DOM-measure debug
    (NAMEFIT=1 in scoreboard-shot.spec.ts logs `FITDEBUG`).
    REAL FIX = **`FitOneLine`** (a local component in SportElementWidgets):
    render the text at a FIXED font (nowrap), measure its natural scrollWidth
    once (stable — font never changes → no feedback loop), then
    `transform: scale(min(1, boxW/textW, boxH/textH))` to shrink it to fit.
    Deterministic, Chromium-83/Taurus-safe. **This (not FitText) is the
    standard auto-fit pattern for sport text elements** (name done; apply to
    score/clock/segment/stat as flagged).
    LESSON: ALWAYS screenshot + DOM-measure the REAL render before claiming a
    visual fix works — I told the operator FitText worked twice before
    measuring it; it didn't.
  - LAYER NAME: the "Name — shown in Layers panel" field was an editable
    `<input>` in Properties; made it a read-only label (rename belongs in the
    Layers tab). Not content → shouldn't be a content field.
  - DEFERRED: color-field hex display simplification. `ColorField` →
    `ColorPickerField` is GLOBAL to every widget; change it in isolation +
    verify, don't bundle into a scoreboard fix.

## Standing rules learned
- Verify against the REAL rendered zone variant (operator screenshot / live),
  never a same-named sibling widget. (`scoreboard-main` ≠ the composed
  `sb-*` element board.)
- Global/shared controls (ColorPickerField, etc.) = bigger blast radius →
  their own commit + own verification, not bundled.
- Every fix: deploy-watch the Vercel commit status → tell the operator when
  it's actually live (don't make them refresh-hunt).
