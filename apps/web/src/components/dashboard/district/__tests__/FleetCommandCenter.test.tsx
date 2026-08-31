/**
 * Render-level proof for FleetCommandCenter (Fleet Command, Phase 1).
 *
 * The derivation matrix is pinned in fleetCommand.test.ts; THIS suite proves
 * the operator SEES the five pills, the worst-first inbox, and the location
 * table — the "verify the render tree" discipline (CLAUDE.md #9 / #21) —
 * and that "Classic view" actually fires the rollback callback.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, act } from '@testing-library/react';
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
// The mock DOES report the pin count it was handed (and keeps the click
// handler reachable) — that is the contract the filter chips and the
// selected-location panel are graded against.
let lastMapClick: ((screenId: string) => void) | undefined;
jest.mock('@/components/screens/ScreenMapClient', () => ({
  ScreenMapClient: ({ screens, onScreenClick }: any) => {
    lastMapClick = onScreenClick;
    return <div data-testid="fleet-map" data-pins={screens.length} />;
  },
}));

// /api/build-info — fail closed (null SHA) so the content pill grades unknown
// deterministically; the derivation suite covers the graded cases.
beforeAll(() => {
  global.fetch = jest.fn(async () => ({ ok: false })) as any;
});

// Both navigation spies are module-level, so a "was NOT called" assertion is
// only meaningful once each test starts from zero.
beforeEach(() => {
  switchToTenant.mockClear();
  refreshMutate.mockClear();
  lastMapClick = undefined;
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

/**
 * Three mappable screens covering both halves of the Atlas filter: one
 * healthy, one offline, one online-but-with-no-confirmed-picture. Content
 * skew stays out of it — the suite's build-info fetch fails closed, so
 * isContentBehind is provably false for every row here.
 */
const atlasFleet: FleetResponse = {
  ...fleet,
  screens: [
    scr('west', { id: 'w-ok', name: 'Healthy', effectiveLatitude: 37.9, effectiveLongitude: -122.06, effectiveAddress: '1 Peak Way, Walnut Creek, CA' }),
    scr('west', { id: 'w-dark', name: 'Dark', status: 'OFFLINE', effectiveLatitude: 37.8, effectiveLongitude: -122.1 }),
    scr('hq', { id: 'hq-nopic', name: 'No picture', renderHealth: 'STALE', renderStale: true, effectiveLatitude: 37.7, effectiveLongitude: -122.2 }),
  ],
};

