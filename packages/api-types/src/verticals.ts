/**
 * VenueOS — industry vertical taxonomy.
 *
 * Single source of truth for the verticals our multi-industry CMS
 * supports. Drives:
 *   - Tenant.vertical default + validation (schema.prisma)
 *   - Template library categorization (Template.vertical)
 *   - UI terminology overrides (e.g. "Districts" vs "Locations")
 *   - Default widget palette per vertical
 *   - Onboarding flow vertical-picker
 *   - Per-vertical pricing SKUs (later)
 *
 * IMPORTANT: keep this enum in sync with the comment in
 * packages/database/prisma/schema.prisma::Tenant.vertical and
 * Template.vertical. Adding a new vertical requires:
 *   1. Add the const here
 *   2. Update the schema.prisma comment list (string column, no enum
 *      constraint, but the comment is the contract)
 *   3. Add UI strings + default templates + branding for the new vertical
 *   4. NOTE: existing tenant rows are unaffected — string column with
 *      `K12` default means new verticals are purely additive.
 *
 * 2026-05-02 — initial 6-vertical launch set per operator decision:
 *   K12 (existing pilot — preserve all behavior)
 *   GYM (fitness clubs, athletic facilities — repurposes the gym
 *        templates we sketched in earlier sprint work)
 *   RETAIL (apparel, big-box, specialty)
 *   CORPORATE (lobbies, internal comms, conference rooms)
 *   QSR (quick-service restaurants — menu boards, promo)
 *   FASHION (boutique apparel, runway, e-comm tie-ins)
 *   BAR (bars, taprooms, sports pubs, nightclubs — tap lists,
 *        cocktail menus, game day, happy hour, trivia, live events)
 *
 * The schema.prisma comment also lists FITNESS / RESTAURANT /
 * HEALTHCARE / OTHER from the original sprint plan; those remain
 * valid string values for forward-compatibility but aren't featured
 * in the launch set. GYM ⊂ FITNESS, QSR ⊂ RESTAURANT — distinct
 * brand categories chosen by the operator.
 */
export const VERTICALS = [
  'K12',
  'GYM',
  'RETAIL',
  'CORPORATE',
  'QSR',
  'FASHION',
  'BAR',
  // 2026-05-16 — added with the 70-template industry signage pack so
  // each pack is tied to a real, selectable vertical (a healthcare
  // tenant sees only healthcare templates, etc.). RESTAURANT is the
  // full-service counterpart to QSR (wine lists, prix-fixe, 86 board).
  'HEALTHCARE',
  'HOSPITALITY',
  'RESTAURANT',
  // 2026-05-16 — SPORTS is its own vertical for the VenueOS Sports
  // system (Sprint 13): stadiums, arenas, gyms, athletic programs.
  // Kept SEPARATE from K12 — a school's athletic department runs the
  // sports stack, but a standalone arena or pro venue is a sports
  // tenant with no K-12 context. Sports templates (scoreboards,
  // ribbon boards, celebrations) are tagged SPORTS so they never
  // bleed into other verticals' galleries.
  'SPORTS',
  // 2026-05-17 — houses of worship: churches, ministries, temples.
  // Worship widgets (service times, sermon cards, hymn board, giving
  // thermometer) are tagged WORSHIP so they stay in this vertical's
  // gallery only and never bleed into a school or restaurant palette.
  'WORSHIP',
] as const;

export type Vertical = (typeof VERTICALS)[number];

/**
 * Human-readable label for each vertical. Used in onboarding picker,
 * settings dropdowns, marketing copy. Plural / singular variants
 * deliberately separate so the UI can pick the right one in context.
 */
