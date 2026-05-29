# VenueOS Template Editability Audit — Definitive Per-Widget / Per-Vertical Punch List (READ-ONLY)

> Opus 4.8 read-only audit agent, 2026-05-28. Scope: CLAUDE.md §19 (Template +
> Widget Editability Standard). Every widget verified against its ACTUAL
> PropertiesPanel handling path (not assumed). All findings cite
> `apps/web/src/components/template-builder/PropertiesPanel.tsx` (8,008 lines)
> unless noted. This is the surgical map for the editability fix waves.

## How the editor actually resolves a widget (the architecture that drives every grade)

`ContentFields()` is one giant `switch (zone.widgetType)`. For a given widget, ONE of these happens:
1. **Explicit hand-built `case`** — the gold path. ~70 widgetTypes.
2. **`default:` → v2-variant auto-form** (line 4368) — fires when `cfg.variant` matches `V2_BY_VARIANT_ID`. Reads registry `defaults` → renders content fields + a full Colors/Type/Background style section.
3. **`default:` → MS-pack auto-form** (line 4564, `MS_DEFAULTS_BY_TYPE`) — 39 themed full-screen widgets (MS_* ×16, FITNESS themed ×15, HS_*_PORTRAIT ×8). Dot-keyed text fields; HS ones get StyleableField (font+color), MS/Fitness get plain text.
4. **`default:` → THEMED auto-form** (line 4663, `THEMED_WIDGET_FIELDS`) — 33 Animated/Bulletin/Scrapbook/Storybook widgets. As of the 2026-05-28 P0-3 fix this dispatches list content to real editors (ScheduleRowsField / BellScheduleEditor / WeekMenuEditor / MenuCardsField / AssetPickerField).
5. **Terminal fallback `return null`** (line 4790) — **"Unknown widget — JSON-only Advanced."** This is the absolute worst "click it, nothing happens" outcome.

**Universal text-style block** (lines 4794–4827): appends Font + Text-color + B/I/U/S to ANY text-bearing widget — BUT only if the function didn't already `return null`. So orphans get nothing.

**Position/Size:** YES, universal for every widget — collapsible "Position & size" section (lines 780–880): X/Y/W/H in % or px, align buttons, Fill/Fit. **Rotation and Opacity are NOT here.** Opacity exists ONLY in the DECORATION case (line 2876). Rotation has no operator control on any normal widget. **This is a §19 gap for every widget** ("rotation, z-index, opacity" required).

---

## 4. Widgets with NO PropertiesPanel case at all — the "nothing happens" failures

Diffed the WidgetRenderer top-level dispatch (162 rendered types) against the panel cases. 79 rendered types have no explicit `case`. Of those, **72 are still fully handled by an auto-form map** (MS/THEMED/HS-portrait — see above). **7 are TRUE ORPHANS that hit `return null` → JSON-only Advanced, zero form fields, zero text-style block:**

| widgetType | Renderer line | In picker? | Status |
|---|---|---|---|
| `ANIMATED_BACKGROUND` | 575 | No | **F — JSON only.** Decorative bg, low blast radius. |
| `TOUCH_BUTTON` | 493 | No (legacy; `TOUCH_POINT` replaced it) | **F — JSON only.** |
| `TOUCH_MENU` | 494 | No | **F — JSON only.** |
| `ROOM_FINDER` | 495 | No | **F — JSON only.** Interactive/kiosk. |
| `ON_SCREEN_KEYBOARD` | 496 | No | **F — JSON only.** |
| `WAYFINDING_MAP` | 497 | No (distinct from `RETAIL_WAYFINDING_MAP`, which HAS a case) | **F — JSON only.** |
| `QUICK_POLL` | 498 | No | **F — JSON only.** Interactive/kiosk. |

None of the 7 are registered in `variants-register.ts`, so an operator can only hit them if a **system preset places them**. None appear in the current preset files — so they are effectively dead/legacy types today. **Recommendation:** either delete them or give each a real case before any template ships using them. Risk is low *now* but they are landmines (the moment a preset references one, the operator gets a blank panel — the exact §19 failure).

Renderer types `CELEBRATION / HEALTHCARE / CORPORATE / HOSPITALITY / WORSHIP / CHART / RETAIL / BACKGROUND / LIVE_DATA` (lines 637–645) render as v2 widgets and ARE handled by the v2-variant auto-form **as long as `cfg.variant` is set** (it always is for placed v2 tiles). Not orphans.

---

## 1. Master grading table

