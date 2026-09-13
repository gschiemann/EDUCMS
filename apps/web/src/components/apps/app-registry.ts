/**
 * App Registry — VenueOS "Apps" library (Phase 1).
 *
 * See docs/research/2026-06-30-app-library/00-SYNTHESIS.md (§5 Architecture,
 * §6 Phase 1) for the design this implements.
 *
 * The core idea (do not lose this while extending): OptiSigns/Yodeck/
 * ScreenCloud's ~80-140 "apps" are almost all a thin wrapper over a widget
 * we ALREADY have (WEBPAGE iframe, RSS parse, STREAMING iframe, CALENDAR,
 * WEATHER, CLOCK/COUNTDOWN). An "app" here is NOT a new render surface — it
 * is a friendly config form + URL-transform that produces a standard zone
 * `{ widgetType, defaultConfig }` the existing WidgetRenderer already knows
 * how to draw. Adding a new app should almost never require touching
 * WidgetRenderer.tsx.
 *
 * Each app definition is intentionally data-only (no JSX) so it can be
 * unit-tested and reasoned about without a DOM. The React config-form UI
 * lives in AppConfigForm.tsx, which reads `configSchema` to render fields
 * generically, with a couple of per-app custom fields where a plain text
 * input isn't enough (see `customFieldsHint` below).
 */

import {
  toYoutubeCanonicalUrl,
  toVimeoCanonicalUrl,
  toTwitchCanonicalUrl,
  toGoogleSlidesEmbedUrl,
  toGoogleSheetsEmbedUrl,
  toCanvaEmbedUrl,
  toGoogleMapsEmbedUrl,
  toGoogleCalendarEmbedUrl,
  extractIframeSrc,
  ensureHttps,
  hostIsOneOf,
  parseWebUrl,
  toSocialWallEmbedUrl,
  isSocialWallEmbedUrl,
} from './url-transforms';
import { scriptOnlyWallReason } from './social-wall-hosts';

/** How much friction the operator has to go through before this app "just works." */
export type FrictionTier = 'instant' | 'login' | 'aggregator';

export const FRICTION_TIER_LABEL: Record<FrictionTier, string> = {
  instant: 'Instant · no login',
  login: 'Needs a business login',
  aggregator: 'Powered by an aggregator',
};

/**
 * `google-place` (2026-09-12) is the one field type that is not a plain input:
 * its value is an opaque Google place id nobody can type, so `AppConfigForm`
 * renders a SEARCH box that calls `POST /integrations/google-reviews/places/
 * search` and writes both `placeId` and a companion `placeName` when the
 * operator picks a result. It is also the one field that can report a
 * deploy-level prerequisite (no API key) in place of its own control.
 */
export type AppFieldType = 'text' | 'url' | 'textarea' | 'select' | 'checkbox' | 'number' | 'date' | 'google-place';

export interface AppFieldSchema {
  key: string;
  label: string;
  type: AppFieldType;
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** For type:'select' */
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | number | boolean;
}

/** Percent-of-canvas size hint for a freshly-added zone (world-class build,
 *  smart-placement workstream). Purely a default — the operator can always
 *  resize after. Omitted apps fall back to a widgetType-keyed default in
 *  useBuilderStore's addZone. */
export interface AppDefaultSize {
  w: number;
  h: number;
}

/**
 * One zone in a curated "finished layout" (Tier 2, 2026-07-01 — see
 * docs/research/2026-06-30-app-library/20-WORLDCLASS-BUILD-PLAN.md Tier 2
 * "Finished-board-per-app"). Coordinates are percent-of-canvas, same space
 * as `TemplateZone` — AppConfigForm applies them verbatim via addZone +
 * updateZone, so these are just ordinary zones once on the canvas (undo/
 * redo, Properties panel, layers — all just work, same as any other zone).
 *
 * `{{url}}` inside a string value in `defaultConfig` is substituted with
 * the app's OWN built config's primary url/text field at apply-time (see
 * `applyStarterLayout` in AppConfigForm.tsx) so a layout can reference
 * "whatever the operator just pasted" without every layout author having
 * to know the exact build() shape for every app that might host it.
 */
export interface AppStarterLayoutZone {
  /** Defaults to the app's own build().widgetType when omitted — set this
   *  explicitly for the COMPLEMENTARY zones (title bar, clock, accent
   *  strip) that aren't the app's own widget. */
  widgetType?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
  defaultConfig: Record<string, unknown>;
}

/** A named, finished multi-zone composition for one app — the app's own
 *  widget PLUS complementary zones (branded title bar, clock, accent
 *  strip), all sized/placed and using `var(--brand-primary)` /
 *  `var(--brand-accent)` so they ride the tenant's brand kit. This is the
 *  Tier-2 answer to "every competitor ships 100s of finished layouts; we
 *  ship one bare zone" — see AppConfigForm's "Finished layouts" row. */
export interface AppStarterLayout {
  id: string;
  name: string;
  zones: AppStarterLayoutZone[];
}

export interface AppBuildResult {
  widgetType: string;
  defaultConfig: Record<string, unknown>;
}

/**
 * What a working paste looks like for one app — the knowledge `buildApp()`
 * (build-app.ts) needs to tell an operator WHY their link won't work
 * instead of adding a zone that shows nothing.
 *
 * M6-1 (2026-09-12): every `build()` below leans on a transform that passes
 * unrecognised input straight through (see url-transforms.ts). So pasting an
 * Instagram link into Google Calendar used to produce a perfectly valid-
 * looking WEBPAGE zone pointed at Instagram, and a Calendar link with
 * malformed percent-encoding threw inside the transform and produced an
 * EMPTY one. Both looked like success. `recognises` is the app's own answer
 * to "is this actually my service's content?"
 */
