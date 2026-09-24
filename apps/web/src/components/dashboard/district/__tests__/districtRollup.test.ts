import {
  buildDistrictRollup,
  compareScorecards,
  filterScorecards,
  type FleetScreenLike,
  type SchoolReadinessLike,
  type SchoolScorecard,
} from '../districtRollup';

/**
 * districtRollup — the district command center's derivation.
 *
 * What this suite pins:
 *  • WORST FIRST is a strict precedence, not a weighted score. "Cannot run a
 *    lockdown" outranks any number of offline screens; "reachable but not
 *    painting" outranks plain offline.
 *  • ZERO IS NOT A ROW — the needs-action counters only ever report real work.
 *  • NEVER CRY WOLF — a readiness or approvals request that didn't answer must
 *    SUPPRESS its counters, never report them as zero, and must never let the
 *    UI claim all-clear.
 *  • A school with zero screens still gets a row.
 */

const loc = (id: string, name = id) => ({ id, name, slug: id });

function screen(
  tenantId: string,
  over: Partial<FleetScreenLike> = {},
): FleetScreenLike {
  return {
    id: `${tenantId}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Screen',
    status: 'ONLINE',
    renderHealth: 'OK',
    renderStale: false,
    sourceTenant: { id: tenantId, name: tenantId, slug: tenantId },
    ...over,
  };
}

function readySchool(
  tenantId: string,
  over: Partial<SchoolReadinessLike> = {},
): SchoolReadinessLike {
  return {
    tenantId,
    name: tenantId,
    slug: tenantId,
    isSelf: false,
    verdict: 'READY',
    contentWired: 6,
    contentTotal: 6,
    lockdownWired: true,
    missingTypes: [],
    screensTotal: 2,
    screensOnline: 2,
    ...over,
  };
}

const byId = (r: { schools: SchoolScorecard[] }, id: string) =>
  r.schools.find((s) => s.tenantId === id)!;

describe('buildDistrictRollup — counters', () => {
  it('a fully healthy district reports all-clear with every counter zero', () => {
    const r = buildDistrictRollup({
      locations: [loc('district'), loc('a'), loc('b')],
      rootId: 'district',
      screens: [screen('a'), screen('a'), screen('b')],
      readiness: { schools: [readySchool('district', { isSelf: true }), readySchool('a'), readySchool('b')] },
      approvals: { byTenant: [] },
    });
    expect(r.needsAction.allClear).toBe(true);
    expect(r.healthyCount).toBe(3);
    expect(r.coverage).toEqual({ readiness: true, approvals: true });
  });

  it('counts offline screens AND the schools they belong to', () => {
    const r = buildDistrictRollup({
      locations: [loc('a'), loc('b')],
      screens: [
        screen('a'),
        screen('b', { status: 'OFFLINE', renderHealth: 'UNKNOWN' }),
        screen('b', { status: 'OFFLINE', renderHealth: 'UNKNOWN' }),
      ],
      readiness: { schools: [readySchool('a'), readySchool('b')] },
      approvals: { byTenant: [] },
    });
    expect(r.needsAction.offlineScreens).toBe(2);
    expect(r.needsAction.offlineSchools).toBe(1);
    expect(byId(r, 'b').screensOffline).toBe(2);
    expect(byId(r, 'b').screensTotal).toBe(2);
    expect(r.needsAction.allClear).toBe(false);
  });

  it('PENDING and REVOKED screens are not counted as an outage', () => {
    const r = buildDistrictRollup({
      locations: [loc('a')],
      screens: [screen('a', { status: 'PENDING' }), screen('a', { status: 'REVOKED' })],
      readiness: { schools: [readySchool('a')] },
      approvals: { byTenant: [] },
    });
    expect(r.needsAction.offlineScreens).toBe(0);
    expect(byId(r, 'a').screensTotal).toBe(2);
  });

  it('counts "reachable but NOT painting" separately from offline', () => {
    const r = buildDistrictRollup({
      locations: [loc('a')],
      // Fresh ping (ONLINE) but the renderer is wedged — the money signal.
      screens: [screen('a', { renderHealth: 'STALE', renderStale: true }), screen('a')],
      readiness: { schools: [readySchool('a')] },
      approvals: { byTenant: [] },
    });
    expect(r.needsAction.notPaintingScreens).toBe(1);
    expect(r.needsAction.notPaintingSchools).toBe(1);
    expect(r.needsAction.offlineScreens).toBe(0);
    expect(byId(r, 'a').screensOnline).toBe(2);
  });

  it('an offline screen is never double-counted as not-painting', () => {
    const r = buildDistrictRollup({
      locations: [loc('a')],
      screens: [screen('a', { status: 'OFFLINE', renderHealth: 'STALE', renderStale: true })],
      readiness: { schools: [readySchool('a')] },
      approvals: { byTenant: [] },
    });
    expect(r.needsAction.offlineScreens).toBe(1);
    expect(r.needsAction.notPaintingScreens).toBe(0);
  });

  it('never-reported render-proof (UNKNOWN) is not an alarm', () => {
    const r = buildDistrictRollup({
      locations: [loc('a')],
      screens: [screen('a', { renderHealth: 'UNKNOWN', renderStale: false })],
      readiness: { schools: [readySchool('a')] },
      approvals: { byTenant: [] },
    });
    expect(r.needsAction.notPaintingScreens).toBe(0);
    expect(r.needsAction.allClear).toBe(true);
  });

  it('rolls up emergency readiness, splitting NOT_CONFIGURED out of not-ready', () => {
    const r = buildDistrictRollup({
      locations: [loc('a'), loc('b'), loc('c')],
      screens: [],
      readiness: {
        schools: [
          readySchool('a'),
          readySchool('b', { verdict: 'NEEDS_ATTENTION', contentWired: 4, missingTypes: ['Fire / Evacuate', 'Medical'] }),
          readySchool('c', { verdict: 'NOT_CONFIGURED', contentWired: 0, lockdownWired: false, missingTypes: ['Lockdown'] }),
        ],
      },
      approvals: { byTenant: [] },
    });
    expect(r.needsAction.emergencyNotReadySchools).toBe(2);
    expect(r.needsAction.emergencyNotConfiguredSchools).toBe(1);
    expect(byId(r, 'c').lockdownWired).toBe(false);
    expect(byId(r, 'b').missingTypes).toEqual(['Fire / Evacuate', 'Medical']);
  });

  it('a location with alerts OFF (DISABLED) is not an emergency gap of any kind (2026-09-24)', () => {
    // Greg, on a print-shop location the dashboard had painted red: "why are
    // we showing an alert that we cant play emergency content but i havent
    // even enabled it?"
    const r = buildDistrictRollup({
      locations: [loc('a'), loc('b')],
      screens: [screen('a'), screen('b')],
      readiness: {
        schools: [
          readySchool('a'),
          readySchool('b', { verdict: 'DISABLED', contentWired: 0, lockdownWired: false, missingTypes: [] }),
        ],
      },
      approvals: { byTenant: [] },
    });
    expect(r.needsAction.emergencyNotReadySchools).toBe(0);
    expect(r.needsAction.emergencyNotConfiguredSchools).toBe(0);
    expect(r.needsAction.emergencyOffSchools).toBe(1);
    expect(r.needsAction.allClear).toBe(true);
    expect(byId(r, 'b').emergencyEnabled).toBe(false);
    expect(byId(r, 'b').needsAttention).toBe(false);
    expect(byId(r, 'a').emergencyEnabled).toBe(true);
    expect(r.healthyCount).toBe(2);
  });

  it('rolls up pending approvals per school', () => {
    const r = buildDistrictRollup({
      locations: [loc('a'), loc('b')],
      screens: [],
      readiness: { schools: [readySchool('a'), readySchool('b')] },
      approvals: { byTenant: [{ tenantId: 'a', pending: 3 }] },
    });
    expect(r.needsAction.pendingApprovals).toBe(3);
    expect(r.needsAction.pendingApprovalSchools).toBe(1);
    expect(byId(r, 'a').pendingApprovals).toBe(3);
    expect(byId(r, 'b').pendingApprovals).toBe(0);
  });

  it('a school with zero screens still gets a row', () => {
    const r = buildDistrictRollup({
      locations: [loc('a'), loc('empty')],
      screens: [screen('a')],
      readiness: { schools: [readySchool('a'), readySchool('empty', { screensTotal: 0, screensOnline: 0 })] },
      approvals: { byTenant: [] },
    });
    expect(r.schools).toHaveLength(2);
    expect(byId(r, 'empty').screensTotal).toBe(0);
  });

  it('ignores screens belonging to a tenant outside the district roster', () => {
    const r = buildDistrictRollup({
      locations: [loc('a')],
      screens: [screen('a'), screen('stranger'), { ...screen('a'), sourceTenant: null }],
      readiness: { schools: [readySchool('a')] },
      approvals: { byTenant: [] },
    });
    expect(r.schools).toHaveLength(1);
    expect(byId(r, 'a').screensTotal).toBe(1);
  });
});

describe('buildDistrictRollup — never cry wolf', () => {
  it('SUPPRESSES readiness counters when the readiness request has not answered', () => {
    const r = buildDistrictRollup({
      locations: [loc('a')],
      screens: [screen('a')],
      readiness: null,
      approvals: { byTenant: [] },
    });
    expect(r.coverage.readiness).toBe(false);
    expect(r.needsAction.emergencyNotReadySchools).toBe(0);
    expect(byId(r, 'a').readiness).toBe('UNKNOWN');
    expect(byId(r, 'a').lockdownWired).toBeNull();
    // UNKNOWN must not mark the school as needing attention — that's the alarm.
    expect(byId(r, 'a').needsAttention).toBe(false);
  });

  it('SUPPRESSES approval counters when the approvals request has not answered', () => {
    const r = buildDistrictRollup({
      locations: [loc('a')],
      screens: [screen('a')],
      readiness: { schools: [readySchool('a')] },
      approvals: null,
    });
    expect(r.coverage.approvals).toBe(false);
    expect(r.needsAction.pendingApprovals).toBe(0);
    expect(r.needsAction.pendingApprovalSchools).toBe(0);
  });

  it('all-clear is reported alongside coverage so the UI can refuse to claim it', () => {
    const r = buildDistrictRollup({
      locations: [loc('a')],
      screens: [screen('a')],
      readiness: null,
      approvals: null,
    });
    // The counters are all zero...
    expect(r.needsAction.allClear).toBe(true);
    // ...but coverage says two of the three domains never answered, which is
    // what the component gates the calm "All N schools healthy" line on.
    expect(r.coverage).toEqual({ readiness: false, approvals: false });
  });
});

describe('compareScorecards — worst first', () => {
  const card = (over: Partial<SchoolScorecard>): SchoolScorecard => ({
    tenantId: over.name || 'x', name: 'x', slug: 'x', isSelf: false,
    screensTotal: 10, screensOnline: 10, screensOffline: 0, notPainting: 0,
    readiness: 'READY', missingTypes: [], lockdownWired: true, emergencyEnabled: true,
    pendingApprovals: 0, needsAttention: false,
    ...over,
  });

  it('a school that cannot run a lockdown outranks ANY number of offline screens', () => {
    const cantLockdown = card({ name: 'zeta', readiness: 'NOT_CONFIGURED' });
    const manyDown = card({ name: 'alpha', screensOffline: 99 });
    expect([manyDown, cantLockdown].sort(compareScorecards)[0]).toBe(cantLockdown);
  });

  it('"not painting" outranks the same count of plain offline screens', () => {
    const frozen = card({ name: 'zeta', notPainting: 1 });
    const down = card({ name: 'alpha', screensOffline: 1 });
    expect([down, frozen].sort(compareScorecards)[0]).toBe(frozen);
  });

  it('offline outranks a readiness warning, which outranks approvals', () => {
    const down = card({ name: 'd', screensOffline: 1 });
    const warn = card({ name: 'w', readiness: 'NEEDS_ATTENTION' });
    const appr = card({ name: 'a', pendingApprovals: 12 });
    expect([appr, warn, down].sort(compareScorecards).map((s) => s.name)).toEqual(['d', 'w', 'a']);
  });

  it('ties break alphabetically so the order is stable across polls', () => {
    const rows = [card({ name: 'Riverside' }), card({ name: 'Adams' }), card({ name: 'Monroe' })];
    expect(rows.sort(compareScorecards).map((s) => s.name)).toEqual(['Adams', 'Monroe', 'Riverside']);
  });

  it('healthy schools sink below every school with anything to fix', () => {
    const r = buildDistrictRollup({
      locations: [loc('healthy', 'Adams'), loc('down', 'Zeta'), loc('nolock', 'Monroe')],
      screens: [screen('down', { status: 'OFFLINE', renderHealth: 'UNKNOWN' }), screen('healthy')],
      readiness: {
        schools: [
          readySchool('healthy', { name: 'Adams' }),
          readySchool('down', { name: 'Zeta' }),
          readySchool('nolock', { name: 'Monroe', verdict: 'NOT_CONFIGURED', lockdownWired: false }),
        ],
      },
      approvals: { byTenant: [] },
    });
    expect(r.schools.map((s) => s.name)).toEqual(['Monroe', 'Zeta', 'Adams']);
    expect(r.healthyCount).toBe(1);
  });

  it('scales to 40 schools and still puts the one broken school first', () => {
    const locations = Array.from({ length: 40 }, (_, i) => loc(`s${i}`, `School ${String(i).padStart(2, '0')}`));
    const readiness = {
      schools: locations.map((l) =>
        readySchool(l.id, {
          name: l.name,
          ...(l.id === 's37' ? { verdict: 'NOT_CONFIGURED' as const, lockdownWired: false } : {}),
        }),
      ),
    };
    const screens = locations.flatMap((l) => [screen(l.id), screen(l.id)]);
    const r = buildDistrictRollup({ locations, screens, readiness, approvals: { byTenant: [] } });
    expect(r.schools).toHaveLength(40);
    expect(r.schools[0].tenantId).toBe('s37');
    expect(r.healthyCount).toBe(39);
  });
});

describe('filterScorecards', () => {
  const rows = [
    { name: 'Lincoln High', slug: 'lincoln-hs' },
    { name: 'Roosevelt Elementary', slug: 'roosevelt-el' },
  ] as SchoolScorecard[];

  it('matches on name, case-insensitively', () => {
    expect(filterScorecards(rows, 'LINCOLN')).toHaveLength(1);
  });
  it('matches on slug', () => {
    expect(filterScorecards(rows, 'roosevelt-el')).toHaveLength(1);
  });
  it('an empty query returns everything unchanged', () => {
    expect(filterScorecards(rows, '   ')).toBe(rows);
  });
});
