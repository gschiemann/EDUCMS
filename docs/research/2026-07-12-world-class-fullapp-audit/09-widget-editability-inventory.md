# Widget and Editor Editability Inventory

**Audit baseline:** `3f274702`  
**Method:** read-only registry, renderer, builder, PropertiesPanel, V2 registry, HTML-discovery, and app-insertion trace. No files changed.

## Source-of-truth result

- The actual Widgets tab is `VariantPicker`, mounted at `apps/web/src/components/template-builder/BuilderShell.tsx:906-920`, `:1210-1217`.
- It derives types/tiles from the in-memory variant registry and inserts zones at `VariantPicker.tsx:199-354`, `:415-527`; registry contract/list functions are `apps/web/src/components/widgets/variants.ts:29-105`.
- Registrations come from `apps/web/src/components/widgets/variants-register.ts`, not `template-builder/constants.ts`. `WIDGET_GROUPS` is labels/icons only at `constants.ts:50-57`.
- Actual Widgets palette: **74 persisted widget types**.
- `WidgetRenderer` handles **180 persisted types**; every palette type renders, so palette → runtime ghosts = **0**.
- V2 contributes **243 concrete variants**, collapsed into canonical persisted types by `variants-register.ts:814-929`.
- PropertiesPanel nominally covers all 180 renderer types: **99 explicit cases + 39 MS/default auto-forms + 33 themed auto-forms + 9 generic V2 forms**. Five additional explicit `PHOTO_*` cases are dead.

This means the problem is not “nothing is wired.” The deeper problem is that canonicalization can route a visually distinct V2 variant into an editor built for a different config shape, producing friendly-looking controls that do not update the fields the renderer consumes.

## Actual Widgets palette — all 74 persisted types

| Family | Persisted types | Registry evidence |
|---|---|---|
| Core/media/design (24) | `TEXT, RICH_TEXT, IMAGE, IMAGE_CAROUSEL, VIDEO, VIDEO_CAROUSEL, WEBPAGE, CLOCK, WEATHER, COUNTDOWN, ANNOUNCEMENT, TICKER, CALENDAR, BELL_SCHEDULE, LUNCH_MENU, STAFF_SPOTLIGHT, LOGO, TOUCH_POINT, SHAPE, ICON, DECORATION, HOUSE_AD_BANNER, MUSIC_PLAYER, EXTERNAL_HTML` | `variants-register.ts:43-209`, `:210-812`, `:934-1010` |
| Sports (13) | `SCOREBOARD, SCORE_HOME, SCORE_AWAY, GAME_CLOCK, GAME_SEGMENT, GAME_STAT, SWIM_LANE_GRID, DIVE_LEADERBOARD, SWIM_RELAY_EXCHANGE, SWIM_SPLITS_PANEL, SWIM_RECORD_LINE, DIVE_JUDGES_PANEL, STADIUM_MEET_BOARD` | `variants-register.ts:1012-1608`; primitives `:1287-1438`; stadium `:1440-1487`; scoreboards `:1489-1608` |
| Food service (6) | `RESTAURANT_MENU_BOARD, RESTAURANT_COMBO_CAROUSEL, RESTAURANT_WAIT_TIME, RESTAURANT_LOYALTY_TICKER, RESTAURANT_SPECIALS_CALLOUT, RESTAURANT_ALLERGY_LEGEND` | `variants-register.ts:1656-1725` |
| Bar (6) | `BAR_TAP_LIST, BAR_COCKTAIL_MENU, BAR_HAPPY_HOUR_COUNTDOWN, BAR_GAME_DAY_SCHEDULE, BAR_EVENT_TONIGHT, BAR_TRIVIA_SCOREBOARD` | `variants-register.ts:1727-1794` |
| Retail/fashion (7) | `RETAIL_PRODUCT_GRID, RETAIL_PRICE_CALLOUT, RETAIL_SALE_COUNTDOWN, RETAIL_WAYFINDING_MAP, RETAIL_LOYALTY_QR, RETAIL_LOOKBOOK_CAROUSEL, RETAIL_STOREFRONT_HOURS` | `variants-register.ts:1796-1876` |
| Gym integrations (9) | `FITNESS_CLASS_SCHEDULE, FITNESS_MUSIC_PLAYER, FITNESS_LIVE_TV, FITNESS_AD_BANNER, FITNESS_TRAINING_VIDEO, FITNESS_WORKOUT_TIMER, FITNESS_MOTIVATIONAL_QUOTE, FITNESS_APP_LIBRARY, FITNESS_STICK_LAUNCHER` | `variants-register.ts:1878-1978` |
| V2-only canonical families (9) | `CELEBRATION, HEALTHCARE, CORPORATE, HOSPITALITY, WORSHIP, CHART, RETAIL, BACKGROUND, LIVE_DATA` | map/register loop `variants-register.ts:844-929` |

