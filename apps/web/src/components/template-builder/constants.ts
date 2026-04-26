import type { LucideIcon } from 'lucide-react';
import {
  Play, Image as ImageIcon, Globe, Type, Bell, Clock, Cloud, Timer,
  CalendarDays, Megaphone, UtensilsCrossed, Users, Rss, Share2, Shield,
  ArrowRight, Square, FileText, ListVideo,
  Cake,
} from 'lucide-react';
// The "School Life" (QUOTE / STATS / SCOREBOARD / MENU_ITEM /
// SCHEDULE_GRID / ATTENDANCE / BIRTHDAYS / HONOR_ROLL) and
// "Touch / Interactive" (TOUCH_BUTTON / TOUCH_MENU / ROOM_FINDER /
// ON_SCREEN_KEYBOARD / WAYFINDING_MAP / QUICK_POLL) groups plus the
// standalone ANIMATED_BACKGROUND widget have been temporarily hidden
// from the Add-Widget picker (2026-04-23 customer-readiness audit).
// Rationale: they had no corresponding editor in PropertiesPanel,
// so picking one left the operator with no way to configure it —
// violates the Integration Lead's "can't pick a widget you can't
// edit" rule. No existing preset references any of them (verified
// via grep), so hiding is a pure no-op for shipped content. Ship
// them back one at a time as their editor ships.

