/**
 * Render-level proof for FleetCommandCenter (Fleet Command, Phase 1).
 *
 * The derivation matrix is pinned in fleetCommand.test.ts; THIS suite proves
 * the operator SEES the five pills, the worst-first inbox, and the location
 * table — the "verify the render tree" discipline (CLAUDE.md #9 / #21) —
 * and that "Classic view" actually fires the rollback callback.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, act, within } from '@testing-library/react';
import { FleetCommandCenter, type FleetScheduleRow } from '../FleetCommandCenter';
import type {
  FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals, DeploymentRow,
  FleetPulseResponse,
} from '@/hooks/use-api';

const switchToTenant = jest.fn();
jest.mock('@/hooks/use-tenant-switch', () => ({
  useTenantSwitch: () => ({ switchToTenant, switchingId: null, error: null, clearError: () => {} }),
}));
// The proof drawer's own behavior is pinned in ProofDrawer.test.tsx; here it
// only has to open, so its data hook + overlay lock are stubbed.
const refreshMutate = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useScreenEvents: () => ({ data: undefined, isLoading: false, isError: false }),
  useRefreshWeb: () => ({ mutate: refreshMutate, isPending: false }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
// Leaflet needs a real window; the map's own drawing is proved in the
// component that owns it. The mock DOES report the LOCATION PINS it was
// handed (name, ring tone, logo, selection) and keeps the click handler
// reachable — that is the contract the chips, the rings and the
// selected-location panel are graded against.
let lastMapClick: ((tenantId: string) => void) | undefined;
jest.mock('@/components/screens/ScreenMapClient', () => ({
  ScreenMapClient: ({ locationPins, onLocationClick }: any) => {
    lastMapClick = onLocationClick;
    const pins = locationPins ?? [];
    return (
      <div
        data-testid="fleet-map"
        data-pins={pins.length}
        data-pin-tones={pins.map((p: any) => `${p.name}=${p.tone}`).join('|')}
        data-pin-logos={pins.map((p: any) => `${p.name}=${p.logoUrl ?? ''}/${p.initials}`).join('|')}
        data-pin-selected={pins.filter((p: any) => p.selected).map((p: any) => p.name).join('|')}
      />
    );
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
 * Three mappable LOCATIONS covering both halves of the Atlas filter:
 *   west — an alert gap plus an offline screen → rose ring
 *   hq   — one screen answering with no confirmed picture → rose ring
 *   east — nothing wrong → emerald ring
 * Content skew stays out of it: the suite's build-info fetch fails closed, so
 * isContentBehind is provably false for every screen here.
 */
const atlasFleet: FleetResponse = {
  ...fleet,
  locations: [...fleet.locations, { id: 'east', name: 'Peak East', slug: 'east' }],
  screens: [
    scr('west', { id: 'w-ok', name: 'Healthy', effectiveLatitude: 37.9, effectiveLongitude: -122.06, effectiveAddress: '1 Peak Way, Walnut Creek, CA' }),
    scr('west', { id: 'w-dark', name: 'Dark', status: 'OFFLINE', effectiveLatitude: 37.8, effectiveLongitude: -122.1 }),
    scr('hq', { id: 'hq-nopic', name: 'No picture', renderHealth: 'STALE', renderStale: true, effectiveLatitude: 37.7, effectiveLongitude: -122.2 }),
    scr('east', { id: 'e-ok', name: 'Calm', effectiveLatitude: 38.1, effectiveLongitude: -121.5 }),
  ],
};

/** Open the map view on the Atlas fixture and hand back the pin-click prop. */
function renderAtlas(props: Partial<React.ComponentProps<typeof FleetCommandCenter>> = {}) {
  render(
    <FleetCommandCenter fleet={atlasFleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} {...props} />,
  );
  fireEvent.click(rtl.getByRole('tab', { name: 'map' }));
  return lastMapClick!;
}

/** The mocked map's pin summary, as `Name=tone` pairs. */
const pinTones = () => (rtl.getByTestId('fleet-map').getAttribute('data-pin-tones') ?? '').split('|').filter(Boolean);

