/**
 * Owner, 2026-10-12: "on the fleet map make sure parent accounts and just
 * standard account maps have the same alerts and action items."
 *
 * The organisation's map (FleetCommandCenter — a pin per location) and a
 * standard account's map (ScreenLocationAtlas on the Screens page — a pin per
 * address) are rendered here from the SAME three RIOT Cleveland screens. The
 * summary card, the alert, the fix block and its actions must read the same;
 * only the place name differs (a location there, an address here).
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FleetCommandCenter } from '@/components/dashboard/district/FleetCommandCenter';
import { ScreenLocationAtlas } from '@/components/screens/ScreenLocationAtlas';
import type { FleetResponse } from '@/hooks/use-api';
import type { OpsScreen } from '@/components/screens/v3/screenOps';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ schoolId: 'riot-cleveland' }),
}));
jest.mock('@/hooks/use-tenant-switch', () => ({
  useTenantSwitch: () => ({ switchToTenant: jest.fn(), switchingId: null, error: null, clearError: () => {} }),
}));
const mutateAsync = jest.fn(async () => ({}));
jest.mock('@/hooks/use-api', () => ({
  useRefreshWeb: () => ({ mutate: jest.fn(), mutateAsync, isPending: false }),
  useScreenEvents: () => ({ data: undefined, isLoading: false, isError: false }),
  useUpdateScreen: () => ({ mutate: jest.fn(), isPending: false }),
  useSetScreenOrientation: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/use-deployed-bundle', () => ({
  useDeployedBundle: () => ({ sha: '643161f88ed5', bundleId: '6d803d524f9d' }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => <a {...p}>{children}</a> }));
// An admin is signed in: the fix actions render (the API is the real gate).
jest.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
jest.mock('@/components/screens/ScreenMapClient', () => ({
  ScreenMapClient: ({ locationPins }: { locationPins?: Array<{ name: string; selected?: boolean }> }) => (
    <div data-testid="fleet-map" data-pin-selected={(locationPins ?? []).filter((p) => p.selected).map((p) => p.name).join('|')} />
  ),
}));

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const LAT = 41.4993;
const LNG = -81.6944;
const CLE = { id: 'cle', name: 'RIOT Cleveland', slug: 'riot-cleveland' };

/** The three Cleveland screens, in the Screens page's own row shape. */
const OPS: OpsScreen[] = [
  { id: 'portrait', name: 'High Brightness Portrait', lastBundleId: '2b8268744b51', lastBundleSha: '583ccf14e927' },
  { id: 'pro86', name: 'Pro Series 86', lastBundleId: '293090d5a88c', lastBundleSha: '6498d9f8ea4c' },
  {
    id: 'wall', name: 'Video Wall', lastBundleId: 'f4560e20b100', lastBundleSha: '78a413053e83',
    pendingRefreshAt: ago(10 * 3_600_000), renderHealth: 'STALE', renderStale: true, lastRenderedAt: ago(51 * 3_600_000),
  },
].map((s) => ({
  status: 'ONLINE', renderHealth: 'OK', renderStale: false, lastRenderedAt: ago(30_000), lastRenderedHash: 'pl:0|10000|x',
  pushChannel: 'live', authState: 'PROVEN', lastPingAt: ago(10_000), screenGroupId: 'lobby',
  screenGroup: { id: 'lobby', name: 'Lobby' }, effectiveLatitude: LAT, effectiveLongitude: LNG,
  effectiveAddress: '1 Public Sq, Cleveland, OH 44113', geoSource: 'group', sourceTenant: CLE,
  ...s,
})) as OpsScreen[];