/** Open the map view on the Atlas fixture and hand back the pin-click prop. */
function renderAtlas() {
  render(
    <FleetCommandCenter fleet={atlasFleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
  );
  fireEvent.click(rtl.getByRole('tab', { name: 'map' }));
  return lastMapClick!;
}

/**
 * One location's <tr>, found by name rather than index — the table sorts
 * worst-first, so a positional lookup silently follows the fixture's health
 * around. Column order: 0 Location · 1 Screens · 2 Content · 3 Push ·
 * 4 Cache · 5 Emergency · 6 Last push · 7 open-arrow.
 */
function locationRow(name: string): HTMLTableRowElement {
  const cell = rtl.getAllByRole('cell').find((c) => c.textContent?.startsWith(name));
  if (!cell) throw new Error(`No location row for “${name}”`);
  return cell.closest('tr') as HTMLTableRowElement;
}

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

  it('Cache column reports n/m per location and stays plain-English', () => {
    const cacheFleet: FleetResponse = {
      ...fleet,
      screens: [
        // HQ: its one screen holds the alert media → 1/1, emerald.
        scr('hq', { lastCacheReport: { emergency: { count: 3 } } }),
        // West: one of two → 1/2, amber. The offline one still counts if
        // cached; here it is not, which is the gap the column exists to show.
        scr('west', { lastCacheReport: { emergency: { count: 3 } } }),
        scr('west', { status: 'OFFLINE', lastCacheReport: null }),
      ],
    };
    render(
      <FleetCommandCenter fleet={cacheFleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    expect(rtl.getByRole('columnheader', { name: 'Cache' })).toBeInTheDocument();
    // Cache is column 4 — read the CELL so the Screens column's own "1/2"
    // can't be mistaken for this one.
    const cache = (location: string) => locationRow(location).children[4];
    expect(cache('Iron Peak HQ')).toHaveTextContent('1/1');
    expect(cache('Iron Peak HQ').firstElementChild).toHaveClass('text-emerald-600');
    expect(cache('Peak West')).toHaveTextContent('1/2');
    expect(cache('Peak West').firstElementChild).toHaveClass('text-amber-600');
    // The header explains itself without the wire vocabulary.
    expect(rtl.getByRole('columnheader', { name: 'Cache' })).toHaveAttribute(
      'title',
      'Screens with emergency content stored locally — they can show an alert even if the network is down.',
    );
    expect(rtl.queryByText(/never-evict|manifest/i)).not.toBeInTheDocument();
  });

  it('Last push is attributed PER LOCATION — a location with no push shows “—”', () => {
    // One push, into "west" only. "hq" must not borrow its timestamp.
    renderCard({ deployments: [dep({ tenantId: 'west' })] });
    expect(rtl.getByRole('columnheader', { name: 'Last push' })).toBeInTheDocument();
    expect(locationRow('Peak West').children[6]).toHaveTextContent('4m ago');
    expect(locationRow('Iron Peak HQ').children[6]).toHaveTextContent('—');
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

  // ─── Atlas filter chips ─────────────────────────────────────────
  it('Map view: the chips filter the PINS, and the two halves partition the fleet', () => {
    render(
      <FleetCommandCenter fleet={atlasFleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    fireEvent.click(rtl.getByRole('tab', { name: 'map' }));

    // Opens unfiltered — a map that lands pre-narrowed hides screens the
    // operator never asked to hide.
    expect(rtl.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pins', '3');

    // Offline + no-confirmed-picture are both "needs attention"…
    fireEvent.click(rtl.getByRole('radio', { name: 'Needs attention' }));
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pins', '2');

    // …and Healthy is the exact complement: 1 + 2 = 3, no screen in neither.
    fireEvent.click(rtl.getByRole('radio', { name: 'Healthy' }));
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pins', '1');
  });

  it('Map view: an empty filter says so — it never blames missing addresses', () => {
    const allHealthy: FleetResponse = {
      ...fleet,
      screens: [scr('west', { effectiveLatitude: 37.9, effectiveLongitude: -122.06 })],
    };
    render(
      <FleetCommandCenter fleet={allHealthy} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    fireEvent.click(rtl.getByRole('tab', { name: 'map' }));
    fireEvent.click(rtl.getByRole('radio', { name: 'Needs attention' }));

    expect(rtl.getByText('No gyms match this filter on the map.')).toBeInTheDocument();
    // The "add an address" advice would send the operator to fix the wrong
    // thing — these screens HAVE addresses.
    expect(rtl.queryByText('No addresses on the map yet.')).not.toBeInTheDocument();
  });

  // ─── Atlas selected-location panel ──────────────────────────────
  it('Map view: a pin click SELECTS its location instead of teleporting away', () => {
    const clickPin = renderAtlas();
    expect(rtl.queryByRole('group', { name: /details/ })).not.toBeInTheDocument();

    act(() => clickPin('w-ok'));

    const panel = rtl.getByRole('group', { name: 'Peak West details' });
    expect(panel).toHaveTextContent('Peak West');
    expect(panel).toHaveTextContent('1 Peak Way, Walnut Creek, CA');
    expect(panel).toHaveTextContent('1/2 online');
    // Same worst-line the table row would print for this location.
    expect(panel).toHaveTextContent('Can’t display an emergency alert');
    // One click on a 20px dot must not have changed tenant.
    expect(switchToTenant).not.toHaveBeenCalled();
  });

  it('Map view: another pin re-targets the panel; ✕ and Escape both close it', () => {
    const clickPin = renderAtlas();

    act(() => clickPin('w-ok'));
    expect(rtl.getByRole('group', { name: 'Peak West details' })).toBeInTheDocument();

    act(() => clickPin('hq-nopic'));
    expect(rtl.queryByRole('group', { name: 'Peak West details' })).not.toBeInTheDocument();
    const hq = rtl.getByRole('group', { name: 'Iron Peak HQ details' });
    // HQ's own worst line — its screen is reachable with no confirmed picture.
    expect(hq).toHaveTextContent('1 no picture confirmed');
    // No screen of HQ's resolved an address in this fixture: the line is
    // simply absent rather than an empty placeholder.
    expect(hq).not.toHaveTextContent('Peak Way');

    fireEvent.click(rtl.getByLabelText('Close'));
    expect(rtl.queryByRole('group', { name: /details/ })).not.toBeInTheDocument();

    act(() => clickPin('w-ok'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(rtl.queryByRole('group', { name: /details/ })).not.toBeInTheDocument();
  });

  it('Map view: "Open" navigates on the same worst-based path the row uses', () => {
    const clickPin = renderAtlas();
    act(() => clickPin('w-ok'));
    fireEvent.click(rtl.getByText(/Open gym/));
    expect(switchToTenant).toHaveBeenCalledWith(
      { id: 'west', slug: 'west' },
      '/west/settings/emergency',
    );
  });

  it('Map view: no chips at all when nothing is mappable — there is nothing to filter', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    fireEvent.click(rtl.getByRole('tab', { name: 'map' }));
    expect(rtl.queryByRole('radio', { name: 'All' })).not.toBeInTheDocument();
    expect(rtl.getByText('No addresses on the map yet.')).toBeInTheDocument();
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
    tenantId: 'west',
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