Fast Add is separate and narrower: `TEXT, IMAGE, VIDEO, WEBPAGE, TOUCH_QR → TOUCH_POINT`; its “Shape” inserts a colored `TEXT`, not `SHAPE` at `apps/web/src/components/template-builder/AddSidebar.tsx:75-117`. Virtual touch/decor aliases are normalized by `useBuilderStore.ts:425-540`.

## Renderer/editability matrix — all 180 persisted types

Legend:

- **E** — explicit PropertiesPanel switch at `PropertiesPanel.tsx:2484-6036`.
- **M** — `MS_DEFAULTS_BY_TYPE` auto-form at `:207-257`, `:6276-6396`.
- **T** — themed auto-form using `themed-widget-defaults.ts:69-456`, rendered at `PropertiesPanel.tsx:6397-6531`.
- **V** — generic V2 defaults/style auto-form at `PropertiesPanel.tsx:6037-6274`.
- **X** — EXTERNAL_HTML field/image/action discovery.

`WidgetRenderer` tries a registered variant first at `WidgetRenderer.tsx:543-584`, then the master switch.

### Core/media — 28, explicit

**E**, except `EXTERNAL_HTML` is **E+X**:

`TOUCH_POINT, CLOCK, WEATHER, COUNTDOWN, TEXT, RICH_TEXT, ANNOUNCEMENT, TICKER, BELL_SCHEDULE, LUNCH_MENU, CALENDAR, STAFF_SPOTLIGHT, IMAGE, IMAGE_CAROUSEL, VIDEO, VIDEO_CAROUSEL, STREAMING, HOUSE_AD_BANNER, MUSIC_PLAYER, LOGO, WEBPAGE, EXTERNAL_HTML, RSS_FEED, SOCIAL_FEED, PLAYLIST, DECORATION, SHAPE, ICON`

Renderer: `WidgetRenderer.tsx:598-657`.

### Generic/sports/legacy touch — 27, explicit

**E**:

`HOLIDAY, QUOTE, STATS, MENU_ITEM, SCOREBOARD, SCORE_HOME, SCORE_AWAY, GAME_CLOCK, GAME_SEGMENT, GAME_STAT, SWIM_LANE_GRID, DIVE_LEADERBOARD, SWIM_RELAY_EXCHANGE, SWIM_SPLITS_PANEL, SWIM_RECORD_LINE, DIVE_JUDGES_PANEL, STADIUM_MEET_BOARD, SCHEDULE_GRID, ATTENDANCE, BIRTHDAYS, HONOR_ROLL, TOUCH_BUTTON, TOUCH_MENU, ROOM_FINDER, ON_SCREEN_KEYBOARD, WAYFINDING_MAP, QUICK_POLL`

Renderer: `WidgetRenderer.tsx:661-690`.

### K-12/full-scene — 73

Renderer: `WidgetRenderer.tsx:692-767`.

- **E**, 16: `ANIMATED_WELCOME, ANIMATED_WELCOME_MS, ANIMATED_WELCOME_HS, ANIMATED_WELCOME_HS_PORTRAIT, ANIMATED_WELCOME_MS_PORTRAIT, ANIMATED_CAFETERIA, ANIMATED_CAFETERIA_PORTRAIT, ANIMATED_BACKGROUND`, plus landscapes `HS_VARSITY, HS_BROADCAST, HS_YEARBOOK, HS_TERMINAL, HS_TRANSIT, HS_GALLERY, HS_BLUEPRINT, HS_ZINE`.
- **M**, 39 total across K-12/fitness: all 16 `MS_{ARCADE,ATLAS,FIELDNOTES,GREENHOUSE,HOMEROOM,PAPER,PLAYLIST,STUDIO}` landscape/portrait and eight `HS_*_PORTRAIT`; map `PropertiesPanel.tsx:207-256`.
- **T**, 33: direct entries `ANIMATED_HALLWAY_SCHEDULE{,_PORTRAIT}, ANIMATED_BELL_SCHEDULE{,_PORTRAIT}, ANIMATED_BUS_BOARD, ANIMATED_MORNING_NEWS, ANIMATED_ACHIEVEMENT_SHOWCASE, ANIMATED_MAIN_ENTRANCE, ANIMATED_CAFETERIA_CHALKBOARD, ANIMATED_CAFETERIA_FOODTRUCK{,_PORTRAIT}, ANIMATED_CAFETERIA_MS, ANIMATED_CAFETERIA_HS, ANIMATED_WELCOME_PORTRAIT, BULLETIN_{HALLWAY,CAFETERIA}, SCRAPBOOK_{HALLWAY,CAFETERIA}, STORYBOOK_{HALLWAY,CAFETERIA}` plus 13 portrait aliases at `themed-widget-defaults.ts:438-456`.

