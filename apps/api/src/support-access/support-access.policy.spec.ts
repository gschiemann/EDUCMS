import {
  BREAK_GLASS_MAX_MINUTES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SupportAccessInputError,
  approvedDurationMinutes,
  expiryFor,
  grantCoversTenant,
  grantHasLapsed,
  grantIsActive,
  isMutatingMethod,
  isSupportAccessExemptPath,
  parseDurationMinutes,
  parseOptionalDurationMinutes,
  parseReason,
  parseScopeTenantIds,
  summarizeGrant,
} from './support-access.policy';

const NOW = new Date('2026-10-11T12:00:00Z');
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);

const active = (over: Partial<any> = {}) => ({
  id: 'g1',
  tenantId: 'org',
  kind: 'REQUEST',
  status: 'ACTIVE',
  scopeTenantIds: [],
  startsAt: min(-10),
  expiresAt: min(50),
  ...over,
});

describe('support-access policy — what "active" means', () => {
  it('ACTIVE, started and before expiry is active', () => {
    expect(grantIsActive(active(), NOW)).toBe(true);
  });

  it.each([
    ['REQUESTED', active({ status: 'REQUESTED' })],
    ['DENIED', active({ status: 'DENIED' })],
    ['REVOKED', active({ status: 'REVOKED' })],
    ['EXPIRED', active({ status: 'EXPIRED' })],
    ['expired by the clock', active({ expiresAt: min(-1) })],
    ['expiring exactly now', active({ expiresAt: NOW })],
    ['no expiry at all', active({ expiresAt: null })],
    ['not started yet', active({ startsAt: min(5) })],
    ['missing', null],
  ])('%s is NOT active', (_label, g) => {
    expect(grantIsActive(g as any, NOW)).toBe(false);
  });

  it('a lapsed grant is an ACTIVE row whose expiry passed (or that has none)', () => {
    expect(grantHasLapsed(active({ expiresAt: min(-1) }), NOW)).toBe(true);
    expect(grantHasLapsed(active({ expiresAt: null }), NOW)).toBe(true);
    expect(grantHasLapsed(active(), NOW)).toBe(false);
    expect(grantHasLapsed(active({ status: 'REVOKED', expiresAt: min(-1) }), NOW)).toBe(false);
  });
});

describe('support-access policy — scope', () => {
  it('a whole-organisation grant covers the root and every location in it', () => {
    const g = active();
    expect(grantCoversTenant(g, 'org', 'org')).toBe(true);
    expect(grantCoversTenant(g, 'loc-1', 'org')).toBe(true);
  });

  it('a location-scoped grant covers ONLY the listed locations — not the root, not a sibling', () => {
    const g = active({ scopeTenantIds: ['loc-1'] });
    expect(grantCoversTenant(g, 'loc-1', 'org')).toBe(true);
    expect(grantCoversTenant(g, 'loc-2', 'org')).toBe(false);
    expect(grantCoversTenant(g, 'org', 'org')).toBe(false);
  });

  it('a grant on another organisation covers nothing here', () => {
    expect(grantCoversTenant(active({ tenantId: 'other-org' }), 'loc-1', 'org')).toBe(false);
  });
});

describe('support-access policy — durations', () => {
  it('the customer may shorten a request, never lengthen it', () => {
    expect(approvedDurationMinutes(1440, null)).toBe(1440);
    expect(approvedDurationMinutes(1440, 60)).toBe(60);
    expect(approvedDurationMinutes(60, 1440)).toBe(60);
  });

  it('clamps to the allowed window', () => {
    expect(approvedDurationMinutes(1, null)).toBe(MIN_DURATION_MINUTES);
    expect(approvedDurationMinutes(10 ** 9, null)).toBe(MAX_DURATION_MINUTES);
  });

  it('break-glass is capped at one hour', () => {
    expect(BREAK_GLASS_MAX_MINUTES).toBe(60);
  });

  it('expiryFor adds minutes to the start', () => {
    expect(expiryFor(NOW, 90).toISOString()).toBe('2026-10-11T13:30:00.000Z');
  });

  it('parses durations and refuses nonsense', () => {
    expect(parseDurationMinutes(60)).toBe(60);
    expect(parseDurationMinutes('1440')).toBe(1440);
    expect(parseOptionalDurationMinutes(undefined)).toBeNull();
    expect(parseOptionalDurationMinutes('')).toBeNull();
    for (const bad of [0, -5, 5, 'soon', NaN, MAX_DURATION_MINUTES + 1]) {
      expect(() => parseDurationMinutes(bad)).toThrow(SupportAccessInputError);
    }
  });
});

