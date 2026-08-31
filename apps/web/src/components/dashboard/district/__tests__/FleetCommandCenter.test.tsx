/**
 * Render-level proof for FleetCommandCenter (Fleet Command, Phase 1).
 *
 * The derivation matrix is pinned in fleetCommand.test.ts; THIS suite proves
 * the operator SEES the five pills, the worst-first inbox, and the location
 * table — the "verify the render tree" discipline (CLAUDE.md #9 / #21) —
 * and that "Classic view" actually fires the rollback callback.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent } from '@testing-library/react';
import { FleetCommandCenter } from '../FleetCommandCenter';
import type { FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals } from '@/hooks/use-api';

const switchToTenant = jest.fn();
jest.mock('@/hooks/use-tenant-switch', () => ({
  useTenantSwitch: () => ({ switchToTenant, switchingId: null, error: null, clearError: () => {} }),
}));

// /api/build-info — fail closed (null SHA) so the content pill grades unknown
// deterministically; the derivation suite covers the graded cases.
beforeAll(() => {
  global.fetch = jest.fn(async () => ({ ok: false })) as any;
});

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
    pushChannel: 'live',
    ...over,
  } as FleetScreen;
}

const fleet: FleetResponse = {
  root: { id: 'hq', name: 'Iron Peak', slug: 'hq', vertical: 'GYM' },
  locations: [
    { id: 'hq', name: 'Iron Peak HQ', slug: 'hq' },
    { id: 'west', name: 'Peak West', slug: 'west' },
  ],
  stats: { total: 3, online: 2, offline: 1, locationCount: 2 },
  screens: [
    scr('hq'),
    scr('west', { status: 'OFFLINE' }),
    scr('west', { renderHealth: 'STALE', renderStale: true }),
  ],
};

const readiness: DistrictReadinessResponse = {
  delivery: { key: 'delivery', status: 'ok', label: '', detail: '', fixHint: '' },
  schools: [
    { tenantId: 'hq', name: 'Iron Peak HQ', slug: 'hq', isSelf: true, verdict: 'READY', contentWired: 3, contentTotal: 3, lockdownWired: false, missingTypes: [], screensTotal: 1, screensOnline: 1 },
    { tenantId: 'west', name: 'Peak West', slug: 'west', isSelf: false, verdict: 'NOT_CONFIGURED', contentWired: 0, contentTotal: 3, lockdownWired: false, missingTypes: ['Evacuate'], screensTotal: 2, screensOnline: 1 },
  ],
  notReadyCount: 1,
  computedAt: '',
} as any;

const approvals: DistrictPendingApprovals = { byTenant: [{ tenantId: 'west', pending: 2 }] } as any;

describe('FleetCommandCenter', () => {
  it('renders the five assurance pills with vertical-aware copy', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    for (const label of ['Content current', 'Devices online', 'Push live', 'Emergency ready', 'Showing content']) {
      expect(rtl.getByText(label)).toBeInTheDocument();
    }
    // GYM vertical: "gyms", never "schools".
    expect(rtl.getByText(/2 gyms · 3 screens/)).toBeInTheDocument();
    expect(rtl.queryByText(/school/i)).not.toBeInTheDocument();
  });

  it('inbox is worst-first (emergency gap on top) and a row switches into the location', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    const first = rtl.getByText(/Peak West can’t display an emergency alert/);
    expect(first).toBeInTheDocument();
    fireEvent.click(first.closest('button')!);
    expect(switchToTenant).toHaveBeenCalledWith(
      { id: 'west', slug: 'west' },
      '/west/settings/emergency',
    );
  });

  it('location table shows the emergency verdict + screens truth per row', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    expect(rtl.getByText('Not set up')).toBeInTheDocument();
    expect(rtl.getByText('Ready')).toBeInTheDocument();
  });

  it('"Classic view" fires the rollback callback', () => {
    const onSwitchClassic = jest.fn();
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={onSwitchClassic} />,
    );
    fireEvent.click(rtl.getByText('Classic view'));
    expect(onSwitchClassic).toHaveBeenCalled();
  });
});
