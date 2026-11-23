// ─── Organisation identity keys per React widget — SINGLE SOURCE OF TRUTH ───
//
// Which zone-config keys of a themed React widget hold the ORGANISATION's
// name, tagline, initials or logo, and which placeholder text that widget's
// renderer paints when the key is absent. Both sides read this one list (the
// QUARANTINED_BOARD_URLS precedent), so it needs no PARITY copy:
//   • API — apps/api/src/branding/brand-identity.ts patchZoneIdentity(), used by
//     Settings > Brand "Apply to templates" and by clone / duplicate / create.
//   • Web — apps/web/src/components/template-builder/brand-kit-actions.ts
//     brandZoneConfig() ("Brand this template" in the editor's Brand tab).
//
// The rule it serves (owner, 2026-11-23: "make sure that when I rebrand
// something everything gets updated that's available"): a value nobody typed —
// blank, a previous brand's, or still the renderer's OWN placeholder — belongs
// to the brand and is replaced by the organisation's identity. A value the
// tenant typed survives "fill blanks".
//
// A placeholder that is a GENERIC word a tenant could type as their own
// ('WILDCATS', 'WHS', 'HS', 'CENTRAL ADMINISTRATION') is marked `generic`. It
// counts as nobody's only on a template with no brand history for that role
// (no previous brand with a name, for a name or initials key): once a brand
// has named the template, the clone and apply paths have written that brand
// over the placeholder, so the same word back in the key was typed by hand.
// A fictional sample organisation ('WESTRIDGE WILDCATS', 'Roosevelt Academy')
// is not generic and always matches.
//
// Every key and every placeholder literal here is copied from the renderer
// file and pinned by apps/api/src/branding/identity-registry.spec.ts:
//   1. the renderer READS the key (pick('k'), pick(config,'k'), c.k, config.k,
//      c['k']) — a DEFAULTS or interface line alone does not count;
//   2. each placeholder appears verbatim in that renderer, and a text key has
//      `data-field="k"` there (a placeholder without one was never persistable);
//   3. every identity read in widgets/{ms,hs,fitness}, Animated*, themes/* and
//      v2/LogoWidgets is registered here or listed in EXCLUDED_IDENTITY_KEYS;
//   4. no variant is registered for a non-LOGO type in this table, so variant
//      and theme selectors only matter for LOGO;
//   5. no system preset ships an identity value that is not a placeholder here.
//
// Keys are FLAT config keys, exactly as the renderer reads them: the MS
// scenes' pick() reads `config['school.name']`, not `config.school.name`.
// Never add a key a renderer does not read, and never invent a placeholder.

export type IdentityRole = 'name' | 'tagline' | 'initials' | 'logo';

/** Which renderer of a type a zone resolves to: its `variant` id, else (LOGO) its `theme`. */
export interface IdentitySelector {
  variants?: readonly string[];
  themes?: readonly string[];
}

/** A literal the renderer paints when the key is absent (DEFAULTS / FALLBACK / `|| 'literal'`). */
export interface IdentityPlaceholder {
  text: string;
  /** Only on this renderer (no selector = every zone of the type). */
  when?: IdentitySelector;
  /**
   * A generic word a tenant could type as their own (a mascot, an
   * abbreviation, an office name), not a fictional sample organisation.
   * Matched only on a template with no brand history for the key's role
   * (placeholdersFor `{ generic: false }` drops it otherwise).
   */
  generic?: boolean;
}

export interface IdentityKeySpec {
  /** The FLAT config key the renderer reads ('schoolName', 'school.name', 'gymLogoUrl'). */
  key: string;
  role: IdentityRole;
  /** Write the name uppercased (the design is all-caps). */
  upper?: boolean;
  /** Write only when the key already exists... */
  onlyIfPresent?: boolean;
  /** ...unless the zone resolves to this renderer. */
  absentWhen?: IdentitySelector;
  placeholders?: readonly IdentityPlaceholder[];
}

/**
 * The five v2 logo variants (v2/registry.ts LOGO_NEON, LOGO_PAPER, LOGO_CRAYON,
 * LOGO_GLASS, LOGO_OPS, kebab-cased by variants-register.ts). They render
 * v2/LogoWidgets.tsx, whose FALLBACK is the placeholder below.
 */
export const V2_LOGO_VARIANT_IDS: readonly string[] = [
  'logo-neon',
  'logo-paper',
  'logo-crayon',
  'logo-glass',
  'logo-ops',
];

const V2_LOGOS: IdentitySelector = { variants: V2_LOGO_VARIANT_IDS };
const OFFICE_DASHBOARD_LOGO: IdentitySelector = { variants: ['logo-dashboard'], themes: ['office-dashboard'] };
const ATHLETICS_LOGO: IdentitySelector = { variants: ['logo-athletics'], themes: ['high-school-athletics'] };