describe('support-access policy — inputs', () => {
  it('a reason is required where the policy says so, trimmed, and bounded', () => {
    expect(parseReason('  fix the loop  ', { required: true })).toBe('fix the loop');
    expect(parseReason('', { required: false })).toBeNull();
    expect(() => parseReason('   ', { required: true })).toThrow(/required/);
    expect(() => parseReason('x'.repeat(1001), { required: false })).toThrow(/1000/);
  });

  it('scope ids are strings, de-duplicated and bounded', () => {
    expect(parseScopeTenantIds(undefined)).toEqual([]);
    expect(parseScopeTenantIds(['a', 'a', ' b '])).toEqual(['a', 'b']);
    expect(() => parseScopeTenantIds('a')).toThrow(SupportAccessInputError);
    expect(() => parseScopeTenantIds([''])).toThrow(SupportAccessInputError);
    expect(() => parseScopeTenantIds(Array.from({ length: 201 }, (_, i) => `t${i}`))).toThrow(/200/);
  });

  it('summarizeGrant exposes the fields the banner needs and nothing surprising', () => {
    const s = summarizeGrant(active({ reason: 'r', requestedByEmail: 'me@venueos' }) as any, NOW);
    expect(s).toMatchObject({ id: 'g1', active: true, reason: 'r', requestedByEmail: 'me@venueos', scopeTenantIds: [] });
    expect(Object.keys(s)).not.toContain('requestedByUserId');
  });
});

describe('support-access policy — which routes need no grant', () => {
  it.each([
    '/api/v1/auth/logout',
    '/api/v1/auth/refresh',
    '/api/v1/users/me',
    '/api/v1/health',
    '/api/v1/health/ready',
    '/api/v1/security/csrf',
    '/api/v1/tenants/accessible',
    '/api/v1/tenants/switch',
    '/api/v1/super/customers',
    '/api/v1/super/customers/abc/support-access/request',
    '/api/v1/super/tenants',
    '/api/v1/super/efficiency',
    '/api/v1/support-access',
    '/api/v1/license/me',
    '/api/v1/billing/invoices?x=1',
    '/api/v1/player-ota/latest',
    '/api/v1/bugs',
  ])('%s is exempt (console metadata / platform ops / session plumbing)', (p) => {
    expect(isSupportAccessExemptPath(p)).toBe(true);
  });

  it.each([
    '/api/v1/playlists',
    '/api/v1/screens/abc/manifest',
    '/api/v1/assets',
    '/api/v1/schedules',
    '/api/v1/users',
    '/api/v1/emergency/trigger',
    '/api/v1/emergency/abc/all-clear',
    '/api/v1/panic-content/lockdown',
    '/api/v1/audit',
    '/api/v1/tenants/me',
    '/api/v1/branding/me',
    '/api/v1/notifications',
    '/api/v1/sso/config',
    '/api/v1/superb', // a prefix must match on a path boundary
    '/api/v1/licenseless',
  ])('%s needs a grant', (p) => {
    expect(isSupportAccessExemptPath(p)).toBe(false);
  });

  it('isMutatingMethod: anything but GET/HEAD/OPTIONS', () => {
    expect(isMutatingMethod('GET')).toBe(false);
    expect(isMutatingMethod('head')).toBe(false);
    expect(isMutatingMethod('OPTIONS')).toBe(false);
    expect(isMutatingMethod('POST')).toBe(true);
    expect(isMutatingMethod('DELETE')).toBe(true);
    expect(isMutatingMethod(undefined)).toBe(false);
  });
});
