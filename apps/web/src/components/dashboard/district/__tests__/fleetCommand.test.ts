import {
  buildFleetCommand, isContentBehind, locationTone, worstLine, worstPath,
  type FleetCommandScreen,
} from '../fleetCommand';

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
    lockdownWired: false, missingTypes: verdict === 'READY' ? [] : ['Fire / Evacuate'],
    screensTotal: 1, screensOnline: 1,
  };
}

function build(screens: FleetCommandScreen[], opts: {
  deployedSha?: string | null;
  deployedBundleId?: string | null;
  readiness?: any[] | null;
  approvals?: Record<string, number> | null;
  now?: number;
} = {}) {
  return buildFleetCommand({
    screens,
    now: opts.now,
    deployedSha: opts.deployedSha === undefined ? 'aaaaaaaaaaaa' : opts.deployedSha,
    deployedBundleId: opts.deployedBundleId,
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

  it('a screen with an UNCONFIRMED PUSH flips content-current, feeds convergence and is an inbox row', () => {
    const fc = build([screen(), screen({ id: 'b', pendingRefreshAtMs: 1000, refreshAckMs: null })]);
    expect(fc.assurance.contentCurrent).toMatchObject({ n: 1, total: 2, state: 'warn' });
    expect(fc.convergence).toMatchObject({ confirmed: 1, propagating: 1, settled: false });
    expect(fc.inbox.some((r) => r.kind === 'content-behind')).toBe(true);
  });

  // 2026-09-21 — the operator, from his phone, on a morning of web deploys:
  //   "why does every screen say resync on it…our app needs to self heal not
  //    … be asking me to do shit all the time"
  // A screen on an older page bundle plays its assigned content and reloads
  // itself. It is not a thing that needs attention, it is not "behind" for
  // its location, and it must never get a row (a row carries a Resync button).
  it('a screen that is only on an OLDER BUILD asks for nothing: no inbox row, no location count', () => {
    const fc = build([
      screen({ id: 'a', lastBundleSha: 'bbbbbbbbbbbb' }),
      screen({ id: 'b', lastBundleSha: 'bbbbbbbbbbbb' }),
    ]);
    expect(fc.inbox.some((r) => r.kind === 'content-behind')).toBe(false);
    expect(fc.locations.find((l) => l.tenantId === 't1')!.contentBehind).toBe(0);
    // The app-version pill still tells the truth it has.
    expect(fc.assurance.contentCurrent).toMatchObject({ n: 0, total: 2 });
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
      screen({ id: 'a', pendingRefreshAtMs: 1000, refreshAckMs: null }),
      screen({ id: 'b', pushChannel: 'stale', sourceTenant: T2 }),
    ]);
    const west = fc.locations.find((l) => l.tenantId === 't1')!;
    const east = fc.locations.find((l) => l.tenantId === 't2')!;
    expect(west.contentBehind).toBe(1);
    expect(east.pushStale).toBe(1);
  });
});

// ─── Emergency cache per location (Fleet Command mock parity) ────────
// The one column that answers "could this location still show an alert with
// the network down". Counted over EVERY screen, and never inferred from
// silence — a screen that has not reported is not a cached screen.
describe('buildFleetCommand — emergencyCached', () => {
  const cached = (count: number) => ({ lastCacheReport: { emergency: { count } } });

  it('counts screens holding emergency content, over ALL screens not just online', () => {
    const fc = build([
      screen({ id: 'a', ...cached(4) }),
      // OFFLINE but already holding the media — exactly the case the
      // never-evict tier exists for, so it MUST count.
      screen({ id: 'b', status: 'OFFLINE', ...cached(4) }),
      screen({ id: 'c' }),
    ]);
    const west = fc.locations.find((l) => l.tenantId === 't1')!;
    expect(west.emergencyCached).toBe(2);
    expect(west.screensTotal).toBe(3);
  });

  it('fails closed on every shape of no-evidence — absent, empty, or zero', () => {
    const fc = build([
      screen({ id: 'a', lastCacheReport: null }),
      screen({ id: 'b', lastCacheReport: {} }),
      screen({ id: 'c', lastCacheReport: { emergency: {} } }),
      screen({ id: 'd', ...cached(0) }),
    ]);
    expect(fc.locations.find((l) => l.tenantId === 't1')!.emergencyCached).toBe(0);
  });

  it('is scoped per location — one location’s cache never counts for another', () => {
    const fc = build([
      screen({ id: 'a', ...cached(2) }),
      screen({ id: 'b', sourceTenant: T2 }),
    ]);
    expect(fc.locations.find((l) => l.tenantId === 't1')!.emergencyCached).toBe(1);
    expect(fc.locations.find((l) => l.tenantId === 't2')!.emergencyCached).toBe(0);
  });

  it('a screenless location reports 0 of 0 (the table renders it as “—”)', () => {
    const fc = build([screen({ id: 'a', ...cached(1) })]);
    const east = fc.locations.find((l) => l.tenantId === 't2')!;
    expect(east.emergencyCached).toBe(0);
    expect(east.hasScreens).toBe(false);
  });
});

