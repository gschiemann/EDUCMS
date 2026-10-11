/**
 * USER SCOPING (2026-10-11) — the pure rules. No Prisma, no Nest.
 *
 * TWO THINGS A PERSON'S ACCESS CAN NOW SAY, on top of `User.tenantId` (home)
 * and `User.role`:
 *
 *   1. MORE THAN ONE LOCATION — `user_location_access` rows. The person may
 *      switch into another location of the same organisation and works there
 *      with the SAME role. The session's ACTIVE tenant (`req.user.tenantId`)
 *      is still the one and only tenant every existing query is scoped by, so
 *      every location-scoped route is closed to the other locations exactly as
 *      before; what is new is only WHICH tenants the switch accepts, and a
 *      per-request re-check that the active one is still allowed.
 *
 *   2. LIMITED TO SCREENS / SCREEN GROUPS — `user_screen_scopes` rows for
 *      (person, location). A screen-scoped person sees and manages only the
 *      listed screens plus the screens in the listed groups.
 *
 * Who can be scoped: the LOCATION roles only (SCOPABLE_ROLES). An org admin
 * (DISTRICT_ADMIN) already reaches every location and is never screen-scoped
 * — to limit one, make them a location role first. SUPER_ADMIN is untouched
 * (support access governs it).
 *
 * HOW A SCREEN-SCOPED REQUEST IS DECIDED — DEFAULT DENY. `decideScopedRoute`
 * matches the request against SCOPED_ROUTE_RULES, first match wins. A route
 * that matches nothing is REFUSED (403 SCREEN_SCOPE_FORBIDDEN). So a route
 * added tomorrow is closed to screen-scoped people until somebody decides
 * otherwise here — the inventory spec lists every JWT route's verdict.
 *
 * OWNER DECISION 2026-10-11 — EMERGENCY IS NOT SCOPED. Screen scoping is for
 * everyday content and screen management. Every `/emergency/**` route passes
 * untouched: a person who may trigger alerts (an admin role, or
 * canTriggerPanic) keeps the exact reach they have today in the location
 * they are working in — all screens, a group or one screen — and sees every
 * screen in the target picker. The emergency controller's own scope/auth
 * logic is not touched. Emergency SETTINGS (panic content, per-screen
 * emergency content, tenant panic settings) stay closed: they are settings.
 */

export const SCOPABLE_ROLES: readonly string[] = ['SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'];

export function isScopableRole(role: unknown): boolean {
  return typeof role === 'string' && SCOPABLE_ROLES.includes(role);
}

/** Error codes the dashboard branches on. */
export const SCREEN_SCOPE_FORBIDDEN = 'SCREEN_SCOPE_FORBIDDEN';
export const LOCATION_ACCESS_REVOKED = 'LOCATION_ACCESS_REVOKED';

export type ScopeCheck =
  /** Not about screens (self, content library, emergency alerts) — through. */
  | { kind: 'pass' }
  /** A list route; the controller narrows it with user-scope.context. */
  | { kind: 'filter' }
  /** Refused for a screen-scoped person. */
  | { kind: 'deny' }
  /** The path segment `param` is a screen id that must be in scope. */
  | { kind: 'screen'; param: string }
  /** Only the body's targets are checked (screenId / screenGroupId / screenIds). */
  | { kind: 'body'; requireTarget: boolean }
  /** `param` is a Schedule id: its target must be in scope (and any new body target). */
  | { kind: 'schedule'; param: string }
  /** `param` is a DisplaySchedule (on/off power schedule) id. */
  | { kind: 'display-schedule'; param: string }
  /** `param` is a Playlist id: every screen / group it is scheduled on must be in scope. */
  | { kind: 'playlist'; param: string };

export interface ScopedRouteRule {
  methods: readonly string[] | '*';
  /** `/api/v1/...` with `:name` (one segment) and a trailing `**` (zero or more segments). */
  pattern: string;
  check: ScopeCheck;
  why: string;
}

const PASS: ScopeCheck = { kind: 'pass' };
const FILTER: ScopeCheck = { kind: 'filter' };
const DENY: ScopeCheck = { kind: 'deny' };
const R = ['GET', 'HEAD'] as const;
const ANY = '*' as const;

/**
 * First match wins — so the specific DENY rules sit above the broad PASS rule
 * they carve out of.
 */