/** A generic placeholder (see IdentityPlaceholder.generic). */
const generic = (text: string, when?: IdentitySelector): IdentityPlaceholder => ({
  text,
  ...(when ? { when } : {}),
  generic: true,
});
const asPlaceholder = (p: string | IdentityPlaceholder): IdentityPlaceholder =>
  typeof p === 'string' ? { text: p } : p;

const name = (
  key: string,
  placeholders: ReadonlyArray<string | IdentityPlaceholder>,
  upper = false,
): IdentityKeySpec => ({
  key,
  role: 'name',
  ...(upper ? { upper: true } : {}),
  placeholders: placeholders.map(asPlaceholder),
});
const logo = (key: string): IdentityKeySpec => ({ key, role: 'logo' });
const initials = (key: string, placeholders: ReadonlyArray<string | IdentityPlaceholder>): IdentityKeySpec => ({
  key,
  role: 'initials',
  placeholders: placeholders.map(asPlaceholder),
});

/** The same specs for a landscape type and its _PORTRAIT twin. */
function both(type: string, specs: readonly IdentityKeySpec[]): Array<[string, readonly IdentityKeySpec[]]> {
  return [[type, specs], [`${type}_PORTRAIT`, specs]];
}

const FITNESS_GYM_LOGO_TYPES = [
  'FITNESS_CHANNEL_GUIDE',
  'FITNESS_CRAG',
  'FITNESS_IRON',
  'FITNESS_LOBBY',
  'FITNESS_LOCKER',
  'FITNESS_MARQUEE',
  'FITNESS_RECESS',
  'FITNESS_REFORMER',
  'FITNESS_SPLASH',
  'FITNESS_STADIUM',
  'FITNESS_TELEMETRY',
  'FITNESS_TRAILHEAD',
  'FITNESS_VAULT',
] as const;

const ANIMATED_WELCOME_TYPES = [
  'ANIMATED_WELCOME',
  'ANIMATED_WELCOME_PORTRAIT',
  'ANIMATED_WELCOME_MS',
  'ANIMATED_WELCOME_MS_PORTRAIT',
  'ANIMATED_WELCOME_HS',
  'ANIMATED_WELCOME_HS_PORTRAIT',
] as const;

/**
 * Widget type → the identity keys its renderer reads. A type listed with `[]`
 * reads none (nothing is written there). A type not listed keeps the older
 * rule: identity keys only when its saved config already carries `schoolName`.
 * EXTERNAL_HTML boards are not here: they use the board field lists.
 */
