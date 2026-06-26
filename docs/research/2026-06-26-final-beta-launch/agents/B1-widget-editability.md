# Wave B1 — Widget editability depth (§19)

**Surface tested:** The template-builder Properties panel + both floating bottom toolbars, graded against the CLAUDE.md **§19 Template + Widget Editability Standard**. All widget TYPES (the editable unit — not every one of the ~110 `*Widget.tsx` render files, most of which are landscape/portrait render variants of a shared TYPE).
**Scale tier:** Read-only code audit (no app run — per ground rules). Cross-referenced live prod is implied; editing UI is client-only React so file-reading is authoritative.
**Standard Audit Surface §§ covered:** §19 (Editability), §20 (Design/UX/Functionality lenses). Adjacent (§3/§4 AI sparkle, §2 storage/asset-picker) touched only where they intersect editability.

## Headline verdict

The operator's historic "you can't edit a single word" complaint is **fixed** — every widget type now reaches an editor (Properties panel case, THEMED auto-form, MS/Fitness auto-form, or the universal "make it your brand" block). Content/items are editable everywhere I checked. **BUT** the §19 *text-style* criteria (per-field font/size/color/weight/**line-height**/**alignment**, and **brand-palette presets in the quick bars**) are only partially met, and the audit found a **dead rich-styling component (`StyleDisclosure`)** whose 6 doc-comments across the file claim a styling UX that no longer renders. No widget is below B for *content* editability; several are B (not A) for *style depth*. **No P0 launch-blocker** in the strict §19 sense (every word is editable); the gaps are P1/P2 polish + one documentation-vs-reality trap.

## What the editing architecture actually is (load-bearing)

There are **THREE** style-editing surfaces, and they do NOT all do the same thing:

1. **Right-hand Properties panel** (`PropertiesPanel.tsx`, 10.4k lines) — per-widget-type `switch` cases + auto-form fallbacks. This is where CONTENT, items, images, backgrounds, clock/countdown controls live. Color fields here use `ColorField`→`ColorPickerField`→`ColorPickerBody`, which **DOES** carry "Brand primary / Brand accent" swatches that emit `var(--brand-primary/accent)` (color-picker.tsx:358-429). ✅
2. **Floating per-field bottom bar** (in `BuilderShell.tsx` ~line 1094-1198) — the "click any text on the canvas to edit its style" bar. Font family, size +/−, **B / I / U / S**, raw color `<input type=color>`. **Missing line-height, missing alignment, raw color picker has NO brand presets.** Applies to any `supportsPerFieldStyles` widget (non-image, non-TEXT/RICH/TICKER, non-sport-element).
3. **Floating quick-action pill** (`BottomToolbar.tsx`) — only shows typography for `TEXT_WIDGET_TYPES = {TEXT, RICH_TEXT, TICKER, ANNOUNCEMENT}` and media controls for image/video. Writes whole-zone config. Raw `<input type=color>`, **no brand presets**.

Plus a **universal "Text style — make it your brand"** block appended to every non-media, non-v2 widget's panel (PropertiesPanel.tsx:6116-6171): `FontFamilyField` + `FontSizeField` + `ColorField` (brand presets ✅) + `FormatToggles`. This is what lifts MS/Fitness/themed widgets from "content-only" to "can brand it" — but it is **zone-wide**, not per-field, and has **no line-height and no alignment**.

The TEXT / RICH_TEXT widget (PropertiesPanel.tsx:2525-2630) is the gold standard and meets **every** §19 text criterion (content, font, size, B/I/U/S, **line-height** via `LineHeightField`, **alignment**, color + bgColor with brand presets, plus AI generate/rewrite). Use it as the parity target.

## Step-by-step what I did

1. Mapped every `case 'WIDGET'` in `PropertiesPanel.tsx` (110+ cases) and the three auto-form fallbacks (`MS_DEFAULTS_BY_TYPE`, `THEMED_WIDGET_FIELDS`, v2-variant style section).
2. Read `StyleableField` / `StyleableAreaField` (6408/6480) — confirmed they render **only** a focus-tracking `TextField`, NOT any style controls (the comment says styling "happens in BuilderBottomBar").
3. Traced the per-field styling to `BuilderShell.tsx` (real) and `StyleDisclosure` (PropertiesPanel.tsx:6299, **dead**).
4. Verified `ColorPickerBody` brand swatches resolve to `var(--brand-*)` (color-picker.tsx:358-429).
5. Verified universal Layout section: x/y/w/h + unit toggle + align buttons + Fill/Fit + **Rotation** + **Opacity** (PropertiesPanel.tsx:746-878). z-index = layer order buttons (acceptable).
6. Spot-checked CLOCK/COUNTDOWN/WEATHER/IMAGE/VIDEO/LOGO/CAROUSEL/RESTAURANT/BAR/RETAIL/HOLIDAY/DECORATION cases for the §19 per-type controls.
7. `grep` for `<StyleDisclosure` → **0 JSX call sites** (definition only). `grep` for `lineHeight`/`textAlign` in the per-field + bottom-bar paths → absent.