export const WIDGET_GROUPS = [
  {
    label: 'Media',
    types: [
      { type: 'VIDEO', label: 'Video Player', desc: 'Play a video file or stream', icon: Play },
      { type: 'IMAGE', label: 'Single Image', desc: 'Display a photo or graphic', icon: ImageIcon },
      { type: 'IMAGE_CAROUSEL', label: 'Photo Slideshow', desc: 'Rotate through photos', icon: ImageIcon },
      { type: 'PLAYLIST', label: 'Content Playlist', desc: 'Play mixed content from a playlist', icon: ListVideo },
    ],
  },
  {
    label: 'Web & Text',
    types: [
      { type: 'WEBPAGE', label: 'URL / Website', desc: 'Drop a webpage anywhere on the canvas — size it however you want', icon: Globe },
      { type: 'TEXT', label: 'Text Block', desc: 'Simple text with custom styling', icon: Type },
      { type: 'RICH_TEXT', label: 'Rich Text', desc: 'Formatted text with headings & links', icon: FileText },
      { type: 'RSS_FEED', label: 'News Feed', desc: 'Headlines from any RSS source', icon: Rss },
      { type: 'SOCIAL_FEED', label: 'Social Media', desc: 'Posts from social accounts', icon: Share2 },
    ],
  },
  {
    label: 'Education',
    types: [
      { type: 'ANNOUNCEMENT', label: 'Announcement', desc: 'Eye-catching important message', icon: Megaphone },
      { type: 'BELL_SCHEDULE', label: 'Bell Schedule', desc: 'Class periods with highlights', icon: Bell },
      { type: 'LUNCH_MENU', label: 'Lunch Menu', desc: "Today's cafeteria menu", icon: UtensilsCrossed },
      { type: 'CALENDAR', label: 'Calendar', desc: 'Upcoming events from a feed', icon: CalendarDays },
      { type: 'COUNTDOWN', label: 'Countdown', desc: 'Count down to a special event', icon: Timer },
      { type: 'STAFF_SPOTLIGHT', label: 'Spotlight', desc: 'Feature a teacher or staff', icon: Users },
    ],
  },
  {
    label: 'Utility',
    types: [
      { type: 'CLOCK', label: 'Clock', desc: 'Current time display', icon: Clock },
      { type: 'WEATHER', label: 'Weather', desc: 'Local weather & forecast', icon: Cloud },
      { type: 'LOGO', label: 'School Logo', desc: 'Display your logo', icon: Shield },
      { type: 'TICKER', label: 'Scrolling Ticker', desc: 'Scrolling text banner', icon: ArrowRight },
      { type: 'EMPTY', label: 'Placeholder', desc: 'Reserve a zone for later', icon: Square },
    ],
  },
  // "School Life" group hidden pending editor — see file header.
  {
    label: 'Animated Scenes',
    types: [
      // ANIMATED_BACKGROUND hidden pending editor — see file header.
      { type: 'ANIMATED_WELCOME', label: 'Animated Welcome · Elementary', desc: 'Full-screen rainbow-ribbon scene — shapes, confetti, live weather', icon: Cake },
      { type: 'ANIMATED_WELCOME_MS', label: 'Animated Welcome · Middle School', desc: 'Stadium / varsity scene — pennants, scoreboard, megaphone, varsity patch', icon: Cake },
      { type: 'ANIMATED_WELCOME_HS', label: 'Animated Welcome · High School', desc: 'Neon sunset scene — grad cap, trophy, yearbook, confetti burst', icon: Cake },
      { type: 'HS_VARSITY',          label: 'HS · Varsity (Athletic)',     desc: '4K scoreboard lobby — jersey chest, game-of-the-week, coach spotlight, pennants, PA ticker', icon: Cake },
      { type: 'HS_BROADCAST',        label: 'HS · Broadcast (News Desk)',  desc: '4K campus news network — ON AIR indicator, lower-thirds, forecast, featured guest, breaking story, crawl', icon: Cake },
      { type: 'HS_YEARBOOK',         label: 'HS · Yearbook (Editorial)',   desc: '4K magazine spread — serif masthead, drop-cap lede, photo feature, portrait quote, folio calendar, wire ticker', icon: Cake },
      { type: 'HS_TERMINAL',         label: 'HS · Terminal (CRT/Phosphor)',desc: '4K CRT lobby — phosphor green, scanlines, whoami teacher card, cron events, syslog ticker, blinking cursor', icon: Cake },
      { type: 'HS_TRANSIT',          label: 'HS · Transit (Departure Board)', desc: '4K airport board — amber split-flap rows, classes as departures, status chips, PA ticker', icon: Cake },
      { type: 'HS_GALLERY',          label: 'HS · Gallery (Museum)',       desc: '4K museum lobby — generous whitespace, italic EB Garamond plaques, Roman-numeral acquisitions, artist-statement quote', icon: Cake },
      { type: 'HS_BLUEPRINT',        label: 'HS · Blueprint (Technical)',  desc: '4K architect blueprint — cyan grid paper, title block header, dimensioned callouts, sheet annotations, revision-log ticker', icon: Cake },
      { type: 'HS_ZINE',             label: 'HS · Zine (Cut & Paste)',     desc: '4K photocopied student zine — rotated panels, taped polaroids, ransom-letter announcements, marker annotations, xeroxwire ticker', icon: Cake },
      // MS Pack — 8 landscape variants (productized 2026-04-25)
      { type: 'MS_ARCADE',           label: 'MS · Arcade (Quest Log)',     desc: '4K retro game-HUD lobby — pixel borders, quest-log agenda, XP bar, leaderboard, BOSS BATTLE ticker', icon: Cake },
      { type: 'MS_ATLAS',            label: 'MS · Atlas (Subway Map)',     desc: '4K travel-poster cartography — compass rose, almanac, four transit-style route cards, scrolling news', icon: Cake },
      { type: 'MS_FIELDNOTES',       label: 'MS · Field Notes (Journal)',  desc: '4K naturalist field journal — kraft paper, washi tape, watercolor specimens, log entries with compass bearings', icon: Cake },
      { type: 'MS_GREENHOUSE',       label: 'MS · Greenhouse (Herbarium)', desc: '4K herbarium plate — pressed specimens, brass instrument gauges, terracotta announcement, almanac countdown', icon: Cake },
      { type: 'MS_HOMEROOM',         label: 'MS · Homeroom (Bulletin)',    desc: '4K classroom bulletin — slate, sticky notes, polaroid, tabbed binder agenda, school-spirit pennant', icon: Cake },
      { type: 'MS_PAPER',            label: 'MS · Paper (Broadsheet)',     desc: '4K vintage broadsheet — masthead, drop-cap lead story, departments band, stop-press bulletin ticker', icon: Cake },
      { type: 'MS_PLAYLIST',         label: 'MS · Playlist (Now Playing)', desc: '4K Spotify-style now-playing — album cover, queue, equalizer, transport controls, club charts', icon: Cake },
      { type: 'MS_STUDIO',           label: 'MS · Studio (On-Air Booth)',  desc: '4K radio booth — ON AIR sign, vinyl turntable, VU meter, mixer, cassette lineup, single combined footer', icon: Cake },
      // MS Pack — 8 portrait variants (2160×3840 for vertical hallway displays)
      { type: 'MS_ARCADE_PORTRAIT',     label: 'MS · Arcade — Portrait',     desc: 'Vertical 4K · single-column quest log + leaderboard + side quests', icon: Cake },
      { type: 'MS_ATLAS_PORTRAIT',      label: 'MS · Atlas — Portrait',      desc: 'Vertical 4K · full-width hero poster + 4 transit cards stacked', icon: Cake },
      { type: 'MS_FIELDNOTES_PORTRAIT', label: 'MS · Field Notes — Portrait', desc: 'Vertical 4K · full-width specimen card + tall agenda column + P.S. ticker', icon: Cake },
      { type: 'MS_GREENHOUSE_PORTRAIT', label: 'MS · Greenhouse — Portrait', desc: 'Vertical 4K · large herbarium plate + vertical specimen index', icon: Cake },
      { type: 'MS_HOMEROOM_PORTRAIT',   label: 'MS · Homeroom — Portrait',   desc: 'Vertical 4K · chalkboard hero + tall corkboard agenda + manila folder clubs', icon: Cake },
      { type: 'MS_PAPER_PORTRAIT',      label: 'MS · Paper — Portrait',      desc: 'Vertical 4K · real broadsheet portrait (masthead + drop-cap + departments)', icon: Cake },
      { type: 'MS_PLAYLIST_PORTRAIT',   label: 'MS · Playlist — Portrait',   desc: 'Vertical 4K · Spotify-mobile aesthetic — album cover + transport + tall queue', icon: Cake },
      { type: 'MS_STUDIO_PORTRAIT',     label: 'MS · Studio — Portrait',     desc: 'Vertical 4K · turntable+VU side-by-side + 4 cassettes vertical + single footer', icon: Cake },
      // Cafeteria variants
      { type: 'ANIMATED_CAFETERIA',           label: 'Animated Cafeteria · Food Truck',     desc: 'Food-truck menu board — weekly menu, swappable food emojis, lunch chef, allergen ticker', icon: UtensilsCrossed },
      { type: 'ANIMATED_CAFETERIA_MS',        label: 'Animated Cafeteria · Middle School',  desc: '4K cafeteria for middle schoolers — sport-stadium menu vibe', icon: UtensilsCrossed },
      { type: 'ANIMATED_CAFETERIA_HS',        label: 'Animated Cafeteria · High School',    desc: '4K cafeteria for high schoolers — café aesthetic', icon: UtensilsCrossed },
      { type: 'ANIMATED_CAFETERIA_CHALKBOARD',label: 'Animated Cafeteria · Chalkboard',     desc: 'Classic green-chalkboard menu board with chalk-textured text', icon: UtensilsCrossed },
      { type: 'ANIMATED_CAFETERIA_FOODTRUCK', label: 'Animated Cafeteria · Food Truck (Classic)', desc: 'Food-truck service window — striped awning, order window, chalkboard menu', icon: UtensilsCrossed },
      // Animated full-screen scenes (lobby / hallway / info)
      { type: 'ANIMATED_MAIN_ENTRANCE',       label: 'Animated Main Entrance Welcome',      desc: 'Grand-entrance welcome board — marquee bulbs, heraldic crests, info tiles, balloon cluster', icon: Cake },
      { type: 'ANIMATED_HALLWAY_SCHEDULE',    label: 'Animated Hallway Schedule',           desc: 'Notebook-paper hallway schedule with daily classes', icon: CalendarDays },
      { type: 'ANIMATED_BELL_SCHEDULE',       label: 'Animated Bell Schedule',              desc: 'Period times with current/next-up highlights', icon: Bell },
      { type: 'ANIMATED_BUS_BOARD',           label: 'Animated Bus Route Board',            desc: 'School-bus route board — driving-bus graphic, route rows with ETAs, late warnings', icon: Cake },
      { type: 'ANIMATED_MORNING_NEWS',        label: 'Animated Morning News',               desc: 'Anchor-desk style morning announcements with headlines', icon: Megaphone },
      { type: 'ANIMATED_ACHIEVEMENT_SHOWCASE',label: 'Animated Achievement Showcase',       desc: 'Trophy-case style scrolling student achievements', icon: Cake },
      { type: 'ANIMATED_WELCOME_PORTRAIT',    label: 'Animated Welcome · Portrait',         desc: 'Vertical 4K rainbow-ribbon welcome scene', icon: Cake },
      // Elementary themed welcome boards
      { type: 'SCRAPBOOK_HALLWAY',   label: 'Scrapbook · Hallway',   desc: 'Cut-and-paste scrapbook hallway with washi tape + polaroids', icon: Cake },
      { type: 'SCRAPBOOK_CAFETERIA', label: 'Scrapbook · Cafeteria', desc: 'Cut-and-paste scrapbook cafeteria menu board', icon: UtensilsCrossed },
      { type: 'STORYBOOK_HALLWAY',   label: 'Storybook · Hallway',   desc: 'Open-book spread hallway with illuminated drop caps', icon: Cake },
      { type: 'STORYBOOK_CAFETERIA', label: 'Storybook · Cafeteria', desc: 'Open-book spread cafeteria menu', icon: UtensilsCrossed },
      { type: 'BULLETIN_HALLWAY',    label: 'Bulletin Board · Hallway',   desc: 'Cork bulletin-board hallway with pinned index cards', icon: Cake },
      { type: 'BULLETIN_CAFETERIA',  label: 'Bulletin Board · Cafeteria', desc: 'Cork bulletin-board cafeteria menu', icon: UtensilsCrossed },
    ],
  },
  // "Touch / Interactive" group hidden pending editor — see file header.
] as const;

