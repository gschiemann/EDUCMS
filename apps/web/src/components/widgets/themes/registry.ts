/**
 * Shared widget-type union + theme-renderer prop contract.
 *
 * HISTORY (2026-08-05 waste sweep): this file used to also carry a runtime
 * "theme registry" (a Map + registerTheme/getTheme/listThemes/resolveWidget)
 * populated by 21 `themes/<name>/index.ts` side-effect modules. The registry
 * had ZERO readers — nothing ever called getTheme/listThemes/resolveWidget —
 * and 19 of the 21 registration modules weren't even imported (bare
 * `./themes/<name>` imports resolve to the sibling `<name>.tsx` component
 * file, not the directory). The runtime half and all 21 index.ts files were
 * deleted; the theme COMPONENTS (`themes/<name>.tsx`) are alive and well,
 * registered as picker variants via variants-register.ts. If a "theme
 * picker" feature ever lands, rebuild the registry with a consumer first.
 *
 * What remains here is load-bearing: `WidgetType` and `ThemeWidgetProps`
 * are the shared contract imported by variants.ts / variants-register.ts.
 */

export type WidgetType =
  | 'CLOCK' | 'WEATHER' | 'COUNTDOWN' | 'TEXT' | 'RICH_TEXT'
  | 'ANNOUNCEMENT' | 'TICKER' | 'BELL_SCHEDULE' | 'LUNCH_MENU' | 'CALENDAR'
  | 'STAFF_SPOTLIGHT' | 'IMAGE' | 'IMAGE_CAROUSEL' | 'VIDEO' | 'VIDEO_CAROUSEL' | 'LOGO'
  | 'WEBPAGE' | 'RSS_FEED' | 'SOCIAL_FEED' | 'PLAYLIST'
  // 2026-05-16 — self-contained HTML signage / HS templates, rendered
  // in a sandboxed iframe by ExternalHtmlWidget (cfg.url + cfg.brand).
  | 'EXTERNAL_HTML'
  // Touch (Sprint 4 placeholders)
  | 'TOUCH_BUTTON' | 'TOUCH_MENU' | 'ROOM_FINDER' | 'ON_SCREEN_KEYBOARD'
  | 'WAYFINDING_MAP' | 'QUICK_POLL'
  // Phase D2.9-D2.11 (2026-05-12) — canonical interactive zone.
  // Many visual variants via config.variant; the runtime renderer
  // (TouchPointWidget) dispatches across hotspot / shapes / arrows /
  // kiosk-nav (home/back/next/close/menu/help/play) / comm (qr/info/
  // phone/email/share) / engagement (heart/star) / utility (search/
  // volume/print). All 25 variants registered in variants-register.
  | 'TOUCH_POINT'
  // VenueOS Sports — celebration ribbons (touchdown, slam dunk, home
  // run, …). Registered as variants; this canonical type groups every
  // celebration widget under one picker chip.
  | 'CELEBRATION'
  // VenueOS multi-industry widget packs (EDU CMS-11/12). Each canonical
  // type groups a vertical's widgets under one picker chip; all are
  // variant-rendered.
  | 'HEALTHCARE' | 'CORPORATE' | 'HOSPITALITY' | 'WORSHIP' | 'CHART'
  // Retail pack (2026-05-19) — storefront widgets, RETAIL-vertical scoped.
  | 'RETAIL'
  // VenueOS Sports — the live, engine-driven scoreboard widget.
  | 'SCOREBOARD'
  // Sprint 13 — sport-bound widget primitives. Each binds to live
  // Game state (home/away score, clock, segment, sport-specific
  // stats) when the operator drops it into a Scoreboard / Ribbon
  // / Scorebug template. In the builder canvas (no GameStateProvider
  // wrapping) the widget falls back to its `placeholder` config so
  // the operator can still see + position the element. The /board
  // /ribbon /scorebug routes mount a GameStateProvider that polls
  // `GET /sports/board/:id` at 750ms — same cadence as the
  // hardcoded layout — so a custom template stays in lockstep with
  // score / clock / cue changes.
  | 'SCORE_HOME' | 'SCORE_AWAY' | 'GAME_CLOCK' | 'GAME_SEGMENT' | 'GAME_STAT'
  // 2026-07-01 — swim/dive split flagship widgets. SWIM_LANE_GRID is the
  // "lanes and shit" board (one row per lane: lane#, swimmer/team, seed/
  // time, place) sourced from the MeetResult structured stats.
  // DIVE_LEADERBOARD ranks divers by running judged total — diving has NO
  // lanes/clock/splits, a fundamentally different data model, so it's a
  // separate widget, not a SWIM_LANE_GRID config option.
  | 'SWIM_LANE_GRID' | 'DIVE_LEADERBOARD'
  // 2026-07-01 DEPTH PASS (docs/research/2026-06-30-swim-dive-
  // scoreboards/00-REPORT.md parts A3/A4/A8/B4/B5) — four more swim/dive
  // widgets: relay-leg exchange board, per-length splits panel, record/
  // pace reference bar, and the diving judges panel (drop-high/low +
  // DD + computed dive score). See SwimDiveWidgets.tsx file header.
  | 'SWIM_RELAY_EXCHANGE' | 'SWIM_SPLITS_PANEL' | 'SWIM_RECORD_LINE' | 'DIVE_JUDGES_PANEL'
  // S6 #288 (2026-07-03) — Stadium Lane flagship swim-meet broadcast
  // board (v1 "Broadcast"; v2 "Duel" / v3 "Chase" reserved for later —
  // see StadiumMeetBoardWidget.tsx file header). Same stats.results
  // contract as SWIM_LANE_GRID, different (broadcast) visual language.
  | 'STADIUM_MEET_BOARD'
  // VenueOS universal packs — drop-in template backgrounds and live
  // data feeds (markets, news, weather, transit). Variant-rendered;
  // each canonical type groups its pack under one picker chip.
  | 'BACKGROUND' | 'LIVE_DATA'
  // 2026-05-25 monetize-audit — drop-in widget for the house-only
  // ad network. Renders a rotation of the operator's own uploaded
  // creatives with sponsor disclosure label + optional CTA chip.
  // Lives next to the third-party programmatic networks but does
  // NOT call the impression endpoint (those are paid only).
  | 'HOUSE_AD_BANNER'
  // 2026-05-25 music-overhaul — Spotify-for-Business / Apple Music
  // for Business / SomaFM / NPR / NTS / generic stream. One widget,
  // many source providers, server-resolved station list.
  | 'MUSIC_PLAYER'
  // Wave B / editor-crush B2 (2026-07-02) — static design-element shapes
  // (rect/pill/circle/triangle/star/line/arrow). ONE widget type; the
  // specific primitive is `config.shape` (see ShapeWidget.tsx SHAPE_KINDS).
  // Mirrors the DECORATION / TOUCH_POINT pattern: many picker tiles, one
  // canonical widgetType, variant-selected primitive.
  | 'SHAPE'
  // Wave B / editor-crush B5 (2026-07-02) — searchable icon library backed
  // by lucide-react (already a dependency). `config.icon` is the lucide
  // icon name; color/size/strokeWidth are editable.
  | 'ICON'
  // Sprint 11h — drag-drop animated decorations (confetti, ribbon,
  // balloons, clouds, sparkles, ticker, neon-buzz, pulse-glow). The
  // canonical type existed at runtime since 2026-04-27 (WidgetRenderer
  // case + useBuilderStore DECORATION_* canonicalization) but was never
  // in this union — formalized 2026-07-02 when the palette registrations
  // landed (Wave B / editor-crush B3).
  | 'DECORATION';

export interface ThemeWidgetProps {
  config: any;
  compact?: boolean;
  live?: boolean;
  // Optional inline-edit hook from the template builder (BuilderZone).
  // Variant renderers need this so EditableText nodes inside them can
  // commit operator edits back to the zone's defaultConfig. Without it
  // EditableText.canEdit is false and click-to-edit silently no-ops.
  onConfigChange?: (patch: Record<string, any>) => void;
}