export const VERTICAL_LABELS: Record<Vertical, { singular: string; plural: string; emoji: string; tagline: string }> = {
  K12: {
    singular: 'School',
    plural: 'Schools',
    emoji: '🎓',
    tagline: 'K-12 districts, schools, campuses',
  },
  GYM: {
    singular: 'Gym',
    plural: 'Gyms',
    emoji: '🏋️',
    tagline: 'Fitness clubs, studios, athletic facilities',
  },
  RETAIL: {
    singular: 'Store',
    plural: 'Stores',
    emoji: '🛍️',
    tagline: 'Retail chains, big-box, specialty shops',
  },
  CORPORATE: {
    singular: 'Office',
    plural: 'Offices',
    emoji: '🏢',
    tagline: 'Corporate lobbies, conference rooms, internal comms',
  },
  QSR: {
    singular: 'Restaurant',
    plural: 'Restaurants',
    emoji: '🍔',
    tagline: 'Quick-service restaurants, menu boards, promotions',
  },
  FASHION: {
    singular: 'Boutique',
    plural: 'Boutiques',
    emoji: '👗',
    tagline: 'Fashion boutiques, apparel, runway',
  },
  BAR: {
    singular: 'Bar',
    plural: 'Bars',
    emoji: '🍺',
    tagline: 'Bars, taprooms, nightclubs, sports pubs',
  },
  HEALTHCARE: {
    singular: 'Practice',
    plural: 'Practices',
    emoji: '🏥',
    tagline: 'Clinics, hospitals, waiting rooms, patient comms',
  },
  HOSPITALITY: {
    singular: 'Property',
    plural: 'Properties',
    emoji: '🏨',
    tagline: 'Hotels, resorts, lobbies, concierge, wayfinding',
  },
  RESTAURANT: {
    singular: 'Restaurant',
    plural: 'Restaurants',
    emoji: '🍽️',
    tagline: 'Full-service restaurants, menus, wine lists, specials',
  },
  SPORTS: {
    singular: 'Venue',
    plural: 'Venues',
    emoji: '🏟️',
    tagline: 'Stadiums, arenas, gyms — scoreboards, ribbon boards, game day',
  },
  WORSHIP: {
    singular: 'Church',
    plural: 'Churches',
    emoji: '⛪',
    tagline: 'Churches, ministries, houses of worship',
  },
};

/**
 * Tenant-grouping noun. K12 customers think "districts"; everyone
 * else thinks "locations". The dashboard's nav + breadcrumbs read
 * from this so a hotel chain doesn't see "your district" on screen.
 */
export const VERTICAL_GROUP_NOUN: Record<Vertical, { singular: string; plural: string }> = {
  K12:       { singular: 'District',     plural: 'Districts' },
  GYM:       { singular: 'Region',       plural: 'Regions' },
  RETAIL:    { singular: 'Region',       plural: 'Regions' },
  CORPORATE: { singular: 'Company',      plural: 'Companies' },
  QSR:       { singular: 'Brand',        plural: 'Brands' },
  FASHION:   { singular: 'Brand',        plural: 'Brands' },
  BAR:       { singular: 'Group',        plural: 'Groups' },
  HEALTHCARE:  { singular: 'Network',  plural: 'Networks' },
  HOSPITALITY: { singular: 'Group',    plural: 'Groups' },
  RESTAURANT:  { singular: 'Group',    plural: 'Groups' },
  SPORTS:      { singular: 'League',   plural: 'Leagues' },
  WORSHIP:     { singular: 'Ministry', plural: 'Ministries' },
};

/**
 * Per-vertical default emergency types. K12 keeps the full panic set
 * (lockdown, evacuate, hold, secure, weather, medical) because that's
 * the load-bearing differentiator. Other verticals start with the
 * universal subset (evacuate + weather + medical) and can opt in to
 * more later.
 */
export const VERTICAL_EMERGENCY_TYPES: Record<Vertical, ReadonlyArray<'lockdown' | 'evacuate' | 'hold' | 'secure' | 'weather' | 'medical'>> = {
  K12:       ['lockdown', 'evacuate', 'hold', 'secure', 'weather', 'medical'],
  GYM:       ['evacuate', 'weather', 'medical'],
  RETAIL:    ['evacuate', 'weather', 'medical'],
  CORPORATE: ['evacuate', 'lockdown', 'weather', 'medical'],
  QSR:       ['evacuate', 'weather', 'medical'],
  FASHION:   ['evacuate', 'weather', 'medical'],
  BAR:       ['evacuate', 'weather', 'medical'],
  HEALTHCARE:  ['evacuate', 'lockdown', 'weather', 'medical'],
  HOSPITALITY: ['evacuate', 'weather', 'medical'],
  RESTAURANT:  ['evacuate', 'weather', 'medical'],
  // Sports venues are mass-gathering — severe weather (lightning) is
  // the load-bearing alert for outdoor games; full evac for stadiums.
  SPORTS:      ['evacuate', 'weather', 'medical', 'lockdown'],
  WORSHIP:     ['evacuate', 'weather', 'medical'],
};

export function isVertical(v: unknown): v is Vertical {
  return typeof v === 'string' && (VERTICALS as readonly string[]).includes(v);
}

export const DEFAULT_VERTICAL: Vertical = 'K12';

