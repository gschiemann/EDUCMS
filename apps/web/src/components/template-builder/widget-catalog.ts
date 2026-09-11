/**
 * WIDGET CATALOG — the human-readable shape of the widget library.
 *
 * WHY THIS FILE EXISTS (Phase 2, 2026-09-11). The widgets panel rendered a
 * rail of ~30 filter chips, seven-plus rows deep, ABOVE the first widget the
 * operator could actually see — and twelve of those chips printed the raw
 * database enum at the operator: `HOUSE_AD_BANNER`, `FITNESS_STICK_LAUNCHER`,
 * `STADIUM_MEET_BOARD`. Every product researched for the program doc (Canva,
 * Yodeck, ScreenCloud, OptiSigns, Rise Vision, Wix Studio) converges on the
 * same shape instead: ONE search field, a small curated default, ~8-10 NAMED
 * category rows each with a "See all", and ONE filter button. A chip rail does
 * not scale past about a dozen entries, and this catalogue holds 701 widgets
 * across 74 types.
 *
 * Three rules this module exists to keep:
 *
 *   1. NEVER show a raw `SCREAMING_SNAKE` type name. `friendlyTypeLabel()`
 *      has an explicit label for every registered type and DERIVES a human
 *      one for anything new, so a type added tomorrow reads as words, not as
 *      an enum. (`widget-catalog.test.ts` fails the build if any registered
 *      type would render as its own enum.)
 *   2. NEVER lose a widget. `categoryForType()` always returns a category —
 *      an unmapped type lands in `more`, which is rendered last. A new widget
 *      type is discoverable the moment it is registered, with no edit here.
 *   3. Filter axes are DERIVED from the visible set, never hard-coded. An
 *      axis with nothing to choose between does not render, which is why a
 *      corporate tenant never sees a "School level" control.
 */

import type { WidgetVariant } from '@/components/widgets/variants';

// ───────────────────────────────────────────────────────────────────────────
// 1. Human labels
// ───────────────────────────────────────────────────────────────────────────

/**
 * Explicit operator-facing label per widget type. Anything missing is derived
 * (see `friendlyTypeLabel`) — the map is for names a mechanical de-snake would
 * get wrong or leave as jargon ("Stick Launcher", "House Ad Banner").
 */
const TYPE_LABELS: Record<string, string> = {
  // Universal signage
  TEXT: 'Headline',
  RICH_TEXT: 'Rich text',
  ANNOUNCEMENT: 'Announcement',
  TICKER: 'Scrolling ticker',
  CLOCK: 'Clock',
  COUNTDOWN: 'Countdown',
  CALENDAR: 'Calendar',
  BELL_SCHEDULE: 'Bell schedule',
  WEATHER: 'Weather',
  IMAGE: 'Photo',
  IMAGE_CAROUSEL: 'Photo slideshow',
  VIDEO: 'Video',
  VIDEO_CAROUSEL: 'Video playlist',
  WEBPAGE: 'Web page',
  RSS_FEED: 'News feed',
  SOCIAL_FEED: 'Social feed',
  PLAYLIST: 'Playlist',
  LOGO: 'Logo',
  STAFF_SPOTLIGHT: 'Staff spotlight',
  LUNCH_MENU: 'Lunch menu',
  LIVE_DATA: 'Live data',
  CHART: 'Chart',
  BACKGROUND: 'Background',
  SHAPE: 'Shape',
  ICON: 'Icon',
  DECORATION: 'Animated decoration',
  TOUCH_POINT: 'Tap target',
  EXTERNAL_HTML: 'Designed board',
  EMPTY: 'Empty area',
  HOUSE_AD_BANNER: 'Sponsor banner',
  MUSIC_PLAYER: 'Music player',
  CELEBRATION: 'Celebration',

  // Sports / game day
  SCOREBOARD: 'Scoreboard',
  SCORE_HOME: 'Home score',
  SCORE_AWAY: 'Away score',
  GAME_CLOCK: 'Game clock',
  GAME_SEGMENT: 'Period or quarter',
  GAME_STAT: 'Game stat',
  STADIUM_MEET_BOARD: 'Meet board',
  SWIM_LANE_GRID: 'Swim lane grid',
  SWIM_RELAY_EXCHANGE: 'Relay exchange',
  SWIM_SPLITS_PANEL: 'Swim splits',
  SWIM_RECORD_LINE: 'Record line',
  DIVE_LEADERBOARD: 'Dive leaderboard',
  DIVE_JUDGES_PANEL: 'Dive judges',

  // Food service
  RESTAURANT_MENU_BOARD: 'Menu board',
  RESTAURANT_COMBO_CAROUSEL: 'Combo carousel',
  RESTAURANT_WAIT_TIME: 'Wait time',
  RESTAURANT_LOYALTY_TICKER: 'Loyalty ticker',
  RESTAURANT_SPECIALS_CALLOUT: 'Specials callout',
  RESTAURANT_ALLERGY_LEGEND: 'Allergy legend',
  BAR_TAP_LIST: 'Tap list',
  BAR_COCKTAIL_MENU: 'Cocktail menu',
  BAR_HAPPY_HOUR_COUNTDOWN: 'Happy hour countdown',
  BAR_GAME_DAY_SCHEDULE: 'Game day schedule',
  BAR_EVENT_TONIGHT: 'Tonight at the bar',
  BAR_TRIVIA_SCOREBOARD: 'Trivia scoreboard',

  // Retail
  RETAIL: 'Retail board',
  RETAIL_PRODUCT_GRID: 'Product grid',
  RETAIL_PRICE_CALLOUT: 'Price callout',
  RETAIL_SALE_COUNTDOWN: 'Sale countdown',
  RETAIL_WAYFINDING_MAP: 'Store map',
  RETAIL_LOOKBOOK_CAROUSEL: 'Lookbook carousel',
  RETAIL_STOREFRONT_HOURS: 'Store hours',
  RETAIL_LOYALTY_QR: 'Loyalty QR code',

  // Gym / fitness
  FITNESS_CLASS_SCHEDULE: 'Class schedule',
  FITNESS_MUSIC_PLAYER: 'Music player',
  FITNESS_LIVE_TV: 'Live TV',
  FITNESS_AD_BANNER: 'Sponsor banner',
  FITNESS_TRAINING_VIDEO: 'Training video',
  FITNESS_WORKOUT_TIMER: 'Workout timer',
  FITNESS_MOTIVATIONAL_QUOTE: 'Motivational quote',
  FITNESS_APP_LIBRARY: 'App library',
  FITNESS_STICK_LAUNCHER: 'Streaming apps',

  // Other verticals
  HEALTHCARE: 'Healthcare board',
  CORPORATE: 'Workplace board',
  HOSPITALITY: 'Hospitality board',
  WORSHIP: 'Worship board',
};