export interface AppInputExpectation {
  /** Plain-English noun phrase that completes "That doesn't look like ___." */
  what: string;
  /** Where to find the right link. Shown as a second sentence. */
  hint?: string;
  /** True when the BUILT output really is this service's content. Omit when
   *  the generic per-widgetType URL check in `buildApp` is the whole story
   *  (Web Page, Maps, RSS — any host is legitimate for those). */
  recognises?: (built: AppBuildResult) => boolean;
  /**
   * A MORE specific sentence for a paste we RECOGNISE as a known-unsupported
   * shape, returned instead of the generic "that doesn't look like ___".
   * Given the operator's raw form values, because the useful detail is in
   * what they typed — by the time `build()` has run, an unusable paste has
   * already collapsed to nothing.
   *
   * Only worth writing where the generic sentence would send the operator
   * round the same loop: a Curator.io wall IS a wall, it just can't be
   * framed, and "that doesn't look like a wall link" tells them nothing they
   * can act on. Returning undefined falls back to the generic sentence.
   */
  explain?: (values: Record<string, string>) => string | undefined;
}

export interface AppDefinition {
  id: string;
  name: string;
  /** lucide-react icon name (resolved in AppLibraryPanel — kept as a string so this file has zero React/JSX deps). */
  icon: string;
  category: AppCategory;
  frictionTier: FrictionTier;
  blurb: string;
  /** Longer copy shown in the config-form header — sets expectations (publish-to-web warning, login requirement, etc). Prefer `setupSteps` for anything with more than one step; kept for the rare single-line note. */
  setupNote?: string;
  /** Ordered numbered checklist rendered instead of `setupNote`'s prose blob
   *  — for the publish-to-web apps (Slides/Sheets/Canva/PowerPoint) where the
   *  hard part is a multi-step dance in a THIRD-PARTY app. Each string is one
   *  step, written in plain operator language ("Click Share, then..."). */
  setupSteps?: string[];
  /** Optional deep-link to open the third-party app the operator needs
   *  (e.g. slides.google.com) — rendered as a small "Open ↗" button next to
   *  the setup steps. */
  helpUrl?: string;
  /** Shown as its own styled line (not buried in setupNote prose) for apps
   *  that require "Publish to web" / "Anyone with the link" — a real privacy
   *  consideration, not just a mechanical step. */
  publicExposureWarning?: string;
  configSchema: AppFieldSchema[];
  /** Pure function: operator's form values -> a standard zone config.
   *  NEVER called directly by the UI — always through `buildApp()` in
   *  build-app.ts, which catches a throw and grades the OUTPUT, so a
   *  transform that can't read the operator's paste becomes a visible
   *  "that doesn't look like a X" instead of an empty zone (M6-1). */
  build: (values: Record<string, string>) => AppBuildResult;
  /** What a working paste looks like, so `buildApp()` can refuse an
   *  unrecognised one in the operator's language. See AppInputExpectation. */
  expects?: AppInputExpectation;
  /** True for apps that are honestly not buildable yet in Phase 1 (native social embeds are dead — see synthesis §1). Rendered as a disabled/"coming via Social Wall" tile, never a silently-broken one. */
  comingSoon?: boolean;
  /** Taurus/Chromium-83 LED note. Every app rides an existing widget so none of these need new player code, but some upstream iframes (Twitch, heavy JS embeds) are known to be flaky on old WebViews. */
  taurusNote?: string;
  /** Percent-of-canvas size hint applied when this app lands a fresh zone
   *  (see AppDefaultSize doc comment). Falls back to a widgetType-keyed
   *  default in useBuilderStore.addZone when omitted. */
  defaultSize?: AppDefaultSize;
  /** Curated finished-board compositions for this app (Tier 2 "finished
   *  boards" — see AppStarterLayout doc comment). 2-3 per app, ordered
   *  best-first. Omitted entirely for apps where a single zone genuinely
   *  IS the whole board (QR code, Clock) — the plain "Add to canvas" stays
   *  the fast path for everyone either way. */
  starterLayouts?: AppStarterLayout[];
}

export type AppCategory =
  | 'video'
  | 'docs'
  | 'utility'
  | 'weather'
  | 'news'
  | 'calendar'
  | 'social'
  | 'reviews'
  | 'data'
  | 'media';

export const APP_CATEGORY_LABEL: Record<AppCategory, string> = {
  video: 'Video',
  docs: 'Docs & Slides',
  utility: 'Utility',
  weather: 'Weather',
  news: 'News',
  calendar: 'Calendar',
  social: 'Social',
  reviews: 'Reviews',
  data: 'Data',
  media: 'Media',
};

function str(values: Record<string, string>, key: string, fallback = ''): string {
  const v = values[key];
  return typeof v === 'string' ? v : fallback;
}

function num(values: Record<string, string>, key: string, fallback: number): number {
  const v = Number(values[key]);
  return Number.isFinite(v) ? v : fallback;
}