/**
 * Legacy / alias vertical values → their canonical replacement. Some
 * tenants (and a few older UI lists) carry pre-rename values that aren't
 * in VERTICALS, so isVertical() rejects them and the UI falls back to the
 * K12 default — showing e.g. a gym as "school". Map those aliases here so
 * the DISPLAY resolves correctly without rewriting the stored value.
 *
 *   FITNESS → GYM   (renamed 2026-05 — "GYM ⊂ FITNESS")
 */
export const VERTICAL_ALIASES: Record<string, Vertical> = {
  FITNESS: 'GYM',
};

/**
 * Resolve ANY raw vertical string (canonical, lowercase, legacy alias,
 * null, or garbage) to a canonical Vertical. Unknown → DEFAULT_VERTICAL.
 * Use this anywhere a stored/transmitted vertical drives UI, so a stray
 * legacy value never silently shows as "school".
 */
export function normalizeVertical(v: unknown): Vertical {
  if (isVertical(v)) return v;
  if (typeof v === 'string') {
    const up = v.toUpperCase();
    if (isVertical(up)) return up as Vertical;
    if (VERTICAL_ALIASES[up]) return VERTICAL_ALIASES[up];
  }
  return DEFAULT_VERTICAL;
}

/**
 * Per-vertical role display labels. The DB enum values stay constant
 * (DISTRICT_ADMIN / SCHOOL_ADMIN / SUPER_ADMIN / CONTRIBUTOR /
 * RESTRICTED_VIEWER) but the human labels change so a gym admin
 * doesn't see "District Admin" on their team page.
 *
 * 2026-05-25 — operator: "we are calling me a district admin even
 * though im in the venue, lets just generalize the admin names,
 * maybe super admin for the account creator." Per-vertical
 * variants (League Admin / Venue Admin / Brand Admin / Region
 * Admin / Boutique Admin / Ministry Admin / Game-Day Operator)
 * mostly read awkwardly outside their flagship vertical and made
 * the team page feel inconsistent across tenants. Generalized to
 * one neutral canonical set across EVERY vertical:
 *
 *   - SUPER_ADMIN       → "Platform Admin" (our company staff —
 *                          renamed from "Super Admin" so it can't
 *                          collide with the customer's top role
 *                          below; customers never see this).
 *   - DISTRICT_ADMIN    → "Super Admin"    (THE ACCOUNT CREATOR
 *                          for a tenant, per operator's exact ask.
 *                          Top of the customer hierarchy.)
 *   - SCHOOL_ADMIN      → "Admin"
 *   - CONTRIBUTOR       → "Editor"
 *   - RESTRICTED_VIEWER → "Viewer"
 *
 * The per-vertical map structure is preserved so we can re-introduce
 * vertical-specific labels later if a customer asks (e.g., a school
 * district wanting "District Admin" / "Principal" back). For now,
 * uniform labels mean a single mental model whether the operator is
 * running a school, a stadium, a hotel group, or a corporate office.
 */
const CANONICAL_ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN:        'Platform Admin',
  DISTRICT_ADMIN:     'Super Admin',
  SCHOOL_ADMIN:       'Admin',
  CONTRIBUTOR:        'Editor',
  RESTRICTED_VIEWER:  'Viewer',
};

export const VERTICAL_ROLE_LABELS: Record<Vertical, Record<string, string>> = {
  K12:         { ...CANONICAL_ROLE_LABELS },
  GYM:         { ...CANONICAL_ROLE_LABELS },
  RETAIL:      { ...CANONICAL_ROLE_LABELS },
  CORPORATE:   { ...CANONICAL_ROLE_LABELS },
  QSR:         { ...CANONICAL_ROLE_LABELS },
  FASHION:     { ...CANONICAL_ROLE_LABELS },
  BAR:         { ...CANONICAL_ROLE_LABELS },
  HEALTHCARE:  { ...CANONICAL_ROLE_LABELS },
  HOSPITALITY: { ...CANONICAL_ROLE_LABELS },
  RESTAURANT:  { ...CANONICAL_ROLE_LABELS },
  SPORTS:      { ...CANONICAL_ROLE_LABELS },
  WORSHIP:     { ...CANONICAL_ROLE_LABELS },
};

export function getRoleLabel(role: string, vertical: Vertical = DEFAULT_VERTICAL): string {
  return VERTICAL_ROLE_LABELS[vertical]?.[role] || role;
}