export const SCOPED_ROUTE_RULES: readonly ScopedRouteRule[] = [
  // ── Self and session ────────────────────────────────────────────────────
  { methods: ANY, pattern: '/api/v1/auth/**', check: PASS, why: 'sign-in, password, 2FA, passkeys on their own account' },
  { methods: ['GET', 'PUT'], pattern: '/api/v1/users/me', check: PASS, why: 'their own profile' },
  { methods: ANY, pattern: '/api/v1/notifications/**', check: PASS, why: 'their own inbox' },
  { methods: R, pattern: '/api/v1/tenants/accessible', check: PASS, why: 'the workspace switcher (their locations only)' },
  { methods: ['POST'], pattern: '/api/v1/tenants/switch', check: PASS, why: 'switch between their locations (checked by the switch itself)' },
  { methods: R, pattern: '/api/v1/feature-flags', check: PASS, why: 'UI feature flags, no tenant data' },
  { methods: R, pattern: '/api/v1/hardware/catalog', check: PASS, why: 'static hardware catalogue' },
  { methods: R, pattern: '/api/v1/geocode/**', check: PASS, why: 'address lookup, no tenant data' },
  { methods: R, pattern: '/api/v1/license/me', check: PASS, why: 'plan entitlements the UI gates features on (no invoices, no payment data)' },
  { methods: R, pattern: '/api/v1/license/current', check: PASS, why: 'plan entitlements the UI gates features on' },
  { methods: R, pattern: '/api/v1/license/tiers', check: PASS, why: 'public plan catalogue' },
  { methods: R, pattern: '/api/v1/branding/me', check: PASS, why: 'the dashboard theme (read only)' },
  { methods: ['POST'], pattern: '/api/v1/branding/derive-palette', check: PASS, why: 'pure colour maths' },
  { methods: ANY, pattern: '/api/v1/branding/templates/**', check: PASS, why: 'brand kit on a template (content)' },
  { methods: ANY, pattern: '/api/v1/proxy/**', check: PASS, why: 'website-widget previews (content)' },

  // ── Emergency alerts — NOT scoped (owner decision 2026-10-11, see header)
  { methods: ANY, pattern: '/api/v1/emergency/**', check: PASS, why: 'emergency reach is never narrowed by screen scope (owner decision)' },

  // ── Content library (role decides; no screen involved) ──────────────────
  { methods: ANY, pattern: '/api/v1/assets/emergency-upload', check: DENY, why: 'emergency content is an emergency setting' },
  { methods: ANY, pattern: '/api/v1/assets/**', check: PASS, why: 'media library (content)' },
  { methods: ANY, pattern: '/api/v1/templates/**', check: PASS, why: 'templates (content)' },
  { methods: ANY, pattern: '/api/v1/imports/**', check: PASS, why: 'PDF / slide imports (content)' },
  { methods: ANY, pattern: '/api/v1/submissions/**', check: PASS, why: 'content review (role decides approve/reject)' },
  { methods: ['POST'], pattern: '/api/v1/data-source/fetch', check: PASS, why: 'widget data preview' },
  { methods: ['POST', 'DELETE'], pattern: '/api/v1/ai/key/**', check: DENY, why: "the location's AI key is a setting" },
  { methods: ANY, pattern: '/api/v1/ai/**', check: PASS, why: 'AI writing / design helpers (content)' },

  // ── Playlists ───────────────────────────────────────────────────────────
  { methods: ['POST'], pattern: '/api/v1/playlists/:id/publish-to-fleet', check: DENY, why: 'publishes to every location' },
  { methods: ANY, pattern: '/api/v1/playlists/:id/screens/:screenId/**', check: { kind: 'screen', param: 'screenId' }, why: 'one screen\'s rule for this playlist' },
  { methods: R, pattern: '/api/v1/playlists', check: PASS, why: 'playlist library (no screen data)' },
  { methods: ['POST'], pattern: '/api/v1/playlists', check: PASS, why: 'create a playlist (does not publish it anywhere)' },
  { methods: R, pattern: '/api/v1/playlists/summary', check: PASS, why: 'library tiles (reach is a count, never screen names)' },
  { methods: R, pattern: '/api/v1/playlists/:id', check: PASS, why: 'read a playlist (no screen data)' },
  {
    methods: ANY,
    pattern: '/api/v1/playlists/:id/**',
    check: { kind: 'playlist', param: 'id' },
    why: 'editing / deleting / pausing a playlist changes every screen it plays on — allowed only when all of them are theirs',
  },

  // ── Screens ─────────────────────────────────────────────────────────────
  { methods: R, pattern: '/api/v1/screens', check: FILTER, why: 'their screens only' },
  { methods: R, pattern: '/api/v1/screens/panel-target', check: PASS, why: 'the largest panel size, for video grading (one number, no screen data)' },
  // The literal one-segment screen routes are fleet-wide: named here so they
  // are refused for what they are, not as an unknown screen id below.
  { methods: ANY, pattern: '/api/v1/screens/fleet', check: DENY, why: 'every location\'s screens' },
  { methods: ANY, pattern: '/api/v1/screens/fleet-pulse', check: DENY, why: 'whole-location health roll-up' },
  { methods: ANY, pattern: '/api/v1/screens/deployments', check: DENY, why: 'whole-location deployment log' },
  { methods: ANY, pattern: '/api/v1/screens/sync-trim-suggestions', check: DENY, why: 'whole-location sync data' },
  { methods: ANY, pattern: '/api/v1/screens/pair', check: DENY, why: 'pairing adds a screen outside their scope' },
  { methods: ANY, pattern: '/api/v1/screens/force-update', check: DENY, why: 'updates every screen in the location' },
  { methods: ANY, pattern: '/api/v1/screens/refresh-web', check: DENY, why: 'refreshes every screen in the location' },
  { methods: ANY, pattern: '/api/v1/screens/:id/emergency-content', check: DENY, why: 'per-screen emergency content is an emergency setting' },
  { methods: ['PUT', 'DELETE'], pattern: '/api/v1/screens/:id', check: { kind: 'screen', param: 'id' }, why: 'rename / move / remove one of their screens' },
  { methods: ANY, pattern: '/api/v1/screens/:id/**', check: { kind: 'screen', param: 'id' }, why: 'status, power, refresh, content of one of their screens' },

  // ── Screen groups: read their groups; the group structure is the location admin's
  { methods: R, pattern: '/api/v1/screen-groups', check: FILTER, why: 'their groups only' },

  // ── Schedules (what plays where) ────────────────────────────────────────
  { methods: R, pattern: '/api/v1/schedules', check: FILTER, why: 'schedules on their screens / groups only' },
  { methods: ['POST'], pattern: '/api/v1/schedules', check: { kind: 'body', requireTarget: true }, why: 'publish to one of their screens / groups' },
  { methods: ANY, pattern: '/api/v1/schedules/:id/**', check: { kind: 'schedule', param: 'id' }, why: 'change a schedule on their screens' },
  { methods: ANY, pattern: '/api/v1/schedules/:id', check: { kind: 'schedule', param: 'id' }, why: 'change a schedule on their screens' },

  // ── On/off (power) schedules ────────────────────────────────────────────
  { methods: R, pattern: '/api/v1/display-schedules', check: FILTER, why: 'power schedules on their screens / groups only' },
  { methods: ['POST'], pattern: '/api/v1/display-schedules', check: { kind: 'body', requireTarget: true }, why: 'power schedule for one of their screens / groups' },
  { methods: ANY, pattern: '/api/v1/display-schedules/:id', check: { kind: 'display-schedule', param: 'id' }, why: 'change a power schedule on their screens' },

  // Everything else — people, location settings, billing, audit, support
  // access, API keys, webhooks, integrations, floor plans, sports, analytics,
  // fleet roll-ups, pairing, tenant-wide refresh/update — matches nothing and
  // is refused by DEFAULT_SCOPED_CHECK.
];