export const WIDGET_IDENTITY_KEYS: Readonly<Record<string, readonly IdentityKeySpec[]>> = Object.freeze({
  // WidgetRenderer.tsx LogoWidget (assetUrl), v2/LogoWidgets.tsx (logoUrl,
  // schoolName, tagline; FALLBACK), themes/office-dashboard.tsx
  // (`config.schoolName || 'CENTRAL ADMINISTRATION'`), themes/high-school-
  // athletics.tsx AthleticsLogo (`config.initials || 'HS'`, which does not
  // derive from schoolName). The other themed crests derive their initials
  // from schoolName, so `initials` is written there only when it is present.
  LOGO: [
    logo('logoUrl'),
    logo('assetUrl'),
    {
      key: 'schoolName',
      role: 'name',
      placeholders: [
        { text: 'Roosevelt Academy', when: V2_LOGOS },
        // A district office could type this as its own name.
        generic('CENTRAL ADMINISTRATION', OFFICE_DASHBOARD_LOGO),
      ],
    },
    {
      key: 'tagline',
      role: 'tagline',
      placeholders: [{ text: 'Excellence · Honor · Service', when: V2_LOGOS }],
    },
    {
      key: 'initials',
      role: 'initials',
      onlyIfPresent: true,
      absentWhen: ATHLETICS_LOGO,
      placeholders: [generic('HS', ATHLETICS_LOGO)],
    },
  ],

  // ── High school scenes (hs/*; DEFAULTS merged under the config) ──
  // 'WILDCATS' (a common mascot, the portrait's big wordmark) and 'WHS' (the
  // real abbreviation of many schools) are generic; the landscape's
  // 'WESTRIDGE WILDCATS' is the fictional sample school.
  HS_VARSITY: [name('schoolName', ['WESTRIDGE WILDCATS'], true), initials('schoolInitials', [generic('WHS')])],
  HS_VARSITY_PORTRAIT: [name('schoolName', [generic('WILDCATS')], true), initials('schoolInitials', [generic('WHS')])],
  HS_BROADCAST: [name('schoolName', ['WESTRIDGE HIGH'], true)],
  HS_BROADCAST_PORTRAIT: [name('schoolName', ['WESTRIDGE HIGH'], true)],
  HS_YEARBOOK: [name('schoolName', ['The Westridge Review'], true)],
  HS_YEARBOOK_PORTRAIT: [name('schoolName', ['Westridge Weekly'], true)],
  ...Object.fromEntries([
    ...both('HS_GALLERY', [name('schoolName', ['The Westridge High School Review'], true)]),
    ...both('HS_BLUEPRINT', [name('schoolName', ['WESTRIDGE HIGH · EST 1956'], true)]),
    ...both('HS_ZINE', [name('schoolName', ['WESTRIDGE!'], true)]),
    // Terminal and Transit read no identity key (host / path / station copy).
    ...both('HS_TERMINAL', []),
    ...both('HS_TRANSIT', []),

    // ── Middle school scenes (ms/*; pick() reads the FLAT dotted key) ──
    ...both('MS_ARCADE', [name('school.name', ['WESTRIDGE.MS'], true), logo('school.logoUrl')]),
    ...both('MS_ATLAS', [name('brand.name', ['WESTRIDGE.MS'], true), logo('brand.logoUrl')]),
    ...both('MS_HOMEROOM', [name('school.name', ['Westridge Middle']), logo('school.logoUrl')]),
    // Renders "<name> & Otters" (school.amp + school.mascot follow).
    ...both('MS_FIELDNOTES', [name('school.name', ['Westridge']), logo('school.logoUrl')]),
    // Renders "<NAME> .MS" (school.callsign follows).
    ...both('MS_STUDIO', [name('school.name', ['WESTRIDGE'], true), logo('school.logoUrl')]),
    // school.name is excluded (see EXCLUDED_IDENTITY_KEYS): a two-part lockup.
    ...both('MS_GREENHOUSE', [logo('school.logoUrl')]),
    ...both('MS_PLAYLIST', [logo('brand.logoUrl')]),
    ...both('MS_PAPER', [logo('masthead.logoUrl')]),

    // ── Fitness scenes: the gym logo slot (there is no gym-name key) ──
    ...FITNESS_GYM_LOGO_TYPES.map((t): [string, readonly IdentityKeySpec[]] => [t, [logo('gymLogoUrl')]]),

    // ── Animated K-12 scenes ──
    // `c.logoUrl ? <img> : emoji` — the logo replaces the emoji.
    ...ANIMATED_WELCOME_TYPES.map((t): [string, readonly IdentityKeySpec[]] => [t, [logo('logoUrl')]]),
    ...both('ANIMATED_HALLWAY_SCHEDULE', [
      { key: 'tagline', role: 'tagline', placeholders: [{ text: 'every day a new adventure' }] },
    ]),
  ]),
});

export interface IdentityExclusion { key: string; reason: string }
const TEAM = 'the team, not the organisation';
const PHRASE = 'a phrase, not the organisation name';
const GREENHOUSE_NAME =
  "a lockup with school.name2 ('Middle') and no separator: it would render 'Lincoln AcademyMiddle', and pick() treats '' as the default, so name2 cannot be blanked";

/** The same exclusions for a landscape type and its _PORTRAIT twin. */
function bothExcluded(type: string, list: readonly IdentityExclusion[]): Array<[string, readonly IdentityExclusion[]]> {
  return [[type, list], [`${type}_PORTRAIT`, list]];
}

/**
 * Identity-looking keys deliberately NOT written, each with its reason. A
 * record key is a widget type, or `TYPE/renderer` for one renderer of a type.
 */