/**
 * Per-vertical default brand name. Every vertical defaults to "VenueOS"
 * — operator decision 2026-05-05: "lets change the default to Venue OS
 * right?" Customer-facing screens and the dashboard sidebar should never
 * read as "EduSignage" once a tenant has set their own brand kit, AND
 * the unbranded fallback should be the industry-agnostic VenueOS name
 * (not the K12-specific EduSignage identity that confused customers
 * mid-deploy). Tenant.branding.displayName overrides this when set —
 * so a tenant who's adopted their own brand never sees VenueOS either.
 */
export const VERTICAL_DEFAULT_BRAND: Record<Vertical, string> = {
  K12:       'VenueOS',
  GYM:       'VenueOS',
  RETAIL:    'VenueOS',
  CORPORATE: 'VenueOS',
  QSR:       'VenueOS',
  FASHION:   'VenueOS',
  BAR:       'VenueOS',
  HEALTHCARE:  'VenueOS',
  HOSPITALITY: 'VenueOS',
  RESTAURANT:  'VenueOS',
  SPORTS:      'VenueOS',
  WORSHIP:     'VenueOS',
};

/**
 * Per-vertical SAMPLE / EXAMPLE identity — the polished on-vertical
 * example a brand-new tenant sees before they've configured anything.
 * Added 2026-06-27 to fix the beta finding that a fresh tenant fell back
 * to generic placeholder copy across the board (the branding wizard,
 * the add-location form, and the onboarding flow) regardless of which
 * industry they picked — a worship admin saw "yourschool.org", a clinic
 * saw "Lincoln High School", etc.
 *
 * This is the SINGLE SOURCE OF TRUTH for per-vertical sample identity so
 * the three UI surfaces that previously hard-coded their own copies
 * (apps/web BrandingWizard EXAMPLES_BY_VERTICAL + PLACEHOLDER_BY_VERTICAL,
 * apps/web DistrictSchoolsCard COPY) can converge on one map and never
 * drift again.
 *
 *   - exampleName  : a realistic tenant name for that industry (form
 *                    placeholder + onboarding sample).
 *   - exampleSlug  : the slug that name would derive to.
 *   - sampleUrl    : a real, scrape-friendly website for the branding
 *                    wizard's "Try an example" affordance. Hand-picked
 *                    to avoid aggressive Cloudflare/Akamai bot protection
 *                    where possible; if one is blocked the wizard shows
 *                    the friendly BRANDING_BLOCKED message and the
 *                    operator can paste their own.
 *   - urlPlaceholder : the "https://www.yourX.com" hint for the URL input.
 *
 * Every entry is industry-appropriate so a fresh tenant's first
 * impression is never the K-12 product wearing another industry's hat.
 */
export interface VerticalSample {
  exampleName: string;
  exampleSlug: string;
  sampleUrl: string;
  urlPlaceholder: string;
}

export const VERTICAL_SAMPLE: Record<Vertical, VerticalSample> = {
  K12:         { exampleName: 'Lincoln High School',   exampleSlug: 'lincoln-high',     sampleUrl: 'https://www.stanford.edu/',           urlPlaceholder: 'https://www.yourschool.org' },
  GYM:         { exampleName: 'Chicago Loop Gym',      exampleSlug: 'chicago-loop',     sampleUrl: 'https://www.crunch.com/',             urlPlaceholder: 'https://www.yourgym.com' },
  RETAIL:      { exampleName: 'Mall of America Store', exampleSlug: 'mall-of-america',  sampleUrl: 'https://www.patagonia.com/',          urlPlaceholder: 'https://www.yourstore.com' },
  CORPORATE:   { exampleName: 'San Francisco Office',  exampleSlug: 'san-francisco',    sampleUrl: 'https://www.hubspot.com/',            urlPlaceholder: 'https://www.yourcompany.com' },
  QSR:         { exampleName: 'Times Square Location', exampleSlug: 'times-square',     sampleUrl: 'https://www.chipotle.com/',           urlPlaceholder: 'https://www.yourrestaurant.com' },
  FASHION:     { exampleName: 'SoHo Studio',           exampleSlug: 'soho',             sampleUrl: 'https://www.everlane.com/',           urlPlaceholder: 'https://www.yourboutique.com' },
  BAR:         { exampleName: 'Downtown Taproom',      exampleSlug: 'downtown-taproom', sampleUrl: 'https://www.stonebrewing.com/',       urlPlaceholder: 'https://www.yourbar.com' },
  HEALTHCARE:  { exampleName: 'Downtown Clinic',       exampleSlug: 'downtown-clinic',  sampleUrl: 'https://www.onemedical.com/',         urlPlaceholder: 'https://www.yourpractice.com' },
  HOSPITALITY: { exampleName: 'The Grand Hotel',       exampleSlug: 'grand-hotel',      sampleUrl: 'https://www.kimptonhotels.com/',      urlPlaceholder: 'https://www.yourhotel.com' },
  RESTAURANT:  { exampleName: 'The Riverside Grill',   exampleSlug: 'riverside-grill',  sampleUrl: 'https://www.texasroadhouse.com/',     urlPlaceholder: 'https://www.yourrestaurant.com' },
  SPORTS:      { exampleName: 'Memorial Stadium',      exampleSlug: 'memorial-stadium', sampleUrl: 'https://www.ncaa.com/',               urlPlaceholder: 'https://www.yourteam.com' },
  WORSHIP:     { exampleName: 'Grace Community Church', exampleSlug: 'grace-community',  sampleUrl: 'https://www.life.church/',            urlPlaceholder: 'https://www.yourchurch.org' },
};

