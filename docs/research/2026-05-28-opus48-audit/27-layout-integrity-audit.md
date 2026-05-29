# Template/Widget Visual-Integrity Audit

> Opus 4.8 read-only, 2026-05-28 (Wave 3). Rendered widgets through the real `/player`
> route at 1920×1080 (+ 1080×1920) via Playwright with worst-case operator data
> (60-char school names, 9-14 row lists, 49-char teacher names). Findings DOM-measured.
> Font-fix agent's 6 targets excluded; this is the LAYOUT/overlap/broken-render class.

## P0 — daily-driver renders BLANK
1. **`AnimatedHallwayScheduleWidget.tsx:382-386` — schedule body INVISIBLE.** `.hs-rows` has
   `container-type: size` on a `flex:1` container → size-containment zeroes intrinsic height →
   `.hs-rows` + all 7 `.hs-row` resolve to height 0 (text nodes exist but boxes are 0). #1 hallway
   daily-driver shows ruled lines with NO schedule, default data, every screen size (modern Chromium
   too, not just Taurus). **Fix:** remove `container-type:size` from `.hs-rows`, keep it on `.hs-row`
   (like `.bs-rows`/`.cafe-items`/`.mn-stories` which render fine). Portrait sibling already works.
   → **NOTE: the font-fix agent (commit 24f284d) already fixed this** via `.hs-notebook{display:flex;
   flex-direction:column}` — independently confirmed. Verify the fix renders all 7 rows.
2. **`fitness/FitnessClassScheduleWidget.tsx` — BLANK after the last class.** `showPastClasses=false` +
   fixed daytime demo hours → after the last class (evenings, 24h gyms) every row is "past" + hidden →
   ~95% empty board. **Fix:** when all past, fall back to next-day / show full day ghosted; never empty.

## P1 — systemic: vertical packs don't fill the canvas (40-65% dead space)
3. **Restaurant/Retail/Bar/Fitness packs (~40 widgets, batch-built 2026-05-17)** cluster content at top,
   leave 40-65% of 1080px empty. They use flow layout (`width/height:100%`,`container-type:size`)
   WITHOUT the `transform:scale` fixed-canvas discipline the K-12 Animated widgets use; outer col is
   `flex:1` but inner list/grid doesn't distribute (no `flex:1 1 0` rows, no `justify-content:space-between`).
   Confirmed: `restaurant/MenuBoardWidget.tsx` ~60% empty; `retail/RetailStorefrontHoursWidget.tsx:249-269`
   ~65%; `bar/TapListWidget.tsx` ~88%; `bar/CocktailMenuWidget.tsx` top ~40% + title clipped; `restaurant/ComboCarouselWidget.tsx`.
   **Fix:** give each list/grid `flex:1; min-height:0` + `justify-content:space-between` (copy the Animated cafeterias).
4. **Vertical packs use emoji as hero imagery → "rounded rectangle + shadow" anti-pattern** (CLAUDE.md forbids):
   `retail/RetailProductGridWidget.tsx` (big empty tiles, tiny emoji), `RetailWayfindingMapWidget`, `RESTAURANT_COMBO_CAROUSEL`.

## P1 — text overlap / overflow on long content
5. **`BulletinHallwayWidget.tsx:338` `.bh-name`** lacks `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`
   (Animated's `.hs-name` has it) → 49-char name wraps 2 lines, bleeds into adjacent row (overlap). Add ellipsis + `flex:1 1 0` on `.bh-row`.
6. **`retail/RetailWayfindingMapWidget.tsx` — "YOU ARE HERE" overlaps "CHECKOUT"** (text-on-text). Offset the marker.
7. **`AnimatedAchievementShowcaseWidget.tsx`** — long school name title (~88px) wraps line 2 onto the date subtitle;
   honor lists unbounded (last entry bleeds past bottom stat row). Clamp title block + cap/auto-fit honor lists.
   → NOTE: font-fix agent bumped `.as-nm` 18→25px; the title-overlap is separate, still open.

## P2 — capacity & polish
8. `StorybookCafeteriaWidget.tsx:204` caps menu at 3 items; `ScrapbookCafeteriaWidget.tsx:143` caps at 4 — real
   K-12 lunch is 5-8 items, so these can't show a full menu. Storybook shows broken "?" icons when no emoji.
9. Silent truncation: `AnimatedBusBoardWidget routes.slice(0,8)` (14-route school loses 6), `AnimatedMorningNews stories.slice(0,4)`,
   `BulletinHallway rows.slice(0,8)` — no "+N more" affordance.
10. Gappy balance: `AnimatedMainEntrance`, `ANIMATED_EVENT_COUNTDOWN`, `SCOREBOARD` metadata microscopic in dead navy.
11. Minor: long `chefName` clipped on cafeteria polaroid (cosmetic).

## Honest verdict — catalog is bimodal (tracks CLAUDE.md "stop batching")
- **World-class (~35-40%):** HS pack (Varsity/Yearbook/Terminal/Blueprint), Storybook Hallway, iterated Animated K-12 daily-drivers (Cafeteria E/M/H, Bus Board, Bell Schedule) — handle 9-14 rows of long real data with ellipsis + alignment. Superintendent-showable.
- **Salvageable (~25%):** MS pack (busy/cramped), Main Entrance, Scoreboard, Scrapbook/Storybook Cafeteria (capacity+placeholders), Achievement (long-name overlap).
- **Not yet world-class — systemic rework (~35-40%):** the entire Restaurant/Retail/Bar/Fitness vertical packs (~40 widgets) — batch-built, skip transform:scale, 40-65% dead space, emoji-hero, one (Fitness Class Schedule) blank under normal conditions. Read as wireframes.

**Highest-leverage structural fixes (mechanical, low-risk, proven-good sibling to copy):**
(a) the `container-type:size`-on-a-flex-container pattern (kills Hallway — fixed by 3A); (b) "inner list doesn't
distribute into its flex parent" (causes all the vertical-pack dead space). Top-10 fix order: Hallway(done)→Fitness
schedule→Restaurant menu→Retail hours→Bar tap→Bulletin overlap→Retail grid→Wayfinding overlap→Achievement title→Storybook/Scrapbook cafeteria capacity.
