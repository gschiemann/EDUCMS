/**
 * Settings — the six areas (Phase 1 simplification, 2026-10-26).
 *
 * Owner: "Our admin settings in the app are also crazy complex" → "Go" on the
 * audit's five recommendations (docs/research/2026-10-24-settings-simplification,
 * gitignored). Settings used to be 13 sections in four groups named after how
 * the system is built ("Player & offline", "Developer & audit"). It is now SIX
 * AREAS named after what an operator wants to do:
 *
 *   Organization · Emergency · Team · Connections · Plan & billing · Advanced
 *
 * Every page keeps its URL. An area is a list of TABS, and each tab points at
 * an existing route — `matches` lists every path (old aliases included) that
 * opens that tab, so `/settings/ai` and `/settings/integrations/ai` both light
 * up Connections → AI. The longest matching path wins (`people/sso` beats
 * `people`).
 *
 * Pages still register as a `SettingsSectionId` (`<SettingsPageFrame
 * section="brand">`) — a page id, not a menu row — so no page had to change to
 * move into an area.
 *
 * This is a PRESENTATION filter only. Every API route keeps its own guard;
 * hiding a tab here never grants or denies anything server-side.
 *
 * Who sees Settings at all: the three admin roles. Editors (CONTRIBUTOR) and
 * Viewers (RESTRICTED_VIEWER) get "My account" instead (owner decision 1).
 */
import type { ComponentType } from 'react';
import {
  Building2,
  ShieldAlert,
  Users,
  Plug,
  CreditCard,
  SlidersHorizontal,
} from 'lucide-react';

export type SettingsScope = 'account' | 'organization' | 'location';

/** A page id — what a route registers through `<SettingsPageFrame section>`. */
export type SettingsSectionId =
  | 'organization'
  | 'locations'
  | 'brand'
  | 'emergency'
  | 'sports'
  | 'player'
  | 'integrations'
  | 'people'
  | 'billing'
  | 'developer'
  | 'supportAccess'
  | 'security';

export type SettingsAreaId = 'organization' | 'emergency' | 'team' | 'connections' | 'billing' | 'advanced';

export type SettingsTabId =
  | 'profile'
  | 'brand'
  | 'locations'
  | 'privacy'
  | 'emergency'
  | 'people'
  | 'sso'
  | 'connections'
  | 'ai'
  | 'pos'
  | 'video'
  | 'rosters'
  | 'billing'
  | 'developer'
  | 'support';

export type SettingsRole =
  | 'SUPER_ADMIN'
  | 'DISTRICT_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'CONTRIBUTOR'
  | 'RESTRICTED_VIEWER';

export const ALL_ROLES: readonly SettingsRole[] = [
  'SUPER_ADMIN',
  'DISTRICT_ADMIN',
  'SCHOOL_ADMIN',
  'CONTRIBUTOR',
  'RESTRICTED_VIEWER',
];
export const ADMIN_ROLES: readonly SettingsRole[] = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];
export const ORG_ADMIN_ROLES: readonly SettingsRole[] = ['SUPER_ADMIN', 'DISTRICT_ADMIN'];