export const EXCLUDED_IDENTITY_KEYS: Readonly<Record<string, ReadonlyArray<IdentityExclusion>>> = Object.freeze({
  ...Object.fromEntries([
    ...bothExcluded('MS_GREENHOUSE', [
      { key: 'school.name', reason: GREENHOUSE_NAME },
      { key: 'school.tag', reason: PHRASE },
      { key: 'school.eye', reason: PHRASE },
    ]),
    ...bothExcluded('MS_PLAYLIST', [{ key: 'profile.initials', reason: "a student's initials" }]),
    ...bothExcluded('MS_ARCADE', [{ key: 'school.team', reason: TEAM }]),
    ...bothExcluded('MS_HOMEROOM', [{ key: 'school.team', reason: TEAM }]),
    ...bothExcluded('MS_STUDIO', [
      { key: 'school.team', reason: TEAM },
      { key: 'school.eye', reason: PHRASE },
    ]),
    ...bothExcluded('MS_FIELDNOTES', [
      { key: 'school.mascot', reason: 'the mascot, not the organisation' },
      { key: 'school.sub', reason: PHRASE },
    ]),
    ...bothExcluded('MS_ATLAS', [
      { key: 'brand.sub', reason: PHRASE },
      { key: 'brand.eye', reason: PHRASE },
    ]),
    ...bothExcluded('MS_PAPER', [{ key: 'masthead.tagline', reason: 'newspaper copy (the masthead line), not the organisation tagline' }]),
    ...bothExcluded('HS_VARSITY', [
      { key: 'homeTeam', reason: TEAM },
      { key: 'greetingEyebrow', reason: `${PHRASE} (the clone path seeds a mascot greeting separately)` },
      { key: 'department', reason: PHRASE },
    ]),
    ...bothExcluded('HS_TERMINAL', [{ key: 'schoolHost', reason: "a host-name phrase ('westridge-hs')" }]),
    ...bothExcluded('HS_TRANSIT', [{ key: 'brandStation', reason: "a station phrase ('WESTRIDGE HIGH · MAIN TERMINAL')" }]),
  ]),
  FITNESS_CORNERMAN: [{ key: 'gymLogoUrl', reason: 'declared in DEFAULTS, never read by the renderer' }],
  FITNESS_DISCOTHEQUE: [{ key: 'gymLogoUrl', reason: 'declared in DEFAULTS, never read by the renderer' }],
  FITNESS_LIVE_TV: [{ key: 'channelLogoUrl', reason: "the TV channel's logo, not the gym's" }],
  STAFF_SPOTLIGHT: [{ key: 'initials', reason: "a person's initials" }],
  SCOREBOARD: [
    { key: 'tagline', reason: "v2 SportsVenue RibbonSponsor / SponsorTakeover: the sponsor's tagline" },
    { key: 'homeLogoUrl', reason: "a team's logo, not the organisation's" },
    { key: 'awayLogoUrl', reason: "a team's logo, not the organisation's" },
  ],
  ANIMATED_WELCOME: [
    { key: 'title', reason: 'a greeting' },
    { key: 'subtitle', reason: "a greeting ('~ welcome back, Eagles ~')" },
  ],
  RESTAURANT_WAIT_TIME: [{ key: 'venueName', reason: "a phrase ('our lobby')" }],
  'LOGO/logo-principals': [{ key: 'schoolName', reason: "the renderer paints a hard-coded 'WASHINGTON' and never reads schoolName" }],
  'LOGO/field-day': [{ key: 'initials', reason: '`initials || mascotName`: a mascot label, so absent initials are not filled' }],
});

/** The identity keys of a widget type, or null when the type is not in the table. */
export function identityKeysFor(widgetType: string | null | undefined): readonly IdentityKeySpec[] | null {
  if (!widgetType) return null;
  return Object.prototype.hasOwnProperty.call(WIDGET_IDENTITY_KEYS, widgetType) ? WIDGET_IDENTITY_KEYS[widgetType] : null;
}

/**
 * Text as a person reads it, for placeholder matching only: NBSP becomes a
 * space, runs of whitespace collapse to one space, trimmed, lowercased — so an
 * innerText capture with newlines, pre-wrap spacing or uppercasing still
 * matches. Null for a non-string or an empty one.
 */
export function normaliseIdentityText(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return t ? t : null;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Does the zone resolve to the renderer `sel` names? No selector = yes. A
 * non-empty `cfg.variant` wins (WidgetRenderer hands it to VariantDispatch);
 * otherwise `cfg.theme` (LogoWidget's theme switch).
 */
export function selectorMatches(sel: IdentitySelector | undefined, cfg: Record<string, unknown>): boolean {
  if (!sel) return true;
  const variant = nonEmpty(cfg?.variant);
  if (variant) return !!sel.variants && sel.variants.includes(variant);
  const theme = nonEmpty(cfg?.theme);
  return !!theme && !!sel.themes && sel.themes.includes(theme);
}

/**
 * The placeholder texts of `spec` that apply to this zone's renderer.
 * `{ generic: false }` leaves out the generic ones (a template whose brand
 * history names this role: there the word was typed by hand).
 */
export function placeholdersFor(
  spec: IdentityKeySpec,
  cfg: Record<string, unknown>,
  opts: { generic?: boolean } = {},
): string[] {
  const withGeneric = opts.generic !== false;
  return (spec.placeholders || [])
    .filter((p) => selectorMatches(p.when, cfg) && (withGeneric || !p.generic))
    .map((p) => p.text);
}

/** Should `spec` be written on this zone at all (onlyIfPresent / absentWhen)? */
export function identityKeyApplies(spec: IdentityKeySpec, cfg: Record<string, unknown>): boolean {
  if (!spec.onlyIfPresent) return true;
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, spec.key)) return true;
  return !!spec.absentWhen && selectorMatches(spec.absentWhen, cfg);
}
