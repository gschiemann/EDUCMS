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
import type {
  FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals, DeploymentRow,
} from '@/hooks/use-api';

const switchToTenant = jest.fn();
jest.mock('@/hooks/use-tenant-switch', () => ({
  useTenantSwitch: () => ({ switchToTenant, switchingId: null, error: null, clearError: () => {} }),
}));
// The proof drawer's own behavior is pinned in ProofDrawer.test.tsx; here it
// only has to open, so its data hook + overlay lock are stubbed.
const refreshMutate = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useScreenEvents: () => ({ data: undefined, isLoading: false }),
  useRefreshWeb: () => ({ mutate: refreshMutate, isPending: false }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
// Leaflet needs a real window; the map's own behavior is not under test here.
jest.mock('@/components/screens/ScreenMapClient', () => ({
  ScreenMapClient: () => <div data-testid="fleet-map" />,
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

  it('Map view: toggle renders the map (mocked) with a no-address empty state when nothing is mappable', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    fireEvent.click(rtl.getByRole('tab', { name: 'map' }));
    // Fixture screens carry no coordinates → honest empty state, not a blank map.
    expect(rtl.getByText('No addresses on the map yet.')).toBeInTheDocument();
    // Back to list restores the table.
    fireEvent.click(rtl.getByRole('tab', { name: 'list' }));
    expect(rtl.getByText('Ready')).toBeInTheDocument();
  });

  it('Map view: renders the map when at least one screen has coordinates', () => {
    const geoFleet: FleetResponse = {
      ...fleet,
      screens: [scr('west', { effectiveLatitude: 37.9, effectiveLongitude: -122.06, geoSource: 'tenant' })],
    };
    render(
      <FleetCommandCenter fleet={geoFleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    fireEvent.click(rtl.getByRole('tab', { name: 'map' }));
    expect(rtl.getByTestId('fleet-map')).toBeInTheDocument();
  });

  it('Push update is two-tap: arm shows the blast radius, confirm fires the fleet push', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    fireEvent.click(rtl.getByText('Push update'));
    expect(refreshMutate).not.toHaveBeenCalled();
    fireEvent.click(rtl.getByText('Confirm · all 3 screens'));
    expect(refreshMutate).toHaveBeenCalledWith({});
  });

  it('Run fleet check calls the re-probe callback', async () => {
    const onFleetCheck = jest.fn(async () => {});
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} onFleetCheck={onFleetCheck} />,
    );
    fireEvent.click(rtl.getByText('Run fleet check'));
    expect(onFleetCheck).toHaveBeenCalled();
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

// ─── Convergence card · deployment record (Phase 2) ──────────────────
// The card has to stay honest in three states: a push in flight, a push that
// landed everywhere, and no push record at all (Phase 1's live-derived view,
// which must render byte-for-byte as it did before this shipped).

const VALUE = 1_724_000_000_000;

function dep(over: Partial<DeploymentRow> = {}): DeploymentRow {
  return {
    id: 'dep1',
    label: 'Fall promo board',
    createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    valueMs: VALUE,
    targetCount: 6,
    convergence: { converged: 4, painting: 2, done: false },
    ...over,
  };
}

function renderCard(deployments?: { deployments: DeploymentRow[] } | null, fleetOver?: FleetResponse) {
  return render(
    <FleetCommandCenter
      fleet={fleetOver ?? fleet}
      readiness={readiness}
      approvals={approvals}
      deployments={deployments}
      orgName="Iron Peak"
      onSwitchClassic={() => {}}
    />,
  );
}

describe('FleetCommandCenter · content convergence', () => {
  it('with NO deployment record, keeps the Phase-1 live-derived card', () => {
    renderCard(null);
    expect(rtl.getByText(/Nothing to compare yet/)).toBeInTheDocument();
    expect(rtl.queryByText('View screens →')).not.toBeInTheDocument();
  });

  it('an in-flight push takes the card: label, n/m, and View screens', () => {
    renderCard({ deployments: [dep()] });
    expect(rtl.getByText('Fall promo board')).toBeInTheDocument();
    // Scoped to the card — bare digits repeat all over the assurance rail.
    const denominator = rtl.getByText('/ 6 confirmed');
    expect(denominator.previousElementSibling).toHaveTextContent('4');
    expect(rtl.getByText('2 screens still picking up this push')).toBeInTheDocument();
    // The live-derived fallback yields the card while a push is in flight.
    expect(rtl.queryByText(/Nothing to compare yet/)).not.toBeInTheDocument();
    expect(rtl.getByText('View screens →')).toBeInTheDocument();
  });

  it('a settled push adds ONE quiet line under the live card, not a banner', () => {
    renderCard({ deployments: [dep({ convergence: { converged: 6, painting: 0, done: true } })] });
    // Phase-1 content still owns the card.
    expect(rtl.getByText(/Nothing to compare yet/)).toBeInTheDocument();
    expect(rtl.getByText(/Last push confirmed everywhere · 4m ago/)).toBeInTheDocument();
    expect(rtl.getByText('View screens →')).toBeInTheDocument();
  });

  it('ignores a push older than 24h — history is not something to watch', () => {
    renderCard({ deployments: [dep({ createdAt: new Date(Date.now() - 25 * 3600_000).toISOString() })] });
    expect(rtl.queryByText('Fall promo board')).not.toBeInTheDocument();
    expect(rtl.queryByText('View screens →')).not.toBeInTheDocument();
    expect(rtl.getByText(/Nothing to compare yet/)).toBeInTheDocument();
  });

  it('picks the NEWEST record regardless of payload order', () => {
    renderCard({
      deployments: [
        dep({ id: 'old', label: 'Yesterday’s board', createdAt: new Date(Date.now() - 20 * 3600_000).toISOString() }),
        dep({ id: 'new', label: 'Newest board' }),
      ],
    });
    expect(rtl.getByText('Newest board')).toBeInTheDocument();
    expect(rtl.queryByText('Yesterday’s board')).not.toBeInTheDocument();
  });

  it('"View screens →" opens the drawer on the screens still holding this push', () => {
    const waiting = scr('west', { name: 'Studio A', pendingRefreshAtMs: VALUE });
    const settled = scr('hq', { name: 'Front desk', pendingRefreshAtMs: null });
    renderCard({ deployments: [dep()] }, { ...fleet, screens: [waiting, settled] });

    fireEvent.click(rtl.getByText('View screens →'));

    const drawer = rtl.getByRole('dialog');
    expect(drawer).toBeInTheDocument();
    // Only the screen still holding this push's value can be NAMED.
    expect(rtl.getByText('Studio A')).toBeInTheDocument();
    expect(rtl.queryByText('Front desk')).not.toBeInTheDocument();
    // The rest are counted, never guessed at: 6 targets − 1 nameable.
    expect(rtl.getByText('Confirmed or superseded (5)')).toBeInTheDocument();
  });
});
