/**
 * ACC-06 follow-up (2026-08-03) — per-key least privilege.
 *
 * Before `TenantApiKey.scopes`, an API key ran at its whole ROLE's authority
 * on every route family outside the emergency deny-list: a menu-board
 * integration's CONTRIBUTOR token could also rewrite every schedule and delete
 * every playlist in the tenant. These tests pin the grant model AND the two
 * properties that make the column safe to add to a live product:
 * `null` means unrestricted (so no existing key changes behaviour), and no
 * scope reaches the emergency routes.
 */
import {
  API_KEY_SCOPES,
  API_KEY_SCOPE_FAMILIES,
  evaluateApiKeyScopes,
  familyForPath,
  normalizeRequestedScopes,
  parseApiKeyScopes,
} from './api-key-scopes';

describe('API key scopes — the grant vocabulary', () => {
  it('has no emergency scope, and none of the families can reach an emergency route', () => {
    // A lockdown needs a human with a session, hold-to-trigger and a named
    // actor. Adding `emergency:*` here would be a weakening of an emergency
    // safeguard — CLAUDE.md requires explicit sign-off for that.
    expect(API_KEY_SCOPES.some((s) => s.startsWith('emergency'))).toBe(false);
    expect(familyForPath('/api/v1/emergency/trigger')).toBeNull();
    expect(familyForPath('/api/v1/emergency/abc/all-clear')).toBeNull();
  });

  it('does not offer a write scope on the audit trail', () => {
    // `analytics` covers /audit; an API key that could author audit history
    // would defeat the point of having one.
    expect(API_KEY_SCOPES).toContain('analytics:read');
    expect(API_KEY_SCOPES).not.toContain('analytics:write');
  });

  it('never maps a privilege surface to a family', () => {
    // Grantable scopes must not reach credentials, role grants, key minting,
    // platform-owner or billing surfaces. An operator who needs those mints an
    // UNRESTRICTED key — an explicit, audited choice.
    for (const path of [
      '/api/v1/auth/login',
      '/api/v1/auth/mfa/enroll',
      '/api/v1/users/u1/role',
      '/api/v1/api-keys',
      '/api/v1/super/tenants',
      '/api/v1/license',
      '/api/v1/billing/checkout',
      '/api/v1/tenants/t1',
      '/api/v1/security/csrf',
    ]) {
      expect(familyForPath(path)).toBeNull();
    }
  });

  it('matches on path boundaries, not string prefixes', () => {
    expect(familyForPath('/api/v1/screens')?.id).toBe('screens');
    expect(familyForPath('/api/v1/screens/abc/manifest')?.id).toBe('screens');
    // A hypothetical sibling controller must not inherit the grant just
    // because its name starts with the same characters.
    expect(familyForPath('/api/v1/screens-preview')).toBeNull();
    expect(familyForPath('/api/v1/assets-export')).toBeNull();
  });

  it('resolves the longest matching prefix so nested routes stay in their family', () => {
    expect(familyForPath('/api/v1/screen-groups/g1')?.id).toBe('screens');
    expect(familyForPath('/api/v1/sports/board/live')?.id).toBe('sports');
  });

  it('every advertised family id produces at least a read scope', () => {
    for (const f of API_KEY_SCOPE_FAMILIES) {
      expect(API_KEY_SCOPES).toContain(`${f.id}:read`);
    }
  });
});

describe('parseApiKeyScopes — NULL and [] are different things', () => {
  it('treats null/undefined/blank as UNRESTRICTED (this is what keeps legacy keys alive)', () => {
    expect(parseApiKeyScopes(null)).toBeNull();
    expect(parseApiKeyScopes(undefined)).toBeNull();
    expect(parseApiKeyScopes('')).toBeNull();
    expect(parseApiKeyScopes('   ')).toBeNull();
  });

  it('parses a stored JSON array and drops scopes this build cannot enforce', () => {
    expect(parseApiKeyScopes('["content:write","nope:write","content:write"]')).toEqual([
      'content:write',
    ]);
  });

  it('keeps an explicit empty grant as [] — NOT null', () => {
    expect(parseApiKeyScopes('[]')).toEqual([]);
  });

  it('falls back to unrestricted on corrupt JSON rather than bricking an integration', () => {
    // Only our own mint path writes this column, so corruption means a
    // storage fault, not an attack — and the emergency deny does not depend
    // on this value at all.
    expect(parseApiKeyScopes('{oh no')).toBeNull();
    expect(parseApiKeyScopes('{"not":"an array"}')).toBeNull();
  });
});

