/**
 * API-key scopes — per-key least privilege for tenant REST tokens.
 * ACC-06 follow-up, 2026-08-03.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 * ACC-06 (2026-08-01) could only express "an API key may not fire a lockdown"
 * as a hard-coded URL-prefix deny in JwtAuthGuard, because `TenantApiKey` had
 * nowhere to record what a key was *allowed* to do. Everything outside that
 * one deny-list ran at the key's full ROLE authority: a menu-board
 * integration's token, minted CONTRIBUTOR so it could push a price change,
 * could equally rewrite every schedule and delete every playlist in the
 * tenant. `TenantApiKey.scopes` (added in the same change as this file) is the
 * missing grant side.
 *
 * ── THE MODEL ─────────────────────────────────────────────────────────────
 * A scope is `<family>:<read|write>`. Each family owns a set of route
 * prefixes. A request is checked as:
 *
 *   1. the key's ROLE must still satisfy @RequireRoles (unchanged — a scope
 *      GRANTS nothing the role does not already have; it only narrows);
 *   2. the path must map to a family this key holds;
 *   3. a mutating method (anything but GET/HEAD/OPTIONS) needs `:write`;
 *      a safe method needs `:read`, and `:write` implies `:read`.
 *
 * Unmapped path + scoped key → DENY. That is deliberate: a route family nobody
 * thought to grant should be unreachable by a machine credential, and a NEW
 * route family is therefore closed on the day it merges rather than open until
 * someone remembers it. (The inverse default — allow-unless-listed — is how
 * ACC-06 got written in the first place, and it only holds up because the one
 * thing it protects is enumerable.)
 *
 * ── EMERGENCY IS NOT A SCOPE, ON PURPOSE ──────────────────────────────────
 * There is no `emergency:*` here and there must not be one. A district-wide
 * lockdown is a life-safety action that requires a human identity with a live
 * session, the hold-to-trigger UX, and a named actor in the audit trail — none
 * of which a bearer string in a CI config has. `JwtAuthGuard`'s
 * `API_KEY_DENIED_PATH_PREFIXES` still refuses those paths for EVERY api-key
 * identity, before scopes are even consulted, and that check stays first.
 * Introducing an emergency scope would be a weakening of an emergency
 * safeguard and per CLAUDE.md requires explicit Integration-Lead sign-off — it
 * is not a follow-up someone should quietly add here.
 *
 * ── NULL vs [] ────────────────────────────────────────────────────────────
 * `TenantApiKey.scopes` is nullable and the two empty-ish values differ:
 *   null → unrestricted (no scope narrowing). Every key minted before this
 *          existed is null, which is exactly why the migration needs no
 *          backfill and no existing integration breaks.
 *   []   → an explicit grant of nothing. Every route refused.
 * Both are still denied the emergency prefix.
 */

/** A route family a key can be granted access to. */
export interface ApiKeyScopeFamily {
  /** Stable id used in the stored JSON and in the UI. */
  id: string;
  /** Operator-facing name. */
  label: string;
  /** One line explaining what it unlocks, in the operator's language. */
  blurb: string;
  /** Lower-cased path prefixes (query-stripped) this family covers. */
  prefixes: readonly string[];
}

/**
 * The families. Ordered as the mint UI presents them.
 *
 * Prefix matching is longest-match-wins (see `familyForPath`), so a nested
 * route that belongs to a different family than its parent can be listed
 * explicitly without reordering this array.
 */