/**
 * One location's <tr>, found by name rather than index — the table sorts
 * worst-first, so a positional lookup silently follows the fixture's health
 * around. Column order (design mock): 0 Location · 1 Screens · 2 Content ·
 * 3 trend sparkline · 4 Push · 5 Cache · 6 Emergency · 7 Last change ·
 * 8 row menu.
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
    // The mock's header band: the surface names itself, then the org + scope.
    expect(rtl.getByRole('heading', { name: 'Fleet Command' })).toBeInTheDocument();
    // GYM vertical: "gyms", never "schools".
    expect(rtl.getByRole('heading', { name: 'Fleet Command' }).nextElementSibling)
      .toHaveTextContent('Iron Peak · 2 gyms');
    expect(rtl.queryByText(/school/i)).not.toBeInTheDocument();
    // The mock's one explanatory line under the rail.
    expect(
      rtl.getByText('Status separates connectivity, content, delivery and on-glass proof'),
    ).toBeInTheDocument();
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

  it('Cache column grades the coverage per location and stays plain-English', () => {
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
    // Cache is column 5 — read the CELL so the Screens column's own counts
    // can't be mistaken for this one. The mock's wording is a GRADE plus a
    // percentage; the exact n of m stays reachable in the cell's title.
    const cache = (location: string) => locationRow(location).children[5];
    expect(cache('Iron Peak HQ')).toHaveTextContent('Good 100%');
    expect(cache('Iron Peak HQ').firstElementChild).toHaveAttribute(
      'title',
      expect.stringContaining('1 of 1 screens'),
    );
    expect(cache('Peak West')).toHaveTextContent('Low 50%');
    expect(cache('Peak West').firstElementChild).toHaveAttribute(
      'title',
      expect.stringContaining('1 of 2 screens'),
    );
    // The header explains itself without the wire vocabulary.
    expect(rtl.getByRole('columnheader', { name: 'Cache' })).toHaveAttribute(
      'title',
      'Screens with emergency content stored locally — they can show an alert even if the network is down.',
    );
    expect(rtl.queryByText(/never-evict|manifest/i)).not.toBeInTheDocument();
  });

  it('Last change is attributed PER LOCATION — a location with no push shows “—”', () => {
    // One push, into "west" only. "hq" must not borrow its timestamp.
    renderCard({ deployments: [dep({ tenantId: 'west' })] });
    expect(rtl.getByRole('columnheader', { name: 'Last change' })).toBeInTheDocument();
    expect(locationRow('Peak West').children[7]).toHaveTextContent('4m ago');
    expect(locationRow('Iron Peak HQ').children[7]).toHaveTextContent('—');
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

  // ─── Atlas pins — ONE PER LOCATION (network-atlas mock) ─────────
  it('Map view: draws ONE pin per location, ringed by the table’s own precedence', () => {
    renderAtlas();
    // Four mappable SCREENS, three LOCATIONS — the operator sees stores,
    // not a wall of device dots.
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pins', '3');
    // Rings match what each location's row would print: west can't display
    // an alert (rose), HQ has a screen with no confirmed picture (rose),
    // east is calm (emerald).
    expect(pinTones().sort()).toEqual(['Iron Peak HQ=bad', 'Peak East=ok', 'Peak West=bad']);
  });

  it('Map view: a pin carries the org logo when branding has one', () => {
    renderAtlas({ logoUrl: 'https://cdn.example/logo.png' });
    expect(rtl.getByTestId('fleet-map').getAttribute('data-pin-logos'))
      .toContain('Peak East=https://cdn.example/logo.png/PE');
  });

  it('Map view: with no branded logo the pin still has initials — never a broken image', () => {
    renderAtlas();
    const logos = rtl.getByTestId('fleet-map').getAttribute('data-pin-logos') ?? '';
    // Empty logo slot, but every pin still carries drawable initials.
    expect(logos).toContain('Peak West=/PW');
    expect(logos).toContain('Iron Peak HQ=/IP');
  });

  // ─── Atlas filter chips ─────────────────────────────────────────
  it('Map view: the mock’s five chips each filter the PINS on a real slice', () => {
    renderAtlas();

    // Opens unfiltered — a map that lands pre-narrowed hides locations the
    // operator never asked to hide.
    expect(rtl.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pins', '3');
    for (const label of ['All', 'Healthy', 'Content drift', 'Push issues', 'Emergency gaps']) {
      expect(rtl.getByRole('radio', { name: label })).toBeInTheDocument();
    }

    // Healthy = the emerald rings, and nothing else.
    fireEvent.click(rtl.getByRole('radio', { name: 'Healthy' }));
    expect(pinTones()).toEqual(['Peak East=ok']);

    // Emergency gaps = readiness that isn't Ready. West is NOT_CONFIGURED.
    fireEvent.click(rtl.getByRole('radio', { name: 'Emergency gaps' }));
    expect(pinTones()).toEqual(['Peak West=bad']);

    // Nothing in this fixture is on the polling backstop or behind content.
    fireEvent.click(rtl.getByRole('radio', { name: 'Push issues' }));
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pins', '0');

    fireEvent.click(rtl.getByRole('radio', { name: 'All' }));
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pins', '3');
  });

  it('Map view: an empty filter says so — it never blames missing addresses', () => {
    renderAtlas();
    fireEvent.click(rtl.getByRole('radio', { name: 'Push issues' }));

    expect(rtl.getByText('No gyms match this filter.')).toBeInTheDocument();
    // The "add an address" advice would send the operator to fix the wrong
    // thing — these locations HAVE addresses.
    expect(rtl.queryByText('No addresses on the map yet.')).not.toBeInTheDocument();
    // And the map itself stays mounted: replacing it with a paragraph would
    // take the chips away with it, stranding the operator in the filter.
    expect(rtl.getByTestId('fleet-map')).toBeInTheDocument();
  });

  // ─── Atlas selected-location panel ──────────────────────────────
  it('Map view: a pin click SELECTS its location instead of teleporting away', () => {
    const clickPin = renderAtlas();
    expect(rtl.queryByRole('group', { name: /details/ })).not.toBeInTheDocument();

    act(() => clickPin('west'));

    const panel = rtl.getByRole('group', { name: 'Peak West details' });
    expect(panel).toHaveTextContent('Peak West');
    // "City, ST" from the address tail — the mock's second line.
    expect(panel).toHaveTextContent('Walnut Creek, CA');
    // The mock's stat rows, off the SAME LocationRow the table reads.
    expect(panel).toHaveTextContent('1 current');
    expect(panel).toHaveTextContent('1 offline');
    // Emergency is its own row and its own verdict — never inferred.
    expect(panel).toHaveTextContent('Emergency cache');
    expect(panel).toHaveTextContent('Not set up');
    // The status word matches the ring the pin was drawn with.
    expect(panel).toHaveTextContent('Needs attention');
    // The selected pin is the one the operator clicked, and only that one.
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pin-selected', 'Peak West');
    // One click on a pin must not have changed tenant.
    expect(switchToTenant).not.toHaveBeenCalled();
  });

  it('Map view: another pin re-targets the panel; ✕ and Escape both close it', () => {
    const clickPin = renderAtlas();

    act(() => clickPin('west'));
    expect(rtl.getByRole('group', { name: 'Peak West details' })).toBeInTheDocument();

    act(() => clickPin('hq'));
    expect(rtl.queryByRole('group', { name: 'Peak West details' })).not.toBeInTheDocument();
    const hq = rtl.getByRole('group', { name: 'Iron Peak HQ details' });
    // HQ's screen is reachable with no confirmed picture → the ring, and so
    // the panel's status word, is the worst grade.
    expect(hq).toHaveTextContent('Needs attention');
    // No address anywhere for HQ in this fixture: the city line is simply
    // absent rather than an empty placeholder or a guess.
    expect(hq).not.toHaveTextContent('Walnut Creek');

    fireEvent.click(rtl.getByLabelText('Close'));
    expect(rtl.queryByRole('group', { name: /details/ })).not.toBeInTheDocument();

    act(() => clickPin('west'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(rtl.queryByRole('group', { name: /details/ })).not.toBeInTheDocument();
  });

  it('Map view: "Open" navigates on the same worst-based path the row uses', () => {
    const clickPin = renderAtlas();
    act(() => clickPin('west'));
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

  it('"Push content" goes to the publish flow — it never arms a fleet-wide reload', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    const push = rtl.getByText('Push content').closest('a');
    expect(push).toHaveAttribute('href', '/hq/playlists?newPlaylist=1');
    fireEvent.click(push!);
    // The old two-tap arm is gone: the primary button must never be a
    // blast-radius action wearing a navigation costume (2026-08-31).
    expect(refreshMutate).not.toHaveBeenCalled();
    expect(rtl.queryByText(/Confirm · all/)).not.toBeInTheDocument();
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

  // ─── The device drawer (2026-08-31 operator: knock out issues from
  //     the main screen, without leaving it) ───────────────────────────
  it('"Open" on a needs-attention SCREEN row opens the drawer, not a navigation', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    // The offline screen's row — "Open" is the verb for anything a reload
    // cannot fix.
    const row = rtl.getByText(/Screen · Offline/).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));

    const drawer = rtl.getByRole('dialog', { name: /Screen — device details/ });
    expect(within(drawer).getByText('Not answering')).toBeInTheDocument();
    // Recovery is offered honestly: an unreachable screen is told the truth
    // about what a reload can and cannot do.
    expect(within(drawer).getByRole('button', { name: /Resync this screen/ })).toBeInTheDocument();
    expect(within(drawer).getByText(/isn’t answering, so a reload can’t reach it/)).toBeInTheDocument();
    // The whole point: the operator never left the dashboard.
    expect(switchToTenant).not.toHaveBeenCalled();

    // Full settings still exists as the way OUT, pointed at the owning gym.
    expect(within(drawer).getByText('Full settings').closest('a')).toHaveAttribute('href', '/west/screens');
  });

  it('a location-level row (no screen) still navigates — a drawer cannot fix a settings gap', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    const row = rtl.getByText(/Peak West can’t display an emergency alert/).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
    expect(rtl.queryByRole('dialog', { name: /device details/ })).not.toBeInTheDocument();
    expect(switchToTenant).toHaveBeenCalledWith({ id: 'west', slug: 'west' }, '/west/settings/emergency');
  });

  it('the drawer sends the reload command to that ONE screen, then holds "sent"', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    const row = rtl.getByText(/Screen · No picture confirmed/).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
    const drawer = rtl.getByRole('dialog', { name: /device details/ });
    const resync = within(drawer).getByRole('button', { name: /Resync this screen/ });

    fireEvent.click(resync);
    expect(refreshMutate).toHaveBeenCalledTimes(1);
    expect(refreshMutate.mock.calls[0][0].screenId).toEqual(expect.any(String));
    // A control reading "sent" that fires again on click would be a trap.
    expect(within(drawer).getByRole('button', { name: /Update sent/ })).toBeDisabled();
  });
});

// ─── Deployment BANNER · deployment record ───────────────────────────
// The standing "Content convergence" card is gone (2026-08-31 operator:
// "what is this dashboard card even for"). What is left is a strip that
// exists only while something is actually happening: a push in flight, or a
// push that landed inside the last ten minutes. Every other state — no push,
// an old push, a push that settled an hour ago — renders NOTHING, which is
// the whole point (the reclaimed height goes to real content).

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

describe('FleetCommandCenter · deployment banner', () => {
  /** The banner, or null when nothing is in flight. */
  const banner = () => rtl.queryByRole('status', { name: 'Content push' });

  it('with NO deployment record there is no strip at all — and no standing card', () => {
    renderCard(null);
    expect(banner()).toBeNull();
    // The card it replaced must be gone for good, in every state.
    expect(rtl.queryByRole('heading', { name: 'Content convergence' })).not.toBeInTheDocument();
    expect(rtl.queryByRole('heading', { name: 'Live deployment' })).not.toBeInTheDocument();
    expect(rtl.queryByText('View screens')).not.toBeInTheDocument();
  });

  it('an in-flight push shows the strip: label, n of m confirmed, and a way in', () => {
    renderCard({ deployments: [dep()] });
    const strip = banner()!;
    expect(strip).toBeInTheDocument();
    expect(strip).toHaveTextContent('Fall promo board');
    expect(strip).toHaveTextContent('4 of 6 screens confirmed');
    expect(within(strip).getByText('View screens')).toBeInTheDocument();
    // Its slot in the three-card row now belongs to the schedule.
    expect(rtl.getByRole('heading', { name: 'Today’s Schedule' })).toBeInTheDocument();
  });

  it('a push that JUST landed says so in emerald, and carries no stale age', () => {
    renderCard({
      deployments: [dep({
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        convergence: { converged: 6, painting: 0, done: true },
      })],
    });
    const strip = banner()!;
    expect(strip).toHaveTextContent('confirmed everywhere');
    // The old card's "· 43m ago" line is exactly what the operator called
    // out — a landed push must never date itself here.
    expect(strip).not.toHaveTextContent(/ago/);
  });

  it('a push that landed more than 10 minutes ago disappears entirely', () => {
    renderCard({
      deployments: [dep({
        createdAt: new Date(Date.now() - 45 * 60_000).toISOString(),
        convergence: { converged: 6, painting: 0, done: true },
      })],
    });
    expect(banner()).toBeNull();
    expect(rtl.queryByText('Fall promo board')).not.toBeInTheDocument();
  });

  it('ignores a push older than 24h — history is not something to watch', () => {
    renderCard({ deployments: [dep({ createdAt: new Date(Date.now() - 25 * 3600_000).toISOString() })] });
    expect(banner()).toBeNull();
    expect(rtl.queryByText('Fall promo board')).not.toBeInTheDocument();
  });

  it('picks the NEWEST record regardless of payload order', () => {
    renderCard({
      deployments: [
        dep({ id: 'old', label: 'Yesterday’s board', createdAt: new Date(Date.now() - 20 * 3600_000).toISOString() }),
        dep({ id: 'new', label: 'Newest board' }),
      ],
    });
    expect(banner()).toHaveTextContent('Newest board');
    expect(rtl.queryByText('Yesterday’s board')).not.toBeInTheDocument();
  });

  it('"View screens" opens the drawer on the screens still holding this push', () => {
    const waiting = scr('west', { name: 'Studio A', pendingRefreshAtMs: VALUE });
    const settled = scr('hq', { name: 'Front desk', pendingRefreshAtMs: null });
    renderCard({ deployments: [dep()] }, { ...fleet, screens: [waiting, settled] });

    fireEvent.click(within(banner()!).getByText('View screens'));

    const drawer = rtl.getByRole('dialog');
    expect(drawer).toBeInTheDocument();
    // Only the screen still holding this push's value can be NAMED.
    expect(rtl.getByText('Studio A')).toBeInTheDocument();
    expect(rtl.queryByText('Front desk')).not.toBeInTheDocument();
    // The rest are counted, never guessed at: 6 targets − 1 nameable.
    expect(rtl.getByText('Confirmed or superseded (5)')).toBeInTheDocument();
  });
});

