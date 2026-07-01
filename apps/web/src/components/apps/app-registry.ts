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
} from './url-transforms';

/** How much friction the operator has to go through before this app "just works." */
export type FrictionTier = 'instant' | 'login' | 'aggregator';

export const FRICTION_TIER_LABEL: Record<FrictionTier, string> = {
  instant: 'Instant · no login',
  login: 'Needs a business login',
  aggregator: 'Powered by an aggregator',
};

export type AppFieldType = 'text' | 'url' | 'textarea' | 'select' | 'checkbox' | 'number' | 'date';

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

export interface AppBuildResult {
  widgetType: string;
  defaultConfig: Record<string, unknown>;
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
  /** Pure function: operator's form values -> a standard zone config. Must not throw — return a safe empty-ish config on bad input, the form validates required fields before allowing confirm. */
  build: (values: Record<string, string>) => AppBuildResult;
  /** True for apps that are honestly not buildable yet in Phase 1 (native social embeds are dead — see synthesis §1). Rendered as a disabled/"coming via Social Wall" tile, never a silently-broken one. */
  comingSoon?: boolean;
  /** Taurus/Chromium-83 LED note. Every app rides an existing widget so none of these need new player code, but some upstream iframes (Twitch, heavy JS embeds) are known to be flaky on old WebViews. */
  taurusNote?: string;
  /** Percent-of-canvas size hint applied when this app lands a fresh zone
   *  (see AppDefaultSize doc comment). Falls back to a widgetType-keyed
   *  default in useBuilderStore.addZone when omitted. */
  defaultSize?: AppDefaultSize;
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
  },

  // ── NEWS ───────────────────────────────────────────────────────────
  {
    id: 'news-rss',
    name: 'News / RSS',
    icon: 'Rss',
    category: 'news',
    frictionTier: 'instant',
    blurb: 'A scrolling headline feed from any public RSS/Atom feed. Coming soon.',
    // World-class build (2026-07-01) — HONESTY workstream: RSSWidget
    // (apps/web/src/components/widgets/WidgetRenderer.tsx ~line 3998)
    // renders 5 HARDCODED placeholder headlines and never fetches
    // config.feedUrl. Shipping this as a clickable "Instant" tile is
    // exactly the silent-break-tile anti-pattern CLAUDE.md's Standard
    // Audit Surface and the App Library synthesis both call out — an
    // operator would paste their real feed, see plausible fake headlines
    // in preview, ship it, and their screen shows fiction forever.
    // Retiered comingSoon:true (matches the honest pattern already used
    // for facebook-page/instagram/social-wall/google-reviews below) until
    // a real SSRF-guarded backend fetch+parse lands — see TODO(lead) note
    // on the `build()` below for the wiring that's already correct and
    // ready to light up the moment the widget gets its real fetch.
    comingSoon: true,
    configSchema: [
      { key: 'feedUrl', label: 'Your news feed link (RSS/Atom)', type: 'url', placeholder: 'https://example.com/feed.xml', required: true },
      { key: 'maxItems', label: 'Headlines to show', type: 'number', defaultValue: 5, placeholder: '5' },
    ],
    // TODO(lead): this wires the feed URL into the zone config correctly
    // (RSS_FEED zone + feedUrl) — the MOMENT RSSWidget is upgraded to
    // actually fetch+parse a real feed, flip comingSoon back to false/
    // remove it and every board built with this app starts showing real
    // headlines with zero migration. Needs a backend XML-fetch+parse
    // endpoint (SSRF-guarded, like /proxy/web) or a keyless RSS-to-JSON
    // service; out of scope for this pass per the "don't touch
    // WidgetRenderer" constraint.
    build: (v) => ({
      widgetType: 'RSS_FEED',
      defaultConfig: {
        feedUrl: str(v, 'feedUrl'),
        maxItems: num(v, 'maxItems', 5),
      },
    }),
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
  {
    id: 'social-wall',
    name: 'Social Wall (multi-network)',
    icon: 'LayoutGrid',
    category: 'social',
    frictionTier: 'aggregator',
    blurb: 'One feed combining Instagram, Facebook, X, and TikTok via an aggregator (Walls.io / EmbedSocial). Phase 2.',
    comingSoon: true,
    configSchema: [],
    build: () => ({ widgetType: 'SOCIAL_FEED', defaultConfig: {} }),
  },
  {
    id: 'google-reviews',
    name: 'Google Reviews',
    icon: 'Star',
    category: 'reviews',
    frictionTier: 'login',
    blurb: 'Show your latest Google reviews and star rating. Phase 2 (needs Places API key).',
    comingSoon: true,
    configSchema: [],
    build: () => ({ widgetType: 'SOCIAL_FEED', defaultConfig: {} }),
  },
];

export function getApp(id: string): AppDefinition | undefined {
  return APP_REGISTRY.find((a) => a.id === id);
}

export function listApps(opts?: { category?: AppCategory; search?: string; includeComingSoon?: boolean }): AppDefinition[] {
  let list = APP_REGISTRY.slice();
  if (!opts?.includeComingSoon) {
    // Default view still SHOWS coming-soon tiles (discoverability + honesty
    // per synthesis §4.1) — callers that truly want to hide them can pass
    // includeComingSoon:false explicitly. Kept as a no-op today so the
    // default listApps() always returns everything; the flag exists for
    // the config-form confirm path which should never let a comingSoon
    // app be "built."
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