/** Vertical prefixes stripped before deriving a label from a type name. */
const STRIPPED_PREFIXES = [
  'FITNESS_', 'RESTAURANT_', 'RETAIL_', 'BAR_', 'SWIM_', 'DIVE_',
  'GAME_', 'SCORE_', 'TOUCH_', 'DECORATION_', 'HS_', 'MS_',
];

/**
 * Operator-facing name for a widget type. Explicit where we have one,
 * otherwise derived: strip the vertical prefix, split the snake case, and
 * sentence-case it. `FOO_BAR_BOARD` → "Foo bar board" — words, never an enum.
 *
 * Deliberately total: every input produces something readable, so a widget
 * type registered after this file was last edited cannot leak an enum onto
 * the operator's screen.
 */
export function friendlyTypeLabel(type: string): string {
  if (!type) return 'Widget';
  const explicit = TYPE_LABELS[type];
  if (explicit) return explicit;
  let rest = type;
  for (const p of STRIPPED_PREFIXES) {
    if (rest.startsWith(p) && rest.length > p.length) { rest = rest.slice(p.length); break; }
  }
  const words = rest.split(/[_\s]+/).filter(Boolean).map((w) => w.toLowerCase());
  if (!words.length) return 'Widget';
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '');
}

/**
 * A variant's own display name, guaranteed human. Variant names are authored
 * strings ("Wood Wall Clock") so they are almost always fine — but a variant
 * registered with its type as its name would print the enum, so fall back to
 * the friendly type label rather than trusting the field.
 */