// ─── Per-screen inbox rows (design-mock parity, 2026-08-31) ──────────
// The mock's inbox names the SCREEN ("G43 · Behind on content · 18m"), not a
// count of screens — because a named row can carry a recovery button for that
// one screen and a counted row cannot. Location-level facts stay per-location.
describe('buildFleetCommand — per-screen inbox granularity', () => {
  const NOW = 1_800_000_000_000;
  const minsAgo = (m: number) => NOW - m * 60_000;

  it('a screen-level kind emits ONE ROW PER SCREEN, each naming its own screen', () => {
    const fc = build(
      [
        screen({ id: 'g43', name: 'G43', pendingRefreshAtMs: minsAgo(9), refreshAckMs: null }),
        screen({ id: 'g44', name: 'G44', pendingRefreshAtMs: minsAgo(4), refreshAckMs: null }),
      ],
      { now: NOW },
    );
    const rows = fc.inbox.filter((r) => r.kind === 'content-behind');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.headline)).toEqual([
      'G43 · Behind on content',
      'G44 · Behind on content',
    ]);
    // The screen id is what lets the row own a per-screen recovery button.
    expect(rows.map((r) => r.screenId)).toEqual(['g43', 'g44']);
    expect(rows.every((r) => r.count === 1)).toBe(true);
  });

  it('content-behind is dated from the outstanding push it has not confirmed', () => {
    const fc = build(
      [screen({ id: 'g43', name: 'G43', pendingRefreshAtMs: minsAgo(18), refreshAckMs: null })],
      { now: NOW },
    );
    const row = fc.inbox.find((r) => r.kind === 'content-behind')!;
    expect(row.age).toBe('18m');
    expect(row.detail).toBe('Content update published 18 minutes ago.');
  });

  it('offline is dated from the last heartbeat; no heartbeat → no age, no guess', () => {
    const fc = build(
      [
        screen({ id: 'a', name: 'M43', status: 'OFFLINE', lastPingAt: new Date(minsAgo(42)).toISOString() }),
        screen({ id: 'b', name: 'M44', status: 'OFFLINE', lastPingAt: null }),
      ],
      { now: NOW },
    );
    const rows = fc.inbox.filter((r) => r.kind === 'offline');
    const dated = rows.find((r) => r.screenId === 'a')!;
    expect(dated.headline).toBe('M43 · Offline');
    expect(dated.age).toBe('42m');
    expect(dated.detail).toBe('Last seen 42 minutes ago.');
    const undated = rows.find((r) => r.screenId === 'b')!;
    expect(undated.age).toBeUndefined();
    expect(undated.detail).toBe('Not answering heartbeats.');
  });

  it('a FUTURE timestamp (clock skew) yields no age rather than a negative one', () => {
    const fc = build(
      [screen({ id: 'a', name: 'Skewed', status: 'OFFLINE', lastPingAt: new Date(NOW + 60_000).toISOString() })],
      { now: NOW },
    );
    const row = fc.inbox.find((r) => r.kind === 'offline')!;
    expect(row.age).toBeUndefined();
    expect(row.headline).not.toMatch(/-/);
  });

  it('named rows are OLDEST FIRST, and undated rows sort last', () => {
    const fc = build(
      [
        screen({ id: 'new', name: 'New', status: 'OFFLINE', lastPingAt: new Date(minsAgo(2)).toISOString() }),
        screen({ id: 'none', name: 'None', status: 'OFFLINE', lastPingAt: null }),
        screen({ id: 'old', name: 'Old', status: 'OFFLINE', lastPingAt: new Date(minsAgo(90)).toISOString() }),
      ],
      { now: NOW },
    );
    expect(fc.inbox.filter((r) => r.kind === 'offline').map((r) => r.screenId))
      .toEqual(['old', 'new', 'none']);
  });

  it('caps at 3 named rows per (kind, location) and adds a “+N more” aggregate with NO screenId', () => {
    const fc = build(
      Array.from({ length: 5 }, (_, i) =>
        screen({ id: `s${i}`, name: `S${i}`, status: 'OFFLINE', lastPingAt: new Date(minsAgo(50 - i)).toISOString() }),
      ),
      { now: NOW },
    );
    const rows = fc.inbox.filter((r) => r.kind === 'offline');
    expect(rows).toHaveLength(4);
    expect(rows.slice(0, 3).every((r) => !!r.screenId)).toBe(true);
    const tail = rows[3];
    expect(tail.headline).toBe('+2 more at Peak West');
    expect(tail.count).toBe(2);
    // No screen id: a button here would claim to fix two screens at once.
    expect(tail.screenId).toBeUndefined();
  });

  it('the cap is PER LOCATION — one busy location never eats another’s rows', () => {
    const fc = build(
      [
        ...Array.from({ length: 4 }, (_, i) =>
          screen({ id: `w${i}`, name: `W${i}`, status: 'OFFLINE', lastPingAt: new Date(minsAgo(40 - i)).toISOString() }),
        ),
        screen({ id: 'e0', name: 'E0', status: 'OFFLINE', sourceTenant: T2, lastPingAt: new Date(minsAgo(5)).toISOString() }),
      ],
      { now: NOW },
    );
    const rows = fc.inbox.filter((r) => r.kind === 'offline');
    expect(rows.filter((r) => r.tenantId === 't1').map((r) => r.headline))
      .toEqual(['W0 · Offline', 'W1 · Offline', 'W2 · Offline', '+1 more at Peak West']);
    expect(rows.filter((r) => r.tenantId === 't2').map((r) => r.screenId)).toEqual(['e0']);
  });

  it('LOCATION-level kinds stay one row per location — they are not screen facts', () => {
    const fc = build(
      [screen({ id: 'a' }), screen({ id: 'b' }), screen({ id: 'c' })],
      {
        readiness: [readiness('t1', 'Peak West', 'west', 'NOT_CONFIGURED'), readiness('t2', 'Peak East', 'east', 'READY')],
        approvals: { t1: 7 },
        now: NOW,
      },
    );
    const emergency = fc.inbox.filter((r) => r.kind === 'emergency');
    expect(emergency).toHaveLength(1);
    expect(emergency[0].headline).toBe('Peak West can’t display an emergency alert');
    expect(emergency[0].screenId).toBeUndefined();
    const approvalRows = fc.inbox.filter((r) => r.kind === 'approvals');
    expect(approvalRows).toHaveLength(1);
    expect(approvalRows[0].count).toBe(7);
  });

  it('a NOT_CONFIGURED location that never stated an industry is told THAT, and sent to Settings → Organization', () => {
    const fc = build(
      [screen({ id: 'a' })],
      {
        readiness: [{ ...readiness('t1', 'RIOT Cleveland', 'riot', 'NOT_CONFIGURED'), verticalStated: false }],
        approvals: {},
        now: NOW,
      },
    );
    const emergency = fc.inbox.filter((r) => r.kind === 'emergency');
    expect(emergency).toHaveLength(1);
    // The name comes from the fleet roster, not the readiness row.
    expect(emergency[0].headline).toBe('Peak West: industry not set — emergency alerts are on by default');
    expect(emergency[0].detail).toBe('Set the industry under Settings → Organization, or turn alerts off under Settings → Emergency.');
    expect(emergency[0].path).toBe('settings/organization');
  });

  it('worst-first still holds across the new per-screen rows', () => {
    const fc = build(
      [
        screen({ id: 'stale', name: 'Slow', pushChannel: 'stale' }),
        screen({ id: 'dark', name: 'Dark', status: 'OFFLINE', sourceTenant: T2 }),
        screen({ id: 'blind', name: 'Blind', renderHealth: 'STALE', renderStale: true }),
      ],
      { now: NOW },
    );
    const kinds = fc.inbox.map((r) => r.kind);
    expect(kinds.indexOf('not-painting')).toBeLessThan(kinds.indexOf('offline'));
    expect(kinds.indexOf('offline')).toBeLessThan(kinds.indexOf('push-stale'));
  });
});