Legend: ● = yes / full · ◐ = partial or power-user (pipe/JSON) · ○ = no/hardcoded · n/a = not applicable. "List?" = can the operator edit array content WITHOUT writing JSON. "uts" = universal text-style block.

| widgetType | Text | Img/Logo | Color | Font+Size | List? | Pos/Size | **Grade** | Vertical(s) using it |
|---|---|---|---|---|---|---|---|---|
| TEXT / RICH_TEXT | ● | n/a | ● | ● | n/a | ● | **A** | K12, SPORTS, WORSHIP |
| ANNOUNCEMENT | ● | ○ | ◐(uts) | ◐ | n/a | ● | **A-** | K12, BAR, WORSHIP |
| TICKER | ● | n/a | ● | ● | ●(lines) | ● | **A** | K12, BAR, RETAIL, FITNESS, SPORTS, WORSHIP |
| CLOCK | ● | n/a | ● | ◐(uts) | n/a | ● | **A** | K12, QSR, BAR, GYM, WORSHIP |
| WEATHER | ● | n/a | ◐ | ◐ | n/a | ● | **A-** | K12, GYM |
| COUNTDOWN | ● | n/a | ◐ | ◐ | ◐(recurring) | ● | **A-** | K12, SPORTS, WORSHIP, RETAIL(via theme) |
| STAFF_SPOTLIGHT | ● | ● | ◐(uts) | ◐ | n/a | ● | **A-** | K12 |
| LOGO | ● | ● | ○ | ○ (media-only) | n/a | ● | **B** | K12 |
| IMAGE | ●(alt) | ● | n/a | n/a | n/a | ● | **A** | K12, WORSHIP |
| IMAGE_CAROUSEL | ●(cap) | ● | n/a | n/a | ●(asset list) | ● | **A** | K12, SPORTS |
| VIDEO | n/a | ● | n/a | n/a | n/a | ● | **A** | (presets/operator) |
| VIDEO_CAROUSEL | ●(cap) | ● | n/a | n/a | ●(asset list) | ● | **A** | (operator) |
| WEBPAGE | n/a(url) | n/a | n/a | n/a | n/a | ● | **A** | (operator) |
| EXTERNAL_HTML | ●(data-field editor) | n/a | ●(5 brand swatches) | ●(3 font slots) | ◐(per template) | ● | **B+** | K12 (78 tiles), CORPORATE/FASHION/HEALTHCARE/HOSPITALITY/RESTAURANT (no dedicated presets → rely on this) |
| LUNCH_MENU | ● | ●(per-item emoji/img) | ● | ● | ●(WeekMenuEditor) | ● | **A** | K12 |
| BELL_SCHEDULE | ● | n/a | ◐(uts) | ◐ | ●(BellScheduleEditor) | ● | **A** | K12, WORSHIP |
| CALENDAR | ● | n/a | ◐(uts) | ◐ | ◐(pipe textarea) | ● | **B** | K12, WORSHIP |
| QUOTE | ● | n/a | ◐(uts) | ◐ | n/a | ● | **A-** | K12 |
| STATS | ◐ | n/a | ◐(uts) | ◐ | ◐(pipe textarea) | ● | **B-** | K12 |
| MENU_ITEM | ● | ○ | ◐(uts) | ◐ | ◐(comma allergens) | ● | **B+** | K12 |
| SCHEDULE_GRID | ● | n/a | ◐(uts) | ◐ | ◐(pipe textarea) | ● | **B-** | K12 |
| ATTENDANCE | ● | n/a | ◐(uts) | ◐ | n/a | ● | **B+** | K12 |
| BIRTHDAYS | ● | n/a | ◐(uts) | ◐ | ◐(line textarea) | ● | **B** | K12 |
| HONOR_ROLL | ● | n/a | ◐(uts) | ◐ | ◐(pipe textarea) | ● | **B-** | K12 |
| PHOTO_NEON/PAPER/CRAYON/GLASS/OPS | ●(title) | ●(PhotosArrayField) | ○ | ○ | ●(photos) | ● | **B+** | K12 (v2 image widgets) |
| TOUCH_POINT | ●(label/qr) | n/a | ●(icon+bg) | ○ | n/a | ● | **A-** | K12 (interactive) |
| HOLIDAY | ◐(picker) | n/a | ○ | ○ | n/a | ● | **B** | K12 (18 presets) |
| DECORATION | ◐ | ◐ | ● | n/a | n/a | ●+**opacity** | **B** | K12 |
| PLAYLIST | n/a(picker) | n/a | n/a | n/a | n/a | ● | **A** | K12 |
| RSS_FEED / SOCIAL_FEED | n/a(url) | n/a | ◐(uts) | ◐ | n/a | ● | **B+** | K12 |
| SCOREBOARD (sport elements + CTS) | ●(label) | ●(logo/sponsor url) | ● | ●(size+weight) | n/a (live-bound) | ● | **A** | SPORTS, K12 |
| SCORE_HOME / SCORE_AWAY | ●(placeholder) | n/a | ● | ●(size+weight) | n/a | ● | **A** | K12 |
| GAME_CLOCK / GAME_SEGMENT / GAME_STAT | ● | n/a | ● | ●(size+weight) | n/a | ● | **A** | K12 |
| STREAMING | n/a(picker) | n/a | n/a | n/a | n/a | ● | **A** | BAR |
| MUSIC_PLAYER | ● | n/a | n/a | n/a | n/a | ● | **A-** | (operator) |
| HOUSE_AD_BANNER | ●(label) | ◐(slots in JSON) | n/a | n/a | **◐ JSON** | ● | **C+** | (monetize) |
| **RESTAURANT_MENU_BOARD** | ● | ●(per item) | ● | ◐(uts) | **● ListItemsEditor** | ● | **A** | QSR/RESTAURANT |
| **BAR_TAP_LIST** | ● | n/a | ● | ◐ | **● ListItemsEditor** | ● | **A** | BAR |
| **BAR_COCKTAIL_MENU** | ● | n/a | ● | ◐ | **● ListItemsEditor** | ● | **A** | BAR |
| **RETAIL_PRODUCT_GRID** | ● | ●(per item) | ● | ◐ | **● ListItemsEditor** | ● | **A** | RETAIL |
| RESTAURANT_SPECIALS_CALLOUT | ● | ○(emoji str) | ● | ◐ | n/a | ● | **B+** | QSR/RESTAURANT |
| RESTAURANT_WAIT_TIME | ● | n/a | ◐(uts) | ◐ | n/a | ● | **B+** | QSR |
| RESTAURANT_COMBO_CAROUSEL | ● | ○ | ● | ◐ | **◐ JSON (combosJson)** | ● | **C+** | QSR |
| RESTAURANT_LOYALTY_TICKER | ● | n/a | ● | ◐ | ●(msgs lines) | ● | **B+** | QSR |
| RESTAURANT_ALLERGY_LEGEND | ● | n/a | ● | ◐ | **◐ JSON (entriesJson)** | ● | **C+** | QSR |
| BAR_HAPPY_HOUR_COUNTDOWN | ● | ○ | ● | ◐ | **◐ JSON (drinksJson)** | ● | **C+** | BAR |
| BAR_GAME_DAY_SCHEDULE | ● | ○ | ● | ◐ | **◐ JSON (gamesJson)** | ● | **C+** | BAR |
| BAR_EVENT_TONIGHT | ● | n/a | ● | ◐ | n/a | ● | **B+** | BAR |
| BAR_TRIVIA_SCOREBOARD | ● | ○ | ● | ◐ | **◐ JSON (teamsJson)** | ● | **C+** | BAR |
| RETAIL_PRICE_CALLOUT | ● | ● | ● | ◐ | **◐ JSON (sellingPointsJson)** | ● | **C+** | RETAIL |
| RETAIL_SALE_COUNTDOWN | ● | n/a | ● | ◐ | n/a | ● | **B+** | RETAIL |
| RETAIL_LOYALTY_QR | ● | ●(qr) | ● | ◐ | **◐ JSON (perksJson)** | ● | **C+** | RETAIL |
| RETAIL_LOOKBOOK_CAROUSEL | ◐ | ◐(in JSON) | ● | ◐ | **◐ JSON (slidesJson)** | ● | **C** | RETAIL |
| RETAIL_STOREFRONT_HOURS | ● | n/a | ● | ◐ | **◐ JSON (openHoursJson)** | ● | **C+** | RETAIL |
| RETAIL_WAYFINDING_MAP | ● | n/a | ● | ◐ | **◐ JSON (departmentsJson + youAreHereJson)** | ● | **C** | RETAIL |
| FITNESS_AD_BANNER | ● | ◐(in JSON) | ● | ◐ | **◐ JSON (creativesJson)** | ● | **C+** | GYM |
| FITNESS_CLASS_SCHEDULE | ● | n/a | ● | ◐ | **◐ JSON (classesJson)** | ● | **C+** | GYM |
| FITNESS_MOTIVATIONAL_QUOTE | ● | n/a | ● | ◐ | **◐ JSON (quotesJson)** | ● | **C+** | GYM |
| FITNESS_MUSIC_PLAYER | ● | ● | ● | ◐ | n/a | ● | **A-** | GYM |
| FITNESS_TRAINING_VIDEO | ● | ●(poster) | ● | ◐ | ●(safety lines) | ● | **A-** | GYM |
| FITNESS_WORKOUT_TIMER | ● | n/a | ● | ◐ | n/a | ● | **A-** | GYM |
| FITNESS_LIVE_TV | ●(name) | n/a(picker) | ◐ | ◐ | n/a | ● | **B+** | GYM |
| FITNESS_APP_LIBRARY / FITNESS_STICK_LAUNCHER | ● | n/a | ● | ◐ | n/a | ● | **B+** | GYM |
| MS_* (16), FITNESS themed (15) | ● (auto-form) | ○ | ◐(uts font+color) | ○ size | ○ (flattened to text) | ● | **B-/C+** | K12 (MS), GYM (Fitness scenes) |
| HS_*_PORTRAIT (8) | ●(StyleableField) | ○ | ●(per field) | ◐ | ○ | ● | **B** | K12 |
| HS_* landscape (8) | ●(hand cases) | varies | ● | ◐ | varies | ● | **B+** | K12 |
| ANIMATED_* themed (Animated/Bulletin/Scrapbook/Storybook, 33) | ● | ●(food photo) | ◐(uts) | ◐ | **●** (post P0-3: schedule/bell/menu/cards editors) | ● | **B/B+** | K12 |
| ANIMATED_WELCOME family (Elem/MS/HS, L+P) | ● | ●(logo) | varies | varies | ● | ● | **A-** | K12 |
| ANIMATED_CAFETERIA family | ● | ● | varies | varies | ●(WeekMenuEditor) | ● | **A-** | K12 |