/** Does this role see Settings at all? Editors and Viewers get My account instead. */
export function canSeeSettings(role: string | null | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

export interface SettingsTabDefinition {
  id: SettingsTabId;
  /** The page id the route registers (`<SettingsPageFrame section>`). */
  section: SettingsSectionId;
  /** Canonical path under `/[schoolId]/settings/`. */
  path: string;
  /** Paths under `/settings/` that open this tab (old aliases included). Longest match wins. */
  matches: readonly string[];
  /** Roles that see the tab. Never the auth policy. */
  roles: readonly SettingsRole[];
  /** Verticals that see the tab (absent = every vertical). The route stays reachable. */
  verticals?: readonly string[];
}

export interface SettingsAreaDefinition {
  id: SettingsAreaId;
  icon: IconType;
  /** Tabs in display order; the first visible one is where the area opens. */
  tabs: readonly SettingsTabDefinition[];
  /** English search synonyms. Localized synonyms live in `settings.shell.areas.<id>.keywords`. */
  keywords: readonly string[];
}

export const SETTINGS_AREAS: readonly SettingsAreaDefinition[] = [
  {
    id: 'organization',
    icon: Building2,
    keywords: ['name', 'address', 'time zone', 'timezone', 'logo', 'colors', 'colours', 'brand', 'locations', 'schools', 'student privacy', 'ferpa', 'industry'],
    tabs: [
      { id: 'profile', section: 'organization', path: 'organization', matches: ['organization'], roles: ORG_ADMIN_ROLES },
      { id: 'brand', section: 'brand', path: 'branding', matches: ['branding'], roles: ADMIN_ROLES },
      // Org admins only: the page itself requires it (a location admin used to
      // be listed this row and then told "no access" — audit 2.4).
      { id: 'locations', section: 'locations', path: 'locations', matches: ['locations'], roles: ORG_ADMIN_ROLES },
      // K-12 sports launch (2026-09-27): what public screens may show about
      // students. Schools and sports venues only.
      { id: 'privacy', section: 'sports', path: 'sports', matches: ['sports'], roles: ADMIN_ROLES, verticals: ['K12', 'SPORTS'] },
    ],
  },
  {
    id: 'emergency',
    icon: ShieldAlert,
    keywords: ['lockdown', 'weather', 'fire', 'evacuate', 'evacuation', 'hold', 'secure', 'medical', 'alert', 'alerts', 'panic', 'drill', 'floor plan', 'readiness'],
    tabs: [
      { id: 'emergency', section: 'emergency', path: 'emergency', matches: ['emergency'], roles: ADMIN_ROLES },
    ],
  },
  {
    id: 'team',
    icon: Users,
    keywords: ['people', 'users', 'invite', 'roles', 'staff', 'two-step', '2fa', 'mfa', 'sign-in', 'login', 'sso', 'single sign-on', 'okta', 'content approval'],
    tabs: [
      { id: 'people', section: 'people', path: 'people', matches: ['people'], roles: ADMIN_ROLES },
      { id: 'sso', section: 'people', path: 'people/sso', matches: ['people/sso', 'sso'], roles: ORG_ADMIN_ROLES },
    ],
  },
  {
    id: 'connections',
    icon: Plug,
    keywords: ['integrations', 'ai', 'ai key', 'openai', 'anthropic', 'gemini', 'pos', 'menu', 'square', 'toast', 'clover', 'lightspeed', 'shopify', 'stream', 'live video', 'hls', 'clever', 'roster'],
    tabs: [
      { id: 'connections', section: 'integrations', path: 'integrations', matches: ['integrations', 'integrations/monetization', 'monetize'], roles: ADMIN_ROLES },
      { id: 'ai', section: 'integrations', path: 'ai', matches: ['ai', 'integrations/ai'], roles: ADMIN_ROLES },
      { id: 'pos', section: 'integrations', path: 'pos', matches: ['pos', 'integrations/pos'], roles: ADMIN_ROLES },
      { id: 'video', section: 'integrations', path: 'streaming', matches: ['streaming', 'integrations/streaming'], roles: ADMIN_ROLES },
      // Clever is a K-12 district roster sync (the page is district/super only).
      { id: 'rosters', section: 'integrations', path: 'integrations/clever', matches: ['integrations/clever'], roles: ORG_ADMIN_ROLES, verticals: ['K12'] },
    ],
  },
  {
    id: 'billing',
    icon: CreditCard,
    keywords: ['plan', 'billing', 'invoice', 'invoices', 'payment', 'card', 'subscription', 'trial', 'seats', 'ai add-on'],
    tabs: [
      // `/settings/billing` must resolve forever: Stripe return URLs, trial and
      // dunning emails all point here.
      { id: 'billing', section: 'billing', path: 'billing', matches: ['billing'], roles: ADMIN_ROLES },
    ],
  },
  {
    id: 'advanced',
    icon: SlidersHorizontal,
    keywords: ['api key', 'api keys', 'webhook', 'webhooks', 'developer', 'support access', 'venueos support', 'build'],
    tabs: [
      { id: 'developer', section: 'developer', path: 'developer', matches: ['developer'], roles: ORG_ADMIN_ROLES },
      { id: 'support', section: 'supportAccess', path: 'support-access', matches: ['support-access'], roles: ADMIN_ROLES },
    ],
  },
];

/**
 * Routes that keep working but are no longer a place in the menu:
 *   - `player` / `usb` — screen updates are managed by VenueOS now (owner
 *     decision 3); the page says so and the controls moved to /super.
 *   - `security` — moved to My account (/[schoolId]/account).
 *   - `test-integrations` — staff tool, moved to /super.
 *   - `overview` — replaced by the Settings home.
 *   - `imports` — design imports live in Templates.
 * Listed so the shell knows which page a hidden route belongs to.
 */
export const HIDDEN_ROUTE_SECTIONS: Readonly<Record<string, SettingsSectionId>> = {
  player: 'player',
  usb: 'player',
  security: 'security',
};

/** Pages a visitor of ANY role may open (they render their own message). */
const OPEN_TO_EVERY_ROLE: ReadonlySet<SettingsSectionId> = new Set<SettingsSectionId>(['player', 'security']);

export interface SettingsRouteMatch {
  area: SettingsAreaDefinition;
  tab: SettingsTabDefinition;
}

/** The part of a pathname after `/settings/`, without query or hash ('' for the home). */
export function settingsSubpath(pathname: string): string | null {
  const m = pathname.match(/\/settings(?:\/([^?#]*))?(?:[?#].*)?$/);
  if (!m) return null;
  return (m[1] ?? '').replace(/\/+$/, '');
}

/** Which area + tab a `/[schoolId]/settings/...` path opens. Longest match wins. */
export function routeForPathname(pathname: string): SettingsRouteMatch | null {
  const sub = settingsSubpath(pathname);
  if (!sub) return null;
  let best: SettingsRouteMatch | null = null;
  let bestLen = -1;
  for (const area of SETTINGS_AREAS) {
    for (const tab of area.tabs) {
      for (const m of tab.matches) {
        if ((sub === m || sub.startsWith(`${m}/`)) && m.length > bestLen) {
          best = { area, tab };
          bestLen = m.length;
        }
      }
    }
  }
  return best;
}

/** Which page a path belongs to (an area tab's page, or a hidden route's). */
export function sectionForPathname(pathname: string): SettingsSectionId | null {
  const route = routeForPathname(pathname);
  if (route) return route.tab.section;
  const sub = settingsSubpath(pathname);
  if (!sub) return null;
  const first = sub.split('/')[0];
  return HIDDEN_ROUTE_SECTIONS[first] ?? null;
}

function roleAllows(roles: readonly SettingsRole[], role: string | null | undefined): boolean {
  return !!role && (roles as readonly string[]).includes(role);
}
function verticalAllows(tab: SettingsTabDefinition, vertical?: string | null): boolean {
  return !vertical || !tab.verticals || tab.verticals.includes(vertical);
}

/** Tabs of one area this person sees, in order. */
export function visibleTabs(
  area: SettingsAreaDefinition,
  role: string | null | undefined,
  vertical?: string | null,
): SettingsTabDefinition[] {
  return area.tabs.filter((tab) => roleAllows(tab.roles, role) && verticalAllows(tab, vertical));
}

/** Areas this person sees (an area with no visible tab is hidden). */
export function visibleAreas(role: string | null | undefined, vertical?: string | null): SettingsAreaDefinition[] {
  if (!canSeeSettings(role)) return [];
  return SETTINGS_AREAS.filter((area) => visibleTabs(area, role, vertical).length > 0);
}

/**
 * May this role open this route? Role only — a vertical filter hides a tab
 * from the menu but the route itself stays reachable (a link in an email, a
 * banner on another page).
 */
export function routeAllowed(pathname: string, role: string | null | undefined): boolean {
  const route = routeForPathname(pathname);
  if (route) return roleAllows(route.tab.roles, role);
  const section = sectionForPathname(pathname);
  if (section && OPEN_TO_EVERY_ROLE.has(section)) return !!role;
  return canSeeSettings(role);
}

/** The pages (section ids) this person can reach through the menu. */
export function visibleSections(role: string | null | undefined, vertical?: string | null): { id: SettingsSectionId }[] {
  const ids = new Set<SettingsSectionId>();
  for (const area of visibleAreas(role, vertical)) {
    for (const tab of visibleTabs(area, role, vertical)) ids.add(tab.section);
  }
  return [...ids].map((id) => ({ id }));
}

export function settingsHomeHref(schoolId: string): string {
  return `/${schoolId}/settings`;
}

export function tabHref(schoolId: string, tab: SettingsTabDefinition): string {
  return `/${schoolId}/settings/${tab.path}`;
}

/** Where an area opens for this person: its first visible tab. */
export function areaHref(
  schoolId: string,
  area: SettingsAreaDefinition,
  role?: string | null,
  vertical?: string | null,
): string {
  const tabs = role ? visibleTabs(area, role, vertical) : area.tabs;
  return tabHref(schoolId, tabs[0] ?? area.tabs[0]);
}

/** Canonical URL of a page (its first tab). Kept for callers that link by page id. */
export function settingsHref(schoolId: string, section: SettingsSectionId): string {
  for (const area of SETTINGS_AREAS) {
    const tab = area.tabs.find((t) => t.section === section);
    if (tab) return tabHref(schoolId, tab);
  }
  const hidden = Object.entries(HIDDEN_ROUTE_SECTIONS).find(([, id]) => id === section);
  return hidden ? `/${schoolId}/settings/${hidden[0]}` : settingsHomeHref(schoolId);
}

export function areaById(id: SettingsAreaId): SettingsAreaDefinition {
  return SETTINGS_AREAS.find((a) => a.id === id) ?? SETTINGS_AREAS[0];
}

/** The area a page belongs to, if any (`brand` → Organization). */
export function areaForSection(section: SettingsSectionId): SettingsAreaDefinition | null {
  return SETTINGS_AREAS.find((a) => a.tabs.some((t) => t.section === section)) ?? null;
}

// ── Search: jobs, not menu names ─────────────────────────────────────
//
// The search on the Settings home and in every area answers "how do I …"
// from anywhere (audit P9). Labels and synonyms are translated
// (`settings.shell.jobs.<id>.label` / `.keywords`); the English `keywords`
// here are extra synonyms. `href` is a path under /[schoolId] (no leading
// slug), optionally with a #anchor.

export interface SettingsJobDefinition {
  id: string;
  area: SettingsAreaId | 'account' | 'activity';
  href: string;
  keywords: readonly string[];
  roles: readonly SettingsRole[];
  verticals?: readonly string[];
}

export const SETTINGS_JOBS: readonly SettingsJobDefinition[] = [
  { id: 'changeLogo', area: 'organization', href: 'settings/branding', keywords: ['logo', 'brand', 'image'], roles: ADMIN_ROLES },
  { id: 'changeColors', area: 'organization', href: 'settings/branding', keywords: ['colors', 'colours', 'palette', 'theme'], roles: ADMIN_ROLES },
  { id: 'orgDetails', area: 'organization', href: 'settings/organization', keywords: ['name', 'address', 'time zone', 'timezone', 'industry'], roles: ORG_ADMIN_ROLES },
  { id: 'addLocation', area: 'organization', href: 'settings/locations', keywords: ['location', 'school', 'site', 'store', 'branch'], roles: ORG_ADMIN_ROLES },
  { id: 'studentPrivacy', area: 'organization', href: 'settings/sports', keywords: ['ferpa', 'photo release', 'student names', 'minors'], roles: ADMIN_ROLES, verticals: ['K12', 'SPORTS'] },
  { id: 'alertMessages', area: 'emergency', href: 'settings/emergency#emergency-content', keywords: ['lockdown', 'evacuate', 'weather', 'message', 'wording', 'picture'], roles: ADMIN_ROLES },
  { id: 'whoCanSend', area: 'emergency', href: 'settings/people', keywords: ['panic', 'trigger', 'send alert', 'permission'], roles: ADMIN_ROLES },
  { id: 'practiceDrill', area: 'emergency', href: 'settings/emergency#emergency-practice', keywords: ['drill', 'practice', 'test alert'], roles: ADMIN_ROLES },
  { id: 'floorPlans', area: 'emergency', href: 'screens?view=floor', keywords: ['floor plan', 'map', 'building'], roles: ADMIN_ROLES },
  { id: 'invite', area: 'team', href: 'settings/people?invite=1', keywords: ['invite', 'add user', 'add person', 'teammate', 'staff'], roles: ADMIN_ROLES },
  { id: 'changeRole', area: 'team', href: 'settings/people', keywords: ['role', 'permissions', 'editor', 'viewer', 'admin'], roles: ADMIN_ROLES },
  { id: 'require2Step', area: 'team', href: 'settings/people#mfa', keywords: ['2fa', 'mfa', 'two-step', 'two-factor', 'security'], roles: ADMIN_ROLES },
  { id: 'sso', area: 'team', href: 'settings/people/sso', keywords: ['sso', 'single sign-on', 'okta', 'azure', 'entra', 'oidc'], roles: ORG_ADMIN_ROLES },
  { id: 'aiKey', area: 'connections', href: 'settings/ai', keywords: ['ai', 'openai', 'anthropic', 'gemini', 'key'], roles: ADMIN_ROLES },
  { id: 'connectPos', area: 'connections', href: 'settings/pos', keywords: ['pos', 'menu', 'prices', 'square', 'toast', 'clover', 'lightspeed', 'shopify'], roles: ADMIN_ROLES },
  { id: 'liveVideo', area: 'connections', href: 'settings/streaming', keywords: ['stream', 'live', 'video', 'hls', 'm3u8', 'tv'], roles: ADMIN_ROLES },
  { id: 'clever', area: 'connections', href: 'settings/integrations/clever', keywords: ['clever', 'roster', 'students', 'sis'], roles: ORG_ADMIN_ROLES, verticals: ['K12'] },
  { id: 'plan', area: 'billing', href: 'settings/billing', keywords: ['plan', 'upgrade', 'seats', 'subscription', 'trial'], roles: ADMIN_ROLES },
  { id: 'invoices', area: 'billing', href: 'settings/billing#bill-invoices', keywords: ['invoice', 'receipt', 'payment', 'card'], roles: ADMIN_ROLES },
  { id: 'apiKeys', area: 'advanced', href: 'settings/developer', keywords: ['api', 'key', 'token', 'webhook', 'developer'], roles: ORG_ADMIN_ROLES },
  { id: 'supportAccess', area: 'advanced', href: 'settings/support-access', keywords: ['support', 'help', 'venueos', 'remote access'], roles: ADMIN_ROLES },
  { id: 'activity', area: 'activity', href: 'audit', keywords: ['audit', 'history', 'log', 'who changed', 'activity'], roles: ADMIN_ROLES },
  { id: 'myPassword', area: 'account', href: 'account#sec-password', keywords: ['password', 'change password'], roles: ALL_ROLES },
  { id: 'myPasskey', area: 'account', href: 'account#sec-passkeys', keywords: ['passkey', 'face id', 'touch id', 'windows hello', 'fingerprint'], roles: ALL_ROLES },
  { id: 'myLanguage', area: 'account', href: 'account#account-language', keywords: ['language', 'spanish', 'español', 'chinese', '中文'], roles: ALL_ROLES },
];

export function visibleJobs(role: string | null | undefined, vertical?: string | null): SettingsJobDefinition[] {
  if (!role) return [];
  return SETTINGS_JOBS.filter(
    (job) => (job.roles as readonly string[]).includes(role) && (!vertical || !job.verticals || job.verticals.includes(vertical)),
  );
}