// -- 2026-09-04: the re-pair signal reaches the district inbox ------------
//
// After a device-key rotation, screens that cannot prove their credential
// stop posting render proof (SEC-001 refuses the write) - 17 pinging, 0
// posting, in production. Two things must hold: the district must NOT read
// that as a fleet-wide picture failure, and the screen must NOT silently
// vanish from the inbox now that it no longer grades 'not-painting'.
describe('fleetCommand - REPAIR_REQUIRED screens', () => {
  const downgraded = () =>
    screen({
      id: 'g43',
      name: 'G43',
      renderHealth: 'STALE',
      renderStale: true,
      // Real fleet rows carry authState; the declared shape predates it.
      ...({ authState: 'REPAIR_REQUIRED' } as Partial<FleetCommandScreen>),
    });

  it('files its own row instead of "No picture confirmed"', () => {
    const out = build([downgraded()]);
    const kinds = out.inboxAll.map((r) => r.kind);
    expect(kinds).toContain('repair-required');
    expect(kinds).not.toContain('not-painting');

    const row = out.inboxAll.find((r) => r.kind === 'repair-required');
    expect(row?.screenId).toBe('g43');
    expect(row?.headline).toContain('Needs re-pairing');
  });

  it('a PROVEN screen with the same missing proof still files not-painting', () => {
    const out = build([
      screen({ id: 's9', name: 'S9', renderHealth: 'STALE', renderStale: true }),
    ]);
    expect(out.inboxAll.map((r) => r.kind)).toContain('not-painting');
  });
});

