# Cycle 1 — Editor / Widget / VariantPicker Audit

Static audit of `PropertiesPanel.tsx` (4078 lines), `WidgetRenderer.tsx`
(2902 lines), `VariantPicker.tsx` (357 lines), `variants-register.ts`
(699 lines), all `apps/api/src/templates/*-presets.ts`. Compared 117
unique preset widget types against renderer cases and editor cases.

## P0 — none

WidgetRenderer dispatches every one of the 117 preset widget types
(diff of preset-set vs renderer cases = empty). VariantPicker
`K12_ONLY_CATEGORIES` covers every category emitted by the registered
variant catalog. AI Generate button + modal: AbortController,
Escape-key, 503/rate-limit error mapping, defaultContext auto-run all
wired correctly (`AiGenerateButton.tsx:117-180`).

## P1 — editor coverage gaps

1. **`FITNESS_WORKOUT_TIMER` has no editor case.**
   `PropertiesPanel.tsx` has no `case 'FITNESS_WORKOUT_TIMER':`. The
   widget is used in `apps/api/src/templates/fitness-presets.ts:191`
   and rendered via `WidgetRenderer.tsx:509`. Falls through MS_DEFAULTS
   (no entry), THEMED_WIDGET_FIELDS (no entry), then `return null` —
   operator only sees JSON Advanced. Operator request from this
   morning was "make sure they are editable just like the k-12 units."
   Add a `case` with mode (tabata/hiit/emom/amrap/custom), workSeconds,
   restSeconds, totalRounds, workColor, restColor, classTitle,
   trainerName, autoStart fields (config interface at
   `FitnessWorkoutTimerWidget.tsx:17-28`).

2. **5/6 RESTAURANT_*, 4/6 BAR_*, 6/7 RETAIL_* widgets have no editor
   case.** Only RESTAURANT_MENU_BOARD, BAR_TAP_LIST, BAR_COCKTAIL_MENU,
   RETAIL_PRODUCT_GRID have explicit cases (`PropertiesPanel.tsx:2280,
   2295, 2304, 2312`). The other 12 widget types
   (RESTAURANT_ALLERGY_LEGEND / RESTAURANT_COMBO_CAROUSEL /
   RESTAURANT_LOYALTY_TICKER / RESTAURANT_SPECIALS_CALLOUT /
   RESTAURANT_WAIT_TIME / BAR_HAPPY_HOUR_COUNTDOWN /
   BAR_GAME_DAY_SCHEDULE / BAR_EVENT_TONIGHT / BAR_TRIVIA_SCOREBOARD /
   RETAIL_PRICE_CALLOUT / RETAIL_SALE_COUNTDOWN /
   RETAIL_WAYFINDING_MAP / RETAIL_LOYALTY_QR /
   RETAIL_LOOKBOOK_CAROUSEL / RETAIL_STOREFRONT_HOURS) are referenced
   by 10 new restaurant presets and the bar/retail presets, render
   correctly, but the operator can only edit them via JSON Advanced.

3. **JSON-parse failure leaks string into array configs.**
   `PropertiesPanel.tsx:2179-2181, 2201-2203, 2230-2232` —
   `try { setField({ creatives: JSON.parse(v) }); } catch { setField({
   creatives: v }); }`. Mid-edit invalid JSON sends a string to the
   widget; `c.creatives.length > 0` returns truthy on strings, then
   `creatives[idx % length]` returns a single character. Render
   doesn't crash but flickers blank for every keystroke. Affects
   FITNESS_AD_BANNER, FITNESS_CLASS_SCHEDULE, FITNESS_MOTIVATIONAL_QUOTE.
   Fix: only setField when parse succeeds, OR keep a draft string
   field separate from the array.

## P2 — UX polish