/** Neutral sample for an unknown / unset / 'venue' vertical. */
export const NEUTRAL_SAMPLE: VerticalSample = {
  exampleName: 'Downtown',
  exampleSlug: 'downtown',
  sampleUrl: 'https://www.example.com/',
  urlPlaceholder: 'https://www.yourwebsite.com',
};

/**
 * Resolve the sample identity for ANY raw vertical string (canonical,
 * lowercase, or legacy alias). Unknown / 'venue' / unset → NEUTRAL.
 */
export function getVerticalSample(vertical: unknown): VerticalSample {
  if (typeof vertical === 'string') {
    const up = vertical.toUpperCase();
    if (isVertical(up)) return VERTICAL_SAMPLE[up as Vertical];
    if (VERTICAL_ALIASES[up]) return VERTICAL_SAMPLE[VERTICAL_ALIASES[up]];
  }
  return NEUTRAL_SAMPLE;
}

/**
 * Per-vertical template category tabs shown in the template gallery.
 * Each vertical gets its own taxonomy that maps to template.category
 * values seeded for that vertical. Falls back to a single "All" tab
 * if a vertical hasn't had its category set defined yet.
 */
export const VERTICAL_TEMPLATE_CATEGORIES: Record<Vertical, ReadonlyArray<{ key: string; label: string }>> = {
  K12: [
    { key: '',          label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'LOBBY',     label: 'Welcome' },
    { key: 'HALLWAY',   label: 'Hallway' },
    { key: 'CAFETERIA', label: 'Cafeteria' },
    { key: 'ATHLETICS', label: 'Athletics' },
    { key: 'HOLIDAYS',  label: 'Holidays' },
  ],
  GYM: [
    { key: '',         label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'FITNESS',  label: 'Class & training' },
    { key: 'LOBBY',    label: 'Welcome' },
    { key: 'PROMO',    label: 'Promo' },
  ],
  RETAIL: [
    { key: '',        label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'LOBBY',   label: 'Welcome' },
    { key: 'PROMO',   label: 'Promo & sale' },
    { key: 'PRICING', label: 'Pricing' },
    { key: 'LOOKBOOK', label: 'Lookbook' },
    { key: 'HOLIDAYS', label: 'Seasonal' },
  ],
  CORPORATE: [
    { key: '',        label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'LOBBY',   label: 'Welcome' },
    { key: 'CONFERENCE', label: 'Conference rooms' },
    { key: 'INTERNAL',   label: 'Internal comms' },
  ],
  QSR: [
    { key: '',         label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'MENU',     label: 'Menu boards' },
    { key: 'PROMO',    label: 'Promo & combos' },
    { key: 'LOYALTY',  label: 'Loyalty' },
  ],
  FASHION: [
    { key: '',         label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'LOOKBOOK', label: 'Lookbook' },
    { key: 'LOBBY',    label: 'Welcome' },
    { key: 'PROMO',    label: 'Promo' },
  ],
  BAR: [
    { key: '',       label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'TAPS',   label: 'Tap list' },
    { key: 'PROMO',  label: 'Drink specials' },
    { key: 'EVENTS', label: 'Events' },
    { key: 'SPORTS', label: 'Sports' },
  ],
  HEALTHCARE: [
    { key: '',          label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'WAITING',   label: 'Waiting room' },
    { key: 'DIRECTORY', label: 'Directory' },
    { key: 'PATIENT',   label: 'Patient info' },
  ],
  HOSPITALITY: [
    { key: '',          label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'LOBBY',     label: 'Lobby' },
    { key: 'EVENTS',    label: 'Events' },
    { key: 'WAYFINDING', label: 'Wayfinding' },
    { key: 'AMENITIES', label: 'Amenities' },
  ],
  RESTAURANT: [
    { key: '',        label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'MENU',    label: 'Menus' },
    { key: 'SPECIALS', label: 'Specials' },
    { key: 'WINE',    label: 'Wine & bar' },
  ],
  SPORTS: [
    { key: '',             label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'SCOREBOARD',   label: 'Scoreboards' },
    { key: 'RIBBON',       label: 'Ribbon boards' },
    { key: 'CELEBRATION',  label: 'Celebrations' },
    { key: 'SPONSOR',      label: 'Sponsors' },
    { key: 'GAMEDAY',      label: 'Game day' },
  ],
  WORSHIP: [
    { key: '',        label: 'All' },
    { key: 'KIOSK', label: 'Touch Kiosks' },
    { key: 'SERVICE', label: 'Services' },
    { key: 'SERMON',  label: 'Sermons' },
    { key: 'EVENTS',  label: 'Events' },
    { key: 'GIVING',  label: 'Giving' },
  ],
};