/** The same screens in the organisation's fleet payload. */
const FLEET: FleetResponse = {
  root: { id: 'corp', name: 'RIOT Corporate', slug: 'riot', vertical: 'FITNESS' },
  // A second location (no screens) keeps the organisation map in multi-location mode.
  locations: [CLE, { id: 'akron', name: 'RIOT Akron', slug: 'riot-akron' }],
  stats: { total: 3, online: 3, offline: 0, locationCount: 2 },
  screens: OPS.map((s) => ({
    ...s,
    pendingRefreshAtMs: s.pendingRefreshAt ? Date.parse(s.pendingRefreshAt) : null,
    refreshAckMs: null,
  })) as unknown as FleetResponse['screens'],
} as unknown as FleetResponse;

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

/** Summary card text with the place's own name taken out. */
function summaryText(place: string) {
  const card = rtl.getAllByRole('group', { name: 'Live screen summary' })[0];
  return (card.textContent ?? '').replace(place, '<place>');
}

function readParent() {
  wrap(<FleetCommandCenter fleet={FLEET} readiness={null} approvals={null} orgName="RIOT Corporate" />);
  fireEvent.click(rtl.getByRole('tab', { name: 'map' }));
  const summary = summaryText('RIOT Cleveland');
  fireEvent.click(within(rtl.getAllByRole('group', { name: 'Live screen summary' })[0]).getByTestId('fleet-live-summary-place'));
  const fix = rtl.getByRole('region', { name: 'What to fix here' });
  return { summary, fix: fix.textContent, buttons: within(fix).getAllByRole('button').map((b) => b.textContent) };
}

function readStandard() {
  wrap(
    <ScreenLocationAtlas
      screens={OPS} rows={[]} groups={[{ id: 'lobby', name: 'Lobby', address: '1 Public Sq, Cleveland, OH 44113', latitude: LAT, longitude: LNG }]}
      logoUrl={null} onOpenScreen={jest.fn()} onList={jest.fn()}
      deployedSha="643161f88ed5" deployedBundleId="6d803d524f9d" locationName="RIOT Cleveland" emergencyGap={null}
    />,
  );
  const pin = rtl.getAllByTestId('fleet-live-summary-place')[0].textContent ?? '';
  const place = pin.split(' · ')[0];
  const summary = summaryText(place);
  fireEvent.click(within(rtl.getAllByRole('group', { name: 'Live screen summary' })[0]).getByTestId('fleet-live-summary-place'));
  const fix = rtl.getByRole('region', { name: 'What to fix here' });
  return { summary, fix: fix.textContent, buttons: within(fix).getAllByRole('button').map((b) => b.textContent) };
}

describe('organisation map and standard-account map: the same alerts and the same fixes', () => {
  beforeEach(() => { mockPush.mockClear(); mutateAsync.mockClear(); });

  it('reads identically from the same screens', () => {
    const parent = readParent();
    cleanup();
    const standard = readStandard();

    expect(standard.summary).toBe(parent.summary);
    expect(parent.summary).toContain('3 screens');
    expect(parent.summary).toContain('2 playing');
    expect(parent.summary).toContain('1 update not confirmed');
    expect(parent.summary).toContain('1 screen hasn’t confirmed the update it was sent.');
    expect(parent.summary).toContain('2 screens are playing on the previous web player');

    expect(standard.fix).toBe(parent.fix);
    expect(parent.fix).toContain('1 screen hasn’t confirmed its update');
    expect(parent.fix).toContain('Video Wall');
    expect(standard.buttons).toEqual(parent.buttons);
    expect(parent.buttons).toContain('Send update now');
  });

  it('"Send update now" sends the per-screen refresh for exactly the screen that has not confirmed — on both maps', async () => {
    for (const read of [readParent, readStandard]) {
      read();
      await act(async () => { fireEvent.click(rtl.getByTestId('map-fix-send-update')); });
      expect(mutateAsync).toHaveBeenCalledTimes(1);
      expect(mutateAsync).toHaveBeenCalledWith({ screenId: 'wall' });
      expect(rtl.getByTestId('map-fix-send-update')).toHaveTextContent('Sent to 1 screen');
      mutateAsync.mockClear();
      cleanup();
    }
  });
});