/**
 * ── THE 2026-09-21 FLEET SYMPTOM ─────────────────────────────────────────
 * Greg: "why does every screen say resync on it…our app needs to self heal."
 *
 * Since 2026-09-02 the player reloads on `bundleId` (a hash of the
 * client-bundle build inputs), not the commit SHA — so an API-only, docs,
 * APK or test-only commit correctly reloads NOBODY. But the fleet graded
 * skew on SHA equality, and every commit moves the SHA. So after any such
 * deploy the whole fleet read "App current 5/18", filed a content-behind row
 * per screen and never showed convergence settled — none of which a Resync
 * could clear, because the screen reloads the identical bundle and reports
 * the identical SHA.
 *
 * This is that exact fleet, asserted at the level the operator reads it.
 */
describe('fleetCommand — a bundle-neutral deploy leaves a healthy fleet alone', () => {
  const BUNDLE = '1f2e3d4c5b6a';

  /** On the deployed BUNDLE but a DIFFERENT commit SHA — the shape of every
   *  screen in the fleet after an API-only / docs / APK / test commit. */
  const onDeployedBundle = (id: string, tenant = T1): FleetCommandScreen =>
    screen({
      id,
      name: id.toUpperCase(),
      sourceTenant: tenant,
      lastBundleSha: 'bbbbbbbbbbbb',
      lastBundleId: BUNDLE,
    });

  it('THE BUG: SHAs all differ, bundleIds all match → App current n === total', () => {
    const fc = build(
      [onDeployedBundle('a'), onDeployedBundle('b', T2), onDeployedBundle('c')],
      { deployedSha: 'aaaaaaaaaaaa', deployedBundleId: BUNDLE },
    );

    // The headline the operator actually reads.
    expect(fc.assurance.contentCurrent).toMatchObject({ n: 3, total: 3, state: 'ok' });
    // No per-screen accusation anywhere.
    expect(fc.inboxAll.some((r) => r.kind === 'content-behind')).toBe(false);
    // Nothing is "still propagating" — there is nothing to propagate.
    expect(fc.convergence).toMatchObject({ confirmed: 3, propagating: 0, settled: true });
    expect(fc.allClear).toBe(true);
  });

  it('WITHOUT the deployed bundleId the same fleet reads behind — the bug, pinned', () => {
    // Proves the assertion above is driven by the new comparison and not by
    // some unrelated default in the fixture.
    const fc = build(
      [onDeployedBundle('a'), onDeployedBundle('b', T2), onDeployedBundle('c')],
      { deployedSha: 'aaaaaaaaaaaa', deployedBundleId: null },
    );

    expect(fc.assurance.contentCurrent).toMatchObject({ n: 0, total: 3 });
    expect(fc.convergence.settled).toBe(false);
    // …and even then it is a PILL, never an inbox row: an older build heals
    // itself, so it is not an ask (7977cace). Only an unconfirmed push is.
    expect(fc.inboxAll.some((r) => r.kind === 'content-behind')).toBe(false);
  });

  it('a screen genuinely on an older BUNDLE is still reported behind', () => {
    // The fix must not blind the signal — a screen stuck on old code reading
    // green would be the 2026-06-27 launch blocker all over again.
    const fc = build(
      [
        onDeployedBundle('a'),
        onDeployedBundle('b'),
        screen({ id: 'c', name: 'C', lastBundleSha: 'bbbbbbbbbbbb', lastBundleId: '9988776655ff' }),
      ],
      { deployedSha: 'aaaaaaaaaaaa', deployedBundleId: BUNDLE },
    );
    // Reported where it belongs — the app-version pill — and visible on the
    // Screens page as a calm 'Updating itself' row. NOT an inbox ask: the
    // screen reloads on its own.
    expect(fc.assurance.contentCurrent).toMatchObject({ n: 2, total: 3, state: 'warn' });
    expect(fc.inboxAll.filter((r) => r.kind === 'content-behind')).toHaveLength(0);
  });

  it('an unacked push still outranks a matching bundleId — the stronger claim wins', () => {
    expect(
      isContentBehind(
        {
          status: 'ONLINE',
          lastBundleSha: 'bbbbbbbbbbbb',
          lastBundleId: BUNDLE,
          pendingRefreshAtMs: 1000,
          refreshAckMs: null,
        },
        'aaaaaaaaaaaa',
        BUNDLE,
      ),
    ).toBe(true);
  });

  it('a caller that passes no bundleId at all behaves exactly as before', () => {
    // MobileFleetCommand is still on the SHA-only call shape; it must keep
    // compiling AND keep its previous truth table.
    expect(
      isContentBehind(
        { status: 'ONLINE', lastBundleSha: 'bbbbbbbbbbbb', pendingRefreshAtMs: null, refreshAckMs: null },
        'aaaaaaaaaaaa',
      ),
    ).toBe(true);
    expect(
      isContentBehind(
        { status: 'ONLINE', lastBundleSha: 'aaaaaaaaaaaa', pendingRefreshAtMs: null, refreshAckMs: null },
        'aaaaaaaaaaaa',
      ),
    ).toBe(false);
  });
});

