# AUDIT — §19 Template + Widget Editability · §2 (widget asset/bg editing)

> Opus 4.8 full-app audit, 2026-05-28. Read-only. Render-tree verified per
> CLAUDE.md rule #9: `BuilderShell.tsx:627` mounts `<VariantPicker>` (live, NOT
> dead WidgetPalette), `:631` mounts `<PropertiesPanel>` (live). Editability switch
> `PropertiesPanel.tsx:1536`.

## THE BRUTAL-TRUTH HEADLINE

**Greg's "you can't edit a single word" is FALSE as a blanket claim but TRUE for a
specific high-traffic class.** Most widgets are genuinely, richly editable. But the
**themed signage widgets that ship as flagship system templates — Bulletin /
Scrapbook / Storybook (Hallway + Cafeteria) + Animated Hallway/Bell Schedule —
expose only decorative labels and stamps, NOT the substantive content (the actual
schedule rows, the lunch menu items, the attendance number, the food photo).** The
widget supports those fields; the editor just never surfaced them. The operator can
change the heading "Today's Schedule" but cannot edit a single period underneath it.
**That is the real defect — 12 widgets (6 landscape + 6 portrait).**

## Coverage table (widget class × editability) — abbreviated
| Widget class | Text | Image | BG | Pos/size | Brand | Grade |
|---|---|---|---|---|---|---|
| TEXT/RICH_TEXT | ✅ full | n/a | solid | x/y/w/h (no rot/opacity) | ✅ | **A-** |
| IMAGE/VIDEO/CAROUSELS | alt/caption ✅ | ✅ picker+fit | n/a | ✅ | n/a | **A** |
| PHOTO_* / LOGO / STAFF_SPOTLIGHT | ✅ | ✅ | n/a | ✅ | n/a | **A / A / B+** |
| CLOCK | eyebrow ✅ | n/a | solid | ✅ | ✅ | **A** (TZ✅ 12/24h✅ seconds✅ date-fmt✅) |
| WEATHER / COUNTDOWN | ✅ | n/a | solid | ✅ | ✅ | **A / A-** |
| TICKER / ANNOUNCEMENT / CALENDAR / LUNCH_MENU / BELL_SCHEDULE | ✅ items add/remove/reorder | n/a | solid | ✅ | ✅ | **A / A-** |
| TOUCH_POINT (25 variants) | label/qr ✅ | — | color+transparent | ✅ | ✅ | **A-** |
| **EXTERNAL_HTML** (signage/QSR) | ✅ **dynamic per-`data-field` editor** | URL | brand bg/surface/primary/accent | ✅ | ✅ | **A — gold standard** |
| SCOREBOARD (live + sport elements) | ✅ labels/stat-bind | sponsor/team logo URL | solid+accent | ✅ | ✅ | **A-** |
| SCOREBOARD CTS variants | ✅ | sponsor URL | solid | ✅ | ✅ | **B+** |
| HOUSE_AD/MUSIC/STREAMING/FITNESS_LIVE_TV | ✅ | ✅ | solid | ✅ | partial | **B+** |
| v2 CELEBRATION/HEALTHCARE/CORPORATE/HOSPITALITY/WORSHIP/CHART/RETAIL/BACKGROUND/LIVE_DATA (default fallback) | ✅ auto from registry | bg img ✅ | bg color/grad/img ✅ | ✅ | ✅ | **B+** (dev-ish labels) |
| HS_VARSITY/BROADCAST/YEARBOOK/etc + portraits | ✅ per-field StyleableField | some | per-field bg | ✅ | partial | **A-** (best-styled) |
| MS_ARCADE/ATLAS/etc + portraits | ✅ incl list rows (`shoutouts.0.who`) | text-only | universal | ✅ | universal | **B+** |
| FITNESS_* (15 scenes) | ✅ dot-keyed | text-only | universal | ✅ | universal | **B** |
| 🔴 **ANIMATED_HALLWAY_SCHEDULE / ANIMATED_BELL_SCHEDULE** | ⚠️ **labels/stamps ONLY — NOT periods (`c.periods`)** | ❌ | universal | ✅ | universal | **D** |
| 🔴 **BULLETIN/SCRAPBOOK/STORYBOOK_HALLWAY** (+portraits) | ⚠️ **labels ONLY — NOT rows (`c.rows`), NOT attendance# (`c.attendancePct`)** | ❌ | universal | ✅ | universal | **D** |
| 🔴 **BULLETIN/SCRAPBOOK/STORYBOOK_CAFETERIA** (+portraits) | ⚠️ **stamps ONLY — NOT menu (`c.menuItems`/`c.weekMenu`), NOT photo (`c.photoEmoji`)** | ❌ no photo picker | universal | ✅ | universal | **D** |
| 🟡 ANIMATED_WELCOME (+MS/HS/portrait), ANIMATED_CAFETERIA | ✅ rich (logo/title/clock/weather/announce/countdown/teacher+photo/birthdays/ticker) | ✅ | universal | ✅ | universal | **B+** |

