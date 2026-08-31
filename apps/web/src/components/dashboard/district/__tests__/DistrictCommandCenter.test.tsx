/**
 * Render-level proof for DistrictCommandCenter.
 *
 * The derivation is pinned in districtRollup.test.ts; THIS suite proves the
 * district admin actually SEES the right words and gets the right one-tap
 * destination — the "verify the render tree, don't trust green types"
 * discipline (CLAUDE.md #9 / #21).
 *
 * The centrepiece is `THE MORNING WALKTHROUGH`: a real district with two
 * offline screens at School B and one school missing lockdown content, which
 * is exactly the scenario this feature was commissioned for.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within } from '@testing-library/react';
import { DistrictCommandCenter } from '../DistrictCommandCenter';
import type { FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals } from '@/hooks/use-api';

const switchToTenant = jest.fn();
jest.mock('@/hooks/use-tenant-switch', () => ({
  useTenantSwitch: () => ({ switchToTenant, switchingId: null, error: null, clearError: () => {} }),
}));

type FleetScreen = FleetResponse['screens'][number];

function scr(tenant: string, over: Partial<FleetScreen> = {}): FleetScreen {
  return {
    id: `${tenant}-${Math.random().toString(36).slice(2, 7)}`,
    name: 'Screen',
    status: 'ONLINE',
    screenGroup: null,
    lastPingAt: null,
    lastCacheReport: null,
    renderHealth: 'OK',
    renderStale: false,
    renderStaleSeconds: 10,
    effectiveLatitude: null,
    effectiveLongitude: null,
    effectiveAddress: null,
    geoSource: 'none',
    sourceTenant: { id: tenant, name: tenant, slug: tenant },
    ...over,
  } as FleetScreen;
}

function fleetOf(screens: FleetScreen[], locations: Array<[string, string]>): FleetResponse {
  return {
    root: { id: 'district', name: 'Walnut Creek USD', slug: 'walnut-creek' },
    locations: locations.map(([id, name]) => ({ id, name, slug: id })),
    stats: {
      total: screens.length,
      online: screens.filter((s) => s.status === 'ONLINE').length,
      offline: screens.filter((s) => s.status === 'OFFLINE').length,
      locationCount: locations.length,
    },
    screens,
  };
}

function readinessOf(
  rows: Array<Partial<DistrictReadinessResponse['schools'][number]> & { tenantId: string; name: string }>,
  deliveryStatus: 'ok' | 'warn' | 'missing' = 'ok',
): DistrictReadinessResponse {
  const schools = rows.map((r) => ({
    slug: r.tenantId, isSelf: false, verdict: 'READY' as const,
    contentWired: 6, contentTotal: 6, lockdownWired: true, missingTypes: [],
    screensTotal: 0, screensOnline: 0, ...r,
  }));
  return {
    delivery: {
      key: 'delivery', status: deliveryStatus, label: 'Delivery chain',
      detail: deliveryStatus === 'warn'
        ? 'Realtime push is in fallback — alerts still deliver via polling, within ~20 seconds instead of instantly.'
        : 'Realtime push, polling backstop, and message signing all healthy.',
      fixHint: deliveryStatus === 'warn' ? 'No action needed from you; platform is monitoring the realtime channel.' : '',
    },
    schools,
    notReadyCount: schools.filter((s) => s.verdict !== 'READY').length,
    computedAt: new Date().toISOString(),
  };
}

const noApprovals: DistrictPendingApprovals = { total: 0, byTenant: [] };

beforeEach(() => switchToTenant.mockClear());

describe('DistrictCommandCenter — THE MORNING WALKTHROUGH', () => {
  // The commissioning scenario, verbatim: 2 offline screens at School B and
  // one school (School C) with no lockdown content.
  const fleet = fleetOf(
    [
      scr('school-a'), scr('school-a'), scr('school-a'),
      scr('school-b'),
      scr('school-b', { status: 'OFFLINE', renderHealth: 'UNKNOWN' }),
      scr('school-b', { status: 'OFFLINE', renderHealth: 'UNKNOWN' }),
      scr('school-c'), scr('school-c'),
    ],
    [['district', 'District Office'], ['school-a', 'School A'], ['school-b', 'School B'], ['school-c', 'School C']],
  );
  const readiness = readinessOf([
    { tenantId: 'district', name: 'District Office', isSelf: true },
    { tenantId: 'school-a', name: 'School A' },
    { tenantId: 'school-b', name: 'School B' },
    {
      tenantId: 'school-c', name: 'School C', verdict: 'NOT_CONFIGURED',
      contentWired: 0, lockdownWired: false,
      missingTypes: ['Lockdown', 'Secure', 'Hold', 'Evacuate', 'Weather', 'Medical'],
    },
  ]);

  const setup = () =>
    render(<DistrictCommandCenter fleet={fleet} readiness={readiness} approvals={noApprovals} />);

  it('leads with the school that CANNOT run a lockdown, naming it', () => {
    setup();
    expect(rtl.getByText('1 school can’t run a lockdown')).toBeInTheDocument();
    expect(
      rtl.getByText(/School C has no alert content wired/),
    ).toBeInTheDocument();
  });

  it('reports the two offline screens and says they are all at School B', () => {
    setup();
    expect(rtl.getByText('2 screens offline')).toBeInTheDocument();
    expect(rtl.getByText('All of them at School B.')).toBeInTheDocument();
  });

  it('shows NO zero-count rows — nothing about approvals or frozen screens', () => {
    setup();
    expect(rtl.queryByText(/waiting on you/)).toBeNull();
    expect(rtl.queryByText(/not painting/)).toBeNull();
    expect(rtl.queryByText(/All 4 schools are healthy/)).toBeNull();
  });

  it('each needs-action row is ONE TAP into the school where the fix lives', () => {
    setup();
    fireEvent.click(rtl.getByRole('button', { name: /Open School C/ }));
    expect(switchToTenant).toHaveBeenCalledWith(
      { id: 'school-c', slug: 'school-c' },
      '/school-c/settings/emergency',
    );

    switchToTenant.mockClear();
    fireEvent.click(rtl.getByRole('button', { name: /Open School B/ }));
    expect(switchToTenant).toHaveBeenCalledWith({ id: 'school-b', slug: 'school-b' }, '/school-b/screens');
  });

  it('orders the scorecards worst-first: C (no lockdown), B (offline), then the healthy', () => {
    setup();
    const rows = rtl.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('School C');
    expect(rows[1]).toHaveTextContent('School B');
    // Only two schools need attention here, so the healthy tail (2) is not
    // collapsed and renders in place.
    expect(rows.slice(2).map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('District Office'), expect.stringContaining('School A')]),
    );
  });

  it('each scorecard row carries its numbers and lands on ITS worst problem', () => {
    setup();
    const rowB = rtl.getAllByRole('listitem')[1];
    expect(within(rowB).getByText('1')).toBeInTheDocument();   // online
    expect(within(rowB).getByText('/3')).toBeInTheDocument();  // of total
    fireEvent.click(within(rowB).getByRole('button', { name: 'School B: Fix screens' }));
    expect(switchToTenant).toHaveBeenCalledWith({ id: 'school-b', slug: 'school-b' }, '/school-b/screens');

    const rowC = rtl.getAllByRole('listitem')[0];
    expect(within(rowC).getByText('No lockdown content')).toBeInTheDocument();
    expect(within(rowC).getByRole('button', { name: 'School C: Wire alerts' })).toBeInTheDocument();
  });

  it('labels the district office row so it is never mistaken for a school', () => {
    setup();
    expect(rtl.getByText('District office')).toBeInTheDocument();
  });
});

describe('DistrictCommandCenter — the calm morning', () => {
  const fleet = fleetOf(
    [scr('a'), scr('b'), scr('c')],
    [['district', 'District Office'], ['a', 'A'], ['b', 'B'], ['c', 'C']],
  );
  const readiness = readinessOf([
    { tenantId: 'district', name: 'District Office', isSelf: true },
    { tenantId: 'a', name: 'A' }, { tenantId: 'b', name: 'B' }, { tenantId: 'c', name: 'C' },
  ]);

  it('collapses to ONE line when every counter is zero', () => {
    render(<DistrictCommandCenter fleet={fleet} readiness={readiness} approvals={noApprovals} />);
    expect(rtl.getByText('All 4 schools are healthy — nothing needs you right now.')).toBeInTheDocument();
    expect(rtl.queryByText('Needs action')).toBeNull();
  });

  it('REFUSES to claim all-clear while a check has not answered', () => {
    render(<DistrictCommandCenter fleet={fleet} readiness={null} approvals={noApprovals} />);
    expect(rtl.queryByText(/are healthy — nothing needs you/)).toBeNull();
    expect(rtl.getByText(/Still checking emergency readiness/)).toBeInTheDocument();
  });
});

describe('DistrictCommandCenter — multi-school rows and scale', () => {
  it('a multi-school row FILTERS the list instead of guessing a destination', () => {
    const fleet = fleetOf(
      [
        scr('a', { status: 'OFFLINE', renderHealth: 'UNKNOWN' }),
        scr('b', { status: 'OFFLINE', renderHealth: 'UNKNOWN' }),
        scr('c'),
      ],
      [['a', 'A'], ['b', 'B'], ['c', 'C']],
    );
    const readiness = readinessOf([
      { tenantId: 'a', name: 'A' }, { tenantId: 'b', name: 'B' }, { tenantId: 'c', name: 'C' },
    ]);
    render(<DistrictCommandCenter fleet={fleet} readiness={readiness} approvals={noApprovals} />);

    expect(rtl.getByText('2 screens offline')).toBeInTheDocument();
    expect(rtl.getByText('Across 2 schools.')).toBeInTheDocument();
    expect(rtl.getAllByRole('listitem')).toHaveLength(3);

    fireEvent.click(rtl.getByRole('button', { name: /Show the 2/ }));
    expect(switchToTenant).not.toHaveBeenCalled();
    const rows = rtl.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent?.slice(0, 1))).toEqual(['A', 'B']);
  });

  it('surfaces "reachable but NOT painting" as its own row — the money signal', () => {
    const fleet = fleetOf(
      [scr('a', { renderHealth: 'STALE', renderStale: true }), scr('a')],
      [['a', 'A']],
    );
    render(
      <DistrictCommandCenter
        fleet={fleet}
        readiness={readinessOf([{ tenantId: 'a', name: 'A' }])}
        approvals={noApprovals}
      />,
    );
    expect(rtl.getByText('1 screen has no confirmed picture')).toBeInTheDocument();
    // 2026-08-30 (audit P0-5): copy says what the evidence proves — no painted-
    // frame PROOF — never "frozen frame", which the system cannot actually see.
    expect(rtl.getByText(/connected and answering, but no confirmed picture/)).toBeInTheDocument();
    expect(rtl.queryByText(/screens offline/)).toBeNull();
  });

  it('offers a search box past 8 schools and collapses the healthy tail', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const fleet = fleetOf(
      ids.flatMap((id) =>
        id === 's4' ? [scr(id, { status: 'OFFLINE', renderHealth: 'UNKNOWN' })] : [scr(id)],
      ),
      ids.map((id) => [id, `School ${id}`] as [string, string]),
    );
    const readiness = readinessOf(ids.map((id) => ({ tenantId: id, name: `School ${id}` })));
    render(<DistrictCommandCenter fleet={fleet} readiness={readiness} approvals={noApprovals} />);

    const search = rtl.getByLabelText('Filter schools by name');
    // Only the one troubled school renders; the healthy 11 are behind a line.
    expect(rtl.getAllByRole('listitem')).toHaveLength(1);
    expect(rtl.getByText('11 other schools are healthy')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 's7' } });
    const rows = rtl.getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('School s7');
  });

  it('reports a realtime-fallback delivery warning ONCE, not on every school', () => {
    const fleet = fleetOf([scr('a', { status: 'OFFLINE', renderHealth: 'UNKNOWN' })], [['a', 'A']]);
    render(
      <DistrictCommandCenter
        fleet={fleet}
        readiness={readinessOf([{ tenantId: 'a', name: 'A' }], 'warn')}
        approvals={noApprovals}
      />,
    );
    expect(rtl.getAllByText(/Realtime push is in fallback/)).toHaveLength(1);
    // ...and it does not turn the school's own verdict amber.
    expect(rtl.getByText('Alert-ready')).toBeInTheDocument();
  });
});
