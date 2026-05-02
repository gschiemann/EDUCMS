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
};

export function isVertical(v: unknown): v is Vertical {
  return typeof v === 'string' && (VERTICALS as readonly string[]).includes(v);
}

export const DEFAULT_VERTICAL: Vertical = 'K12';
