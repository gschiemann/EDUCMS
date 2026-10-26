import {
  getTenantState,
  invalidateTenantState,
  resetManifestCacheForTests,
  setTenantState,
  tenantStateEpoch,
} from './manifest-hot-cache';

/**
 * The tenant-state cache's invalidation epoch (2026-10-26, the MEDICAL drill
 * at a launch site).
 *
 * The emergency controller invalidates BEFORE its transaction commits and
 * dispatches the signed fan-out beside it; every screen then re-reads its
 * manifest while the transaction is in flight. A read that reached Postgres
 * before the commit used to write the PRE-change row back into this cache,
 * where it stood for up to 2 s after the commit. On the all-clear that served
 * a manifest with the override rows gone and the tenant still ACTIVE — an
 * alert that no longer existed, in a shape the glass had never shown.
 */
describe('manifest-hot-cache — tenant state invalidation epoch', () => {
  const ACTIVE = { emergencyStatus: 'CRITICAL', emergencyPlaylistId: 'pl-drill', emergencyPortraitPlaylistId: null };
  const CLEARED = { emergencyStatus: 'INACTIVE', emergencyPlaylistId: null, emergencyPortraitPlaylistId: null };

  beforeEach(() => resetManifestCacheForTests());

  it('a read that began BEFORE an invalidation cannot repopulate the cache (the all-clear race)', () => {
    // t0: a manifest poll captures the epoch and goes to Postgres.
    const readEpoch = tenantStateEpoch('t1');
    // t1: the all-clear invalidates (pre-commit) … and, after the commit, again.
    invalidateTenantState('t1');
    invalidateTenantState('t1');
    // t2: the poll's pre-commit row arrives and is offered to the cache.
    setTenantState('t1', ACTIVE, readEpoch);
    // Refused: the next poll reads Postgres and sees the committed clear.
    expect(getTenantState('t1')).toBeUndefined();
  });

  it('a read that began AFTER the last invalidation is cached as before', () => {
    invalidateTenantState('t1');
    const readEpoch = tenantStateEpoch('t1');
    setTenantState('t1', CLEARED, readEpoch);
    expect(getTenantState('t1')).toEqual(CLEARED);
  });

  it('negative control: without the epoch, the stale write landed (what the fleet ran into)', () => {
    invalidateTenantState('t1');
    setTenantState('t1', ACTIVE); // legacy caller shape — no epoch, cached
    expect(getTenantState('t1')).toEqual(ACTIVE);
  });

  it('epochs are per tenant: another tenant\'s all-clear does not refuse this one\'s read', () => {
    const readEpoch = tenantStateEpoch('t1');
    invalidateTenantState('t2');
    setTenantState('t1', ACTIVE, readEpoch);
    expect(getTenantState('t1')).toEqual(ACTIVE);
  });

  it('invalidation still empties the cache at once, before the fan-out', () => {
    setTenantState('t1', ACTIVE, tenantStateEpoch('t1'));
    expect(getTenantState('t1')).toEqual(ACTIVE);
    invalidateTenantState('t1');
    expect(getTenantState('t1')).toBeUndefined();
  });
});