function bool(values: Record<string, string>, key: string, fallback = false): boolean {
  const v = values[key];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

/** The URL a built config actually hands to its widget (WEBPAGE `url`,
 *  STREAMING `embedUrl`, RSS_FEED `feedUrl`) — what an `expects.recognises`
 *  should be grading. Empty string when the app doesn't produce one. */
export function builtWidgetUrl(built: AppBuildResult): string {
  const c = built.defaultConfig;
  const v = c.url ?? c.embedUrl ?? c.feedUrl;
  return typeof v === 'string' ? v : '';
}

// ─────────────────────────────────────────────────────────────────────────
// Starter-layout building blocks — Tier 2 "finished boards" (2026-07-01).
// Small factories for the COMPLEMENTARY zones every layout below reuses
// (a branded title bar, a corner clock, a thin accent strip) so each
// layout definition stays a short, readable list of zones rather than
// repeating the same TEXT/CLOCK config object bodies. Every color here
// resolves through the tenant's brand kit (`var(--brand-primary)` /
// `var(--brand-accent)`, with a safe static fallback) — Taurus-safe
// (physical longhand positioning only, no `inset`).
// ─────────────────────────────────────────────────────────────────────────

/** A slim branded title bar along one edge — the zone `build()`s a plain
 *  TEXT widget with the tenant's brand-primary as the background. */
function titleBarZone(
  text: string,
  opts: { x: number; y: number; width: number; height: number; edge?: 'top' | 'bottom' },
): AppStarterLayoutZone {
  return {
    widgetType: 'TEXT',
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    zIndex: 5,
    defaultConfig: {
      content: text,
      fontSize: 32,
      alignment: 'center',
      bold: true,
      color: 'var(--brand-primary-ink, #ffffff)',
      bgColor: 'var(--brand-primary, #4f46e5)',
    },
  };
}

/** A thin brand-accent strip — pure decoration, no text. */
function accentStripZone(opts: { x: number; y: number; width: number; height: number }): AppStarterLayoutZone {
  return {
    widgetType: 'TEXT',
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    zIndex: 4,
    defaultConfig: {
      content: '',
      bgColor: 'var(--brand-accent, #f59e0b)',
    },
  };
}

/** A compact corner clock, on-brand ink color. */
function cornerClockZone(opts: { x: number; y: number; width: number; height: number }): AppStarterLayoutZone {
  return {
    widgetType: 'CLOCK',
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    zIndex: 5,
    defaultConfig: { format: '12h' },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// INSTANT apps — Phase 1 batch. Every one of these `build()`s a config for
// a widgetType that WidgetRenderer.tsx already has a `case` for (verified
// against the switch in apps/web/src/components/widgets/WidgetRenderer.tsx
// before writing this file — see CLAUDE.md rule #9, same discipline applies
// to widget TYPES as to component mount sites).
// ─────────────────────────────────────────────────────────────────────────

export const APP_REGISTRY: AppDefinition[] = [
  // ── VIDEO ──────────────────────────────────────────────────────────
  {
    id: 'youtube',
    name: 'YouTube',
    // NOTE: lucide-react (this app's icon set) dropped brand/logo icons —
    // there is no 'Youtube'/'Twitch'/'Facebook'/'Instagram' glyph available.
    // Using a generic semantic icon instead of pulling in a new icon
    // dependency (react-icons/simple-icons) just for a handful of logos;
    // TODO(lead): swap in real brand marks if/when a logo icon set gets
    // added to the app for other reasons.
    icon: 'Tv',
    category: 'video',
    frictionTier: 'instant',
    blurb: 'Play a video, playlist, or channel live stream. Free official embed.',
    defaultSize: { w: 60, h: 45 },
    configSchema: [
      { key: 'url', label: 'YouTube link', type: 'url', placeholder: 'https://www.youtube.com/watch?v=... or a channel /live URL', required: true },
      { key: 'muted', label: 'Muted (recommended for signage)', type: 'checkbox', defaultValue: true },
    ],
    build: (v) => ({
      widgetType: 'STREAMING',
      defaultConfig: {
        channelTitle: 'YouTube',
        embedUrl: toYoutubeCanonicalUrl(str(v, 'url')),
        playbackType: 'iframe',
        muted: bool(v, 'muted', true),
        fitMode: 'cover',
      },
    }),
    // Host-level, not video-id-level, on purpose: the blurb promises
    // playlists and channel-live URLs too, and `youtubeVideoId` matches
    // neither. Anything on these hosts is something StreamingWidget will
    // frame; anything else is the silent break.
    expects: {
      what: 'a YouTube link',
      hint: 'Copy it from the video’s Share button.',
      recognises: (b) => hostIsOneOf(builtWidgetUrl(b), ['youtube.com', 'youtu.be', 'youtube-nocookie.com']),
    },
    starterLayouts: [
      {
        id: 'full-bleed-titled',
        name: 'Full-bleed + branded title',
        zones: [
          { x: 0, y: 0, width: 100, height: 88, zIndex: 1, defaultConfig: {} },
          titleBarZone('Now Playing', { x: 0, y: 88, width: 100, height: 12 }),
        ],
      },
      {
        id: 'lower-third-clock',
        name: 'Video + clock rail',
        zones: [
          { x: 0, y: 0, width: 78, height: 100, zIndex: 1, defaultConfig: {} },
          accentStripZone({ x: 78, y: 0, width: 1, height: 100 }),
          cornerClockZone({ x: 80, y: 4, width: 18, height: 14 }),
          titleBarZone('Live', { x: 80, y: 20, width: 18, height: 10 }),
        ],
      },
    ],
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    icon: 'Video',
    category: 'video',
    frictionTier: 'instant',
    blurb: 'Play a Vimeo video. Free official embed.',
    defaultSize: { w: 60, h: 45 },
    configSchema: [
      { key: 'url', label: 'Vimeo link', type: 'url', placeholder: 'https://vimeo.com/123456789', required: true },
      { key: 'muted', label: 'Muted (recommended for signage)', type: 'checkbox', defaultValue: true },
    ],
    build: (v) => ({
      widgetType: 'STREAMING',
      defaultConfig: {
        channelTitle: 'Vimeo',
        embedUrl: toVimeoCanonicalUrl(str(v, 'url')),
        playbackType: 'iframe',
        muted: bool(v, 'muted', true),
        fitMode: 'cover',
      },
    }),
    expects: {
      what: 'a Vimeo link',
      hint: 'Copy it from the video’s Share button.',
      recognises: (b) => hostIsOneOf(builtWidgetUrl(b), ['vimeo.com']),
    },
    starterLayouts: [
      {
        id: 'full-bleed-titled',
        name: 'Full-bleed + branded title',
        zones: [
          { x: 0, y: 0, width: 100, height: 88, zIndex: 1, defaultConfig: {} },
          titleBarZone('Now Playing', { x: 0, y: 88, width: 100, height: 12 }),
        ],
      },
      {
        id: 'lower-third-clock',
        name: 'Video + clock rail',
        zones: [
          { x: 0, y: 0, width: 78, height: 100, zIndex: 1, defaultConfig: {} },
          accentStripZone({ x: 78, y: 0, width: 1, height: 100 }),
          cornerClockZone({ x: 80, y: 4, width: 18, height: 14 }),
          titleBarZone('Featured', { x: 80, y: 20, width: 18, height: 10 }),
        ],
      },
    ],
  },
  {
    id: 'twitch',
    name: 'Twitch',
    icon: 'Radio',
    category: 'video',
    frictionTier: 'instant',
    blurb: 'Embed a live Twitch channel. Free official player.',
    setupNote: 'Just enter your channel name below — we automatically set everything else up so it works in both the preview here and on your live screen.',
    taurusNote: 'This may run heavy on older LED wall controllers — worth double-checking on your actual screen before a permanent install.',
    defaultSize: { w: 60, h: 45 },
    configSchema: [
      { key: 'channel', label: 'Twitch channel', type: 'text', placeholder: 'twitch.tv/yourchannel or just yourchannel', required: true },
      { key: 'muted', label: 'Muted (recommended for signage)', type: 'checkbox', defaultValue: true },
    ],
    build: (v) => ({
      widgetType: 'STREAMING',
      defaultConfig: {
        channelTitle: 'Twitch',
        embedUrl: toTwitchCanonicalUrl(str(v, 'channel')),
        playbackType: 'iframe',
        muted: bool(v, 'muted', true),
        fitMode: 'cover',
      },
    }),
    expects: {
      what: 'a Twitch channel',
      hint: 'Use just the channel name, like yourchannel.',
      recognises: (b) => hostIsOneOf(builtWidgetUrl(b), ['twitch.tv']),
    },
  },

  // ── DOCS & SLIDES ──────────────────────────────────────────────────
  {
    id: 'google-slides',
    name: 'Google Slides',
    icon: 'Presentation',
    category: 'docs',
    frictionTier: 'instant',
    blurb: 'Auto-advancing slideshow from a published Google Slides deck. The #1 signage app.',
    setupSteps: [
      'In your Slides deck, click File → Share → Publish to web.',
      'Click Publish, then copy the link it gives you.',
      'Paste that link below (or your normal Slides link — we’ll convert it).',
    ],
    helpUrl: 'https://slides.google.com',
    publicExposureWarning: 'Heads up — publishing makes this deck viewable by anyone with the link, not just your screens.',
    defaultSize: { w: 60, h: 55 },
    configSchema: [
      { key: 'url', label: 'Your Google Slides link', type: 'url', placeholder: 'https://docs.google.com/presentation/d/.../edit', required: true },
      { key: 'delaySeconds', label: 'Seconds per slide', type: 'number', defaultValue: 5, placeholder: '5' },
      { key: 'loop', label: 'Loop the deck', type: 'checkbox', defaultValue: true },
    ],
    build: (v) => ({
      widgetType: 'WEBPAGE',
      defaultConfig: {
        url: toGoogleSlidesEmbedUrl(str(v, 'url'), { loop: bool(v, 'loop', true), delayMs: num(v, 'delaySeconds', 5) * 1000 }),
        staticMode: true, // publish-to-web embeds are plain iframes; skip the interactive JS pass-through
      },
    }),
    // `/embed` only appears when toGoogleSlidesEmbedUrl actually matched a
    // deck id — its no-match branch returns the paste untouched, which is
    // precisely the case that must not reach the canvas.
    expects: {
      what: 'a Google Slides link',
      hint: 'It should contain /presentation/ — copy it from File → Share → Publish to web.',
      recognises: (b) => {
        const u = builtWidgetUrl(b);
        return hostIsOneOf(u, ['docs.google.com']) && u.includes('/presentation/d/') && u.includes('/embed');
      },
    },
    starterLayouts: [
      {
        id: 'full-bleed-titled',
        name: 'Full-bleed deck + branded title',
        zones: [
          { x: 0, y: 0, width: 100, height: 90, zIndex: 1, defaultConfig: {} },
          titleBarZone('Today at a Glance', { x: 0, y: 90, width: 100, height: 10 }),
        ],
      },
      {
        id: 'deck-clock-weather-rail',
        name: 'Deck + clock & weather rail',
        zones: [
          { x: 0, y: 0, width: 74, height: 100, zIndex: 1, defaultConfig: {} },
          accentStripZone({ x: 74, y: 0, width: 1, height: 100 }),
          cornerClockZone({ x: 76, y: 4, width: 22, height: 16 }),
          { widgetType: 'WEATHER', x: 76, y: 22, width: 22, height: 20, zIndex: 5, defaultConfig: {} },
        ],
      },
    ],
  },
  {
    id: 'powerpoint-onedrive',
    name: 'PowerPoint / OneDrive',
    icon: 'FileText',
    category: 'docs',
    frictionTier: 'instant',
    blurb: 'Embed a PowerPoint deck hosted on OneDrive/SharePoint via Office for the web.',
    setupSteps: [
      'Open your deck in PowerPoint for the web.',
      'Click File → Share → Embed.',
      'Copy the link it gives you (or the whole box of code — we’ll pull the link out of it) and paste it below.',
    ],
    publicExposureWarning: 'Heads up — embedding makes this deck viewable by anyone with the link, not just your screens.',
    defaultSize: { w: 60, h: 55 },
    configSchema: [
      { key: 'url', label: 'Your PowerPoint share link', type: 'url', placeholder: 'Paste the link (or the whole embed snippet) from PowerPoint’s Share button', required: true },
    ],
    build: (v) => ({
      widgetType: 'WEBPAGE',
      defaultConfig: { url: extractIframeSrc(str(v, 'url')), staticMode: true },
    }),
    expects: {
      what: 'a PowerPoint share link',
      hint: 'Copy it from File → Share → Embed in PowerPoint for the web.',
      recognises: (b) => hostIsOneOf(builtWidgetUrl(b), [
        'sharepoint.com', 'onedrive.live.com', '1drv.ms',
        'officeapps.live.com', 'office.com', 'office.net',
      ]),
    },
  },
  {
    id: 'canva',
    name: 'Canva',
    icon: 'Palette',
    category: 'docs',
    frictionTier: 'instant',
    blurb: 'Embed a Canva design that auto-updates whenever you edit it in Canva.',
    setupSteps: [
      'Open your design in Canva.',
      'Click Share, then turn on "Anyone with the link" (set to view).',
      'Copy that link and paste it below.',
    ],
    helpUrl: 'https://www.canva.com',
    publicExposureWarning: 'Heads up — sharing makes this design viewable by anyone with the link, not just your screens.',
    defaultSize: { w: 60, h: 55 },
    configSchema: [
      { key: 'url', label: 'Your Canva share link', type: 'url', placeholder: 'https://www.canva.com/design/.../view', required: true },
    ],
    build: (v) => ({
      widgetType: 'WEBPAGE',
      defaultConfig: { url: toCanvaEmbedUrl(str(v, 'url')) },
    }),
    expects: {
      what: 'a Canva share link',
      hint: 'Copy it from Canva’s Share button.',
      recognises: (b) => hostIsOneOf(builtWidgetUrl(b), ['canva.com', 'canva.site']),
    },
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    icon: 'Table',
    category: 'data',
    frictionTier: 'instant',
    blurb: 'Show a live spreadsheet — great for a schedule, roster, or price list a non-technical staffer can edit.',
    setupSteps: [
      'In your spreadsheet, click File → Share → Publish to web.',
      'Choose the sheet/tab you want to show, then click Publish.',
      'Paste that link below (or your normal Sheets link — we’ll convert it).',
    ],
    helpUrl: 'https://sheets.google.com',
    publicExposureWarning: 'Heads up — publishing makes this sheet viewable by anyone with the link, not just your screens.',
    defaultSize: { w: 60, h: 55 },
    configSchema: [
      { key: 'url', label: 'Your Google Sheets link', type: 'url', placeholder: 'https://docs.google.com/spreadsheets/d/.../edit', required: true },
    ],
    build: (v) => ({
      widgetType: 'WEBPAGE',
      defaultConfig: { url: toGoogleSheetsEmbedUrl(str(v, 'url')), staticMode: true },
    }),
    expects: {
      what: 'a Google Sheets link',
      hint: 'It should contain /spreadsheets/ — copy it from File → Share → Publish to web.',
      recognises: (b) => {
        const u = builtWidgetUrl(b);
        // The already-published forms (/pubhtml, output=html) are returned
        // untouched by the transform, so accept them on any Google host.
        return hostIsOneOf(u, ['google.com']) && (u.includes('/spreadsheets/d/') || u.includes('/pubhtml') || u.includes('output=html'));
      },
    },
    starterLayouts: [
      {
        id: 'full-bleed-titled',
        name: 'Full-bleed sheet + branded title',
        zones: [
          titleBarZone('Today’s Schedule', { x: 0, y: 0, width: 100, height: 10 }),
          { x: 0, y: 10, width: 100, height: 90, zIndex: 1, defaultConfig: {} },
        ],
      },
      {
        id: 'sheet-clock-corner',
        name: 'Sheet + corner clock',
        zones: [
          { x: 0, y: 0, width: 82, height: 100, zIndex: 1, defaultConfig: {} },
          accentStripZone({ x: 82, y: 0, width: 1, height: 100 }),
          cornerClockZone({ x: 84, y: 4, width: 14, height: 12 }),
        ],
      },
    ],
  },

  // ── UTILITY ────────────────────────────────────────────────────────
  {
    id: 'web-url',
    name: 'Web Page / URL',
    icon: 'Globe',
    category: 'utility',
    frictionTier: 'instant',
    blurb: 'Show any website, live and interactive, on screen.',
    publicExposureWarning: 'Heads up — this page becomes visible on every screen it’s added to. Don’t use this for anything with private/internal data.',
    defaultSize: { w: 60, h: 55 },
    configSchema: [
      { key: 'url', label: 'Web page link', type: 'url', placeholder: 'https://example.com', required: true },
      { key: 'refreshMinutes', label: 'Refresh the page every (minutes, 0 = never)', type: 'number', defaultValue: 0, placeholder: '0' },
    ],
    build: (v) => ({
      widgetType: 'WEBPAGE',
      defaultConfig: {
        url: ensureHttps(str(v, 'url')),
        refreshIntervalMs: Math.max(0, num(v, 'refreshMinutes', 0)) * 60_000,
      },
    }),
    // No `recognises` — any host is legitimate here. The generic WEBPAGE
    // URL check in buildApp() is the whole gate, and it is what stops
    // `not a valid url` from becoming `https://not a valid url`.
    expects: {
      what: 'a web address',
      hint: 'It needs a full domain, like example.com.',
    },
    starterLayouts: [
      {
        id: 'full-bleed-titled',
        name: 'Full-bleed page + branded title',
        zones: [
          { x: 0, y: 0, width: 100, height: 90, zIndex: 1, defaultConfig: {} },
          titleBarZone('On Screen', { x: 0, y: 90, width: 100, height: 10 }),
        ],
      },
      {
        id: 'page-clock-corner',
        name: 'Page + corner clock',
        zones: [
          { x: 0, y: 0, width: 82, height: 100, zIndex: 1, defaultConfig: {} },
          accentStripZone({ x: 82, y: 0, width: 1, height: 100 }),
          cornerClockZone({ x: 84, y: 4, width: 14, height: 12 }),
        ],
      },
    ],
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    icon: 'MapPin',
    category: 'utility',
    frictionTier: 'instant',
    blurb: 'Show a map — directions to your venue, a campus map pin, or a traffic view.',
    defaultSize: { w: 45, h: 35 },
    configSchema: [
      { key: 'query', label: 'Address or place name', type: 'text', placeholder: '123 Main St, Springfield, or "Springfield High School"', required: true },
    ],
    build: (v) => ({
      widgetType: 'WEBPAGE',
      defaultConfig: { url: toGoogleMapsEmbedUrl(str(v, 'query')), staticMode: true },
    }),
    starterLayouts: [
      {
        id: 'map-titled',
        name: 'Map + branded title',
        zones: [
          titleBarZone('Find Us', { x: 0, y: 0, width: 100, height: 12 }),
          { x: 0, y: 12, width: 100, height: 88, zIndex: 1, defaultConfig: {} },
        ],
      },
      {
        id: 'map-clock-corner',
        name: 'Map + corner clock',
        zones: [
          { x: 0, y: 0, width: 78, height: 100, zIndex: 1, defaultConfig: {} },
          accentStripZone({ x: 78, y: 0, width: 1, height: 100 }),
          cornerClockZone({ x: 80, y: 4, width: 18, height: 16 }),
        ],
      },
    ],
  },
  {
    id: 'qr-code',
    name: 'QR Code',
    icon: 'QrCode',
    category: 'utility',
    frictionTier: 'instant',
    blurb: 'A real, scannable QR code — no external service, generated on-device.',
    defaultSize: { w: 15, h: 15 },
    configSchema: [
      { key: 'text', label: 'Link or text to encode', type: 'text', placeholder: 'https://example.com', required: true },
    ],
    // Rides the EXISTING TOUCH_POINT 'qr' variant (WidgetRenderer.tsx
    // QrCodeVariant) which already generates a real client-side SVG/canvas
    // QR via the bundled `qrcode` package — no new widget code needed for
    // this app. See CLAUDE.md rule #9: verified this variant is actually
    // reachable (TOUCH_POINT case in WidgetRenderer's switch, dispatched by
    // config.variant) before wiring the app to it.
    build: (v) => ({
      widgetType: 'TOUCH_POINT',
      defaultConfig: { variant: 'qr', qrText: str(v, 'text') },
    }),
    starterLayouts: [
      {
        id: 'centered-poster',
        name: 'Centered QR poster',
        zones: [
          titleBarZone('Scan Me', { x: 25, y: 12, width: 50, height: 10 }),
          { x: 35, y: 26, width: 30, height: 48, zIndex: 5, defaultConfig: {} },
          accentStripZone({ x: 25, y: 78, width: 50, height: 2 }),
        ],
      },
      {
        id: 'corner-badge',
        name: 'QR corner badge + headline',
        zones: [
          titleBarZone('Scan for More', { x: 0, y: 0, width: 78, height: 100 }),
          { x: 80, y: 62, width: 18, height: 32, zIndex: 5, defaultConfig: {} },
        ],
      },
    ],
  },
  {
    id: 'clock',
    name: 'Clock',
    icon: 'Clock',
    category: 'utility',
    frictionTier: 'instant',
    blurb: 'A live clock — pick a timezone and 12/24-hour format.',
    defaultSize: { w: 28, h: 22 },
    configSchema: [
      { key: 'timezone', label: 'Timezone (leave blank for the screen’s local time)', type: 'text', placeholder: 'America/Chicago' },
      { key: 'format', label: 'Time format', type: 'select', options: [{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }], defaultValue: '12h' },
    ],
    build: (v) => ({
      widgetType: 'CLOCK',
      defaultConfig: {
        timezone: str(v, 'timezone') || undefined,
        format: str(v, 'format', '12h'),
      },
    }),
  },
  {
    id: 'countdown',
    name: 'Countdown',
    icon: 'Timer',
    category: 'utility',
    frictionTier: 'instant',
    blurb: 'Count down to a date — a game, a break, an event, a deadline.',
    defaultSize: { w: 28, h: 22 },
    configSchema: [
      { key: 'label', label: 'Label', type: 'text', placeholder: 'Days Until Winter Break', defaultValue: 'Days Remaining' },
      { key: 'targetDate', label: 'Count down to', type: 'date', required: true },
    ],
    build: (v) => ({
      widgetType: 'COUNTDOWN',
      defaultConfig: {
        label: str(v, 'label', 'Days Remaining'),
        targetDate: str(v, 'targetDate'),
      },
    }),
    starterLayouts: [
      {
        id: 'centered-hero',
        name: 'Centered countdown hero',
        zones: [
          titleBarZone('Coming Up', { x: 20, y: 16, width: 60, height: 12 }),
          { x: 15, y: 32, width: 70, height: 46, zIndex: 5, defaultConfig: {} },
          accentStripZone({ x: 20, y: 80, width: 60, height: 2 }),
        ],
      },
      {
        id: 'countdown-clock-split',
        name: 'Countdown + clock split',
        zones: [
          { x: 4, y: 20, width: 44, height: 60, zIndex: 5, defaultConfig: {} },
          accentStripZone({ x: 50, y: 15, width: 1, height: 70 }),
          cornerClockZone({ x: 56, y: 30, width: 40, height: 30 }),
        ],
      },
    ],
  },

  // ── WEATHER ────────────────────────────────────────────────────────
  {
    id: 'weather',
    name: 'Weather',
    icon: 'Cloud',
    category: 'weather',
    frictionTier: 'instant',
    blurb: 'Live current-conditions weather — free, no API key (Open-Meteo).',
    defaultSize: { w: 28, h: 22 },
    configSchema: [
      { key: 'location', label: 'City or ZIP code', type: 'text', placeholder: 'Springfield, IL or 62704', help: 'You can also paste exact coordinates as "lat,lng" if you have them.', required: true },
      { key: 'units', label: 'Units', type: 'select', options: [{ value: 'imperial', label: 'Fahrenheit' }, { value: 'metric', label: 'Celsius' }], defaultValue: 'imperial' },
    ],
    build: (v) => ({
      widgetType: 'WEATHER',
      defaultConfig: {
        location: str(v, 'location'),
        units: str(v, 'units', 'imperial'),
      },
    }),
    starterLayouts: [
      {
        id: 'weather-clock-titled',
        name: 'Weather + clock + branded title',
        zones: [
          titleBarZone('Today’s Forecast', { x: 0, y: 0, width: 100, height: 14 }),
          { x: 4, y: 18, width: 44, height: 60, zIndex: 5, defaultConfig: {} },
          accentStripZone({ x: 50, y: 18, width: 1, height: 60 }),
          cornerClockZone({ x: 56, y: 30, width: 40, height: 36 }),
        ],
      },
      {
        id: 'weather-corner-badge',
        name: 'Weather corner badge',
        zones: [
          { x: 74, y: 4, width: 22, height: 26, zIndex: 5, defaultConfig: {} },
        ],
      },
    ],
  },

  // ── NEWS ───────────────────────────────────────────────────────────
  {
    id: 'news-rss',
    name: 'News / RSS',
    icon: 'Rss',
    category: 'news',
    frictionTier: 'instant',
    blurb: 'Live scrolling headlines from any public RSS/Atom feed.',
    // LIVE as of 2026-07-01 (launch sprint): the feeds backend
    // (apps/api/src/feeds/ — SSRF-guarded fetch+parse, Redis-cached 5 min so
    // a 150-screen fleet hits the origin once per window) + RSSWidget's real
    // fetch via useLiveRssFeed landed together, so this tile went from the
    // honest comingSoon placeholder to genuinely instant. Every board built
    // while it was coming-soon starts showing real headlines with zero
    // migration — the feedUrl wiring below was correct all along.
    configSchema: [
      { key: 'feedUrl', label: 'Your news feed link (RSS/Atom)', type: 'url', placeholder: 'https://example.com/feed.xml', required: true },
      { key: 'maxItems', label: 'Headlines to show', type: 'number', defaultValue: 5, placeholder: '5' },
    ],
    build: (v) => ({
      widgetType: 'RSS_FEED',
      defaultConfig: {
        feedUrl: str(v, 'feedUrl'),
        maxItems: num(v, 'maxItems', 5),
      },
    }),
    expects: {
      what: 'a news feed link',
      hint: 'A feed address usually ends in /feed, /rss, or .xml.',
    },
  },

  // ── CALENDAR ───────────────────────────────────────────────────────
  {
    id: 'calendar',
    name: 'Calendar',
    icon: 'CalendarDays',
    category: 'calendar',
    frictionTier: 'instant',
    blurb: 'Upcoming events from your Google Calendar, live on screen.',
    // World-class build (2026-07-01) — HONESTY workstream. The CALENDAR
    // widget only ever renders a manually-entered `cfg.events` list and
    // never fetches an ICS feed (confirmed against WidgetRenderer.tsx) —
    // shipping this as an "Instant" tile wired to a feedUrl field would be
    // the same silent-break trap as News/RSS. Google Calendar's own public
    // "Embed code" HTML view is real, live, and works TODAY: route this
    // app through WEBPAGE (same widget/proxy path as every other Docs app)
    // instead of the CALENDAR widget, so what the operator sees in preview
    // is exactly what ships — genuinely working, not a costume.
    setupSteps: [
      'In Google Calendar, click the gear icon → Settings.',
      'Under "Settings for my calendars," pick the calendar to show.',
      'Scroll to "Integrate calendar" and copy the "Public URL" (or the Embed code — either works).',
      'Paste that link below.',
    ],
    helpUrl: 'https://calendar.google.com',
    publicExposureWarning: 'Heads up — this makes your calendar’s events viewable by anyone with the link, not just your screens.',
    defaultSize: { w: 45, h: 55 },
    configSchema: [
      { key: 'url', label: 'Your Google Calendar link', type: 'url', placeholder: 'Paste your calendar’s Public URL or Embed link', required: true },
    ],
    build: (v) => ({
      widgetType: 'WEBPAGE',
      defaultConfig: { url: toGoogleCalendarEmbedUrl(str(v, 'url')), staticMode: true },
    }),
    // toGoogleCalendarEmbedUrl passes an unrecognised paste through AND can
    // THROW on a malformed-percent-encoded ical id (decodeURIComponent) —
    // buildApp() turns both into this sentence instead of an empty zone.
    expects: {
      what: 'a Google Calendar link',
      hint: 'Copy the Public URL from Settings → Integrate calendar.',
      recognises: (b) => {
        const parsed = parseWebUrl(builtWidgetUrl(b));
        return !!parsed
          && hostIsOneOf(parsed.href, ['calendar.google.com'])
          && parsed.pathname.startsWith('/calendar/embed');
      },
    },
  },

  // ── STUBS / not-yet-buildable-honestly (synthesis §1: native embeds are
  // dead for these networks in 2026; shipping them as silent-break tiles
  // is the exact anti-pattern we're avoiding). Tagged comingSoon so the
  // picker shows them as "Powered by our Social Wall (coming soon)" —
  // visible for discoverability, never clickable-but-broken. ──────────
  {
    id: 'facebook-page',
    name: 'Facebook Page',
    icon: 'Users',
    category: 'social',
    frictionTier: 'aggregator',
    blurb: 'Show your Facebook Page’s posts. Still has a free official embed as of 2026.',
    comingSoon: true,
    configSchema: [],
    build: () => ({ widgetType: 'SOCIAL_FEED', defaultConfig: {} }),
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: 'ThumbsUp',
    category: 'social',
    frictionTier: 'aggregator',
    blurb: 'Instagram’s free embed API shut down in Dec 2024 — this needs a social-wall aggregator.',
    comingSoon: true,
    configSchema: [],
    build: () => ({ widgetType: 'SOCIAL_FEED', defaultConfig: {} }),
  },
  // ── Social Wall is NOT a stub any more (2026-09-12). A moderated
  // multi-network wall is a product operators buy (Walls.io, Juicer,
  // Taggbox); our honest job is to put THAT wall on the screen, not to
  // rebuild a feed Instagram stopped letting anyone embed in Dec 2024. So
  // this app rides the WEBPAGE widget, exactly like Canva and Slides, and
  // the only thing it needs from the operator is the wall's link.
  {
    id: 'social-wall',
    name: 'Social Wall (multi-network)',
    icon: 'LayoutGrid',
    category: 'social',
    frictionTier: 'aggregator',
    blurb: 'Put your Walls.io, Juicer or Taggbox wall on the screen — you need a wall with one of those services first.',
    setupSteps: [
      'Build your wall in Walls.io, Juicer or Taggbox (they gather Instagram, Facebook, X and TikTok into one moderated feed).',
      'Open its embed screen — Walls.io calls it “Embed & Display”, Juicer and Taggbox call it “Embed”.',
      'Paste the link, or the whole embed snippet, below. We’ll pull the link out of it.',
    ],
    helpUrl: 'https://walls.io',
    publicExposureWarning: 'Heads up — whatever your wall shows, your screens show. Keep its moderation on.',
    defaultSize: { w: 45, h: 70 },
    configSchema: [
      {
        key: 'url',
        label: 'Your social wall link',
        type: 'url',
        placeholder: 'https://my.walls.io/your-wall',
        help: 'Works with Walls.io, Juicer and Taggbox — paste the link or the whole embed snippet.',
        required: true,
      },
    ],
    // Interactive (staticMode:false) because a wall is a live JS app: it
    // polls for new posts and animates between them. The strip-scripts
    // static path would freeze it on whatever posts loaded first — the same
    // reason the Web Page app defaults to interactive (see WidgetRenderer's
    // `interactiveMode` comment). `refreshIntervalMs` — NOT `refreshMinutes`,
    // which is a FORM-FIELD key, not a widget key — reloads the frame every
    // 15 minutes so a wall whose own poller has died still recovers.
    build: (v) => ({
      widgetType: 'WEBPAGE',
      defaultConfig: {
        url: toSocialWallEmbedUrl(str(v, 'url')) ?? '',
        staticMode: false,
        refreshIntervalMs: 15 * 60_000,
      },
    }),
    expects: {
      what: 'a Walls.io, Juicer or Taggbox wall link',
      hint: 'Copy it from your wall’s embed screen.',
      recognises: (b) => isSocialWallEmbedUrl(builtWidgetUrl(b)),
      // Curator.io is a real, popular wall that simply cannot be framed —
      // say that, instead of sending the operator back to re-copy a link
      // that was right all along.
      explain: (v) => scriptOnlyWallReason(str(v, 'url')) ?? undefined,
    },
  },

  /**
   * Google Reviews — REAL as of 2026-09-12, which is why it sits BELOW the
   * `comingSoon` block above rather than inside it.
   *
   * It used to be a stub: `comingSoon: true`, an empty `configSchema`, and a
   * `build()` that returned an EMPTY `SOCIAL_FEED` config — a tile that looked
   * like a feature and produced a blank zone. It is now backed by Places API
   * (New) through `/api/v1/integrations/google-reviews/*`, where the Google
   * key stays server-side.
   *
   * FRICTION TIER `login`, not `instant`: nothing here works until someone
   * with access to the tenant's Google Cloud project enables **Places API
   * (New)** on the `GOOGLE_MAPS_API_KEY` this deploy already uses for address
   * lookup. The config form says so in place of the search box when the API
   * reports `enabled: false`, so the operator learns that from the product
   * rather than from an empty result list.
   *
   * `placeId` is NOT free text and has no keyboard path on purpose — it is an
   * opaque Google token. The `google-place` field type renders a search box
   * that calls the API's Text Search and writes BOTH `placeId` and
   * `placeName` when the operator picks a row. Storing the place id is also
   * the one Places value Google's policies exempt from the caching
   * restrictions outright ("You can therefore store place ID values
   * indefinitely"), which is why it is the only Places data this product
   * persists.
   */
  {
    id: 'google-reviews',
    name: 'Google Reviews',
    icon: 'Star',
    category: 'reviews',
    frictionTier: 'login',
    blurb: 'Your Google star rating and reviews, straight from your Business Profile.',
    setupNote:
      'Your admin needs a Google Maps API key with “Places API (New)” enabled — the same key this app already uses for address lookup. Once it is on, search for your business below and pick it.',
    helpUrl: 'https://console.cloud.google.com/apis/library/places.googleapis.com',
    defaultSize: { w: 34, h: 52 },
    configSchema: [
      {
        key: 'placeId',
        label: 'Your business',
        type: 'google-place',
        placeholder: 'Search your business name and city',
        help: 'Pick your business from Google so the reviews shown are really yours.',
      },
      {
        key: 'maxItems',
        label: 'How many reviews to show',
        type: 'number',
        defaultValue: 3,
        help: 'Google returns at most five.',
      },
      {
        key: 'minRating',
        label: 'Only show reviews of this many stars or more',
        type: 'number',
        defaultValue: 4,
        help: '0 shows every review Google returns.',
      },
      {
        key: 'layout',
        label: 'Layout',
        type: 'select',
        defaultValue: 'carousel',
        options: [
          { value: 'carousel', label: 'One at a time (rotates)' },
          { value: 'list', label: 'Stacked list' },
        ],
      },
    ],
    build: (v) => ({
      widgetType: 'GOOGLE_REVIEWS',
      defaultConfig: {
        placeId: str(v, 'placeId').trim(),
        placeName: str(v, 'placeName').trim(),
        maxItems: Math.max(1, Math.min(5, Math.round(num(v, 'maxItems', 3)))),
        minRating: Math.max(0, Math.min(5, Math.round(num(v, 'minRating', 4)))),
        layout: str(v, 'layout') === 'list' ? 'list' : 'carousel',
      },
    }),
    // Without a business there is nothing to fetch, and the widget would land on
    // the canvas as an empty zone — the exact M6-1 defect. A place id is an
    // opaque `[A-Za-z0-9_-]` token, so "did they actually pick one?" is a check
    // the gate can make with certainty.
    expects: {
      what: 'a business picked from Google',
      hint: 'Search for yours above and pick it from the list first.',
      recognises: (b) => {
        const id = b.defaultConfig.placeId;
        return typeof id === 'string' && /^[A-Za-z0-9_-]{5,512}$/.test(id);
      },
    },
  },
];

export function getApp(id: string): AppDefinition | undefined {
  return APP_REGISTRY.find((a) => a.id === id);
}

export function listApps(opts?: { category?: AppCategory; search?: string; includeComingSoon?: boolean }): AppDefinition[] {
  let list = APP_REGISTRY.slice();
  // Default (undefined) still SHOWS coming-soon tiles — discoverability +
  // honesty per synthesis §4.1, and the picker renders them with a grey
  // "Soon" badge that cannot be clicked into a zone. An EXPLICIT `false`
  // hides them, for a caller that is listing apps an operator could
  // actually add right now.
  //
  // 2026-09-12: this was an EMPTY `if (!opts?.includeComingSoon) { }` whose
  // own comment said "kept as a no-op today" — so the parameter had no
  // effect in either direction, and `includeComingSoon:false` returned the
  // coming-soon apps anyway. Note the `=== false`: `!opts?.includeComingSoon`
  // was also the wrong TEST, since it cannot tell "unset" from "false".
  if (opts?.includeComingSoon === false) {
    list = list.filter((a) => !a.comingSoon);
  }
  if (opts?.category) list = list.filter((a) => a.category === opts.category);
  if (opts?.search?.trim()) {
    const q = opts.search.trim().toLowerCase();
    list = list.filter((a) => a.name.toLowerCase().includes(q) || a.blurb.toLowerCase().includes(q));
  }
  return list;
}

export function listAppCategories(): AppCategory[] {
  const seen = new Set<AppCategory>();
  for (const a of APP_REGISTRY) seen.add(a.category);
  return Array.from(seen);
}