// ─── Today's Schedule card (took the convergence card's slot) ────────

const schedRow = (over: Partial<FleetScheduleRow> = {}): FleetScheduleRow => ({
  key: `k${Math.random()}`,
  name: 'Lunch rush board',
  deviceLine: 'Lobby · Front desk',
  deviceCount: 2,
  timeStart: '11:00',
  timeEnd: '14:00',
  isActive: false,
  previewUrl: null,
  portrait: false,
  ...over,
});

function renderSchedule(schedule: FleetScheduleRow[] | null, totals?: { playing: number; total: number }) {
  return render(
    <FleetCommandCenter
      fleet={fleet}
      readiness={readiness}
      approvals={approvals}
      schedule={schedule}
      scheduleTotals={totals}
      orgName="Iron Peak"
      onSwitchClassic={() => {}}
    />,
  );
}

describe('FleetCommandCenter · today’s schedule card', () => {
  it('renders the rows the page hands it, with counts and a way to manage them', () => {
    renderSchedule(
      [schedRow({ name: 'Morning board', isActive: true }), schedRow({ name: 'Lunch rush board' })],
      { playing: 1, total: 2 },
    );
    const card = within(rtl.getByRole('group', { name: 'Today’s Schedule' }));
    expect(rtl.getByRole('heading', { name: 'Today’s Schedule' })).toBeInTheDocument();
    expect(card.getByText('1 playing · 2 total')).toBeInTheDocument();
    expect(card.getByText('Morning board')).toBeInTheDocument();
    expect(card.getByText('Lunch rush board')).toBeInTheDocument();
    // Only the row that is on air right now wears the badge.
    expect(card.getAllByText('Live')).toHaveLength(1);
    expect(card.getByText('Manage').closest('a')).toHaveAttribute('href', '/hq/playlists');
  });

  it('caps at five rows and offers the rest rather than scrolling forever', () => {
    renderSchedule(Array.from({ length: 8 }, (_, i) => schedRow({ name: `Board ${i}` })));
    expect(rtl.getByText('Board 4')).toBeInTheDocument();
    expect(rtl.queryByText('Board 5')).not.toBeInTheDocument();
    expect(rtl.getByText('+3 more').closest('a')).toHaveAttribute('href', '/hq/playlists');
  });

  it('an empty day says so and offers the first schedule', () => {
    renderSchedule([]);
    expect(rtl.getByText('Nothing scheduled for today.')).toBeInTheDocument();
    expect(rtl.getByText('Create a schedule').closest('a')).toHaveAttribute('href', '/hq/playlists?newPlaylist=1');
  });
});

