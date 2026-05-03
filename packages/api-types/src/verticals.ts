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
};

export function getRoleLabel(role: string, vertical: Vertical = DEFAULT_VERTICAL): string {
  return VERTICAL_ROLE_LABELS[vertical]?.[role] || role;
}

/**
 * Per-vertical default brand name. K12 tenants without custom branding
 * see "EduSignage" (existing pilot identity); everyone else sees
 * "VenueOS". Tenant.branding.displayName overrides this when set.
 */
export const VERTICAL_DEFAULT_BRAND: Record<Vertical, string> = {
  K12:       'EduSignage',
  GYM:       'VenueOS',
  RETAIL:    'VenueOS',
  CORPORATE: 'VenueOS',
  QSR:       'VenueOS',
  FASHION:   'VenueOS',
  BAR:       'VenueOS',
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
};