Note on `ANIMATED_WELCOME` family: hand-built case covers `ANIMATED_WELCOME` (elementary landscape), `_MS`, `_MS_PORTRAIT`, `_HS`, `_HS_PORTRAIT` — but NOT `ANIMATED_WELCOME_PORTRAIT` (elementary portrait), which falls to the THEMED auto-form (still covered, just via a different, possibly less complete path).

---

## 2. Ranked list of every widget below B + exactly the missing field

These are the launch blockers (CLAUDE.md: "anything below B is a gap"). The dominant defect is **raw-JSON list editing** — the operator can edit headline/colors but must hand-write a JSON array to change the menu/products/teams/etc. This is precisely "you can't edit a single word" for the substance of the widget.

### Tier 1 — raw-JSON list content (C / C+). Fix: replace the `*Json` `TextAreaField` with `ListItemsEditor` (component shipped, defined at PropertiesPanel.tsx line 7865; pattern proven on the 4 A-grade widgets). File:line for every one:

1. `RETAIL_WAYFINDING_MAP` — `departmentsJson` **and** `youAreHereJson` (line 4242, 4239). **C** — two JSON blobs; departments[] needs a row editor (name/x/y/w/h/color/emoji/highlight).
2. `RETAIL_LOOKBOOK_CAROUSEL` — `slidesJson` (line 4171). **C** — slides[] {eyebrow,headline,subhead,price,imageUrl,swatchColor,emoji}; imageUrl trapped in JSON (no asset picker).
3. `RETAIL_PRICE_CALLOUT` — `sellingPointsJson` (line 4202). **C+** — sellingPoints[] string array.
4. `RETAIL_LOYALTY_QR` — `perksJson` (line 4228). **C+** — perks[] string array.
5. `RETAIL_STOREFRONT_HOURS` — `openHoursJson` (line 4184). **C+** — openHours{} object (sun…sat); needs a 7-row day/hours editor.
6. `RESTAURANT_COMBO_CAROUSEL` — `combosJson` (line 4257). **C+** — combos[] {name,includes,price,emoji,badge}.
7. `RESTAURANT_ALLERGY_LEGEND` — `entriesJson` (line 4302). **C+** — entries[] {code,label,emoji}.
8. `BAR_HAPPY_HOUR_COUNTDOWN` — `drinksJson` (line 4314). **C+** — drinks[] {name,regularPrice,happyPrice,emoji}.
9. `BAR_GAME_DAY_SCHEDULE` — `gamesJson` (line 4324). **C+** — games[] {league,away,home,time,channel,status,emoji}.
10. `BAR_TRIVIA_SCOREBOARD` — `teamsJson` (line 4351). **C+** — teams[] {name,score,emoji,delta}.
11. `FITNESS_AD_BANNER` — `creativesJson` (line 3911). **C+** — creatives[] {headline,sub,ctaText,ctaUrl}; no asset picker for creative image.
12. `FITNESS_CLASS_SCHEDULE` — `classesJson` (line 3938). **C+** — classes[] {time,name,instructor,room}.
13. `FITNESS_MOTIVATIONAL_QUOTE` — `quotesJson` (line 3968). **C+** — quotes[] {text,author} (has AI append, but no per-row edit/delete UI).
14. `HOUSE_AD_BANNER` — `slotsJson` (line 3732). **C+** — slots[] {assetUrl,sponsorName,ctaText,clickThroughUrl}; assetUrl should be an asset picker, not pasted into JSON.