### Vertical dedicated — 43

Renderer: `WidgetRenderer.tsx:769-821`.

- **E**, 28: nine gym-integration, six restaurant, six bar, seven retail palette types listed above.
- **M**, 15 fitness scenes: `FITNESS_STADIUM, FITNESS_IRON, FITNESS_MARQUEE, FITNESS_CHANNEL_GUIDE, FITNESS_DISCOTHEQUE, FITNESS_LOCKER, FITNESS_SPLASH, FITNESS_TELEMETRY, FITNESS_CRAG, FITNESS_CORNERMAN, FITNESS_RECESS, FITNESS_REFORMER, FITNESS_TRAILHEAD, FITNESS_VAULT, FITNESS_LOBBY` at `PropertiesPanel.tsx:224-241`.

### V2 canonical fallbacks — 9

**V**:

`CELEBRATION, HEALTHCARE, CORPORATE, HOSPITALITY, WORSHIP, CHART, RETAIL, BACKGROUND, LIVE_DATA`

Renderer: `WidgetRenderer.tsx:822-880`, cases `:844-852`.

A universal raw-JSON fallback also mounts at `PropertiesPanel.tsx:895`, implementation `:8386-8415`. Raw JSON is a developer escape hatch, not operator-grade editability.

## V2 concrete inventory — all 243

Registry assembly: `apps/web/src/components/widgets/v2/registry.ts:684-726`; canonical registration: `variants-register.ts:844-929`.

- **70 core:** five each, generally `NEON/PAPER/CRAYON/GLASS/OPS`: `CLOCK_*` (`v2/registry.ts:223-229`), `HEADLINE_*` (`:231-238`), `ANN_*` (`:240-247`), `CAL_*` (`:249-256`), `STAFF_*` (`:258-265`), `CD_*` (`:267-274`), `LOGO_*` (`:276-283`), `TICKER_*` (`:285-292`), `WX_*` (`:294-301`), `PHOTO_*` (`:303-310`), `RT_*` (`:312-319`), `IMG_*` (`:321-328`), `LUNCH_*` (`:330-337`), `BELL_*` (`:339-346`).
- **76 celebrations:** baseball 8 (`:358-367`), football 8 (`:369-378`), basketball 8 (`:380-389`), hockey 6 (`:395-402`), soccer 6 (`:404-411`), other sport/status 40 (`:553-595`).
- **Healthcare 7:** `NOW_SERVING, WAIT_TIMES_BOARD, PROVIDER_SPOTLIGHT, PATIENT_EDUCATION, VISITOR_HOURS, CODE_BANNER, INSURANCE_ACCEPTED` (`:413-437`).
- **Corporate 7:** `ROOM_SCHEDULE, VISITOR_WELCOME, KPI_TILE, SALES_LEADERBOARD, DOOR_SIGN, OKR_TRACKER, TEAM_ANNIVERSARIES` (`:439-454`).
- **Hospitality 5:** `HOTEL_WELCOME, DAILY_EVENTS_BOARD, AMENITY_HOURS, CHECK_IN_OUT_TIMES, LOCAL_ATTRACTIONS` (`:457-468`).
- **Worship 6:** `SERVICE_TIMES, SERMON_TITLE_CARD, HYMN_BOARD, GIVING_THERMOMETER, SCRIPTURE_VERSE, PRAYER_REQUEST_QR` (`:470-484`).
- **Retail 8:** `RETAIL_SALE_SEAL, RETAIL_PRICE_TAG, RETAIL_PRODUCT, RETAIL_FLASH_COUNTDOWN, RETAIL_STORE_HOURS, RETAIL_LOYALTY_QR, RETAIL_NEW_ARRIVALS, RETAIL_PROMO_STRIP` (`:487-501`).
- **Scoreboards 3:** `SCOREBOARD_HS, SCOREBOARD_COLLEGE, SCOREBOARD_PRO` (`:505-510`).
- **Charts 5:** `CHART_BAR, CHART_DONUT_GAUGE, CHART_LINE, CHART_PROGRESS, CHART_COUNTUP` (`:511-518`).
- **Sports venue 17:** `STADIUM_SCOREBOARD, RIBBON_TICKER, RIBBON_SPONSOR, RIBBON_FAN_SHOUTOUT, PLAYER_CARD, STARTING_LINEUP, STAT_COMPARISON, OUT_OF_TOWN_SCORES, KISS_CAM, NOISE_METER, IN_GAME_PROMO, SPONSOR_TAKEOVER, HOME_SCHEDULE, STANDINGS_BOARD, CONCESSION_WAITS, GATE_WAYFINDING, GOAL_CELEBRATION` (`:522-545`).
- **Backgrounds 17:** `BG_*` (`:597-621`).
- **Live data 8:** `SPORTS_SCOREBOARD, STOCK_TICKER, CRYPTO_TICKER, NEWS_HEADLINES, AIR_QUALITY, WORLD_CLOCKS, FX_RATES, TRAFFIC_CAM` (`:623-638`).
- **Touch/engage 10:** `PHOTO_BOOTH, SIGN_IN_PAD, LANGUAGE_PICKER, ACCESSIBILITY_TRAY, NPS_SMILEY, TRIVIA_GAME, SPIN_TO_WIN, DIRECTORY_SEARCH, WAYFINDING_FLOOR_MAP, DONATION_THERMOMETER` (`:640-657`).
- **Transit 4:** `DEPARTURES_BOARD, FLIGHT_STATUS_HERO, TRANSIT_DEPARTURES, PARKING_AVAILABILITY` (`:659-670`).

