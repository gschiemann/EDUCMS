import type { LucideIcon } from 'lucide-react';
import {
  Play, Image as ImageIcon, Globe, Type, Bell, Clock, Cloud, Timer,
  CalendarDays, Megaphone, UtensilsCrossed, Users, Rss, Share2, Shield,
  ArrowRight, Square, FileText, ListVideo,
  MousePointerClick, Menu as MenuIcon, MapPin, Keyboard, Map, BarChart3,
  Quote, Trophy, Cake, Award, Table2, UserCheck,
} from 'lucide-react';

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
      { type: 'WEBPAGE', label: 'Website', desc: 'Embed any website or web app', icon: Globe },
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
  {
    label: 'School Life',
    types: [
      { type: 'QUOTE',          label: 'Quote Card',       desc: 'Inspirational pull-quote + author',   icon: Quote },
      { type: 'STATS',          label: 'Stats Row',        desc: '3-5 big-number stat cards',           icon: BarChart3 },
      { type: 'SCOREBOARD',     label: 'Scoreboard',       desc: 'Home vs away game scorebug',          icon: Trophy },
      { type: 'MENU_ITEM',      label: 'Menu Item',        desc: 'Cafeteria dish card with allergens',  icon: UtensilsCrossed },
      { type: 'SCHEDULE_GRID',  label: 'Schedule Grid',    desc: 'Period-by-period daily schedule',     icon: Table2 },
      { type: 'ATTENDANCE',     label: 'Attendance',       desc: 'Live daily attendance percentage',    icon: UserCheck },
      { type: 'BIRTHDAYS',      label: 'Birthdays',        desc: "Today's birthday shout-outs",         icon: Cake },
      { type: 'HONOR_ROLL',     label: 'Honor Roll',       desc: 'Recognized students + reason',        icon: Award },
    ],
  },
  {
    label: 'Animated Scenes',
    types: [
      { type: 'ANIMATED_BACKGROUND', label: 'Animated Background', desc: 'Pure-decoration backdrop: rainbow ribbon, drifting clouds, confetti, balloons', icon: Cake },
      { type: 'ANIMATED_WELCOME', label: 'Animated Welcome · Elementary', desc: 'Full-screen rainbow-ribbon scene — shapes, confetti, live weather', icon: Cake },
      { type: 'ANIMATED_WELCOME_MS', label: 'Animated Welcome · Middle School', desc: 'Stadium / varsity scene — pennants, scoreboard, megaphone, varsity patch', icon: Cake },
      { type: 'ANIMATED_WELCOME_HS', label: 'Animated Welcome · High School', desc: 'Neon sunset scene — grad cap, trophy, yearbook, confetti burst', icon: Cake },
    ],
  },
  {
    label: 'Touch / Interactive',
    types: [
      { type: 'TOUCH_BUTTON',    label: 'Touch Button',    desc: 'Large tappable button with action', icon: MousePointerClick },
      { type: 'TOUCH_MENU',      label: 'Touch Menu',      desc: 'Row or column of touch buttons', icon: MenuIcon },
      { type: 'ROOM_FINDER',     label: 'Room Finder',     desc: 'Searchable directory with keyboard', icon: MapPin },
      { type: 'ON_SCREEN_KEYBOARD', label: 'On-Screen Keyboard', desc: 'Virtual QWERTY / numeric pad', icon: Keyboard },
      { type: 'WAYFINDING_MAP',  label: 'Wayfinding Map',  desc: 'Pan/zoom map with hotspots', icon: Map },
      { type: 'QUICK_POLL',      label: 'Quick Poll',      desc: 'Touch voting widget (local)', icon: BarChart3 },
    ],
  },
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
