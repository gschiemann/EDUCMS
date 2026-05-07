# HS Template Widgets — Pre-Demo Audit (2026-05-07)

Demo target: high school district demo on 2026-05-08.

Files audited (in `apps/web/src/components/widgets/hs/`):

- `HsStage.tsx` (shared 3840x2160 / 2160x3840 transform:scale wrapper)
- `HsVarsityWidget.tsx`, `HsVarsityPortraitWidget.tsx`
- `HsBroadcastWidget.tsx`, `HsBroadcastPortraitWidget.tsx`
- `HsYearbookWidget.tsx`, `HsYearbookPortraitWidget.tsx`
- `HsTerminalWidget.tsx`, `HsTerminalPortraitWidget.tsx`
- `HsTransitWidget.tsx`, `HsTransitPortraitWidget.tsx`
- `HsGalleryWidget.tsx`, `HsGalleryPortraitWidget.tsx`
- `HsBlueprintWidget.tsx`, `HsBlueprintPortraitWidget.tsx`
- `HsZineWidget.tsx`, `HsZinePortraitWidget.tsx`

Cross-references:

- `apps/web/src/components/widgets/AnimatedWelcomeWidget.tsx` — gold standard (live clock + Open-Meteo weather + IP geolocate fallback)
- `apps/web/src/components/template-builder/BuilderZone.tsx` — `[data-field]` inline-edit hotspot mechanism
- `apps/web/src/components/template-builder/PropertiesPanel.tsx` — sidebar editor cases
- `apps/web/src/components/widgets/WidgetRenderer.tsx` — widget-type to component dispatch
- `apps/api/src/templates/system-presets.ts` — preset registration

---

## Per-widget table

| Widget | Hotspots? (`[data-field]` count) | Live data? | Visual quality (1-5) | Top 2 fixes needed | Estimated fix time |
|---|---|---|---|---|---|
| HsVarsityWidget (landscape) | Yes (37) | No | 5 | (1) Wire live clock + ZIP weather (`clockTimeZone`/`weatherLocation`) so the stat row pulls real data. (2) Add Sentry boundary check — pennant SVGs are 10 inline elements that could be GPU-heavy on Android WebView. | 90 min |
| HsVarsityPortraitWidget | Yes (31) | No | 4 | (1) **No PropertiesPanel section** — operator sees an empty editor. Add a `case 'HS_VARSITY_PORTRAIT'` (or a `HS_DEFAULTS_BY_TYPE` map mirroring MS). (2) Wire live clock & weather. | 60 min |
| HsBroadcastWidget (landscape) | Yes (32) | No | 5 | (1) Wire live clock + weather. (2) `teacherPortraitTag` shows literal `"[ portrait ]"` — replace with a real photo upload field (mirror `STAFF_SPOTLIGHT.photoUrl` upload pattern). | 90 min |
| HsBroadcastPortraitWidget | Yes (28) | No | 4 | (1) **No PropertiesPanel section.** (2) Same `teacherPortraitTag` placeholder issue. | 60 min |
| HsYearbookWidget (landscape) | Yes (38) | No | 5 | (1) Wire live clock + weather + countdown (`countdownDate` → days remaining, like AnimatedWelcomeWidget). (2) `featurePhotoTag` and `teacherPhotoTag` render literal `"[ photo · auditorium · april 18 ]"` strings — needs photo upload. | 90 min |
| HsYearbookPortraitWidget | Yes (30) | No | 4 | (1) **No PropertiesPanel section.** (2) Same photo-tag literal text issue. | 60 min |
| HsTerminalWidget (landscape) | Yes (31) | No | 4 | (1) Wire live clock — the `07:53:21` and uptime line are hardcoded. The CRT aesthetic loses credibility if the clock is frozen. (2) The lunch stat box has a hardcoded inline 80px font on a non-`data-field` `<div>` (line 190) — operator can't change `lunchVal` via inline edit; only via panel. | 60 min |
| HsTerminalPortraitWidget | Yes (34) | No | 4 | (1) **No PropertiesPanel section.** (2) Hardcoded `UP 184d` — operator can't customize. | 60 min |
| HsTransitWidget (landscape) | Yes (27) | No | 5 | (1) Wire live clock + weather. (2) The 5 "departure" rows wire `data-field` ONLY on the 6 status cells; the time/code/dest/note/room/teacher cells render plain text without `data-field` attributes (lines 165-173) — operator must use the side panel, can't click-to-edit. | 90 min |
| HsTransitPortraitWidget | Yes (28) | No | 4 | (1) **No PropertiesPanel section** AND no inline-edit on departure rows. Operator has zero way to customize the table. | 90 min |
| HsGalleryWidget (landscape) | Yes (31) | No | 5 | (1) Wire live clock + weather. (2) Roman-numeral event rows (lines 138-147) render plain text without `data-field` on `name`/`meta`/`time`/`day` — same inline-edit gap as Transit. | 75 min |
| HsGalleryPortraitWidget | Yes (35) | No | 4 | (1) **No PropertiesPanel section.** (2) Same event-row inline-edit gap. | 60 min |
| HsBlueprintWidget (landscape) | Yes (33) | No | 4 | (1) Wire live clock + weather. (2) Schedule rows (lines 178-185) render plain text — no `data-field`, no inline edit. (3) `data-sheet` annotations like `A-01.1` are hardcoded in JSX (`data-sheet="A-01.1"`); operators can't rename without editing source. | 90 min |
| HsBlueprintPortraitWidget | Yes (26) | No | 4 | (1) **No PropertiesPanel section.** (2) `periodRows` (lines 80-88) hardcodes 4 of 7 schedule rows (LUNCH/CHEM-260/CALC-330/PEP RALLY); operator cannot edit those rows at all — they're not in `defaultConfig`. | 90 min |
| HsZineWidget (landscape) | Yes (33) | No | 5 | (1) The polaroid `.hs-zn-pic` blocks (line 234) are pure CSS gradients — operator can't upload a real photo. Wire `event0PhotoUrl` / `event1PhotoUrl` / `event2PhotoUrl` config fields. (2) Wire live clock & weather. | 90 min |
| HsZinePortraitWidget | Yes (35) | No | 4 | (1) **No PropertiesPanel section.** (2) Same polaroid `.hs-zn-pic` placeholder gradient — no way to upload student photos. | 75 min |