// Per-vertical example prompts for the "Generate a template with AI" modal.
// `kiosk` = touch-kiosk suggestions (tap-driven scenes); `signage` =
// passive board suggestions. The chips were hard-coded K-12 ("Cafeteria
// menu / Library map / After-school programs / Front-desk visitor sign-in")
// on EVERY vertical incl. Sports — these make them vertical-aware. Keyed by
// the existing `Vertical` enum so it stays in lockstep with the rest of the
// per-vertical maps above. Callers fall back to NEUTRAL_AI_TEMPLATE_PROMPTS
// for an unknown / unset vertical.
export const VERTICAL_AI_TEMPLATE_PROMPTS: Record<Vertical, { kiosk: ReadonlyArray<string>; signage: ReadonlyArray<string> }> = {
  K12: {
    kiosk: [
      'Wi-Fi info screen with QR code and password',
      'Cafeteria menu with tap-to-see-allergens',
      'Library map with tap on each section',
      'After-school programs picker',
      'Front-desk visitor sign-in kiosk',
    ],
    signage: [
      'Welcome lobby board with logo, clock and weather',
      'Daily announcements ticker with photo strip',
      'Event countdown with a big hero image',
      'Cafeteria menu of the day',
      'Staff spotlight with rotating quotes',
    ],
  },
  GYM: {
    kiosk: [
      'Class schedule with tap to see today\'s sessions',
      'Membership tiers with tap-to-compare',
      'Wi-Fi and locker info screen with QR code',
      'Personal-trainer picker with bios',
    ],
    signage: [
      'Today\'s class schedule board with instructor photos',
      'New-member promo with a big hero image',
      'Personal-training spotlight with rotating testimonials',
      'Gym hours and amenities welcome board',
    ],
  },
  RETAIL: {
    kiosk: [
      'Store directory with tap on each department',
      'Loyalty sign-up kiosk with QR code',
      'Product lookbook with tap to browse',
      'Today\'s deals picker',
    ],
    signage: [
      'Weekend sale board with big price callouts',
      'New-arrivals lookbook with rotating photos',
      'Loyalty program promo with QR code',
      'Seasonal storefront welcome board',
    ],
  },
  CORPORATE: {
    kiosk: [
      'Lobby check-in kiosk with visitor sign-in',
      'Conference-room finder with tap on each room',
      'Building directory with tap to search',
      'Wi-Fi and guest info screen with QR code',
    ],
    signage: [
      'Lobby welcome board with logo, clock and news ticker',
      'Conference-room schedule board',
      'Internal comms board with announcements and KPIs',
      'Visitor welcome board for today\'s meetings',
    ],
  },
  QSR: {
    kiosk: [
      'Order kiosk with tap-to-build a combo',
      'Loyalty sign-up screen with QR code',
      'Allergen and calorie info picker',
      'Today\'s deals kiosk',
    ],
    signage: [
      'Digital menu board with combos and prices',
      'Limited-time-offer promo with a big hero shot',
      'Loyalty program board with QR code',
      'Drive-thru order-here / pay-here board',
    ],
  },
  FASHION: {
    kiosk: [
      'Lookbook with tap to browse this season',
      'Style finder with tap on each category',
      'Loyalty sign-up kiosk with QR code',
      'Store directory with tap on each floor',
    ],
    signage: [
      'New-collection lookbook with rotating editorial photos',
      'Seasonal sale board with bold price callouts',
      'Brand-story welcome board with logo and hero image',
      'Window-display promo with a single hero look',
    ],
  },
  BAR: {
    kiosk: [
      'Tap list with tap to see each beer\'s ABV and notes',
      'Tonight\'s events picker',
      'Drink-specials menu with tap-to-see ingredients',
      'Wi-Fi info screen with QR code',
    ],
    signage: [
      'Tap-list board with ABV, brewery and price',
      'Happy-hour specials board with a bold headline',
      'Tonight\'s live-music / events board',
      'Big-game watch-party board with the matchup',
    ],
  },
  HEALTHCARE: {
    kiosk: [
      'Patient check-in kiosk with tap-to-start',
      'Department directory with tap to find a clinic',
      'Wayfinding map with tap on each wing',
      'Wi-Fi and visitor info screen with QR code',
    ],
    signage: [
      'Waiting-room board with now-serving and wait times',
      'Department directory and wayfinding board',
      'Patient-education board with rotating health tips',
      'Lobby welcome board with clock and hours',
    ],
  },
  HOSPITALITY: {
    kiosk: [
      'Guest check-in kiosk with tap-to-start',
      'Property map with tap on each amenity',
      'Today\'s events picker',
      'Concierge info screen with Wi-Fi QR code',
    ],
    signage: [
      'Lobby welcome board with logo, clock and local weather',
      'Today\'s events and meetings board',
      'Amenities and dining-hours board',
      'Wayfinding board with directions to key areas',
    ],
  },
  RESTAURANT: {
    kiosk: [
      'Menu with tap to see each dish\'s ingredients and allergens',
      'Wine list with tap-to-pair',
      'Reservation / waitlist kiosk with QR code',
      'Tonight\'s specials picker',
    ],
    signage: [
      'Dinner menu board with sections and prices',
      'Tonight\'s specials board with a hero plating shot',
      'Wine-and-bar board with by-the-glass pours',
      'Prix-fixe / chef\'s-tasting board',
    ],
  },
  SPORTS: {
    kiosk: [
      'Concourse wayfinding kiosk with tap on each section',
      'Tonight\'s matchup info screen with QR to tickets',
      'Concessions menu with tap-to-see each stand',
      'Fan Wi-Fi and stadium info screen with QR code',
    ],
    signage: [
      'Stadium scoreboard with home/away score, clock and period',
      'Game-day matchup board with team records and kickoff countdown',
      'Sponsor rotator strip for the ribbon board',
      'Concourse concessions board with stands and prices',
    ],
  },
  WORSHIP: {
    kiosk: [
      'Welcome kiosk with tap to find today\'s service',
      'Ministry directory with tap on each group',
      'Giving kiosk with QR code',
      'Campus map with tap on each room',
    ],
    signage: [
      'Service-times welcome board with logo and clock',
      'This-week ministries and events board',
      'Sermon-series board with a hero image',
      'Giving thermometer board toward a goal',
    ],
  },
};

