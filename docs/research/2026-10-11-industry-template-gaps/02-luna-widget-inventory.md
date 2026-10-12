# Core widget inventory — full Luna source report

Read-only inventory complete (CLAUDE.md first; no edits/runtime). Core findings: use files/IDs below; integration/runtime/whole-app audit deferred, and this is source tracing only, not browser-tested.

| Core feature | Status | Evidence |
|---|---|---|
| Text/headings | Available, strong styling/editing | `PropertiesPanel.tsx` `ContentFields` TEXT/RICH_TEXT around 3131: text, subtitle, eyebrow/byline/date, alignment, font family/size, color/background, AI generate/rewrite. `variants-register.ts` `text-big-bold`, `text-gradient`, `text-highlight`, `text-outlined`, many themed headings; renderer `WidgetRenderer.tsx` TEXT/RICH_TEXT -> TextWidget. |
| Image/photo | Available | `image-basic` registration ~376; IMAGE renderer; PropertiesPanel IMAGE picks asset, fit, opacity, radius, alt text. `SelectionControls.tsx` MediaQuickControls adds replace/fit/frame-to-image. |
| Video | Available, signage-oriented playback | `video-basic` ~394; VIDEO + VIDEO_CAROUSEL renderer. PropertiesPanel supports asset, fit, opacity, radius, autoplay, loop, muted; carousel list/transition. Media controls have replace/fit. Runtime playback compatibility has separate specialized pipeline, not Canva-style timeline editing. |
| Shapes/lines/arrows | Available | `variants-register.ts` ~538-563 loops SHAPE_KINDS; SHAPE + PropertiesPanel ~4833 supports shape/fill/border/width/radius/opacity; renderer case SHAPE. Includes rectangle/pill/circle/triangle/star/line/arrow. |
| Icons | Available | `icon-element` registration ~565, searchable ~1,500 icons; PropertiesPanel ICON ~4921 supports icon/color/stroke/opacity; renderer case ICON. |
| Frames/gallery/collage | Partial | IMAGE_CAROUSEL is real slideshow (list, interval, transitions, fit) and has many gallery themed tiles (`gallery-modern`, etc). Frames are baked into themed variants (e.g. gallery-modern, Polaroid/pinned-photo), not a general frame tool clipping arbitrary photos; no freeform collage/layout widget identified. |
| Backgrounds | Available as signage/background catalog, not conventional design canvas | `variants-register.ts` ~1184 maps Backgrounds to BACKGROUND; WidgetRenderer fallback handles BACKGROUND via registry variants. New template canvas background color is in PropertiesPanel template info. Verify exact variant/editability if expanding this area. |
| Tables/charts | Partial / specialized | CHART has renderer fallback through registered variants (`WidgetRenderer.tsx` ~1313); chart configs are data-bound signage widgets, no generic Canva chart authoring evidence. Table surfaces mainly specialized menu/schedule/roster data widgets; no general editable table element found. |
| QR | Available | `qr-code-basic` in reachability tiles ~508; QR_CODE renderer; PropertiesPanel ~3708 supports URL/Wi-Fi/tel/SMS/email/contact/plain text; generated on-device. |
| Map/embed | Partial | WEBPAGE tile and renderer (URL/refresh editable); no generic map widget found in core inventory. Some specialized location/venue widgets may exist. |
| Audio | Partial / signage-specific | MUSIC_PLAYER tile ~617, renderer; config defaults set `display:'hidden', hideOnScreen:true`, scheduled/background music, emergency pause. Not an on-canvas audio clip or timeline/sound-effect placement. |

Catalog UX is already intentionally curated: `VariantPicker.tsx` uses search + curated ≤12 default flagships + category rows (6 before See all) + one filter drawer, not enum chips. Search/catalog helpers live `widget-catalog.ts`. Variant registration is source of truth; CLAUDE says constants.ts WIDGET_GROUPS is historical and doesn’t populate picker. `packages/database/src/types/index.ts` WidgetType enum is legacy-small (IMAGE/IMAGE_CAROUSEL/VIDEO/TEXT/RICH_TEXT etc), while runtime has much broader types like SHAPE, ICON, QR_CODE, MUSIC_PLAYER, CHART; don't infer availability from enum alone.

Common items are registered early near top of `variants-register.ts` and generally discoverable via search, but fixed shapes/icons are grouped under one MODERN category with individual tiles; users may not learn category=element. Photo 'frame' examples sit under themed/gallery variants. Strong existing design features may be buried behind properties: icon search and photo-list picker, but basic common controls seem implemented.

## Top three recommendations

1. Promote a visibly named “Elements” category/section with Shape, Line, Arrow, Icon, QR tiles; likely edit `variants-register.ts` registration category metadata and `widget-catalog.ts` category/display mapping, then `VariantPicker.tsx` only if needed. Avoid changing WIDGET_GROUPS.
2. Add an explicit “Photo frame / collage” set with editable photo slots using existing IMAGE_CAROUSEL/PhotosArrayField plumbing; target `variants-register.ts`, `PropertiesPanel.tsx`, and existing photo widget renderer/component(s), after choosing whether MVP is a few layouts versus arbitrary collage.
3. General-purpose data table/chart authoring is the largest true parity gap; start with a simple editable table element (columns/rows) then basic chart presets, using dedicated renderer + ContentFields. Targets `WidgetRenderer.tsx` or new component files and `PropertiesPanel.tsx`; register palette tiles in `variants-register.ts`. This is larger than the first two.

No app/build/browser/tests/install/db/other chat messaging performed.
