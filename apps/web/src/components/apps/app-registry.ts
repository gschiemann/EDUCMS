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

export type AppFieldType = 'text' | 'url' | 'textarea' | 'select' | 'checkbox' | 'number';

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
  /** Longer copy shown in the config-form header — sets expectations (publish-to-web warning, login requirement, etc). */
  setupNote?: string;
  configSchema: AppFieldSchema[];
  /** Pure function: operator's form values -> a standard zone config. Must not throw — return a safe empty-ish config on bad input, the form validates required fields before allowing confirm. */
  build: (values: Record<string, string>) => AppBuildResult;
  /** True for apps that are honestly not buildable yet in Phase 1 (native social embeds are dead — see synthesis §1). Rendered as a disabled/"coming via Social Wall" tile, never a silently-broken one. */
  comingSoon?: boolean;
  /** Taurus/Chromium-83 LED note. Every app rides an existing widget so none of these need new player code, but some upstream iframes (Twitch, heavy JS embeds) are known to be flaky on old WebViews. */
  taurusNote?: string;
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
    setupNote: 'Twitch’s embed needs the exact domain it runs on (the "parent" param) — the widget fills this in automatically from the current page, so it works in both the builder preview and on the live screen.',
    taurusNote: 'Twitch’s embed is JS-heavy; verify on the target LED controller before relying on it for a permanent install.',
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
    setupNote: 'In Slides: File → Share → Publish to web, then paste the link it gives you (or your normal edit link — we’ll convert it). Publishing makes the deck viewable by anyone with the embed link.',
    configSchema: [
      { key: 'url', label: 'Google Slides link', type: 'url', placeholder: 'https://docs.google.com/presentation/d/.../edit', required: true },
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
    setupNote: 'In PowerPoint for the web: File → Share → Embed, then paste the generated link (or the whole <iframe> snippet — we’ll pull the URL out of it).',
    configSchema: [
      { key: 'url', label: 'Office embed link', type: 'url', placeholder: 'https://onedrive.live.com/embed?... or a full <iframe> snippet', required: true },
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
    setupNote: 'In Canva: Share → "Anyone with the link" set to view access, then paste the share link here.',
    configSchema: [
      { key: 'url', label: 'Canva share link', type: 'url', placeholder: 'https://www.canva.com/design/.../view', required: true },
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
    setupNote: 'In Sheets: File → Share → Publish to web, choose the sheet/tab, then paste the link (or your normal edit link — we’ll convert it).',
    configSchema: [
      { key: 'url', label: 'Google Sheets link', type: 'url', placeholder: 'https://docs.google.com/spreadsheets/d/.../edit', required: true },
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
    setupNote: 'Works with almost any public site — the page becomes visible on every screen it’s added to. Don’t use this for anything with private/internal data.',
    configSchema: [
      { key: 'url', label: 'Web page URL', type: 'url', placeholder: 'https://example.com', required: true },
      { key: 'refreshMinutes', label: 'Auto-refresh every (minutes, 0 = never)', type: 'number', defaultValue: 0, placeholder: '0' },
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
    configSchema: [
      { key: 'timezone', label: 'Timezone (blank = screen’s local time)', type: 'text', placeholder: 'America/Chicago' },
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
    configSchema: [
      { key: 'label', label: 'Label', type: 'text', placeholder: 'Days Until Winter Break', defaultValue: 'Days Remaining' },
      { key: 'targetDate', label: 'Target date', type: 'text', placeholder: 'YYYY-MM-DD', required: true },
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
    configSchema: [
      { key: 'location', label: 'City, ZIP code, or "lat,lng"', type: 'text', placeholder: 'Springfield, IL or 62704', required: true },
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
    blurb: 'A scrolling headline feed from any public RSS/Atom feed.',
    // TODO(lead): RSSWidget (apps/web/src/components/widgets/WidgetRenderer.tsx
    // ~line 3998) currently renders 5 HARDCODED placeholder headlines — it
    // does not fetch config.feedUrl or any real feed. This app wires the
    // config field through correctly (RSS_FEED zone + feedUrl), so the
    // MOMENT the widget is upgraded to actually fetch+parse, every board
    // built with this app starts showing real headlines with zero
    // migration. Flagging here rather than silently shipping a "working"
    // app that's actually a stub — see CLAUDE.md rule on honest friction
    // tiers / no silently-broken tiles. Real implementation needs a
    // backend XML-fetch+parse endpoint (SSRF-guarded, like /proxy/web) or
    // a keyless RSS-to-JSON service; out of scope for this thin-wrapper
    // pass per the task's "don't touch WidgetRenderer" constraint.
    setupNote: 'Phase 1 note for the team: this app wires the feed URL into the zone config correctly, but the underlying News widget still needs its real fetch implementation — see TODO(lead) in app-registry.ts.',
    configSchema: [
      { key: 'feedUrl', label: 'RSS/Atom feed URL', type: 'url', placeholder: 'https://example.com/feed.xml', required: true },
      { key: 'maxItems', label: 'Headlines to show', type: 'number', defaultValue: 5, placeholder: '5' },
    ],
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
    blurb: 'Upcoming events from Google Calendar, Outlook, or any public iCal (.ics) feed.',
    setupNote: 'Paste your calendar’s public/secret iCal address (Google Calendar: Settings → [your calendar] → "Secret address in iCal format"; Outlook: Calendar → Share → Publish a calendar → ICS link).',
    configSchema: [
      { key: 'title', label: 'Title', type: 'text', placeholder: 'Upcoming Events', defaultValue: 'Upcoming Events' },
      { key: 'feedUrl', label: 'iCal (.ics) URL', type: 'url', placeholder: 'https://calendar.google.com/calendar/ical/.../basic.ics', required: true },
      { key: 'maxEvents', label: 'Events to show', type: 'number', defaultValue: 5, placeholder: '5' },
    ],
    // TODO(lead): same caveat as News/RSS — CalendarWidget renders
    // cfg.events (a manually-entered list) and has a `feedUrl` config field
    // already wired into PropertiesPanel (ListItemsEditor UI), but nothing
    // in WidgetRenderer actually fetches/parses that ICS feed today. This
    // app writes feedUrl correctly so it lights up the moment that gets
    // built. A calendar with a real published HTML view (Google Calendar's
    // "Embed code") could alternatively ride WEBPAGE today for a fully
    // working v1 — left as the lead's call since it changes the visual
    // (Google's own UI chrome) vs. our branded CALENDAR widget.
    build: (v) => ({
      widgetType: 'CALENDAR',
      defaultConfig: {
        title: str(v, 'title', 'Upcoming Events'),
        feedUrl: str(v, 'feedUrl'),
        maxEvents: num(v, 'maxEvents', 5),
      },
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