Hotspot totals: **509 `data-field` attributes across 16 files** (avg 32 per widget). Each landscape sibling is comparable; portraits have a slightly lower count because some regions (departure rows, schedule rows) reflowed without preserving `data-field` on the moved cells.

---

## Most-broken first (priority order)

These are the items I would fix BEFORE the demo. Ranked by likelihood of being noticed by the customer and by cost-to-fix.

1. **All 8 HS portrait widgets have NO PropertiesPanel section.** When an operator selects a portrait HS template and clicks the only zone, the right-side editor returns `null` (falls through `default:` case → no `MS_DEFAULTS_BY_TYPE` entry → no `THEMED_WIDGET_FIELDS` entry → return null at line 2954 of PropertiesPanel.tsx). This is the single most-visible regression in the demo path. **Fix: add an `HS_DEFAULTS_BY_TYPE` map keyed off the existing landscape DEFAULTS, mirror MS pattern.** ~45 min for all 8.
2. **HsTransitWidget / HsTransitPortraitWidget — departure-row cells lack `data-field`.** Operator clicks "BOARDING" status and edits it inline (works), but cannot click on `08:05`, `APE-301`, `AP ENGLISH LIT`, `Ms. Park` etc. — those cells render bare `{e.time}` text. ~30 min to add.
3. **HsBlueprintPortraitWidget — 4 of 7 schedule rows are hardcoded** (LUNCH/CHEM-260/CALC-330/PEP RALLY are literal JS, not in `Cfg`). Operator literally cannot personalize those rows. ~30 min.
4. **No live clock anywhere in the HS pack.** The customer is going to look at all 16 templates side-by-side and the clock will read `7:53` on every screen forever. AnimatedWelcomeWidget runs a `setInterval(() => setNow(new Date()), 30_000)` — port that to all 16 HS widgets. ~60 min for a shared `useLiveClock(timezone, format)` hook + 16 call sites.
5. **No live weather anywhere in the HS pack.** Same Open-Meteo + IP-geolocate pattern as AnimatedWelcomeWidget. The temp will read `46°` on every screen forever. ~90 min for a shared `useLiveWeather` hook.
6. **Photo placeholders are literal text strings.** HsBroadcast `teacherPortraitTag: '[ portrait ]'`, HsYearbook `featurePhotoTag: '[ photo · auditorium · april 18 ]'`, HsTerminal `lunchVal: 'chicken bowl'`. Mirror the `staff.photoUrl` upload pattern in BuilderZone.tsx (lines 114, 156-160). ~60 min for the three widgets that have textual placeholders for photo regions.
7. **HsZineWidget polaroid stock gradient.** All 3 event polaroids and 1 teacher polaroid use a CSS-gradient `.hs-zn-pic` block that visually reads as "broken image." Wire upload fields. ~30 min.
8. **HsTerminalWidget hardcoded uptime + lunch font.** `UP 184d` and inline `style={{ fontSize: 80 }}` on `lunchVal`. Minor but operator-visible. ~15 min.
9. **HsGalleryWidget event rows lack `data-field`.** Same as Transit. ~20 min.
10. **HsBlueprintWidget `data-sheet` annotations are hardcoded.** Operator cannot rename `A-01.1` etc. without editing source. ~10 min.

---

## Cross-cutting issues

These affect every widget in the pack and are worth solving once at the layer below.

