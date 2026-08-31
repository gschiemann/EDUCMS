import { buildFleetCommand, isContentBehind, type FleetCommandScreen } from '../fleetCommand';

/**
 * fleetCommand — Phase 1 derivation matrix. The five assurance truths must
 * stay INDEPENDENT (online ≠ healthy), the inbox must be worst-first, and
 * every unknown input must suppress rather than zero (never cry wolf).
 */

const T1 = { id: 't1', name: 'Peak West', slug: 'west' };
const T2 = { id: 't2', name: 'Peak East', slug: 'east' };

function screen(over: Partial<FleetCommandScreen> = {}): FleetCommandScreen {
  return {
    id: over.id ?? 's1',
    name: over.name ?? 'Screen',
    status: 'ONLINE',
    renderHealth: 'OK',
    renderStale: false,
    pushChannel: 'live',
    lastBundleSha: 'aaaaaaaaaaaa',
    pendingRefreshAtMs: null,
    refreshAckMs: null,
    sourceTenant: T1,
    ...over,
  };
}

function readiness(tenantId: string, name: string, slug: string, verdict: 'READY' | 'NEEDS_ATTENTION' | 'NOT_CONFIGURED') {
  return {
    tenantId, name, slug, isSelf: false, verdict,
    contentWired: verdict === 'READY' ? 3 : 0, contentTotal: 3,
    lockdownWired: false, missingTypes: verdict === 'READY' ? [] : ['Evacuate'],
    screensTotal: 1, screensOnline: 1,
  };
}

function build(screens: FleetCommandScreen[], opts: {
  deployedSha?: string | null;
  readiness?: any[] | null;
  approvals?: Record<string, number> | null;
} = {}) {
  return buildFleetCommand({
    screens,
    deployedSha: opts.deployedSha === undefined ? 'aaaaaaaaaaaa' : opts.deployedSha,
    rollupInput: {
      locations: [T1, T2],
      rootId: 't1',
      screens: screens as any,
      readiness: opts.readiness === undefined
        ? { delivery: { status: 'ok' }, schools: [readiness('t1', 'Peak West', 'west', 'READY'), readiness('t2', 'Peak East', 'east', 'READY')], notReadyCount: 0, computedAt: '' } as any
        : opts.readiness === null ? null : { delivery: { status: 'ok' }, schools: opts.readiness, notReadyCount: 0, computedAt: '' } as any,
      approvals: opts.approvals === undefined
        ? { byTenant: [] } as any
        : opts.approvals === null
          ? null
          : { byTenant: Object.entries(opts.approvals).map(([tenantId, pending]) => ({ tenantId, pending })) } as any,
    },
  });
}

describe('isContentBehind — the content-current truth', () => {
  it('same bundle + no pending refresh → current', () => {
    expect(isContentBehind(screen(), 'aaaaaaaaaaaa')).toBe(false);
  });
  it('different bundle → behind', () => {
    expect(isContentBehind(screen({ lastBundleSha: 'bbbbbbbbbbbb' }), 'aaaaaaaaaaaa')).toBe(true);
  });
  it('unacked durable refresh → behind, even on the current bundle', () => {
    expect(isContentBehind(screen({ pendingRefreshAtMs: 1000, refreshAckMs: null }), 'aaaaaaaaaaaa')).toBe(true);
  });
  it('VALUE-acked refresh → current (ack echoes the exact pending value)', () => {
    expect(isContentBehind(screen({ pendingRefreshAtMs: 1000, refreshAckMs: 1000 }), 'aaaaaaaaaaaa')).toBe(false);
  });
  it('stale ack from an OLDER refresh → still behind (value identity, not clocks)', () => {
    expect(isContentBehind(screen({ pendingRefreshAtMs: 2000, refreshAckMs: 1000 }), 'aaaaaaaaaaaa')).toBe(true);
  });
  it('offline screens are never "behind" — the offline pill owns them', () => {
    expect(isContentBehind(screen({ status: 'OFFLINE', lastBundleSha: 'bbbbbbbbbbbb' }), 'aaaaaaaaaaaa')).toBe(false);
  });
  it('no deployed SHA and no pending refresh → fails closed, not behind', () => {
    expect(isContentBehind(screen(), null)).toBe(false);
  });
});