(14 distinct widgets / 15 JSON fields.) **Most likely to be missed** because they bundle an image/asset inside the JSON: **RETAIL_WAYFINDING_MAP (two blobs)**, **RETAIL_LOOKBOOK_CAROUSEL (imageUrl trapped)**, **HOUSE_AD_BANNER (assetUrl trapped)**.

### Tier 2 — pipe-delimited / line textarea list content (B- / B). Friendlier than JSON but still not per-row UI; no per-item color/icon:
15. `STATS` — `stats` pipe textarea `value | label` (line 2175). **B-** → ListItemsEditor.
16. `HONOR_ROLL` — `students` pipe textarea `name | reason` (line 2505). **B-** → ListItemsEditor.
17. `SCHEDULE_GRID` — `periods` pipe textarea `num | name | time` (line 2492). **B-** → ScheduleRowsField (already exists).
18. `CALENDAR` — `events` pipe textarea `date|title|time|location|tag` (line 2025). **B** → per-row editor with date picker; no per-event color despite v2 widgets rendering tags.
19. `BIRTHDAYS` — `birthdays` line textarea (line 2501). **B** → simple add/remove list.

### Tier 3 — missing scalar/style fields (B):
20. `LOGO` (line 2507). **B** — it's in `MEDIA_ONLY` so the universal text-style block is skipped, yet LOGO_* v2 variants render `schoolName`/`tagline`/`initials` as **text** with no font/color/size control. Missing: font family, text color, size for the wordmark text. Either remove LOGO from MEDIA_ONLY or add explicit text-style fields.
21. `HOLIDAY` (line 2741). **B** — only a holiday+grade picker; no color/font/text override of the holiday card copy.
22. `MS_*` + `FITNESS themed` scenes (line 4564, auto-form). **B-/C+** — content text editable + universal font/color, but **no per-field font-size**, **no color per field** (only HS-portrait gets StyleableField), and **array regions are flattened to comma-joined text** (the auto-form `Array.isArray(dv)` branch at default line 4387 joins with ", "). For a 4K Fitness "class schedule" scene this means the schedule isn't a real row editor.