## Findings table

| # | Sev | area | what | repro | evidence (file:line) |
|---|-----|------|------|-------|----------------------|
| 1 | **P1** | per-field styling (HS/Holiday/themed) | `StyleDisclosure` — the rich per-field editor (FontFamily + Size + B/I/U/S + **line-height** + brand-aware ColorField + Highlight) — is **defined but never rendered**. 6 in-file comments (e.g. 7357-7359 "swap … for the Styleable* wrappers so each field gets a 🎨 Style disclosure (font-size + color)") describe a UX that does not exist. Operators editing a Holiday/HS field see only a text box; per-field styling is reachable ONLY via the separate canvas-click bottom bar, which is less discoverable and lacks line-height/align. | grep `<StyleDisclosure` → 0 matches; `StyleableField` (6455-6476) renders only `<TextField>`. | PropertiesPanel.tsx:6299 (def, orphaned); 6455-6476 (StyleableField has no style UI); 7357-7392 (Holiday comment claims a disclosure that's absent) |
| 2 | **P1** | per-field bottom bar (§19 line-height) | The shipping per-field style bar (BuilderShell) has font family, size, B/I/U/S, color — but **NO line-height and NO alignment**. §19 explicitly lists "line-height" and per-field "alignment" as required addressable text properties. Themed / HS / Holiday / MS / Fitness widgets therefore cannot set per-field line-height or alignment at all; only the TEXT widget can. | Select a themed widget, click a text field on canvas → bottom bar shows no leading/align controls. | BuilderShell.tsx:1094-1198 (no `lineHeight`/`textAlign`); contrast TEXT case PropertiesPanel.tsx:2617-2623 (has both) |
| 3 | **P1** | brand-palette presets in quick bars (§19 brand-honoring) | §19 requires every color field to offer "Brand primary / Brand accent". The right-panel `ColorField` does (✅), but **both floating color pickers are raw native `<input type="color">` with no brand swatches**: BuilderShell per-field (1176-1181) and BottomToolbar (201-207). An operator who recolors text from the canvas quick bar (the discoverable path) gets a generic OS picker, not their brand. | Select TEXT or themed widget, use the bottom-bar "A" color chip → native picker, no brand row. | BuilderShell.tsx:1176-1181; BottomToolbar.tsx:201-207; (the working one: color-picker.tsx:358-429) |
| 4 | **P2** | MS / Fitness pack per-field styling | MS + Fitness auto-form widgets render plain `TextField` (not `StyleableField`) — `isHsWidget` gates the styleable path, so **only HS_ widgets get per-field styling**; MS/Fitness get content-only + the universal zone-wide font/size/color block. Honest (the comment at 5873-5878 says the runtime hook is HS-only), but it's a parity gap: an MS welcome board can't style its headline independently of its sub-copy. | Select an MS/Fitness full-screen widget → fields are plain text boxes; only zone-wide "make it your brand" at bottom. | PropertiesPanel.tsx:5879 (`isHsWidget` gate), 5938-5961 (plain TextField branch) |
| 5 | **P2** | brand FONT preset | §19 brand-honoring is satisfied for color but there is **no "Brand font" option** anywhere — `FontFamilyField` lists Google fonts only, never `var(--brand-font)` / the tenant's brand typeface. A re-themed tenant's font does not auto-apply to widget text the way brand color does. | Open any Font dropdown → no brand entry. | PropertiesPanel.tsx:7762-7804 (FontFamilyField, no brand option) |
| 6 | **P2** | z-index as a number | §19 lists "z-index" explicitly. The panel exposes layer order only as Bring-forward / Send-back buttons (no numeric z-index field). Fine for 99% of cases; flag for completeness. | Layout section has no z-index input. | PropertiesPanel.tsx:1069-1071 (moveLayer buttons), no numeric z field |
| 7 | **P2** | per-widget background (non-template) | Background editing (solid/gradient/image + brand colors + 12 presets) exists for the **template canvas** (`BackgroundPanel.tsx`) and for v2 widgets (5822-5843) and a handful of typed widgets (TEXT bgColor, CLOCK bgColor, vertical accent colors). But most themed/auto-form widgets have **no per-widget background control** — their backdrop is baked into the widget art. §19 "Background: solid/gradient/image — all editable in PropertiesPanel" is met at canvas + v2 level, not universally per-widget. Mostly by-design (themed art), noted for completeness. | Select a Bulletin/Scrapbook themed widget → no bg solid/gradient/image field. | PropertiesPanel.tsx:6072-6096 (THEMED default branch = text/image only) |

## Per-widget-type grade (the §19 list)

**A / A- (meets §19 fully or near-fully):**
- `TEXT`, `RICH_TEXT` — **A+** (content, font, size, B/I/U/S, line-height, alignment, color+bg w/ brand presets, AI). The parity target.
- `IMAGE`, `IMAGE_CAROUSEL`, `VIDEO`, `VIDEO_CAROUSEL`, `LOGO`, `PHOTO_*` — **A** (asset picker + URL paste + fit cover/contain + opacity + radius + alt-text; carousels add interval/transition/reorder).
- `COUNTDOWN` — **A** (date+time picker, recurring schedule editor, label/eyebrow/fallback).
- `CLOCK` — **A** (12/24h, timezone, seconds, day/date toggle, 5 date formats, bgColor).
- `WEATHER` — **A** (smart location, °F/°C, live + manual override).
- `RESTAURANT_MENU_BOARD`, `BAR_TAP_LIST`, `BAR_COCKTAIL_MENU`, `RETAIL_PRODUCT_GRID` (+ other vertical packs) — **A-** (full ListItemsEditor: add/remove/reorder, name/price/desc/image/tags + brand ColorPickerField + POS toggle).
- `TICKER`, `ANNOUNCEMENT`, `QUOTE`, `STATS`, `MENU_ITEM` — **A-** (content + AI + style via quick bar).
- `HOLIDAY` — **A-** for content (variant/grade + all live text fields piped to iframe). Style works via bottom bar but the promised inline disclosure is dead (Finding 1).
- Sport elements (`SCORE_*`, `GAME_CLOCK`, `GAME_SEGMENT`, `GAME_STAT`, `SCOREBOARD`) — **A-** (zone-level font/size/color/align via the sport-element bottom-bar path; team/logo/label fields in panel).

**B+ / B (content fully editable; §19 style depth incomplete — the launch-watch tier, not blockers):**
- 20 `THEMED_WIDGET_FIELDS` widgets (`ANIMATED_*`, `BULLETIN_*`, `SCRAPBOOK_*`, `STORYBOOK_*`, cafeteria/hallway/bell/bus/news/achievement/welcome) — **B+**. Content + schedules/menus/bell-periods + image slots all editable (the 2026-05-28 P0-3 fix). Zone-wide font/size/color via universal block. **Missing:** per-field line-height/alignment, per-field styling beyond HS (Findings 2,4), dead inline disclosure (Finding 1).
- HS_* widgets (`HS_VARSITY/BROADCAST/YEARBOOK/TERMINAL/TRANSIT/GALLERY/BLUEPRINT/ZINE`) — **B+**. Get the per-field bottom bar (best of the themed lot) but still no line-height/align and the raw-color picker has no brand presets (Findings 2,3).
- MS + Fitness auto-form widgets — **B**. Content-only fields + zone-wide brand block; no per-field styling at all (Finding 4).
- `DECORATION`, `ANIMATED_BACKGROUND`, `HOUSE_AD_BANNER`, `MUSIC_PLAYER`, `STREAMING` — **B/B+** (real variant/config controls in panel; textless or near-textless so style criteria largely N/A).

**No widget graded below B.** The "can't edit a word" failure class is closed.

## Coverage — what I could NOT reach + why

- **Did not run the app** (ground rules forbid `pnpm dev`/Playwright). All findings are from code-reading the render path, which is authoritative for client-only editing UI, but I did not visually confirm the bottom-bar appears for every themed widget at runtime. The `supportsPerFieldStyles` gate (BuilderShell 985) is the deciding logic and reads correctly.
- **EXTERNAL_HTML signage/kiosk boards** — out of §19 widget scope (they're iframe boards edited via `ExternalHtmlTextEditor`, a separate surface). Their `data-field` text is editable; their per-field styling is the V5 shim's job, not PropertiesPanel. Flagged as N-A for this widget-editability pass.
- **Live brand-palette resolution on the player** — verified the var is *emitted* by the picker; did not curl a rendered player frame to confirm `var(--brand-primary)` resolves (other waves own player verification).

## Grade per Greg's 3 lenses (§20)

- **DESIGN: A-** — the panel, brand swatches, Canva-style bottom bars, and ListItemsEditor look like a premium product. Loses a half-step for two competing bottom bars + a native OS color picker leaking through in the quick path.
- **UX: B+** — content editing is genuinely 30-second easy and click-to-edit jumps work. Dinged by Finding 1 (comments promise a styling disclosure that isn't there → the *discoverable* per-field styling path is the less-capable bottom bar) and the line-height/align/brand-color gaps in that bar.
- **FUNCTIONALITY: B+** — everything wired actually works end-to-end (content, items, images, backgrounds, clock/countdown, brand color in the panel). Held below A by the dead `StyleDisclosure`, the missing §19 line-height/alignment in non-TEXT widgets, and brand-color/brand-font absent from the quick bars.
