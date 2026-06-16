# Cycle 3 — Editor / VariantPicker / AiGenerate Retest

Static retest of `PropertiesPanel.tsx` (4234 lines), `VariantPicker.tsx`,
`AiGenerateButton.tsx` against cycle 1 + cycle 2 fixes. Plus a fresh
sweep for new gaps in the RETAIL pack.

## Job 1 — Cycle 1+2 fixes hold (all GREEN)

- **editor-BUG-001 — VERIFIED.** `PropertiesPanel.tsx:2282` has explicit
  `case 'FITNESS_WORKOUT_TIMER':` block. Surfaces `classTitle`,
  `trainerName`, `mode` (Tabata/HIIT/EMOM/AMRAP/Custom — preset switching
  auto-applies work/rest/rounds defaults), `workSeconds`, `restSeconds`,
  `totalRounds`, `currentRound`, `workColor`, `restColor`, `autoStart`,
  `audioCues`. Matches the FitnessWorkoutTimerConfig interface.
- **editor-BUG-002 (partial 9/15) — VERIFIED.** All 9 RESTAURANT/BAR
  cases present and correctly typed at lines 2363, 2372, 2386, 2397,
  2407, 2417, 2429, 2439, 2451 (RESTAURANT_COMBO_CAROUSEL,
  RESTAURANT_SPECIALS_CALLOUT, RESTAURANT_LOYALTY_TICKER,
  RESTAURANT_WAIT_TIME, RESTAURANT_ALLERGY_LEGEND,
  BAR_HAPPY_HOUR_COUNTDOWN, BAR_GAME_DAY_SCHEDULE, BAR_EVENT_TONIGHT,
  BAR_TRIVIA_SCOREBOARD).
- **editor-BUG-003 — VERIFIED.** Eight JSON-array TextAreaField onChange
  handlers use `catch { /* keep previous value; user is mid-typing */ }`
  (lines 2186, 2209, 2239, 2368, 2413, 2425, 2435, 2462). Zero
  occurrences of the old `catch { setField({ X: v }) }` anti-pattern
  remain in the file.
- **VariantPicker K12_ONLY_CATEGORIES — VERIFIED.** Set still defined at
  line 117 with all 13 categories; filter applied via
  `variantVisibleForVertical()` at line 124. `isK12 = vertical === 'K12'`
  derived at line 140; grade-chip render gated by `isK12 && ...` at
  line 257.
- **AiGenerateButton hardening — VERIFIED.** Escape close at line 141,
  AbortController abort on unmount at line 171, friendly 503 message at
  line 216 ("AI is not configured for this deployment..."), rate-limit
  message at line 218 ("Hit the hourly AI cap..."). The
  ai-imports-006 a11y additions (role=dialog, aria-modal,
  aria-labelledby, focus trap, focus restore) are all present at
  lines 128-175 / 233.

## Job 2 — New findings

### P1 — confirmed gaps (cleanup agent in flight)

1. **6 RETAIL widgets still fall through to JSON-only Advanced.**
   Confirmed via `grep` against PropertiesPanel.tsx — zero matches for
   `case 'RETAIL_LOOKBOOK_CAROUSEL'|'RETAIL_STOREFRONT_HOURS'|`
   `'RETAIL_PRICE_CALLOUT'|'RETAIL_SALE_COUNTDOWN'|'RETAIL_LOYALTY_QR'|`
   `'RETAIL_WAYFINDING_MAP'`. All six are referenced as
   `widgetType:` literals in `apps/api/src/templates/retail-presets.ts`
   (lines 66, 105, 161, 186, 246, 289, 354, 416, 503, 528, 574, 599 —
   12 preset uses across the retail pack). Operator drags any of these
   onto the canvas and gets the JSON-only Advanced fallback. Same
   severity / scope as editor-BUG-002. Cleanup agent is fixing in
   parallel — verifying the gap exists today only.

2. **BAR_TAP_LIST + BAR_COCKTAIL_MENU minimal cases miss real config
   fields.** Both editor cases (lines 2330, 2339) work but expose a
   strict subset of their widget Config interface:
   - `TapListConfig` (`TapListWidget.tsx:39`) declares `taps[]`,
     `title`, `subtitle`, `columns`, `accentColor`. Editor surfaces
     only `title`, `posSync`, `posCategory`, `columns`. **Missing:
     subtitle, accentColor, taps[] array editor.** When `posSync` is
     OFF an operator literally cannot edit the tap rows.
   - `CocktailMenuConfig` (`CocktailMenuWidget.tsx:33`) declares
     `cocktails[]`, `title`, `subtitle`, `footer`, `columns`. Editor
     surfaces only `title`, `posSync`, `posCategory`. **Missing:
     subtitle, footer, columns, cocktails[] array editor.** Same
     posSync-off blank-edit problem.

   Operator-facing impact: a bar tenant whose POS doesn't yet ship
   menu items has no UI path to populate the live demo data shown in
   the widgets. Pattern fix is the same as the 9 widgets in
   editor-BUG-002 — add TextField/ColorPickerField/TextAreaField rows
   for the missing config keys.

### TypeScript health — GREEN

`cd apps/web && npx tsc --noEmit` returns errors ONLY in test files
(`RoleGate.test.tsx`, `touch-widgets.test.tsx`,
`AnimatedWelcomeWidget.spec.tsx`, etc.) — every error is a missing
`@testing-library/react` matcher type, all pre-existing from before
cycle 2. Filtered for non-test production paths: zero errors. The 9
new RESTAURANT/BAR cases + 1 FITNESS_WORKOUT_TIMER case introduced no
new TypeScript regressions.

## GREEN — verified correct

- editor-BUG-001 / -002 / -003 fixes intact and operator-usable.
- VariantPicker vertical filter + grade-chip gating intact.
- AiGenerateButton: Escape, AbortController, 503 friendly, rate-limit
  friendly, full a11y dialog pattern intact.
- Zero new TypeScript errors in production code.