### Tier 4 — orphans (F): the 7 in §4 above (`return null`). Fix: add a real `case` or delete the type.

---

## 3. Per-vertical readiness

A vertical is only as editable as the widgets its system templates actually place. Grepped every preset file in `apps/api/src/templates/`. Verticals with dedicated presets: **K12, GYM, QSR, RETAIL, BAR, SPORTS, WORSHIP.** Verticals with NO dedicated presets (**CORPORATE, FASHION, HEALTHCARE, HOSPITALITY, RESTAURANT**) ship no system templates of their own — they depend on the `EXTERNAL_HTML` "Signage Template" tile (B+) + generic widgets.

| Vertical | Widgets its presets use | Fully editable? | Gaps |
|---|---|---|---|
| **K12** | EXTERNAL_HTML, SCOREBOARD/SCORE_*/GAME_*, HOLIDAY, all ANIMATED_*/MS_*/HS_*/SCRAPBOOK/STORYBOOK/BULLETIN | **Mostly Y** | HOLIDAY (B), MS_* size/per-field color + flattened arrays (B-), CALENDAR/STATS/HONOR_ROLL pipe textareas (B-/B), LOGO text styling (B). No true F in shipped K12 presets. |
| **QSR / RESTAURANT** | RESTAURANT_MENU_BOARD ✅A, _SPECIALS_CALLOUT B+, _ALLERGY_LEGEND **C+**, _LOYALTY_TICKER B+, _COMBO_CAROUSEL **C+**, _WAIT_TIME B+, RICH_TEXT, CLOCK | **N** | Combo carousel + allergy legend force JSON. Menu board (the hero) is fixed and excellent. |
| **BAR** | BAR_TAP_LIST ✅A, _COCKTAIL_MENU ✅A, _HAPPY_HOUR_COUNTDOWN **C+**, _TRIVIA_SCOREBOARD **C+**, _GAME_DAY_SCHEDULE **C+**, _EVENT_TONIGHT B+, TICKER, ANNOUNCEMENT, STREAMING, CLOCK | **N** | Tap list + cocktails fixed (good — the daily-driver boards). But happy-hour drinks, trivia teams, game-day games all JSON. |
| **RETAIL** | RETAIL_PRODUCT_GRID ✅A, _PRICE_CALLOUT **C+**, _LOYALTY_QR **C+**, _SALE_COUNTDOWN B+, _LOOKBOOK_CAROUSEL **C**, _STOREFRONT_HOURS **C+**, _WAYFINDING_MAP **C**, TICKER | **N** | Product grid fixed; everything with a list (lookbook slides, hours, departments, perks, selling points) is JSON. Worst-covered vertical after the product grid. |
| **GYM** | FITNESS_MUSIC_PLAYER A-, _TRAINING_VIDEO A-, _WORKOUT_TIMER A-, _CLASS_SCHEDULE **C+**, _AD_BANNER **C+**, _MOTIVATIONAL_QUOTE **C+**, 15 FITNESS themed scenes (B-/C+), TICKER, WEATHER, CLOCK | **N** | Class schedule + ad creatives + quotes JSON. The 15 4K themed scenes (Stadium/Iron/etc.) have content text + font/color but no size + flattened array regions. |
| **SPORTS** | TEXT ✅A, TICKER ✅A, SCOREBOARD ✅A, IMAGE_CAROUSEL ✅A, COUNTDOWN A-, CELEBRATION (v2 auto-form, styleable) | **Y** | Best-covered non-K12 vertical. CELEBRATION relies on v2 auto-form (fine). |
| **WORSHIP** | TEXT ✅A, ANNOUNCEMENT A-, TICKER ✅A, COUNTDOWN A-, CLOCK ✅A, CALENDAR **B**, BELL_SCHEDULE ✅A, IMAGE ✅A | **Mostly Y** | Only soft spot is CALENDAR's pipe textarea (B). |
| **CORPORATE / FASHION / HEALTHCARE / HOSPITALITY** | *No dedicated presets.* EXTERNAL_HTML signage tiles + generic widgets | **Partial** | Editability = EXTERNAL_HTML (B+) + whatever generic widgets the operator adds. No vertical-native fixed templates. Content gap, not a code gap. |