Only **143/243** V2 variants reach the generic V2 auto-form—the nine V2-only canonical families, with transit folded into `LIVE_DATA`. The other **100** map to 15 canonical types with earlier explicit cases, bypassing generic defaults/style; V2 universal style controls are also suppressed at `PropertiesPanel.tsx:6571-6574`.

## EXTERNAL_HTML editability

- Palette registration: `variants-register.ts:88-102`.
- Explicit picker/editor: `PropertiesPanel.tsx:2492-2636`.
- Same-origin packaged catalog: **113 boards**, `apps/web/src/components/widgets/signage-templates.ts:17-149`.
- Discovery parses inline HTML or fetches URL (`PropertiesPanel.tsx:7065-7104`), discovers `[data-field]` (`:7113-7139`), image slots (`:7141-7167`), actions (`:7169-7181`), supports click-to-locate (`:7193-7257`), then renders text/style/image/action editors (`:7259-7590`).
- Runtime transports brand/text/style/image/action overrides through query parameters/postMessage/srcdoc at `WidgetRenderer.tsx:3801-3984`.

This is a useful compatibility layer, but field discovery does not equal structural editing. The operator cannot freely rearrange internal nodes, and runtime/action safety remains a blocking concern.

## High-confidence ghost or broken controls

### 1. Dead public widget catalog

API `WIDGET_TYPE_CATALOG` at `apps/api/src/templates/templates.controller.ts:2719-2865` is exposed at `:694-702`; frontend hook exists at `apps/web/src/hooks/use-api.ts:1125-1129` but has no caller. It includes `EMPTY`, which has no renderer. The actual palette is `variants-register.ts`.

**Fix:** delete the dead catalog or generate all catalog/palette/renderer/editor metadata from one typed registry. Add a registry parity test.

### 2. Five dead PropertiesPanel cases

`PHOTO_NEON/PAPER/CRAYON/GLASS/OPS` at `PropertiesPanel.tsx:3775-3797` can never run. V2 photos canonicalize to `IMAGE` at `variants-register.ts:859-861`; `WidgetRenderer` has no `PHOTO_*` cases.

**Fix:** preserve concrete variant identity in the zone document and route to the correct schema, or delete dead cases.

### 3. At least 45 V2 variants expose misleading/no-op friendly controls

- Ten photo/image variants map to `IMAGE`; editor writes `assetUrl/fitMode/assetName` at `PropertiesPanel.tsx:3818-3825`, while V2 images read `url/fit/alt/caption/eyebrow` at `v2/ImageWidgets.tsx:10-24` and photos read `photos/title/rotateMs` at `v2/PhotoWidgets.tsx:11-28`.
- Five rich-text variants map to `RICH_TEXT`; editor writes `content/title/html` at `PropertiesPanel.tsx:2638-2742`, while V2 reads `body/title/eyebrow/signature/style` at `v2/RichTextWidgets.tsx:11-36`.
- Twenty scoreboard/sports-venue variants map to `SCOREBOARD`; special IDs recognized by the explicit case are only `sb-*`, `scoreboard-main`, `ribbon-main`, `scorebug-main` at `PropertiesPanel.tsx:3220-3232`. V2 IDs fall to legacy fields at `:3718-3725`, while V2 scoreboard reads `gameId/tier/bannerText/style` at `v2/SportsScoreboardWidgets.tsx:60-70`.
- Ten touch/engage variants map to `TOUCH_POINT`; editor shows hotspot/icon fields at `PropertiesPanel.tsx:3859-3953`, not variant fields such as PhotoBooth `frames/countdownSec/deliveries/brandOverlay/style` at `v2/TouchEngageWidgets.tsx:15-20`, `:37-41`.
- The generic V2-form comment says scoreboards are covered at `PropertiesPanel.tsx:6038-6042`, but the earlier explicit `SCOREBOARD` case prevents that.