describe('normalizeRequestedScopes — mint-time validation', () => {
  it('reports unknown scopes instead of silently granting less than asked', () => {
    const res = normalizeRequestedScopes(['content:write', 'lockdown:write']);
    expect(res.unknown).toEqual(['lockdown:write']);
  });

  it('absent → unrestricted', () => {
    expect(normalizeRequestedScopes(undefined)).toEqual({ json: null, unknown: [] });
    expect(normalizeRequestedScopes(null)).toEqual({ json: null, unknown: [] });
  });

  it('an explicit empty list stores [] (grant nothing), not null', () => {
    expect(normalizeRequestedScopes([]).json).toBe('[]');
  });
});

describe('evaluateApiKeyScopes — the decision', () => {
  it('an unrestricted key (null) is allowed everywhere the deny-list permits', () => {
    const d = evaluateApiKeyScopes(null, 'DELETE', '/api/v1/playlists/p1');
    expect(d).toEqual({ allowed: true, requiredScope: null, reason: 'unrestricted' });
  });

  it('undefined is treated as unrestricted too — same meaning as the DB NULL', () => {
    // A partially-selected row or a caller that omits the field must not
    // become a TypeError inside the auth path.
    expect(evaluateApiKeyScopes(undefined, 'GET', '/api/v1/screens').allowed).toBe(true);
  });

  it('an explicitly empty grant ([]) is refused everywhere', () => {
    const d = evaluateApiKeyScopes([], 'GET', '/api/v1/screens');
    expect(d.allowed).toBe(false);
    expect(d.requiredScope).toBe('screens:read');
  });

  it('write implies read, but read does not imply write', () => {
    expect(evaluateApiKeyScopes(['content:write'], 'GET', '/api/v1/playlists').allowed).toBe(true);
    expect(evaluateApiKeyScopes(['content:read'], 'POST', '/api/v1/playlists').allowed).toBe(false);
    expect(evaluateApiKeyScopes(['content:read'], 'GET', '/api/v1/playlists').allowed).toBe(true);
  });

  it('a grant on one family does not leak into another', () => {
    const d = evaluateApiKeyScopes(['content:write'], 'DELETE', '/api/v1/screens/s1');
    expect(d.allowed).toBe(false);
    expect(d.requiredScope).toBe('screens:write');
    expect(d.reason).toBe('missing-scope');
  });

  it('default-DENIES an unmapped path, so a NEW route family is closed on merge day', () => {
    const d = evaluateApiKeyScopes(['content:write'], 'POST', '/api/v1/some-future-thing');
    expect(d).toEqual({ allowed: false, requiredScope: null, reason: 'unmapped-path' });
  });

  it('treats HEAD/OPTIONS as reads and everything else as writes', () => {
    expect(evaluateApiKeyScopes(['content:read'], 'HEAD', '/api/v1/assets').allowed).toBe(true);
    expect(evaluateApiKeyScopes(['content:read'], 'OPTIONS', '/api/v1/assets').allowed).toBe(true);
    expect(evaluateApiKeyScopes(['content:read'], 'PATCH', '/api/v1/assets').allowed).toBe(false);
    expect(evaluateApiKeyScopes(['content:read'], 'PUT', '/api/v1/assets').allowed).toBe(false);
  });

  it('no grant, however broad, opens an emergency route', () => {
    for (const scopes of [API_KEY_SCOPES as string[], ['content:write'], []]) {
      expect(evaluateApiKeyScopes(scopes, 'POST', '/api/v1/emergency/trigger').allowed).toBe(false);
    }
  });
});