## Editor surfaces ARE mounted (not theater) — the good news
- PropertiesPanel mounted (`BuilderShell.tsx:631`); switch live; universal text-style
  section (`:4675-4708`) fires for every non-media text-bearing widget.
- Zone-wide font/color/bold overrides injected as `!important` CSS scoped to
  `[data-zone-id] [data-widget-content] [data-field]` in **both** editor
  (`BuilderZone.tsx:593-628`) **and** player (`player/page.tsx:5173-5212`). Styling
  overrides are **real on the live screen**, not editor-only.
- `ExternalHtmlTextEditor` (`PropertiesPanel.tsx:5073`) dynamically walks `data-field`
  nodes — the correct pattern, already shipped for the 80 signage templates.
- **The gap is NOT mounting.** Themed widgets DO get an editor (THEMED auto-form
  `:4641-4668`). The defect: the **`THEMED_WIDGET_FIELDS` registry
  (`themed-widget-defaults.ts`) is incomplete** — lists decorative text, omits the
  list-array fields (`rows`/`periods`/`menuItems`) + image fields (`photoEmoji`). The
  auto-form only renders Text/TextArea, never an array or asset picker.

## TOP 10 RANKED FIXES

**P0 — launch blockers (THIS is the operator complaint):**
1. **Expose menu items on the 3 Cafeteria themed widgets.** `BulletinCafeteriaWidget.tsx:116`
   reads `c.menuItems`. Add a `MenuItemsArrayField` (model on `PhotosArrayField`
   `~2535` or LUNCH_MENU `:2037`), wire for BULLETIN/SCRAPBOOK/STORYBOOK_CAFETERIA
   (+portraits). Fix in THEMED handler `:4641` — special-case array fields.
2. **Expose schedule rows on Hallway/Schedule themed widgets.** `BulletinHallwayWidget.tsx:84`
   (`c.rows`), `AnimatedHallwayScheduleWidget.tsx:126` (`c.periods`). Reuse the
   BELL_SCHEDULE period editor `:2694`. Targets: ANIMATED_HALLWAY_SCHEDULE,
   ANIMATED_BELL_SCHEDULE, BULLETIN/SCRAPBOOK/STORYBOOK_HALLWAY (+portraits).
3. **Add a photo picker to the Cafeteria widgets.** They accept a URL in
   `c.photoEmoji` (`:41-42`). Add `AssetPickerField key="photoEmoji" kind="image"`.
4. **Expose attendance # + day** (`c.attendancePct`/`c.attendanceDay`) on the 3
   Hallway widgets — add to `themed-widget-defaults.ts:229+`.

**P1 — high-value polish:**
5. **Add `rotation` + zone-level `opacity` to the Zone model** (`types.ts:72-90` has
   neither) + controls in "Position & size" (`:780`). §19 requires both.
6. **Make the THEMED editor dynamic like `ExternalHtmlTextEditor`** — walk rendered
   `data-field` nodes instead of the static registry. Kills the whole "registry
   forgot a field" class going forward (`:4641`).
7. **Extend per-field `StyleableField` to MS/Fitness packs** — add `useTextStyleOverrides`
   to those widgets, drop the `isHsWidget`-only gate (`:4568`). Today only HS gets
   per-field size/color.

**P2 — consistency:**
8. **Humanize v2 fallback field labels** ("Exit Velo" etc.) — extend `prettyFieldLabel`
   map (`~346`).
9. **Brand primary/accent preset even when no brand kit set** — resolve to
   `var(--brand-primary)` / default (`color-picker.tsx:345`).
10. **Guard the `return null` blank-panel edge** (`:4671`) — final generic style+JSON
    fallback so no widget can ever show an empty editor.

## ROOT CAUSE (single pattern)
> For the themed signage widgets, `THEMED_WIDGET_FIELDS` (`themed-widget-defaults.ts`)
> only enumerates decorative scalar text and omits (a) the list-array fields the
> widget renders as its PRIMARY content (`rows`, `periods`, `menuItems`/`weekMenu`)
> and (b) image fields (`photoEmoji`). The widgets read these from config — the
> editor never built a field, and the THEMED auto-form (`PropertiesPanel.tsx:4641`)
> only renders Text/TextArea, never an array or asset picker.

Fix is mechanical + contained: special-case array + image fields in the THEMED
handler (better: make it dynamic per `data-field` like the shipped
`ExternalHtmlTextEditor`). Everything else — TEXT, IMAGE, CLOCK, WEATHER, TICKER, v2
packs, sports/CTS, HS, MS, EXTERNAL_HTML — is genuinely editable end-to-end with
zone-scoped overrides that verifiably apply on the live player. **The 12 themed
schedule/cafeteria widgets (6 landscape + 6 portrait), each shipped as a system
preset, are the launch blockers.**