export const DEFAULT_SCOPED_CHECK: ScopeCheck = DENY;

interface CompiledRule {
  rule: ScopedRouteRule;
  re: RegExp;
  params: string[];
}

function compile(rule: ScopedRouteRule): CompiledRule {
  const params: string[] = [];
  const segs = rule.pattern.split('/').filter(Boolean);
  let src = '^';
  for (const seg of segs) {
    if (seg === '**') {
      src += '(?:/[^/]+)*';
    } else if (seg.startsWith(':')) {
      params.push(seg.slice(1));
      src += '/([^/]+)';
    } else {
      src += '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  src += '$';
  return { rule, re: new RegExp(src, 'i'), params };
}

const COMPILED: CompiledRule[] = SCOPED_ROUTE_RULES.map(compile);

/** `/api/v1/x/y?z` → `/api/v1/x/y` (no query, no trailing slash). */
export function normalizePath(path: string): string {
  const p = String(path || '').split('?')[0].split('#')[0].replace(/\/+$/, '');
  return p || '/';
}

export interface ScopedRouteDecision {
  check: ScopeCheck;
  params: Record<string, string>;
  rule: ScopedRouteRule | null;
}

export function decideScopedRoute(method: string, path: string): ScopedRouteDecision {
  const m = String(method || 'GET').toUpperCase();
  const p = normalizePath(path);
  for (const c of COMPILED) {
    if (c.rule.methods !== '*' && !c.rule.methods.includes(m)) continue;
    const hit = c.re.exec(p);
    if (!hit) continue;
    const params: Record<string, string> = {};
    c.params.forEach((name, i) => {
      params[name] = decodeURIComponent(hit[i + 1]);
    });
    return { check: c.rule.check, params, rule: c.rule };
  }
  return { check: DEFAULT_SCOPED_CHECK, params: {}, rule: null };
}

// ─── Membership: routes a person may use while their active location is stale ─
//
// If a person's access to the location their session is in is removed, every
// request is refused with LOCATION_ACCESS_REVOKED — except these, so they can
// still sign out, see who they are, list their locations and switch home.
const STALE_LOCATION_EXEMPT = [
  /^\/api\/v1\/auth(?:\/|$)/i,
  /^\/api\/v1\/users\/me$/i,
  /^\/api\/v1\/tenants\/accessible$/i,
  /^\/api\/v1\/tenants\/switch$/i,
];

export function isStaleLocationExemptPath(path: string): boolean {
  const p = normalizePath(path);
  return STALE_LOCATION_EXEMPT.some((re) => re.test(p));
}

// ─── The person's resolved scope in their active location ─────────────────

export interface ScreenScope {
  /** Effective screens: listed screens + screens in listed groups + their other faces. */
  screenIds: string[];
  /** Listed groups that exist in the location. */
  groupIds: string[];
}

/** The body targets a request names (schedules, power schedules, a screen's new group). */
export function bodyTargets(body: unknown): { screenIds: string[]; groupIds: string[] } {
  const b: any = body && typeof body === 'object' ? body : {};
  const screenIds: string[] = [];
  const groupIds: string[] = [];
  if (typeof b.screenId === 'string' && b.screenId) screenIds.push(b.screenId);
  if (Array.isArray(b.screenIds)) for (const s of b.screenIds) if (typeof s === 'string' && s) screenIds.push(s);
  if (typeof b.screenGroupId === 'string' && b.screenGroupId) groupIds.push(b.screenGroupId);
  return { screenIds, groupIds };
}

/** Every named target is in scope. An empty list is "in scope" — `requireTarget` is checked separately. */
export function targetsInScope(scope: ScreenScope, t: { screenIds: string[]; groupIds: string[] }): boolean {
  const screens = new Set(scope.screenIds);
  const groups = new Set(scope.groupIds);
  return t.screenIds.every((id) => screens.has(id)) && t.groupIds.every((id) => groups.has(id));
}

/** A schedule-shaped row (Schedule, DisplaySchedule) targets something in scope. A row with no target is NOT. */
export function rowTargetInScope(scope: ScreenScope, row: { screenId?: string | null; screenGroupId?: string | null }): boolean {
  if (row.screenId) return scope.screenIds.includes(row.screenId);
  if (row.screenGroupId) return scope.groupIds.includes(row.screenGroupId);
  return false;
}

// ─── Input validation for PUT /users/:id/access ───────────────────────────

export const MAX_SCOPE_ITEMS = 500;

export class UserScopeInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function parseIdList(v: unknown, field: string): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new UserScopeInputError('USER_ACCESS_INVALID', `${field} must be a list.`);
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || !item.trim()) throw new UserScopeInputError('USER_ACCESS_INVALID', `${field} must be a list of ids.`);
    const s = item.trim();
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_SCOPE_ITEMS) {
    throw new UserScopeInputError('USER_ACCESS_INVALID', `${field} may list at most ${MAX_SCOPE_ITEMS} items.`);
  }
  return out;
}