**Fix:** every variant supplies a shared runtime/editor schema; the panel renders controls from that schema, and field-path contract tests prove the edited value reaches the exact renderer field after save/reload/player render. Do not canonicalize variants with incompatible config shapes.

### 4. Template-level live-data controls do not persist

Store defines `meta.dataSource/dataUrl/dataFormat` at `useBuilderStore.ts:19-32`; BuilderShell reads nonexistent top-level template fields and sends them at `BuilderShell.tsx:170-176`, `:316-323`; controller omits them at `templates.controller.ts:2293-2308`; Prisma `Template` has no fields at `schema.prisma:1141-1194`. Controls at `PropertiesPanel.tsx:955-1424` reset after reload. Zone-level `posSync/customSync/customUrl` does persist.

**Fix:** either add versioned document-level bindings to `BoardDocumentV2` and persistence, or remove the controls. Add save → reload → player proof.

### 5. EXTERNAL_HTML POS binding tokens have no resolver

Editor writes `{{pos.item:<externalId>.<field>}}` at `PropertiesPanel.tsx:7372-7413`; no evaluation path was found, only a type comment at `menu-console-api.ts:60-66`. Runtime transports the token through `textOverrides` at `WidgetRenderer.tsx:3830-3876`, so it can display literally.

**Fix:** replace string tokens with typed `IntegrationBinding` references resolved server/player-side, or implement and test a safe token resolver. Never expose a binding UI without a consumer.

### 6. EXTERNAL_HTML “Switch template” can be a no-op

Dropdown writes `{url}` only at `PropertiesPanel.tsx:2553-2558`; renderer prioritizes existing `config.html` and continues `srcdoc` at `WidgetRenderer.tsx:3801-3809`, `:3939-3955`.

**Fix:** make source mode explicit (`inline` or `packaged`); switching mode clears/archives the conflicting field transactionally and shows a confirmation if content will change.

### 7. Fast Add Shape catalog drift

Fast Add says no standalone shape and inserts `TEXT` at `AddSidebar.tsx:75-95`, while real `SHAPE` is registered at `variants-register.ts:115-146`, rendered at `WidgetRenderer.tsx:652-657`, and editable at `PropertiesPanel.tsx:4156-4243`.

**Fix:** Fast Add uses the same registry insertion action as VariantPicker; no hand-built duplicate catalog.

### 8. Type-union drift

`WidgetType` at `apps/web/src/components/widgets/themes/registry.ts:21-110` omits multiple dedicated vertical types; registrations compensate with `as any` from `variants-register.ts:1666+`.

**Fix:** generate the union from the registry or use a typed discriminated registry; eliminate `as any` registration escapes.

## Apps insertion surface

Apps are separate from the Widgets palette: 19 definitions, 15 enabled, four social apps coming soon at `apps/web/src/components/apps/app-registry.ts:267-855`. Enabled apps insert `STREAMING`, `WEBPAGE`, `TOUCH_POINT`, `CLOCK`, `COUNTDOWN`, `WEATHER`, or `RSS_FEED` through schema-driven forms at `AppConfigForm.tsx:81-187`, `:388-448`, `:527-575`.

Consequences:

- `STREAMING` and `RSS_FEED` are reachable even though absent from VariantPicker.
- `SOCIAL_FEED` currently is not reachable through an enabled app.
- App registry, widget palette, renderer, and editor need one capability graph so reachability is intentional/tested.

## Criterion-by-family/variant capability matrix

This is the release matrix promised by `WID-001/003/004`. It grades the operator-facing contract, not only rendering. `N/A` means the capability is genuinely irrelevant to that family. `I-Geo` is geometry of elements inside the widget; `O-Geo` is the outer zone/canvas geometry. `Bind` covers live/provider/game data binding plus freshness/fallback. Evidence abbreviations: `PP-E/M/T/V/X` are the editor mechanisms defined above; `WR` is `WidgetRenderer`; `REG` is `variants-register.ts`; `V2` is the concrete V2 component/registry; `HTML` is the EXTERNAL_HTML discovery/iframe path.

Any applicable criterion below an unqualified `B` blocks production release and maps to the work package in the final column. A strong aggregate cannot average away a D/F primary criterion.