- **Zero live data wiring.** All 16 widgets are static HTML. There is exactly ONE `useEffect` in the entire `hs/` folder, and it lives in `HsStage.tsx` for the scale-fit math. AnimatedWelcomeWidget by contrast runs a live clock, three-tier weather geolocation, 15-minute weather refetch, and confetti spawn. **None of the HS widgets accept a `clockTimeZone`, `weatherLocation`, `weatherUnits`, `tickerSpeed`, or `countdownDate` config key.** Operator config is purely cosmetic strings — never wired to API data.
- **Portrait variants accept a `live` prop but never read it.** Every portrait function signature is `({ config }: { config?: Cfg; live?: boolean })` — the prop is destructured AS A TYPE only, never extracted from the args. Compare to AnimatedWelcomeWidget which gates ALL expensive work behind `isLive`. Right now this is a non-issue (no expensive work to gate), but if you wire live data you must gate it on `isLive` like the gold standard or thumbnails will fire 16 weather fetches.
- **No PropertiesPanel coverage for portraits.** Already called out above; root cause is structural.
- **Hardcoded school names = "WESTRIDGE WILDCATS" / "WESTRIDGE HIGH" / "Westridge" everywhere.** The defaults are realistic for a demo but if the customer school is "Roosevelt High" the operator must individually overwrite every `schoolName` / `schoolInitials` / `schoolEst` field. There is no `Tenant.brandSettings` propagation into HS widgets — landscape MS widgets have the same pattern, so this is by-design but worth flagging if the demo wants to start with the customer's name pre-filled.
- **Hardcoded teacher = "Ms. Kowalski" everywhere.** Same problem. Could be solved with a `useTenantStaffPick()` hook that surfaces the most-recently-uploaded staff member.
- **Roman-numeral / departure / schedule rows render plain text without `data-field`.** Pattern recurs in 5 widgets (Transit landscape+portrait, Gallery landscape+portrait, Blueprint landscape). 30s of edit per cell to add the attribute would unlock click-to-edit on all of them.
- **Photos are placeholder gradients or bracket-text strings.** No widget has a working image-upload field. The customer will ask "where do I put my coach's photo?" and the answer is "you can't." Add a uniform `xxxPhotoUrl` config + BuilderZone drop-zone wiring.
- **Demo gallery (`/demo/hs-preview`) does not include HS portraits.** Only landscape HS + landscape MS + portrait MS are listed. If you intend to demo HS portrait orientation, add it to the demo page so QA can sanity-check at thumbnail scale (the HsStage three-layer scale is the exact pattern that broke MS portraits in early ports).

---

## Quick wins for tomorrow's demo

These are the cheapest high-impact fixes that will make the difference between "this looks like a demo" and "this looks like a product."

1. **Add `HS_DEFAULTS_BY_TYPE` to PropertiesPanel.tsx** (~45 min). Copy the 8 landscape `DEFAULTS` constants (already exported) into a single map keyed by both `HS_X` and `HS_X_PORTRAIT`. The existing `default:` case at line 2860 already does the rest — operator gets a fully-functional auto-form for every portrait variant. **This single change closes the most-visible regression and makes 8 widgets demoable that currently aren't.**

2. **Add a shared `useLiveClock` hook + wire to the 8 landscape widgets** (~60 min). 6 lines of code per widget — `const now = useLiveClock(c.clockTimeZone)` then `clockTime` derived from `now` if no override. AnimatedWelcomeWidget already has the cadence (30-second interval). If the demo shows a wall of HS templates, the synchronized live clock across all 8 of them is genuinely impressive — and it costs nothing.

3. **HsVarsityWidget + HsBroadcastWidget + HsYearbookWidget are 80% there visually.** They look like real lobby signage today (5/5 visual). The Varsity scoreboard with pulsing red dot, the Broadcast ON-AIR pill with phantom-glow ring, the Yearbook drop-cap-italic lede — these are the demo highlight reel. Pre-fill them with the customer's school name + a single staff photo and they will close the deal. Spend the bulk of the remaining time polishing these three.

---

## Notes on what is NOT broken

- HsStage.tsx scaling is correct — three-layer pattern (viewport / stage-outer with scaled dimensions / stage with `transform:scale + transform-origin: 0 0`) matches the documented good pattern. There are no widget-level layout regressions.
- All 16 widgets ARE registered correctly: 16 imports + 16 case statements in WidgetRenderer.tsx (lines 122-184, 434-449), 16 preset entries in `system-presets.ts` (lines 460-521 + 877-933).
- No TypeScript or import errors in any of the 16 files.
- Inline-edit (Canva-style click-on-text) works on most fields — the 509 `data-field` attributes are correctly hooked into BuilderZone.tsx at line 615 (`querySelector` matches `[data-field="${fieldKey}"]` per zone). The 5 widgets I called out as missing `data-field` on their event/schedule rows are the exception, not the rule.
- The visual design is genuinely good. The Varsity jersey-chest greeting, the Broadcast satellite-arc SVG, the Terminal CRT phosphor-glow, the Zine photocopied texture — these are not "rounded rectangle with shadow." They follow the CLAUDE.md "Push the metaphor as far as it will go" rule.

---

**Audit time:** ~25 minutes (file reads + cross-reference checks).
**Total demo-prep time estimate to fix everything in this report:** ~9-10 hours.
**Time to fix the top 5 quick wins:** ~3-4 hours.