// Neutral fallback for an unknown / unset vertical — generic enough for any
// venue so a board still gets sensible suggestion chips.
export const NEUTRAL_AI_TEMPLATE_PROMPTS: { kiosk: ReadonlyArray<string>; signage: ReadonlyArray<string> } = {
  kiosk: [
    'Lobby check-in kiosk with three tap buttons',
    'Directory with tap on each section',
    'Wi-Fi info screen with QR code',
    'Today\'s info picker',
  ],
  signage: [
    'Welcome lobby board with logo, clock and weather',
    'Announcements ticker with a rotating photo strip',
    'Event countdown with a big hero image',
    'Promo board with a bold headline and image',
  ],
};

/** Resolve the AI-template suggestion chips for a vertical, with fallback. */
export function getAiTemplatePrompts(vertical: Vertical | string | undefined): { kiosk: ReadonlyArray<string>; signage: ReadonlyArray<string> } {
  const v = vertical as Vertical;
  return (v && VERTICAL_AI_TEMPLATE_PROMPTS[v]) || NEUTRAL_AI_TEMPLATE_PROMPTS;
}

/**
 * Per-vertical DESIGN AFFINITY — the layout archetypes + visual themes that look
 * on-brand for each industry. Added 2026-06-27 to fix the core AI-template
 * weakness: the vertical previously steered ONLY copy tone, so archetype + theme
 * were the model's free guess and a gym promo / worship verse / corporate KPI
 * board all rolled the same dice and routinely fell back to cold corporate navy.
 *
 * The art-director engine consumes this TWO ways (apps/api/src/ai/ai.service.ts
 * buildSignageBoardCore):
 *   1. as a SOFT HINT in the generation prompt ("prefer these archetypes/themes;
 *      deviate only if the description clearly calls for it"), and
 *   2. as the DETERMINISTIC FALLBACK when the model omits/garbles its pick — so
 *      the failure mode is the vertical's own on-brand look, never cold navy.
 *
 * Archetype ids mirror @cms/signage-design ARCHETYPE_IDS; theme ids mirror its
 * THEMES. Kept as plain strings so this package stays dependency-light; the
 * signage-design test suite asserts every id here resolves (no drift).
 * Order = preference — element [0] is the deterministic default.
 */
