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
};

export function isVertical(v: unknown): v is Vertical {
  return typeof v === 'string' && (VERTICALS as readonly string[]).includes(v);
}

export const DEFAULT_VERTICAL: Vertical = 'K12';

/**
 * Per-vertical role display labels. The DB enum values stay constant
 * (DISTRICT_ADMIN / SCHOOL_ADMIN / SUPER_ADMIN / CONTRIBUTOR /
 * RESTRICTED_VIEWER) but the human labels change so a gym admin
 * doesn't see "District Admin" on their team page. K12 keeps its
 * existing strings exactly.
 */
export const VERTICAL_ROLE_LABELS: Record<Vertical, Record<string, string>> = {
  K12: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'District Admin',
    SCHOOL_ADMIN:       'School Admin',
    CONTRIBUTOR:        'Contributor',
    RESTRICTED_VIEWER:  'Viewer',
  },
  GYM: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'Region Admin',
    SCHOOL_ADMIN:       'Gym Admin',
    CONTRIBUTOR:        'Trainer',
    RESTRICTED_VIEWER:  'Viewer',
  },
  RETAIL: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'Region Admin',
    SCHOOL_ADMIN:       'Store Admin',
    CONTRIBUTOR:        'Associate',
    RESTRICTED_VIEWER:  'Viewer',
  },
  CORPORATE: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'Company Admin',
    SCHOOL_ADMIN:       'Office Admin',
    CONTRIBUTOR:        'Editor',
    RESTRICTED_VIEWER:  'Viewer',
  },
  QSR: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'Brand Admin',
    SCHOOL_ADMIN:       'Restaurant Admin',
    CONTRIBUTOR:        'Manager',
    RESTRICTED_VIEWER:  'Viewer',
  },
  FASHION: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'Brand Admin',
    SCHOOL_ADMIN:       'Boutique Admin',
    CONTRIBUTOR:        'Stylist',
    RESTRICTED_VIEWER:  'Viewer',
  },
  BAR: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'Owner',
    SCHOOL_ADMIN:       'Manager',
    CONTRIBUTOR:        'Manager',
    RESTRICTED_VIEWER:  'Viewer',
  },
  HEALTHCARE: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'Network Admin',
    SCHOOL_ADMIN:       'Practice Admin',
    CONTRIBUTOR:        'Coordinator',
    RESTRICTED_VIEWER:  'Viewer',
  },
  HOSPITALITY: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'Group Admin',
    SCHOOL_ADMIN:       'Property Admin',
    CONTRIBUTOR:        'Manager',
    RESTRICTED_VIEWER:  'Viewer',
  },
  RESTAURANT: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'Group Admin',
    SCHOOL_ADMIN:       'Restaurant Admin',
    CONTRIBUTOR:        'Manager',
    RESTRICTED_VIEWER:  'Viewer',
  },
  SPORTS: {
    SUPER_ADMIN:        'Super Admin',
    DISTRICT_ADMIN:     'League Admin',
    SCHOOL_ADMIN:       'Venue Admin',
    CONTRIBUTOR:        'Game-Day Operator',
    RESTRICTED_VIEWER:  'Viewer',
  },
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
};

/**
 * Per-vertical template category tabs shown in the template gallery.
 * Each vertical gets its own taxonomy that maps to template.category
 * values seeded for that vertical. Falls back to a single "All" tab
 * if a vertical hasn't had its category set defined yet.
 */
export const VERTICAL_TEMPLATE_CATEGORIES: Record<Vertical, ReadonlyArray<{ key: string; label: string }>> = {
  K12: [
    { key: '',          label: 'All' },
    { key: 'LOBBY',     label: 'Welcome' },
    { key: 'HALLWAY',   label: 'Hallway' },
    { key: 'CAFETERIA', label: 'Cafeteria' },
    { key: 'ATHLETICS', label: 'Athletics' },
    { key: 'HOLIDAYS',  label: 'Holidays' },
  ],
  GYM: [
    { key: '',         label: 'All' },
    { key: 'FITNESS',  label: 'Class & training' },
    { key: 'LOBBY',    label: 'Welcome' },
    { key: 'PROMO',    label: 'Promo' },
  ],
  RETAIL: [
    { key: '',        label: 'All' },
    { key: 'LOBBY',   label: 'Welcome' },
    { key: 'PROMO',   label: 'Promo & sale' },
    { key: 'PRICING', label: 'Pricing' },
    { key: 'LOOKBOOK', label: 'Lookbook' },
    { key: 'HOLIDAYS', label: 'Seasonal' },
  ],
  CORPORATE: [
    { key: '',        label: 'All' },
    { key: 'LOBBY',   label: 'Welcome' },
    { key: 'CONFERENCE', label: 'Conference rooms' },
    { key: 'INTERNAL',   label: 'Internal comms' },
  ],
  QSR: [
    { key: '',         label: 'All' },
    { key: 'MENU',     label: 'Menu boards' },
    { key: 'PROMO',    label: 'Promo & combos' },
    { key: 'LOYALTY',  label: 'Loyalty' },
  ],
  FASHION: [
    { key: '',         label: 'All' },
    { key: 'LOOKBOOK', label: 'Lookbook' },
    { key: 'LOBBY',    label: 'Welcome' },
    { key: 'PROMO',    label: 'Promo' },
  ],
  BAR: [
    { key: '',       label: 'All' },
    { key: 'TAPS',   label: 'Tap list' },
    { key: 'PROMO',  label: 'Drink specials' },
    { key: 'EVENTS', label: 'Events' },
    { key: 'SPORTS', label: 'Sports' },
  ],
  HEALTHCARE: [
    { key: '',          label: 'All' },
    { key: 'WAITING',   label: 'Waiting room' },
    { key: 'DIRECTORY', label: 'Directory' },
    { key: 'PATIENT',   label: 'Patient info' },
  ],
  HOSPITALITY: [
    { key: '',          label: 'All' },
    { key: 'LOBBY',     label: 'Lobby' },
    { key: 'EVENTS',    label: 'Events' },
    { key: 'WAYFINDING', label: 'Wayfinding' },
    { key: 'AMENITIES', label: 'Amenities' },
  ],
  RESTAURANT: [
    { key: '',        label: 'All' },
    { key: 'MENU',    label: 'Menus' },
    { key: 'SPECIALS', label: 'Specials' },
    { key: 'WINE',    label: 'Wine & bar' },
  ],
  SPORTS: [
    { key: '',             label: 'All' },
    { key: 'SCOREBOARD',   label: 'Scoreboards' },
    { key: 'RIBBON',       label: 'Ribbon boards' },
    { key: 'CELEBRATION',  label: 'Celebrations' },
    { key: 'SPONSOR',      label: 'Sponsors' },
    { key: 'GAMEDAY',      label: 'Game day' },
  ],
};