// ─── Fleet pulse (design-mock parity) ────────────────────────────────
// The chart draws only what the sampler recorded. A fresh deploy has a
// handful of samples and SAYS SO rather than drawing a 24h line through two
// points — the same never-cry-wolf discipline the pills follow.

function pulseSeries(count: number): FleetPulseResponse {
  const base = Date.now() - count * 15 * 60_000;
  return {
    fleet: Array.from({ length: count }, (_, i) => ({
      ts: base + i * 15 * 60_000,
      online: 9,
      offline: 2,
      notPainting: 1,
      total: 11,
    })),
    locations: {
      west: Array.from({ length: count }, (_, i) => ({ ts: base + i * 15 * 60_000, online: 1, total: 2 })),
    },
  };
}

describe('FleetCommandCenter · fleet pulse', () => {
  const renderPulse = (pulse: FleetPulseResponse | null) =>
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} pulse={pulse} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );

  it('says it is still collecting when there is no recorded history yet', () => {
    renderPulse(null);
    expect(rtl.getByRole('heading', { name: 'Fleet pulse' })).toBeInTheDocument();
    expect(
      rtl.getByText('Building your first 24 hours of history — first samples land within the hour.'),
    ).toBeInTheDocument();
    expect(rtl.queryByRole('img', { name: /Fleet status over the last 24 hours/ })).not.toBeInTheDocument();
  });

  it('draws whatever real history exists, labeled as building (operator: show me the data we have)', () => {
    renderPulse(pulseSeries(3));
    // 3 samples = ~30min span → the chart renders AND the header says so.
    expect(rtl.getByRole('img', { name: /Fleet status/ })).toBeInTheDocument();
    expect(rtl.getByText(/building history — /)).toBeInTheDocument();
    expect(rtl.queryByText(/Building your first 24 hours/)).not.toBeInTheDocument();
  });

  it('a single sample still shows the honest empty copy — one dot is not a trend', () => {
    renderPulse(pulseSeries(1));
    expect(rtl.getByText(/Building your first 24 hours of history/)).toBeInTheDocument();
  });

  it('draws the stacked chart + legend once there is a real series', () => {
    renderPulse(pulseSeries(24));
    const chart = rtl.getByRole('img', { name: /Fleet status over the last 24 hours, 24 samples/ });
    expect(chart).toBeInTheDocument();
    // Three separately-named bands — online is never a synonym for healthy.
    for (const label of ['Online', 'Degraded', 'Offline']) {
      expect(rtl.getByText(label)).toBeInTheDocument();
    }
    expect(rtl.queryByText(/Building your first 24 hours/)).not.toBeInTheDocument();
  });

  it('the location table draws a per-location sparkline only where a series exists', () => {
    renderPulse(pulseSeries(24));
    // "west" has a series (1 of 2 answering → the red variant).
    expect(locationRow('Peak West').children[3].querySelector('svg')).toBeInTheDocument();
    expect(rtl.getByRole('img', { name: 'Some screens not answering' })).toBeInTheDocument();
    // HQ has none — an empty cell, never a flat line implying "all fine".
    expect(locationRow('Iron Peak HQ').children[3].querySelector('svg')).toBeNull();
  });

  it('the card fills the row height like its siblings — no self-start stub', () => {
    renderPulse(pulseSeries(24));
    const card = rtl.getByRole('heading', { name: 'Fleet pulse' }).closest('div')!.parentElement!;
    // 2026-08-31 operator: "keep it the same height as the other cards".
    // `self-start` is what parked it at the top of the row with dead space
    // underneath — a grid item without it stretches to the row.
    expect(card.className).not.toMatch(/self-start/);
    // And the chart box is the one that grows into whatever height it gets.
    const chartBox = rtl.getByRole('img', { name: /Fleet status/ }).parentElement!;
    expect(chartBox.className).toMatch(/flex-1/);
    expect(chartBox.className).toMatch(/min-h-0/);
  });
});

