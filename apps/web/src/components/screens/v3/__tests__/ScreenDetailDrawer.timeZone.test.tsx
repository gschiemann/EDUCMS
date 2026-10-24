/**
 * The screen drawer's Time zone row (2026-10-24): the effective zone, where it
 * came from, the plain-words note when the device's own clock setting
 * disagrees (a GUQ shipped on Asia/Shanghai), and the override picker that
 * writes `timezone` through PUT /screens/:id. Renders the REAL drawer.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScreenDetailDrawer } from '../ScreenDetailDrawer';
import { buildScreenOps, type OpsScreen } from '../screenOps';

const updateMutate = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useRefreshWeb: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateScreen: () => ({ mutate: updateMutate, mutateAsync: jest.fn(), isPending: false }),
  useSetScreenOrientation: () => ({ mutate: jest.fn(), isPending: false }),
  useForceApkUpdate: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteScreen: () => ({ mutate: jest.fn(), isPending: false }),
  useScreenEvents: () => ({ data: { events: [] }, isLoading: false, isError: false }),
  useScreenDeviceInventory: () => ({ data: undefined, isLoading: false, isError: false }),
  useScreenPlaybackCapability: () => ({ data: undefined, isLoading: false, isError: false }),
  useScreenInterruptions: () => ({ data: undefined, isLoading: false, isError: false }),
  useClearPlaybackDemotion: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: 'SCHOOL_ADMIN' } }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(async () => ({ success: true })) }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn(async () => true) }));
// The Actions tab also mounts the shared settings sections through
// `next/dynamic` (app update, orientation, LED canvas…). They are not under
// test here and need a dozen more hooks, so the dynamic island renders nothing.
jest.mock('next/dynamic', () => () => () => null);

// 2026-07-15T19:00Z — 12:00 PM in Los Angeles (PDT), 3:00 AM next day in Shanghai.
const NOW = Date.UTC(2026, 6, 15, 19, 0);

function screenRow(over: Partial<OpsScreen> = {}) {
  const screen: OpsScreen = {
    id: 'scr-tz-1', name: 'Lobby', status: 'ONLINE',
    lastPingAt: new Date(NOW - 8_000).toISOString(),
    renderHealth: 'OK', renderStale: false,
    lastRenderedAt: new Date(NOW - 20_000).toISOString(), lastRenderedHash: 'content:9f2',
    pendingRefreshAt: null, pushChannel: 'live', authState: 'PROVEN',
    ...over,
  };
  return buildScreenOps({ screens: [screen], schedules: [], playlists: [], deployedSha: null, now: NOW }).rows[0];
}

function renderDrawer(row: ReturnType<typeof screenRow>, canControl = true) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScreenDetailDrawer
        row={row}
        placeName="Test group"
        previewHref={null}
        canControl={canControl}
        groups={[]}
        now={NOW}
        initialTab="actions"
        onClose={jest.fn()}
        onOpenDisplaySchedule={jest.fn()}
        pushState={undefined}
        onPushApk={jest.fn()}
        apkPending={false}
        onRefreshWeb={jest.fn()}
        refreshWebPending={false}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
  updateMutate.mockClear();
});

describe('ScreenDetailDrawer → Time zone', () => {
  it('shows the automatic zone, its source, the local time, and says the device disagrees in plain words', () => {
    renderDrawer(screenRow({
      timeZone: 'America/Los_Angeles', timeZoneSource: 'auto', timeZoneAuto: 'America/Los_Angeles', timeZoneAutoFrom: 'location',
      timezone: null, deviceTimeZone: 'Asia/Shanghai',
    }));
    const row = rtl.getByTestId('screen-time-zone');
    expect(within(row).getByTestId('screen-time-zone-effective').textContent).toBe('America/Los_Angeles · PDT (UTC−7) · 12:00 PM there now');
    expect(row.textContent).toContain('Automatic, from the address');
    expect(within(row).getByTestId('screen-time-zone-device').textContent)
      .toBe('The screen itself is set to Asia/Shanghai. Clocks, dates and overnight updates on it follow America/Los_Angeles anyway.');
    // The picker's first option names the automatic zone; nothing is selected over it.
    const select = within(row).getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[0].textContent).toBe('Automatic (America/Los_Angeles)');
  });

  it('two names for the same rules never read as a disagreement', () => {
    renderDrawer(screenRow({ timeZone: 'America/Los_Angeles', timeZoneSource: 'location', timeZoneAuto: 'America/Los_Angeles', deviceTimeZone: 'US/Pacific' }));
    const row = rtl.getByTestId('screen-time-zone');
    expect(row.textContent).toContain('From the location’s setting');
    expect(within(row).getByTestId('screen-time-zone-device').textContent).toBe('The screen’s own clock setting agrees.');
  });

  it('with no zone known it says the screen uses its device’s zone, and offers the picker', () => {
    renderDrawer(screenRow({ timeZone: null, timeZoneSource: 'device', timeZoneAuto: null, timeZoneAutoFrom: null, deviceTimeZone: 'Asia/Shanghai' }));
    const row = rtl.getByTestId('screen-time-zone');
    expect(within(row).getByTestId('screen-time-zone-effective').textContent).toBe('Asia/Shanghai · (UTC+8)');
    expect(row.textContent).toContain('No zone known for this screen — it uses whatever its device is set to.');
    expect(rtl.queryByTestId('screen-time-zone-device')).not.toBeInTheDocument();
    const select = within(row).getByRole('combobox') as HTMLSelectElement;
    expect(select.options[0].textContent).toBe('Automatic (no address to detect from)');
  });

  it('an older payload without the field shows no row rather than a guess', () => {
    renderDrawer(screenRow({}));
    expect(rtl.queryByTestId('screen-time-zone')).not.toBeInTheDocument();
  });

  it('picking a zone writes the override; picking Automatic clears it; nothing is written when unchanged', () => {
    renderDrawer(screenRow({ timeZone: 'America/Los_Angeles', timeZoneSource: 'auto', timeZoneAuto: 'America/Los_Angeles', timezone: null }));
    const select = within(rtl.getByTestId('screen-time-zone')).getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'America/Denver' } });
    expect(updateMutate).toHaveBeenCalledWith({ id: 'scr-tz-1', timezone: 'America/Denver' }, expect.anything());
    updateMutate.mockClear();
    // Already automatic: choosing Automatic again writes nothing.
    fireEvent.change(select, { target: { value: '' } });
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('a screen with an override shows it selected and can be put back to automatic', () => {
    renderDrawer(screenRow({ timeZone: 'America/Denver', timeZoneSource: 'screen', timeZoneAuto: 'America/Los_Angeles', timezone: 'America/Denver' }));
    const row = rtl.getByTestId('screen-time-zone');
    expect(row.textContent).toContain('Set on this screen');
    const select = within(row).getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('America/Denver');
    fireEvent.change(select, { target: { value: '' } });
    expect(updateMutate).toHaveBeenCalledWith({ id: 'scr-tz-1', timezone: null }, expect.anything());
  });

  it('a viewer who cannot control the screen sees the facts but a disabled picker', () => {
    renderDrawer(screenRow({ timeZone: 'America/Los_Angeles', timeZoneSource: 'auto', timeZoneAuto: 'America/Los_Angeles' }), false);
    const select = within(rtl.getByTestId('screen-time-zone')).getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