// ─── Emergency alerts OFF (readiness DISABLED, 2026-09-24) ───────────
// Greg, on a print-shop location the dashboard had painted red: "why are we
// showing an alert that we cant play emergency content but i havent even
// enabled it?" A location with the capability off is not graded: no inbox
// row, no red line, not in the pill's denominator.
describe('buildFleetCommand — emergency alerts OFF (DISABLED)', () => {
  const off = (tenantId: string, name: string, slug: string) => ({
    ...readiness(tenantId, name, slug, 'READY'),
    verdict: 'DISABLED',
    enabled: false,
    contentWired: 0,
    missingTypes: [],
  });

  it('a location with alerts off gets no emergency row, no red line, and leaves the pill to the armed locations', () => {
    const fc = build([screen(), screen({ id: 'b', sourceTenant: T2 })], {
      readiness: [readiness('t1', 'Peak West', 'west', 'READY'), off('t2', 'Peak East', 'east')],
    });
    expect(fc.inbox.some((r) => r.kind === 'emergency')).toBe(false);
    expect(fc.assurance.emergencyReady).toMatchObject({ n: 1, total: 1, state: 'ok' });
    const east = fc.locations.find((l) => l.tenantId === 't2')!;
    expect(east.emergencyEnabled).toBe(false);
    expect(worstLine(east)).toBeNull();
    expect(locationTone(east)).toBe('ok');
    expect(worstPath(east)).toBe('dashboard');
  });

  it('an armed location with nothing wired still alarms — turning alerts off is the only thing that silences it', () => {
    const fc = build([screen(), screen({ id: 'b', sourceTenant: T2 })], {
      readiness: [readiness('t1', 'Peak West', 'west', 'READY'), readiness('t2', 'Peak East', 'east', 'NOT_CONFIGURED')],
    });
    expect(fc.inbox.some((r) => r.kind === 'emergency' && r.tenantId === 't2')).toBe(true);
    expect(fc.assurance.emergencyReady).toMatchObject({ n: 1, total: 2, state: 'bad' });
  });

  it('every location off → the pill reads "off", never 0/0 and never a false all-clear', () => {
    const fc = build([screen(), screen({ id: 'b', sourceTenant: T2 })], {
      readiness: [off('t1', 'Peak West', 'west'), off('t2', 'Peak East', 'east')],
    });
    expect(fc.assurance.emergencyReady).toMatchObject({ n: 0, total: 0, state: 'off' });
    expect(fc.inbox.some((r) => r.kind === 'emergency')).toBe(false);
  });
});