// ─── Location scope filter (the mock's "All locations" control) ──────
// It must narrow EVERY number on the page, not just the table — a filtered
// table over unfiltered pills is how an operator misreads their own fleet.

describe('FleetCommandCenter · location filter', () => {
  const openScope = () => rtl.getByLabelText('Show one gym or all of them');

  it('defaults to every location', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    expect(openScope()).toHaveValue('all');
    expect(rtl.getAllByRole('option').map((o) => o.textContent))
      .toEqual(['All gyms', 'Iron Peak HQ', 'Peak West']);
  });

  /** The count a named assurance card is showing (its label's sibling). */
  const pillValue = (label: string) => rtl.getByText(label).previousElementSibling;

  it('narrows the pills, the inbox AND the table to the chosen location', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    // Unfiltered: 3 screens across both gyms, and West owns the alert gap.
    expect(pillValue('Devices online')).toHaveTextContent('2/3');
    expect(rtl.getByText(/Peak West can’t display an emergency alert/)).toBeInTheDocument();

    fireEvent.change(openScope(), { target: { value: 'hq' } });

    // Pills now count HQ's one screen only…
    expect(pillValue('Devices online')).toHaveTextContent('1/1');
    // …the inbox drops West's exception…
    expect(rtl.queryByText(/Peak West can’t display an emergency alert/)).not.toBeInTheDocument();
    // …and so does the table. (The PICKER still lists every gym — narrowing
    // the control that does the narrowing would be a one-way door.)
    const names = rtl.getAllByRole('cell').map((c) => c.textContent ?? '');
    expect(names.some((t) => t.startsWith('Peak West'))).toBe(false);
    expect(names.some((t) => t.startsWith('Iron Peak HQ'))).toBe(true);
    expect(rtl.getByRole('option', { name: 'Peak West' })).toBeInTheDocument();
    expect(rtl.getByText('Showing 1 of 1 gym')).toBeInTheDocument();
  });

  it('the header keeps pointing at the publish flow while scoped', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    fireEvent.change(openScope(), { target: { value: 'hq' } });
    // The scope narrows what the page REPORTS; it is not a publish target,
    // so the button must not imply the push is pre-scoped to one gym.
    expect(rtl.getByText('Push content').closest('a')).toHaveAttribute('href', '/hq/playlists?newPlaylist=1');
  });
});