export function friendlyVariantName(v: Pick<WidgetVariant, 'name' | 'widgetType'>): string {
  const n = (v.name || '').trim();
  if (!n || /^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(n)) return friendlyTypeLabel(String(v.widgetType));
  return n;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Named categories — the rows that replaced the chip rail
// ───────────────────────────────────────────────────────────────────────────

export interface WidgetCategory {
  id: string;
  label: string;
  /** One plain line under the row title. No jargon, no enum names. */
  blurb: string;
  types: readonly string[];
}

/**
 * ~10 named rows, in the order an operator builds a board: words first,
 * then time, then media. Vertical packs sit last because a tenant only ever
 * sees its own.
 *
 * A type may appear in exactly ONE category — `categoryForType` takes the
 * first match and the test asserts there are no duplicates, because a widget
 * listed twice inflates every count on the panel.
 */
export const WIDGET_CATEGORIES: readonly WidgetCategory[] = [
  {
    id: 'words',
    label: 'Words & headlines',
    blurb: 'Say something — titles, notices and scrolling messages.',
    types: ['TEXT', 'RICH_TEXT', 'ANNOUNCEMENT', 'TICKER'],
  },
  {
    id: 'time',
    label: 'Time & schedules',
    blurb: 'Clocks, countdowns and what happens next.',
    types: ['CLOCK', 'COUNTDOWN', 'CALENDAR', 'BELL_SCHEDULE'],
  },
  {
    id: 'media',
    label: 'Photos & video',
    blurb: 'Your own pictures and clips, on their own or as a slideshow.',
    types: ['IMAGE', 'IMAGE_CAROUSEL', 'VIDEO', 'VIDEO_CAROUSEL', 'PLAYLIST', 'MUSIC_PLAYER'],
  },
  {
    id: 'live',
    label: 'Live info',
    blurb: 'Weather, web pages and numbers that update themselves.',
    types: ['WEATHER', 'LIVE_DATA', 'CHART', 'WEBPAGE', 'RSS_FEED', 'SOCIAL_FEED'],
  },
  {
    id: 'brand',
    label: 'Brand & people',
    blurb: 'Your logo, the people behind it, and sponsor space.',
    types: ['LOGO', 'STAFF_SPOTLIGHT', 'HOUSE_AD_BANNER'],
  },
  {
    id: 'food',
    label: 'Food & menus',
    blurb: "What's being served, and what it costs.",
    types: [
      'LUNCH_MENU',
      'RESTAURANT_MENU_BOARD', 'RESTAURANT_COMBO_CAROUSEL', 'RESTAURANT_WAIT_TIME',
      'RESTAURANT_LOYALTY_TICKER', 'RESTAURANT_SPECIALS_CALLOUT', 'RESTAURANT_ALLERGY_LEGEND',
      'BAR_TAP_LIST', 'BAR_COCKTAIL_MENU', 'BAR_HAPPY_HOUR_COUNTDOWN',
      'BAR_GAME_DAY_SCHEDULE', 'BAR_EVENT_TONIGHT', 'BAR_TRIVIA_SCOREBOARD',
    ],
  },
  {
    id: 'gameday',
    label: 'Game day',
    blurb: 'Scores, clocks and the rest of the live game picture.',
    types: [
      'SCOREBOARD', 'SCORE_HOME', 'SCORE_AWAY', 'GAME_CLOCK', 'GAME_SEGMENT', 'GAME_STAT',
      'STADIUM_MEET_BOARD', 'SWIM_LANE_GRID', 'SWIM_RELAY_EXCHANGE', 'SWIM_SPLITS_PANEL',
      'SWIM_RECORD_LINE', 'DIVE_LEADERBOARD', 'DIVE_JUDGES_PANEL',
    ],
  },
  {
    id: 'celebrate',
    label: 'Celebrations',
    blurb: 'Big moments — confetti, streaks and shout-outs.',
    types: ['CELEBRATION', 'DECORATION'],
  },
  {
    id: 'touch',
    label: 'Touch & interactive',
    blurb: 'Tap targets for a screen people can actually press.',
    types: ['TOUCH_POINT'],
  },
  {
    id: 'design',
    label: 'Shapes & backgrounds',
    blurb: 'The layer under everything else — blocks, icons, backdrops.',
    types: ['SHAPE', 'ICON', 'BACKGROUND', 'EXTERNAL_HTML'],
  },
  {
    id: 'venue',
    label: 'Made for your venue',
    blurb: 'Boards built for this industry and nothing else.',
    types: [
      'HEALTHCARE', 'CORPORATE', 'HOSPITALITY', 'WORSHIP',
      'RETAIL', 'RETAIL_PRODUCT_GRID', 'RETAIL_PRICE_CALLOUT', 'RETAIL_SALE_COUNTDOWN',
      'RETAIL_WAYFINDING_MAP', 'RETAIL_LOOKBOOK_CAROUSEL', 'RETAIL_STOREFRONT_HOURS',
      'RETAIL_LOYALTY_QR',
      'FITNESS_CLASS_SCHEDULE', 'FITNESS_MUSIC_PLAYER', 'FITNESS_LIVE_TV', 'FITNESS_AD_BANNER',
      'FITNESS_TRAINING_VIDEO', 'FITNESS_WORKOUT_TIMER', 'FITNESS_MOTIVATIONAL_QUOTE',
      'FITNESS_APP_LIBRARY', 'FITNESS_STICK_LAUNCHER',
    ],
  },
];

/**
 * The catch-all. Rendered last, and only when something actually lands in it.
 * Its existence is the guarantee in rule 2: a widget type nobody remembered to
 * categorise is still one scroll away, never invisible.
 */
export const OTHER_CATEGORY: WidgetCategory = {
  id: 'more',
  label: 'More widgets',
  blurb: 'Everything else in your library.',
  types: [],
};

const TYPE_TO_CATEGORY = new Map<string, string>();
for (const c of WIDGET_CATEGORIES) {
  for (const t of c.types) if (!TYPE_TO_CATEGORY.has(t)) TYPE_TO_CATEGORY.set(t, c.id);
}

/** Category id for a widget type. Total — unmapped types land in `more`. */
export function categoryForType(type: string): string {
  return TYPE_TO_CATEGORY.get(type) || OTHER_CATEGORY.id;
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Filter axes — derived, never hard-coded
// ───────────────────────────────────────────────────────────────────────────

/**
 * Look-and-feel buckets, mapped off the variant `category` metadata that
 * already exists on the registrations. Only buckets with something in them
 * are offered (see `deriveStyleOptions`).
 */
export const STYLE_BUCKETS: readonly { id: string; label: string; categories: readonly string[] }[] = [
  { id: 'modern', label: 'Modern', categories: ['MODERN'] },
  { id: 'bold', label: 'Bold & colourful', categories: ['BOLD', 'PLAYFUL', 'ARTS'] },
  { id: 'minimal', label: 'Minimal', categories: ['MINIMAL'] },
  { id: 'dark', label: 'Dark', categories: ['DARK'] },
  { id: 'broadcast', label: 'Broadcast', categories: ['BROADCAST'] },
];

/**
 * "Where it goes" buckets. Same derivation: the variant categories that name a
 * PLACE rather than a look. Mostly a K-12 axis in practice, which is precisely
 * why it is derived — a gym simply never sees it.
 */
export const PLACE_BUCKETS: readonly { id: string; label: string; categories: readonly string[] }[] = [
  { id: 'entrance', label: 'Lobby / entrance', categories: ['LOBBY'] },
  { id: 'hallway', label: 'Hallway', categories: ['HALLWAY'] },
  { id: 'cafeteria', label: 'Cafeteria', categories: ['CAFETERIA'] },
  { id: 'classroom', label: 'Classroom', categories: ['CLASSROOM'] },
  { id: 'library', label: 'Library', categories: ['LIBRARY'] },
  { id: 'office', label: 'Office', categories: ['OFFICE'] },
  { id: 'athletics', label: 'Athletics', categories: ['ATHLETICS', 'SPORTS'] },
  { id: 'stem', label: 'STEM / labs', categories: ['STEM'] },
  { id: 'safety', label: 'Safety', categories: ['SAFETY'] },
];

function deriveOptions(
  buckets: readonly { id: string; label: string; categories: readonly string[] }[],
  visible: readonly WidgetVariant[],
): { id: string; label: string }[] {
  const present = new Set<string>();
  for (const v of visible) if (v.category) present.add(v.category.toUpperCase());
  return buckets
    .filter((b) => b.categories.some((c) => present.has(c)))
    .map((b) => ({ id: b.id, label: b.label }));
}

/** Style options actually worth offering for this visible set. */
export function deriveStyleOptions(visible: readonly WidgetVariant[]) {
  return deriveOptions(STYLE_BUCKETS, visible);
}

/** Place options actually worth offering for this visible set. */
export function derivePlaceOptions(visible: readonly WidgetVariant[]) {
  return deriveOptions(PLACE_BUCKETS, visible);
}

/** Does a variant belong to the chosen style bucket? `ALL` always passes. */
export function matchesStyle(v: WidgetVariant, styleId: string): boolean {
  if (styleId === 'ALL') return true;
  const bucket = STYLE_BUCKETS.find((b) => b.id === styleId);
  if (!bucket) return true;
  return !!v.category && bucket.categories.includes(v.category.toUpperCase());
}

/** Does a variant belong to the chosen place bucket? `ALL` always passes. */
export function matchesPlace(v: WidgetVariant, placeId: string): boolean {
  if (placeId === 'ALL') return true;
  const bucket = PLACE_BUCKETS.find((b) => b.id === placeId);
  if (!bucket) return true;
  return !!v.category && bucket.categories.includes(v.category.toUpperCase());
}

// ───────────────────────────────────────────────────────────────────────────
// 4. The curated default — 8-12 flagship widgets, never the whole catalogue
// ───────────────────────────────────────────────────────────────────────────

/**
 * Flagships are declared as widget TYPES, not variant ids, and resolved
 * against whatever is actually registered and visible to this tenant. That is
 * deliberate: a hard-coded variant id rots the moment a variant is renamed,
 * and a rotted id here would silently shrink the one section a first-time
 * operator sees. A type that has no visible variant simply drops out.
 */
const VERTICAL_FLAGSHIP_TYPES: Record<string, readonly string[]> = {
  K12: ['ANNOUNCEMENT', 'BELL_SCHEDULE', 'LUNCH_MENU', 'STAFF_SPOTLIGHT'],
  SPORTS: ['SCOREBOARD', 'GAME_CLOCK', 'CELEBRATION', 'HOUSE_AD_BANNER'],
  GYM: ['FITNESS_CLASS_SCHEDULE', 'FITNESS_WORKOUT_TIMER', 'FITNESS_MOTIVATIONAL_QUOTE', 'FITNESS_LIVE_TV'],
  QSR: ['RESTAURANT_MENU_BOARD', 'RESTAURANT_SPECIALS_CALLOUT', 'RESTAURANT_COMBO_CAROUSEL', 'RESTAURANT_WAIT_TIME'],
  RESTAURANT: ['RESTAURANT_MENU_BOARD', 'RESTAURANT_SPECIALS_CALLOUT', 'RESTAURANT_COMBO_CAROUSEL', 'RESTAURANT_WAIT_TIME'],
  BAR: ['BAR_TAP_LIST', 'BAR_COCKTAIL_MENU', 'BAR_HAPPY_HOUR_COUNTDOWN', 'BAR_EVENT_TONIGHT'],
  RETAIL: ['RETAIL_PRODUCT_GRID', 'RETAIL_PRICE_CALLOUT', 'RETAIL_SALE_COUNTDOWN', 'RETAIL_LOOKBOOK_CAROUSEL'],
  FASHION: ['RETAIL_LOOKBOOK_CAROUSEL', 'RETAIL_PRODUCT_GRID', 'RETAIL_PRICE_CALLOUT', 'RETAIL_STOREFRONT_HOURS'],
  CORPORATE: ['CORPORATE', 'ANNOUNCEMENT', 'CALENDAR', 'STAFF_SPOTLIGHT'],
  HEALTHCARE: ['HEALTHCARE', 'ANNOUNCEMENT', 'CALENDAR', 'STAFF_SPOTLIGHT'],
  HOSPITALITY: ['HOSPITALITY', 'ANNOUNCEMENT', 'CALENDAR', 'WEATHER'],
  WORSHIP: ['WORSHIP', 'ANNOUNCEMENT', 'CALENDAR', 'STAFF_SPOTLIGHT'],
};

/** Shown to every vertical, after that vertical's own flagships. */
const UNIVERSAL_FLAGSHIP_TYPES: readonly string[] = [
  'TEXT', 'IMAGE', 'VIDEO', 'CLOCK', 'WEATHER',
  'IMAGE_CAROUSEL', 'TICKER', 'COUNTDOWN', 'CALENDAR', 'LOGO', 'WEBPAGE', 'SHAPE',
];

/** Upper bound on the curated row. The research range is 8-12. */
export const CURATED_LIMIT = 12;

/**
 * Pick one representative variant per flagship type from the already
 * vertical-filtered set, vertical-specific first. Preference inside a type:
 * whichever variant the registry lists first, which is the authored order in
 * `variants-register.ts` — i.e. the one whoever built the pack put first.
 */
export function curatedFlagships(
  visible: readonly WidgetVariant[],
  vertical: string,
  limit: number = CURATED_LIMIT,
): WidgetVariant[] {
  const byType = new Map<string, WidgetVariant>();
  for (const v of visible) {
    const t = String(v.widgetType);
    if (!byType.has(t)) byType.set(t, v);
  }
  const order = [...(VERTICAL_FLAGSHIP_TYPES[vertical] || []), ...UNIVERSAL_FLAGSHIP_TYPES];
  const out: WidgetVariant[] = [];
  const taken = new Set<string>();
  for (const t of order) {
    if (out.length >= limit) break;
    if (taken.has(t)) continue;
    const v = byType.get(t);
    if (!v) continue;
    taken.add(t);
    out.push(v);
  }
  // Never render an empty "start here" row: if this tenant's catalogue is so
  // narrow that none of the flagship types resolved, fall back to the first
  // few visible widgets. An empty curated section is the bug this whole phase
  // exists to kill.
  if (!out.length) return visible.slice(0, limit);
  return out;
}