export interface VerticalDesignAffinity {
  archetypes: ReadonlyArray<string>;
  themes: ReadonlyArray<string>;
}

export const VERTICAL_DESIGN_AFFINITY: Record<Vertical, VerticalDesignAffinity> = {
  K12:         { archetypes: ['title-cta', 'three-up-grid', 'stat-spotlight', 'hero-fullbleed'], themes: ['warm-school', 'sky-civic'] },
  GYM:         { archetypes: ['stat-spotlight', 'hero-fullbleed', 'title-cta', 'split-50'],       themes: ['fresh-fitness', 'neon-sports'] },
  RETAIL:      { archetypes: ['poster-promo', 'hero-fullbleed', 'three-up-grid'],                 themes: ['bold-retail', 'minimal-luxury'] },
  CORPORATE:   { archetypes: ['split-50', 'stat-spotlight', 'title-cta'],                         themes: ['clean-corporate', 'minimal-luxury'] },
  QSR:         { archetypes: ['menu-list', 'poster-promo', 'title-cta'],                          themes: ['qsr-appetite', 'bold-retail'] },
  FASHION:     { archetypes: ['poster-promo', 'hero-fullbleed', 'quote-spotlight'],              themes: ['minimal-luxury', 'bold-retail'] },
  BAR:         { archetypes: ['poster-promo', 'lower-third-banner', 'title-cta'],                themes: ['bold-retail', 'neon-sports'] },
  HEALTHCARE:  { archetypes: ['three-up-grid', 'title-cta', 'split-50'],                          themes: ['calm-clinic', 'sky-civic'] },
  HOSPITALITY: { archetypes: ['hero-fullbleed', 'split-50', 'title-cta'],                         themes: ['minimal-luxury', 'worship-warm'] },
  RESTAURANT:  { archetypes: ['menu-list', 'hero-fullbleed', 'split-50'],                         themes: ['minimal-luxury', 'qsr-appetite'] },
  SPORTS:      { archetypes: ['stat-spotlight', 'hero-fullbleed', 'lower-third-banner'],          themes: ['neon-sports', 'bold-retail'] },
  WORSHIP:     { archetypes: ['quote-spotlight', 'title-cta', 'three-up-grid'],                   themes: ['worship-warm', 'warm-school'] },
};

/** Generic affinity for an unset / 'venue' / unknown vertical. NOT K12 — a
 *  no-vertical tenant should fall back to a neutral professional look, not the
 *  school palette (that's why this can't reuse normalizeVertical, which maps
 *  unknown → K12). */
export const NEUTRAL_DESIGN_AFFINITY: VerticalDesignAffinity = {
  archetypes: ['title-cta', 'hero-fullbleed', 'stat-spotlight'],
  themes: ['clean-corporate', 'minimal-luxury'],
};

/**
 * Resolve design affinity for ANY raw vertical string (canonical, lowercase, or
 * legacy alias). Unknown / 'venue' / unset → NEUTRAL (never K12). */
export function getVerticalDesignAffinity(vertical: unknown): VerticalDesignAffinity {
  if (typeof vertical === 'string') {
    const up = vertical.toUpperCase();
    if (isVertical(up)) return VERTICAL_DESIGN_AFFINITY[up as Vertical];
    if (VERTICAL_ALIASES[up]) return VERTICAL_DESIGN_AFFINITY[VERTICAL_ALIASES[up]];
  }
  return NEUTRAL_DESIGN_AFFINITY;
}