export const API_KEY_SCOPE_FAMILIES: readonly ApiKeyScopeFamily[] = [
  {
    id: 'content',
    label: 'Content',
    blurb: 'Assets, playlists, templates, schedules, menus and promos.',
    prefixes: [
      '/api/v1/assets',
      '/api/v1/playlists',
      '/api/v1/templates',
      '/api/v1/schedules',
      '/api/v1/submissions',
      '/api/v1/imports',
      '/api/v1/menu',
      '/api/v1/ads',
      '/api/v1/panic-content',
    ],
  },
  {
    id: 'screens',
    label: 'Screens',
    blurb: 'Screens, screen groups, paired devices and hardware.',
    prefixes: [
      '/api/v1/screens',
      '/api/v1/screen-groups',
      '/api/v1/devices',
      '/api/v1/hardware',
    ],
  },
  {
    id: 'sports',
    label: 'Sports',
    blurb: 'Scoreboards, game state, rosters and sponsor rotations.',
    prefixes: ['/api/v1/sports'],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    blurb: 'POS, data sources, feeds, streaming, music and outbound webhooks.',
    prefixes: [
      '/api/v1/integrations',
      '/api/v1/pos',
      '/api/v1/data-source',
      '/api/v1/feeds',
      '/api/v1/streaming',
      '/api/v1/music',
      '/api/v1/webhooks',
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    blurb: 'Playback stats, player logs and the audit trail. Read-only.',
    prefixes: ['/api/v1/stats', '/api/v1/player-logs', '/api/v1/audit'],
  },
] as const;

export type ApiKeyScopeAccess = 'read' | 'write';

/** Every grantable scope id, e.g. `content:write`. */
export const API_KEY_SCOPES: readonly string[] = API_KEY_SCOPE_FAMILIES.flatMap((f) =>
  // `analytics` is a reporting surface with no meaningful machine-driven
  // writes; offering `analytics:write` would imply an API key can author audit
  // history, which it must never be able to do.
  f.id === 'analytics' ? [`${f.id}:read`] : [`${f.id}:read`, `${f.id}:write`],
);

const FAMILY_IDS = new Set(API_KEY_SCOPE_FAMILIES.map((f) => f.id));

/** True when `scope` is a scope this build knows how to enforce. */
export function isKnownApiKeyScope(scope: unknown): scope is string {
  return typeof scope === 'string' && API_KEY_SCOPES.includes(scope);
}

/**
 * Parse the stored column. Returns `null` for an unrestricted key (column
 * NULL, absent, or unparseable) and a de-duplicated array otherwise.
 *
 * Unparseable JSON resolves to `null` (unrestricted) rather than `[]`
 * (locked out) ON PURPOSE: this value is written only by our own mint path, so
 * corruption here means a storage/deploy fault, not an attack. Failing to
 * "deny everything" would silently brick a customer's live integration for a
 * reason no error message explains, while the safeguard that actually matters
 * — the emergency deny — does not depend on this value at all.
 */
export function parseApiKeyScopes(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return dedupeKnown(raw);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return null;
    return dedupeKnown(parsed);
  } catch {
    return null;
  }
}

function dedupeKnown(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (isKnownApiKeyScope(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Validate + normalize an operator-supplied scope list for storage.
 *
 * `undefined`/`null` → `null` (unrestricted). An array → JSON string, with
 * unknown entries reported so the mint call can 400 rather than silently
 * granting less than the operator asked for.
 */
export function normalizeRequestedScopes(requested: unknown): {
  json: string | null;
  unknown: string[];
} {
  if (requested == null) return { json: null, unknown: [] };
  if (!Array.isArray(requested)) return { json: null, unknown: ['(not a list)'] };
  const bad = requested.filter((v) => !isKnownApiKeyScope(v)).map((v) => String(v));
  const good = dedupeKnown(requested);
  return { json: JSON.stringify(good), unknown: bad };
}

/** The family that owns `path`, by longest matching prefix. */
export function familyForPath(path: string): ApiKeyScopeFamily | null {
  const p = String(path || '').toLowerCase();
  let best: ApiKeyScopeFamily | null = null;
  let bestLen = -1;
  for (const family of API_KEY_SCOPE_FAMILIES) {
    for (const prefix of family.prefixes) {
      if (p.startsWith(prefix) && prefix.length > bestLen) {
        best = family;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

/** True for methods that only read. */
export function isSafeMethod(method: string): boolean {
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

export interface ScopeDecision {
  allowed: boolean;
  /** Scope that would have permitted the request; null when unmapped. */
  requiredScope: string | null;
  /** Machine-readable reason, for the log line + audit row. */
  reason: 'unrestricted' | 'granted' | 'missing-scope' | 'unmapped-path';
}

/**
 * Decide whether a key holding `scopes` may perform `method` on `path`.
 *
 * `scopes === null` (unrestricted / legacy key) always allows — the emergency
 * deny and the role check are separate and both still run.
 */
export function evaluateApiKeyScopes(
  scopes: string[] | null,
  method: string,
  path: string,
): ScopeDecision {
  if (scopes === null) {
    return { allowed: true, requiredScope: null, reason: 'unrestricted' };
  }
  const family = familyForPath(path);
  if (!family) {
    // Default-deny: a scoped key only reaches families someone deliberately
    // granted. See the header note on why this direction is the safe one.
    return { allowed: false, requiredScope: null, reason: 'unmapped-path' };
  }
  const access: ApiKeyScopeAccess = isSafeMethod(method) ? 'read' : 'write';
  const required = `${family.id}:${access}`;
  // `:write` implies `:read` — a key granted write on a family can obviously
  // read it, and forcing operators to tick both boxes is a footgun that ends
  // in over-granting.
  const held =
    scopes.includes(required) ||
    (access === 'read' && scopes.includes(`${family.id}:write`));
  return {
    allowed: held,
    requiredScope: required,
    reason: held ? 'granted' : 'missing-scope',
  };
}