| Family / concrete variants | Editor / evidence | Text | Media | BG | Time | Lists | I-Geo | O-Geo | Brand | Bind | Overall | Release decision |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Native `TEXT`, `RICH_TEXT` | PP-E; WR core | A | N/A | A | N/A | N/A | N/A | A | A | N/A | B+ | Release after generated field-path proof (`WID-002`) |
| Native `ANNOUNCEMENT`, `TICKER`, `QUOTE`, `STATS`, `MENU_ITEM` | PP-E; WR core/legacy | A | N/A | B | N/A | B | N/A | A | A | N/A | B+ | Release after `WID-002` parity suite |
| Native `STAFF_SPOTLIGHT`, `LOGO` | PP-E; WR core | B | A | B | N/A | N/A | N/A | A | A | N/A | B | Release with parity proof |
| Native `CLOCK`, `COUNTDOWN`, `WEATHER` | PP-E; WR core | B | N/A | A | A | N/A | N/A | A | A | B | A- | Release with timezone/fallback tests |
| `CALENDAR`, `SCHEDULE_GRID`, `ATTENDANCE`, `BIRTHDAYS`, `HONOR_ROLL` | PP-E; WR legacy | B | N/A | B | B | A | N/A | A | A | B | A- | Release with structured-list/binding tests |
| Native `LUNCH_MENU`, `BELL_SCHEDULE` | PP-E; WR core | A | B | B | A | A | N/A | A | A | B | A- | Release after POS/static truth tests |
| Native `IMAGE`, `IMAGE_CAROUSEL`, `VIDEO`, `VIDEO_CAROUSEL` | PP-E; WR core | B | A | N/A | B | A | N/A | A | N/A | N/A | A- | Release with asset/player parity |
| `STREAMING`, `WEBPAGE`, `RSS_FEED`, `SOCIAL_FEED`, `PLAYLIST`, `HOUSE_AD_BANNER`, `MUSIC_PLAYER` | PP-E/App; WR core | B | B | B | B | B | N/A | A | B | B- | B- | Block until resolver/freshness/source truth reaches B (`WID-004`) |
| `SHAPE`, `ICON`, `DECORATION`, `HOLIDAY`, `ANIMATED_BACKGROUND` | PP-E; WR core/legacy | B | N/A | A | N/A | N/A | B | A | A | N/A | A- | Release after Fast Add uses registry (`WID-002`) |
| Native `TOUCH_POINT` visual variants | PP-E + action; REG | B | N/A | A | N/A | N/A | B | A | A | B | B+ | Release with action/source/nonce tests |
| `TOUCH_BUTTON`, `TOUCH_MENU`, `ROOM_FINDER`, `ON_SCREEN_KEYBOARD`, `WAYFINDING_MAP`, `QUICK_POLL` | PP-E; WR legacy | A | B | A | N/A | A | B | A | A | B | B+ | Release with keyboard/action persistence tests |
| V2 mirrored core: five each `CLOCK_*`, `HEADLINE_*`, `ANN_*`, `CAL_*`, `CD_*`, `LOGO_*`, `TICKER_*`, `WX_*`, `LUNCH_*` | PP-E canonical adapter; V2 | A | B | B | A | A | N/A | A | B | B | B+ | Release only after generated per-variant contract tests (`WID-002`) |
| V2 Staff: `STAFF_NEON/PAPER/CRAYON/GLASS/OPS` | PP-E canonical; V2 | C | A | B | N/A | N/A | N/A | A | B | N/A | C+ | Block; add exact typed adapter (`WID-003`) |
| V2 Bell: `BELL_NEON/PAPER/CRAYON/GLASS/OPS` | PP-E canonical; V2 | B | N/A | B | A | C | N/A | A | B | N/A | B- | Block; structured schedule editor (`WID-003`) |
| V2 Image: `IMG_NEON/PAPER/CRAYON/GLASS/OPS` | Wrong PP-E `IMAGE`; V2 ImageWidgets | C | F | C | N/A | N/A | N/A | A | C | N/A | F | Quarantine now (`WID-001`); typed URL/fit/alt/caption adapter (`WID-003`) |
| V2 Photo: `PHOTO_NEON/PAPER/CRAYON/GLASS/OPS` | Wrong PP-E `IMAGE`; dead PHOTO cases; V2 PhotoWidgets | C | F | C | C | F | N/A | A | C | N/A | F | Quarantine now (`WID-001`); typed `photos[]` editor (`WID-003`) |
| V2 Rich Text: `RT_NEON/PAPER/CRAYON/GLASS/OPS` | Wrong PP-E `RICH_TEXT`; V2 RichTextWidgets | D | N/A | C | N/A | N/A | N/A | A | C | N/A | D | Quarantine now (`WID-001`); body/eyebrow/signature adapter (`WID-003`) |
| Animated Welcome/Cafeteria landscape+portrait | PP-E; WR full scene | A | A | A | A | A | D | A | A | N/A | B- | Block internal structural release until manifest/editor exists (`WID-003`/`TPL-002`) |
| Other animated/themed K-12 scenes | PP-T; WR full scene | A | A | B | A | A | D | A | A | N/A | B- | Block internal structural release (`WID-003`/`TPL-002`) |
| HS landscapes: `VARSITY/BROADCAST/YEARBOOK/TERMINAL/TRANSIT/GALLERY/BLUEPRINT/ZINE` | PP-E; WR scene | A | B | B | A | A | D | A | A | B | B- | Block internal structure/fallback gaps (`WID-003`) |
| HS portrait counterparts | PP-M; WR scene | A | B | B | A | C | D | A | A | B | B- | Block; typed scene manifest (`WID-003`) |
| MS landscape/portrait 16 scene types | PP-M; WR scene | B | B | B | B | C | D | A | B | N/A | C+ | Block; replace defaults reflection/scene monolith (`WID-003`) |
| Fitness full scenes 15 | PP-M; WR scene | B | B | B | B | C | D | A | B | B | C+ | Block; typed scene manifest and bindings (`WID-003`) |
| Fitness functional 9 | PP-E; WR vertical | A | A | B | A | A | N/A | A | A | B | B+ | Release after integration/player parity |
| Restaurant dedicated 6 | PP-E; WR vertical | A | A | B | A | A | N/A | A | A | B- | B- | Block exact POS selection/freshness (`WID-004`) |
| Bar dedicated 6 | PP-E; WR vertical | A | A | B | A | A | N/A | A | A | B | B+ | Release after live schedule/feed fixtures |
| Retail/fashion dedicated 7 | PP-E; WR vertical | A | A | B | A | A | N/A | A | A | B | B+ | Release after data/QR fixtures |
| Native `scoreboard-main` | PP-E + game bind; WR sports | A | B | A | A | A | N/A | A | A | B | B+ | Release after exact game/source tests |
| Native `ribbon-main`, `scorebug-main` | Binding-only PP-E; WR sports | F | F | F | A | F | N/A | A | C | B | D | Block; dedicated editors (`WID-003`) |
| Composable `sb-*` scoreboard elements | PP-E/CTS; WR sports | A | B | A | A | A | B | A | A | A | B+ | Release after source-authority/player tests |
| `SCORE_HOME`, `SCORE_AWAY`, `GAME_CLOCK`, `GAME_SEGMENT`, `GAME_STAT` | PP-E; WR sports | A | N/A | A | A | N/A | N/A | A | A | A | A- | Release after revision/replay tests |
| Swim/dive/stadium lane, split, relay, record, judge, leaderboard types | PP-E; WR sports | A | B | A | A | A | B | A | A | B | B+ | Release only with timing/hardware certification |
| V2 `SCOREBOARD_HS/COLLEGE/PRO` | Wrong PP-E `SCOREBOARD`; V2 SportsScoreboard | F | N/A | C | F | F | N/A | A | C | F | F | Quarantine now (`WID-001`); typed game/tier/banner editor (`WID-003`) |
| V2 Sports Venue 17 IDs in quarantine manifest | Wrong PP-E `SCOREBOARD`; V2 SportsVenue | F | F | C | F | F | D | A | C | F | F | Quarantine now (`WID-001`); per-widget schemas (`WID-003`) |
| V2 Celebrations 76 | PP-V; V2 registry/components | B | N/A | A | B | C | N/A | A | A | B | B- | Block until typed event/content contract reaches B (`WID-003`) |
| V2 Healthcare/Corporate/Hospitality/Worship scalar or string-list widgets | PP-V; V2 | B | B | A | B | B | N/A | A | A | B- | B- | Block binding/semantic controls below B (`WID-003/004`) |
| V2 object-list widgets: wait times, hours, insurance, rooms, sales, OKRs, anniversaries, events, amenities, attractions, services, hymns | PP-V defaults reflection; V2 | C | B | A | C | F | N/A | A | A | C | D | Block; typed object-list add/remove/reorder/migration (`WID-003`) |
| V2 Corporate KPI | PP-V; V2 | B | N/A | A | N/A | F | N/A | A | A | C | C- | Block numeric-array preservation/binding (`WID-003`) |
| V2 Charts 5 | PP-V; V2 ChartsWidgets | C | N/A | A | N/A | F | N/A | A | A | C | D | Block typed series/stat editors (`WID-003`) |
| V2 Retail simple: sale seal, price tag, promo strip | PP-V; V2 | A | N/A | A | N/A | N/A | N/A | A | A | C | B- | Block live-price/source truth (`WID-004`) |
| V2 Retail product/countdown/hours/loyalty/new arrivals | PP-V; V2 | C | F | A | F | F | N/A | A | A | D | D | Block typed media/time/list/binding (`WID-003/004`) |
| V2 Backgrounds 17 | PP-V; V2 | N/A | B | A | N/A | N/A | N/A | A | A | N/A | B | Release after offline asset/brand tests |
| V2 Live Data 8 + Transit 4 | PP-V; V2 | C | C | A | C | C | N/A | A | A | C | C- | Block real binding/freshness/fallback and typed fields (`WID-003/004`) |
| V2 Touch & Engage 10 IDs in quarantine manifest | Wrong PP-E `TOUCH_POINT`; V2 TouchEngage | F | F | C | F | F | D | A | C | F | F | Quarantine now (`WID-001`); per-widget action/content schemas (`WID-003/004`) |
| Packaged `EXTERNAL_HTML` 113 rows/112 URLs | PP-E+X; HTML discovery/iframe | B | B | B | C | F | F | A | C | D | C | Block source mode, collections, brand bridge, actions, POS, offline (`WID-004`/`TPL-002`) |
| AI-generated inline HTML | PP-E+X when hooks survive; Designer/HTML | C | C | B | C | F | F | A | C | F | D | Disable raw path; migrate to BoardDocumentV2 (`SEC-002`/`DOC-001`/`WID-004`) |