// ─── Recent activity card ────────────────────────────────────────────

describe('FleetCommandCenter · recent activity', () => {
  it('renders the rows the page hands it, newest formatting and all', () => {
    render(
      <FleetCommandCenter
        fleet={fleet}
        readiness={readiness}
        approvals={approvals}
        activity={[
          { title: 'Content Pushed', detail: 'screen', at: new Date('2026-08-31T16:47:00Z').toISOString() },
          { title: 'Emergency Playlist Updated', at: new Date('2026-08-31T16:22:00Z').toISOString() },
        ]}
        orgName="Iron Peak"
        onSwitchClassic={() => {}}
      />,
    );
    expect(rtl.getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument();
    expect(rtl.getByText('Content Pushed')).toBeInTheDocument();
    expect(rtl.getByText('Emergency Playlist Updated')).toBeInTheDocument();
    expect(rtl.getByText('screen')).toBeInTheDocument();
    expect(rtl.getByText('View all activity')).toBeInTheDocument();
  });

  it('an empty feed says so rather than rendering an empty card', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} activity={[]} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    expect(rtl.getByText('Changes across your gyms will appear here.')).toBeInTheDocument();
  });
});

// ─── Atlas stat cards (Network Atlas mock parity) ────────────────────

describe('FleetCommandCenter · map stat cards', () => {
  it('counts locations, screens, content-current and needs-attention above the map', () => {
    renderAtlas();
    const totals = within(rtl.getByRole('group', { name: 'Fleet totals' }));
    const card = (label: string) => totals.getByText(label).previousElementSibling;
    expect(card('Screens')).toHaveTextContent('4');
    // Sentence case, and never title-cased into "Content Current".
    expect(card('Gyms')).toHaveTextContent('3');
    // Offline + no-confirmed-picture — the SAME predicate the map chips use,
    // so the count and the "Needs attention" filter can never disagree.
    expect(card('Need attention')).toHaveTextContent('2');
    // Build-info fails closed in this suite, so content is ungraded — the
    // card shows "—" rather than a zero it has not earned.
    expect(card('Content current')).toHaveTextContent('—');
  });

  it('the map inbox is GROUPED by category, each heading carrying its real count', () => {
    renderAtlas();
    const inbox = within(rtl.getByRole('group', { name: 'Exception inbox' }));
    // The mock's category headings, in our language — worst first.
    for (const label of ['Emergency gaps', 'No picture confirmed', 'Offline', 'Waiting on review']) {
      expect(inbox.getByRole('button', { expanded: true, name: new RegExp(label) })).toBeInTheDocument();
    }
    // A row reads LOCATION on top, screen + problem underneath (mock layout).
    expect(inbox.getByText('Dark · Offline')).toBeInTheDocument();
    // The wire word never reaches a heading.
    expect(inbox.queryByText(/paint/i)).not.toBeInTheDocument();
  });

  it('a category collapses and expands from its own heading', () => {
    renderAtlas();
    const inbox = within(rtl.getByRole('group', { name: 'Exception inbox' }));
    // Anchored: a ROW's accessible name also ends in "Offline" ("Peak West
    // Dark · Offline") — only the heading STARTS with the category word.
    const heading = inbox.getByRole('button', { name: /^Offline/ });
    expect(inbox.getByText('Dark · Offline')).toBeInTheDocument();

    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(inbox.queryByText('Dark · Offline')).not.toBeInTheDocument();

    fireEvent.click(heading);
    expect(inbox.getByText('Dark · Offline')).toBeInTheDocument();
  });

  it('an inbox row over the map SELECTS its location’s pin — it does not navigate', () => {
    renderAtlas();
    const inbox = rtl.getByRole('group', { name: 'Exception inbox' });

    fireEvent.click(within(inbox).getByText('Dark · Offline').closest('button')!);

    // The pin lights up and the evidence panel opens…
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pin-selected', 'Peak West');
    expect(rtl.getByRole('group', { name: 'Peak West details' })).toBeInTheDocument();
    // …the detail footer names what is selected and offers the way in…
    expect(within(inbox).getByRole('button', { name: /Open screen/ })).toBeInTheDocument();
    // …and the operator is still on the map they were reading. The drill-in
    // is the panel's own Open button, one deliberate click later.
    expect(switchToTenant).not.toHaveBeenCalled();
  });

  it('the sliders control hides and restores the inbox — never a dead ornament', () => {
    renderAtlas();
    expect(rtl.getByRole('group', { name: 'Exception inbox' })).toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: 'Hide the exception inbox' }));
    expect(rtl.queryByRole('group', { name: 'Exception inbox' })).not.toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: 'Show the exception inbox' }));
    expect(rtl.getByRole('group', { name: 'Exception inbox' })).toBeInTheDocument();
  });

  it('"Open screen" opens the device drawer ON the dashboard — no tenant switch', () => {
    renderAtlas();
    const inbox = rtl.getByRole('group', { name: 'Exception inbox' });
    fireEvent.click(within(inbox).getByText('Dark · Offline').closest('button')!);
    fireEvent.click(within(inbox).getByRole('button', { name: /Open screen/ }));

    const drawer = rtl.getByRole('dialog', { name: /Dark — device details/ });
    expect(within(drawer).getByText('Not answering')).toBeInTheDocument();
    expect(within(drawer).getByText('What happened')).toBeInTheDocument();
    expect(switchToTenant).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(rtl.queryByRole('dialog', { name: /device details/ })).not.toBeInTheDocument();
  });

  it('a location with no coordinates is listed, not invented onto the map', () => {
    const withOrphan: FleetResponse = {
      ...atlasFleet,
      locations: [
        ...atlasFleet.locations,
        // Has an address → the server is already geocoding it.
        { id: 'north', name: 'Peak North', slug: 'north', address: '9 North Rd, Reno, NV' },
        // No address at all → the operator has something to do.
        { id: 'south', name: 'Peak South', slug: 'south' },
      ],
    };
    render(
      <FleetCommandCenter fleet={withOrphan} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    fireEvent.click(rtl.getByRole('tab', { name: 'map' }));

    const card = within(rtl.getByRole('group', { name: 'Locations not on the map yet' }));
    expect(card.getByText('Peak North')).toBeInTheDocument();
    expect(card.getByText(/Locating…/)).toBeInTheDocument();
    expect(card.getByText('Peak South')).toBeInTheDocument();
    expect(card.getByText(/Add an address/)).toBeInTheDocument();
    // Neither of them got a pin.
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pins', '3');
  });

  it('a location with its OWN coordinates gets a pin even with no screens', () => {
    const screenless: FleetResponse = {
      ...atlasFleet,
      locations: [
        ...atlasFleet.locations,
        { id: 'north', name: 'Peak North', slug: 'north', latitude: 39.5, longitude: -119.8, address: '9 North Rd, Reno, NV' },
      ],
    };
    render(
      <FleetCommandCenter fleet={screenless} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    fireEvent.click(rtl.getByRole('tab', { name: 'map' }));
    expect(rtl.getByTestId('fleet-map')).toHaveAttribute('data-pins', '4');
    expect(pinTones()).toContain('Peak North=ok');
  });

  it('the legend speaks English — "Picture proof", never "painting"', () => {
    renderAtlas();
    const legend = within(rtl.getByRole('group', { name: 'Online ≠ current' }));
    for (const label of ['Device online', 'Content current', 'Push live', 'Picture proof']) {
      expect(legend.getByText(label)).toBeInTheDocument();
    }
    // Our wire vocabulary must not leak into the operator's map.
    expect(rtl.queryByText(/paint/i)).not.toBeInTheDocument();
  });
});

