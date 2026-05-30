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

- **#4 No highlight when editing + "highlight the hotspot AND the left
  field"** (this commit). Operator clicked a scoreboard text element and
  (a) saw NO selection outline on the canvas and (b) the left Properties
  field for that text didn't light up. Two root causes + the fix:
  - CANVAS: the selected zone's clean `2px solid #6366f1` outline was being
    **buried under overlapping zones** (a composed board overlaps heavily,
    and a prior "no giant highlight" revert removed the z-index lift). FIX:
    `BuilderZone` lifts the selected zone to `zIndex: 1000` (only while
    selected, non-preview) so its outline paints above neighbors. NO glow,
    NO banner — just the clean outline the operator asked for.
  - LEFT PANEL: the app already has the Canva-style "click canvas hotspot →
    matching panel field rings + scrolls into view" link
    (`template-edit-field` event → `PropertiesPanel` finds
    `[data-field-section="<key>"]` → adds `.is-active-section`). The
    scoreboard **element** zones weren't `[data-field]` hotspots, so
    selecting one never fired that event + the fields had no
    `data-field-section`. FIX: (1) wrapped each element's PRIMARY field
    (teamName / logoUrl / imageUrl / label / scoreboard-main homeName) in a
    `<div data-field-section="<key>">`; (2) `BuilderShell` fires
    `template-edit-field` with that element's primary key on selection →
    the existing handler rings + scrolls to it.
  - LESSON: the highlight link ALREADY EXISTED for themed widgets — reused
    it instead of inventing a new highlight. When the operator describes a
    behavior the app does elsewhere ("Canva click-to-edit"), find that
    mechanism and wire the new surface into it; don't build a parallel one.
  - ⚠️ UNVERIFIED-IN-BUILDER: builder is auth-gated + no browser connected,
    so this is code-correct + tsc-clean but NOT visually confirmed by me —
    operator is the visual check this round.

- **#5 Score / clock / segment numbers too big — overflow the zone** (this
  commit). Operator screenshot: the SCORE_HOME "24", SCORE_AWAY "21",
  GAME_CLOCK, GAME_SEGMENT digits rendered MUCH bigger than their zones and
  blew past the board — "the numbers are so big, they dont fit in the
  template." ROOT CAUSE: those widgets live in `SportWidgets.tsx`
  (ScoreHome/Away, GameClock, GameSegment, GameStat) and rendered the value
  in a plain `<div style={rootStyle(config)}>` at a FIXED `cfg.fontSize`
  with NO auto-fit — independent of the zone size, so any big/pegged font
  overflowed. The team name already got the FitOneLine treatment (#3); these
  numeric widgets never did.
  FIX: extracted FitOneLine into a SHARED module
  `apps/web/src/components/widgets/sports/FitOneLine.tsx` (was a local fn in
  SportElementWidgets) + added a `FitValue` helper in SportWidgets that
  wraps the value in FitOneLine → renders at a large base and scales DOWN
  to fill-but-fit the zone. `config.fontSize` (if set) is the base/target;
  FitOneLine clamps it to fit so even a huge pegged value can't overflow.
  Applied to all 5 widgets' bare-value returns. Taurus-safe (transform:
  scale; no gap/inset/backdrop) + tsc clean + taurus gate green.
  - LESSON (architecture): when the SAME visual rule (shrink-to-fit) is
    needed in two widget files, EXTRACT the primitive to a shared module —
    don't duplicate. FitOneLine is now the one auto-fit primitive for ALL
    sport text/number elements across both files.
  - NOTE: the score/stat COLUMN variants (showLogo/showName/label stacked)
    still use em-relative sizing — not the reported bug, left as-is; revisit
    if an operator hits overflow there.
  - ⚠️ UNVERIFIED-IN-BUILDER (auth-gated, no browser this session) — operator
    is the visual check.

## Standing rules learned
- Verify against the REAL rendered zone variant (operator screenshot / live),
  never a same-named sibling widget. (`scoreboard-main` ≠ the composed
  `sb-*` element board.)
- Global/shared controls (ColorPickerField, etc.) = bigger blast radius →
  their own commit + own verification, not bundled.
- Every fix: deploy-watch the Vercel commit status → tell the operator when
  it's actually live (don't make them refresh-hunt).