describe('buildFleetCommand — five independent truths', () => {
  it('a fully healthy fleet is all-clear with five ok pills', () => {
    const fc = build([screen({ id: 'a' }), screen({ id: 'b', sourceTenant: T2 })]);
    expect(fc.assurance.online.state).toBe('ok');
    expect(fc.assurance.contentCurrent.state).toBe('ok');
    expect(fc.assurance.pushLive.state).toBe('ok');
    expect(fc.assurance.emergencyReady.state).toBe('ok');
    expect(fc.assurance.showingContent.state).toBe('ok');
    expect(fc.inbox).toHaveLength(0);
    expect(fc.allClear).toBe(true);
    expect(fc.convergence.settled).toBe(true);
  });

  it('online ≠ healthy: an online screen with no confirmed picture flips ONLY showing-content', () => {
    const fc = build([screen({ renderHealth: 'STALE', renderStale: true })]);
    expect(fc.assurance.online.state).toBe('ok');
    expect(fc.assurance.showingContent.state).toBe('bad');
    expect(fc.inbox[0].kind).toBe('not-painting');
    expect(fc.allClear).toBe(false);
  });

  it('a behind screen flips content-current and feeds convergence', () => {
    const fc = build([screen(), screen({ id: 'b', lastBundleSha: 'bbbbbbbbbbbb' })]);
    expect(fc.assurance.contentCurrent).toMatchObject({ n: 1, total: 2, state: 'warn' });
    expect(fc.convergence).toMatchObject({ confirmed: 1, propagating: 1, settled: false });
    expect(fc.inbox.some((r) => r.kind === 'content-behind')).toBe(true);
  });

  it('no deployed SHA → content pill unknown, never an accusation', () => {
    const fc = build([screen()], { deployedSha: null });
    expect(fc.assurance.contentCurrent.state).toBe('unknown');
    expect(fc.inbox.some((r) => r.kind === 'content-behind')).toBe(false);
  });

  it('missing readiness suppresses the emergency pill and blocks all-clear', () => {
    const fc = build([screen()], { readiness: null });
    expect(fc.assurance.emergencyReady.state).toBe('unknown');
    expect(fc.coverage.readiness).toBe(false);
    expect(fc.allClear).toBe(false);
  });

  it('inbox is worst-first: emergency gap outranks everything, approvals last', () => {
    const fc = build(
      [
        screen({ id: 'a', sourceTenant: T2, status: 'OFFLINE' }),
        screen({ id: 'b', pushChannel: 'stale' }),
      ],
      {
        readiness: [readiness('t1', 'Peak West', 'west', 'READY'), readiness('t2', 'Peak East', 'east', 'NOT_CONFIGURED')],
        approvals: { t1: 2 },
      },
    );
    const kinds = fc.inbox.map((r) => r.kind);
    expect(kinds[0]).toBe('emergency');
    expect(kinds.indexOf('offline')).toBeLessThan(kinds.indexOf('push-stale'));
    expect(kinds[kinds.length - 1]).toBe('approvals');
  });

  it('a screenless location gets ONE calm setup row — never an emergency alarm (operator, 2026-08-31)', () => {
    // Henderson has NO screens paired; its readiness verdict is
    // NOT_CONFIGURED (nothing wired), but a location that cannot display
    // anything must not be told it "can't display an emergency alert".
    const fc = buildFleetCommand({
      screens: [screen()],
      deployedSha: 'aaaaaaaaaaaa',
      rollupInput: {
        locations: [T1, { id: 't3', name: 'Peak Henderson', slug: 'henderson' }],
        rootId: 't1',
        screens: [screen()] as any,
        readiness: { delivery: { status: 'ok' }, schools: [
          readiness('t1', 'Peak West', 'west', 'READY'),
          { ...readiness('t3', 'Peak Henderson', 'henderson', 'NOT_CONFIGURED'), screensTotal: 0, screensOnline: 0 },
        ], notReadyCount: 1, computedAt: '' } as any,
        approvals: { byTenant: [] } as any,
      },
    });
    expect(fc.inbox.filter((r) => r.tenantId === 't3')).toHaveLength(1);
    expect(fc.inbox.find((r) => r.tenantId === 't3')!.kind).toBe('setup');
    expect(fc.inbox.some((r) => r.kind === 'emergency')).toBe(false);
    // Emergency pill measures only locations WITH screens.
    expect(fc.assurance.emergencyReady).toMatchObject({ n: 1, total: 1, state: 'ok' });
    // Screenless parks at the bottom of the table.
    expect(fc.locations[fc.locations.length - 1].tenantId).toBe('t3');
    expect(fc.locations[fc.locations.length - 1].hasScreens).toBe(false);
  });

  it('per-location rows carry contentBehind and pushStale counts', () => {
    const fc = build([
      screen({ id: 'a', lastBundleSha: 'bbbbbbbbbbbb' }),
      screen({ id: 'b', pushChannel: 'stale', sourceTenant: T2 }),
    ]);
    const west = fc.locations.find((l) => l.tenantId === 't1')!;
    const east = fc.locations.find((l) => l.tenantId === 't2')!;
    expect(west.contentBehind).toBe(1);
    expect(east.pushStale).toBe(1);
  });
});