## `WID-001` exact 45-variant quarantine manifest

This manifest is machine-readable and release-blocking. These IDs must be hidden from new use or have misleading controls removed until their typed editor contract passes edit → save → reload → player-render evidence.

```json
{
  "workPackage": "WID-001",
  "count": 45,
  "releaseDecision": "QUARANTINE",
  "groups": {
    "v2Image": ["IMG_NEON", "IMG_PAPER", "IMG_CRAYON", "IMG_GLASS", "IMG_OPS"],
    "v2Photo": ["PHOTO_NEON", "PHOTO_PAPER", "PHOTO_CRAYON", "PHOTO_GLASS", "PHOTO_OPS"],
    "v2RichText": ["RT_NEON", "RT_PAPER", "RT_CRAYON", "RT_GLASS", "RT_OPS"],
    "v2Scoreboard": ["SCOREBOARD_HS", "SCOREBOARD_COLLEGE", "SCOREBOARD_PRO"],
    "v2SportsVenue": [
      "STADIUM_SCOREBOARD", "RIBBON_TICKER", "RIBBON_SPONSOR", "RIBBON_FAN_SHOUTOUT",
      "PLAYER_CARD", "STARTING_LINEUP", "STAT_COMPARISON", "OUT_OF_TOWN_SCORES",
      "KISS_CAM", "NOISE_METER", "IN_GAME_PROMO", "SPONSOR_TAKEOVER",
      "HOME_SCHEDULE", "STANDINGS_BOARD", "CONCESSION_WAITS", "GATE_WAYFINDING",
      "GOAL_CELEBRATION"
    ],
    "v2TouchEngage": [
      "PHOTO_BOOTH", "SIGN_IN_PAD", "LANGUAGE_PICKER", "ACCESSIBILITY_TRAY", "NPS_SMILEY",
      "TRIVIA_GAME", "SPIN_TO_WIN", "DIRECTORY_SEARCH", "WAYFINDING_FLOOR_MAP",
      "DONATION_THERMOMETER"
    ]
  }
}
```