4. **AssetPickerField uses uncontrolled `defaultValue`**
   (`PropertiesPanel.tsx:3338`). When `onChange` updates `value` from
   "Browse library", the underlying `<input>` keeps its initial
   defaultValue and never reflects the new URL string. Thumbnail
   updates (line 3319), but the URL field shows the OLD URL. Switch
   to controlled `value={value}` with onBlur commit, or add a `key`
   prop tied to `value` to force remount.

5. **Auto-form section labels read like API specs** for the 15
   fitness themed scenes. `FitnessLockerWidget` has `lf.*` (Lost &
   Found), `FitnessReformerWidget` has `mq.*`/`reformers.*`. The
   `prettyTitle()` fallback at `PropertiesPanel.tsx:322-330` produces
   "LF" (≤2 chars uppercased), "Mq", "Reformers" for missing prefixes.
   Add ~30 mappings to `SECTION_LABELS` (lines 239-289) — at minimum:
   lf, mq, marquee, deadlift, reformers, ksched, lanes, leader, lb,
   nowplaying, promo, tv, valet, rec, screen, slot, tutorial, weigh,
   sched, log, found, sand, crag, runs, sends, sets, vault, zones.

6. **14 v2 admin-tier widgets disappear for non-K12 tenants.**
   `v2/registry.ts:70-187` registers 14 widgets with `level: 'admin'`
   (CLOCK_OPS, HEADLINE_OPS, ANN_OPS, CAL_OPS, STAFF_OPS, etc. —
   terminal/console aesthetic, NOT K-12 specific).
   `variants-register.ts:646` maps `admin → OFFICE`, and `OFFICE` is
   in `K12_ONLY_CATEGORIES` (`VariantPicker.tsx:120`). A
   gym/restaurant tenant loses these neutral cyber-ops widgets. Fix:
   remap `admin → MODERN` in the v2 mapping OR add a `CONSOLE`
   category that's never K12-filtered.

7. **Streaming-settings link uses relative path.**
   `PropertiesPanel.tsx:3572` — `<a href="settings/streaming">`. From
   the template-builder route this resolves to
   `/[schoolId]/template-builder/settings/streaming` (404). Should be
   `/[schoolId]/settings/streaming` or use Next `<Link>`.

8. **`FITNESS_MOTIVATIONAL_QUOTE` AI Generate omits defaultContext.**
   `PropertiesPanel.tsx:2213-2222` doesn't pass it; ANNOUNCEMENT (line
   880-892) does. Pass `cfg.quotes[last]?.text` for parity.

## GREEN — verified correct

- All 117 preset widget types have a renderer `case` (diff empty).
- VariantPicker `K12_ONLY_CATEGORIES` covers every registered variant
  category (ARTS / ATHLETICS / BOLD / BROADCAST / CAFETERIA /
  CLASSROOM / DARK / ELEMENTARY / HALLWAY / HIGH / LIBRARY / LOBBY /
  MIDDLE / MINIMAL / MODERN / OFFICE / PLAYFUL / SAFETY / STEM).
- AI Generate: 503 mapping (line 171), rate-limit mapping (line 173),
  AbortController on unmount (line 128), Escape-key close (line 124),
  auto-run on defaultContext (line 134).
- 8 of 9 new fitness widgets (FITNESS_AD_BANNER / _APP_LIBRARY /
  _CLASS_SCHEDULE / _LIVE_TV / _MOTIVATIONAL_QUOTE / _MUSIC_PLAYER /
  _STICK_LAUNCHER / _TRAINING_VIDEO) have explicit editor cases.
- All 15 themed fitness scenes (FITNESS_STADIUM through FITNESS_LOBBY)
  have MS_DEFAULTS_BY_TYPE entries (lines 87-101); each widget's
  `pick()` helper falls back to DEFAULTS, so empty-config rendering
  is safe.
- ColorPickerField, ToggleField, SelectField are controlled
  components — save/load round-trips cleanly.
- StreamingChannelPickerField + PosCategoryPickerField fetch
  `/streaming/channels` and `/pos/categories` correctly.