---

## Bottom line for the next fix wave (surgical targets)

1. **The "~16 JSON widgets" are real and enumerated above (items 1–14, 15 JSON fields)** — convert each `*Json` `TextAreaField` to `ListItemsEditor` / `ScheduleRowsField`. File:line given for every one. Confirm the conversion agent also catches **RETAIL_WAYFINDING_MAP (two blobs)**, **RETAIL_LOOKBOOK_CAROUSEL (imageUrl trapped in JSON)**, and **HOUSE_AD_BANNER (assetUrl trapped in JSON)**.
2. **5 pipe-textarea widgets (items 15–19)** should also move to row editors for true Canva-grade — STATS / HONOR_ROLL / SCHEDULE_GRID / CALENDAR / BIRTHDAYS.
3. **7 true orphans hit `return null`** (TOUCH_BUTTON, TOUCH_MENU, ROOM_FINDER, ON_SCREEN_KEYBOARD, WAYFINDING_MAP, QUICK_POLL, ANIMATED_BACKGROUND). Not in any current preset or picker, so not biting the operator *today*, but they are the literal "click it, nothing happens" failure mode — delete or give a case.
4. **§19 universal gaps:** no **rotation** and no **opacity** control on any normal widget (opacity exists only for DECORATION); MS/Fitness themed scenes lack **per-field font-size** and treat array regions as comma-joined text. **LOGO** wordmark text has no font/color/size (it's wrongly in `MEDIA_ONLY`).
5. **Verticals without dedicated presets** (CORPORATE/FASHION/HEALTHCARE/HOSPITALITY) have no native editable templates — they lean entirely on EXTERNAL_HTML. Product decision, separate from the widget-editor fixes.