## Required systemic remediation

1. Define one typed `WidgetDefinition` with persisted type, variant ID, renderer, editor schema, defaults, capability requirements, data bindings, player compatibility, and release status.
2. Generate Widget palette, Fast Add, Apps insertion, API catalog, TypeScript union, PropertiesPanel form, documentation, and registry parity tests from it.
3. Preserve concrete variant ID/config schema in `BoardDocumentV2`; never map incompatible variants into a shared type without an explicit adapter.
4. Every editor field declares its renderer-consumed path. CI performs edit → serialize → API save → reload → player-render assertion.
5. Add a full widget standard suite for text/image/background/clock/countdown/list/geometry/brand/binding controls.
6. Remove raw JSON from ordinary operator UX; keep it behind a developer role/flag.
7. Make reachability explicit: palette/app/template-only/internal/deprecated. Unreachable/dead controls fail CI.

## Release acceptance

- Registry parity: zero palette/runtime/editor ghosts; zero dead public catalog entries; zero `as any` registrations.
- Field-path parity: every friendly control changes a renderer-consumed field after save/reload.
- Standard editability: each published widget scores at least an unqualified `B` for every applicable criterion; any D/F primary criterion blocks regardless of aggregate.
- Variant completeness: all 243 V2 variants either have a compatible typed schema/editor or are not published.
- Integration truth: every live-data control persists and resolves to a tested adapter.
- Source switching: inline/package modes are deterministic and reversible.
- Cross-browser/player matrix: every published widget renders on declared canvases/engines with no fake data, overflow, console errors, or remote asset misses.