export const WIDGET_META: Record<string, { label: string; icon: LucideIcon; desc: string }> = {};
WIDGET_GROUPS.forEach(g => g.types.forEach(t => {
  WIDGET_META[t.type] = { label: t.label, icon: t.icon as LucideIcon, desc: t.desc };
}));

export function widgetLabel(type: string): string {
  return WIDGET_META[type]?.label ?? type;
}

export function widgetIcon(type: string): LucideIcon {
  return WIDGET_META[type]?.icon ?? Square;
}

export const ZONE_COLORS: Record<string, { bg: string; border: string; text: string; accent: string }> = {
  VIDEO:           { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#8b5cf6' },
  IMAGE:           { bg: '#f0f9ff', border: '#93c5fd', text: '#1d4ed8', accent: '#3b82f6' },
  IMAGE_CAROUSEL:  { bg: '#f0f9ff', border: '#93c5fd', text: '#1d4ed8', accent: '#3b82f6' },
  PLAYLIST:        { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#8b5cf6' },
  WEBPAGE:         { bg: '#ecfdf5', border: '#6ee7b7', text: '#047857', accent: '#10b981' },
  TEXT:            { bg: '#f8fafc', border: '#cbd5e1', text: '#334155', accent: '#64748b' },
  RICH_TEXT:       { bg: '#f8fafc', border: '#cbd5e1', text: '#334155', accent: '#64748b' },
  RSS_FEED:        { bg: '#fff7ed', border: '#fdba74', text: '#c2410c', accent: '#f97316' },
  SOCIAL_FEED:     { bg: '#fdf2f8', border: '#f9a8d4', text: '#be185d', accent: '#ec4899' },
  ANNOUNCEMENT:    { bg: '#fffbeb', border: '#fcd34d', text: '#a16207', accent: '#f59e0b' },
  BELL_SCHEDULE:   { bg: '#eef2ff', border: '#a5b4fc', text: '#4338ca', accent: '#6366f1' },
  LUNCH_MENU:      { bg: '#f0fdf4', border: '#86efac', text: '#15803d', accent: '#22c55e' },
  CALENDAR:        { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af', accent: '#3b82f6' },
  COUNTDOWN:       { bg: '#fff1f2', border: '#fda4af', text: '#be123c', accent: '#f43f5e' },
  STAFF_SPOTLIGHT: { bg: '#f0fdfa', border: '#5eead4', text: '#0f766e', accent: '#14b8a6' },
  CLOCK:           { bg: '#f9fafb', border: '#d1d5db', text: '#374151', accent: '#6b7280' },
  WEATHER:         { bg: '#ecfeff', border: '#67e8f9', text: '#0e7490', accent: '#06b6d4' },
  LOGO:            { bg: '#eef2ff', border: '#a5b4fc', text: '#4338ca', accent: '#6366f1' },
  TICKER:          { bg: '#fffbeb', border: '#fcd34d', text: '#a16207', accent: '#f59e0b' },
  EMPTY:           { bg: '#f8fafc', border: '#e2e8f0', text: '#94a3b8', accent: '#cbd5e1' },
  // Touch / Interactive (Sprint 4)
  TOUCH_BUTTON:       { bg: '#eef2ff', border: '#a5b4fc', text: '#3730a3', accent: '#4f46e5' },
  TOUCH_MENU:         { bg: '#eef2ff', border: '#a5b4fc', text: '#3730a3', accent: '#4f46e5' },
  ROOM_FINDER:        { bg: '#f0fdfa', border: '#5eead4', text: '#0f766e', accent: '#14b8a6' },
  ON_SCREEN_KEYBOARD: { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155', accent: '#475569' },
  WAYFINDING_MAP:     { bg: '#fef3c7', border: '#fcd34d', text: '#92400e', accent: '#f59e0b' },
  QUICK_POLL:         { bg: '#fdf2f8', border: '#f9a8d4', text: '#be185d', accent: '#ec4899' },
  ANIMATED_WELCOME:     { bg: '#fbcfe8', border: '#ec4899', text: '#831843', accent: '#ec4899' },
  ANIMATED_WELCOME_MS:  { bg: '#fef3c7', border: '#dc2626', text: '#7f1d1d', accent: '#dc2626' },
  ANIMATED_WELCOME_HS:  { bg: '#fef3c7', border: '#ec4899', text: '#831843', accent: '#f59e0b' },
  ANIMATED_CAFETERIA:   { bg: '#fef3c7', border: '#dc2626', text: '#7c2d12', accent: '#dc2626' },
  ANIMATED_BACKGROUND:  { bg: '#fbcfe8', border: '#ec4899', text: '#831843', accent: '#ec4899' },
};

// Hit-target validator — warn if a zone would render smaller than WCAG 44px
// at the template's target resolution. Returns { ok, warnings[] }.
export const MIN_TOUCH_TARGET_PX = 44;

export function validateTouchHitTargets(
  zones: Array<{ id: string; name: string; widgetType: string; x: number; y: number; width: number; height: number; touchAction?: unknown }>,
  screenWidth: number,
  screenHeight: number,
): { ok: boolean; warnings: Array<{ zoneId: string; zoneName: string; reason: string }> } {
  const warnings: Array<{ zoneId: string; zoneName: string; reason: string }> = [];
  const touchWidgets = new Set([
    'TOUCH_BUTTON', 'TOUCH_MENU', 'ROOM_FINDER', 'ON_SCREEN_KEYBOARD',
    'WAYFINDING_MAP', 'QUICK_POLL',
  ]);
  for (const z of zones) {
    const interactive = touchWidgets.has(z.widgetType) || !!z.touchAction;
    if (!interactive) continue;
    const pxW = (z.width / 100) * screenWidth;
    const pxH = (z.height / 100) * screenHeight;
    if (pxW < MIN_TOUCH_TARGET_PX || pxH < MIN_TOUCH_TARGET_PX) {
      warnings.push({
        zoneId: z.id,
        zoneName: z.name,
        reason: `Too small for touch (${Math.round(pxW)}×${Math.round(pxH)}px; needs ≥ ${MIN_TOUCH_TARGET_PX}px)`,
      });
    }
  }
  return { ok: warnings.length === 0, warnings };
}

export function getZoneColor(type: string) {
  return ZONE_COLORS[type] ?? ZONE_COLORS.EMPTY;
}

export const RESOLUTION_PRESETS = [
  { label: '4K UHD', sub: 'Landscape', w: 3840, h: 2160 },
  { label: '4K UHD', sub: 'Portrait', w: 2160, h: 3840 },
  { label: 'Full HD', sub: 'Landscape', w: 1920, h: 1080 },
  { label: 'Full HD', sub: 'Portrait', w: 1080, h: 1920 },
  { label: '720p', sub: 'Landscape', w: 1280, h: 720 },
  { label: 'Ultra-Wide', sub: '21:9', w: 2560, h: 1080 },
  { label: 'LED Banner', sub: '5:1', w: 2500, h: 500 },
  { label: 'LED Tall', sub: '1:3', w: 480, h: 1440 },
  { label: 'Square', sub: '1:1', w: 1080, h: 1080 },
];

export const GRID_SIZES = [1, 2, 5, 10, 25] as const;
export const DEFAULT_GRID_SIZE = 5;

export const SNAP_THRESHOLD = 1.5;
export const MIN_ZONE_SIZE = 3;