describe('single-location mode (child-location dashboard, 2026-08-31)', () => {
  // A child session's fleet is naturally self-only: one location, its own
  // screens. The surface must keep the pills/inbox/schedule/pulse and drop
  // the multi-location chrome — operator: "look the same new look as the
  // top level just be only that locations info".
  const soloFleet: FleetResponse = {
    root: { id: 'solo', name: 'Peak West', slug: 'west', vertical: 'GYM' },
    locations: [{ id: 'solo', name: 'Peak West', slug: 'west' }],
    stats: { total: 2, online: 2, offline: 0, locationCount: 1 },
    screens: [scr('solo', { id: 's-1' }), scr('solo', { id: 's-2' })],
  };

  it('keeps the pills but drops the location filter and the locations module', () => {
    render(
      <FleetCommandCenter fleet={soloFleet} readiness={undefined} approvals={undefined} orgName="Peak West" onSwitchClassic={() => {}} />,
    );
    // The five assurance pills still stand — same surface.
    expect(rtl.getByText('Devices online')).toBeInTheDocument();
    // No "All gyms" scope dropdown for a single location.
    expect(rtl.queryByLabelText(/Show one gym/)).not.toBeInTheDocument();
    // No locations module at all — a one-row table restates the pills.
    expect(rtl.queryByRole('tab', { name: 'map' })).not.toBeInTheDocument();
    expect(rtl.queryByRole('tab', { name: 'list' })).not.toBeInTheDocument();
    // Header counts screens, not locations.
    expect(rtl.getByText(/2 screens/)).toBeInTheDocument();
  });

  it('the inbox footer links to the screens page instead of scrolling to a table that is not there', () => {
    render(
      <FleetCommandCenter fleet={soloFleet} readiness={undefined} approvals={undefined} orgName="Peak West" onSwitchClassic={() => {}} />,
    );
    expect(rtl.queryByRole('button', { name: /View all incidents/ })).not.toBeInTheDocument();
    const link = rtl.getByRole('link', { name: /View all screens/ });
    expect(link).toHaveAttribute('href', '/west/screens');
  });

  it('two locations still get the full multi-location chrome', () => {
    render(
      <FleetCommandCenter fleet={fleet} readiness={readiness} approvals={approvals} orgName="Iron Peak" onSwitchClassic={() => {}} />,
    );
    expect(rtl.getByLabelText(/Show one gym/)).toBeInTheDocument();
    expect(rtl.getByRole('tab', { name: 'map' })).toBeInTheDocument();
  });
});
