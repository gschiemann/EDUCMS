/**
 * Bulk screen actions on the Screens page (2026-10-11) — selection (select
 * all shown, per group, per screen), the bar, and the confirm / results sheet
 * driven through the real ScreenOperationsV3. Fixture + mocks are the same as
 * ScreenOperationsV3.test.tsx; the bulk mutation is the only new seam.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScreenOperationsV3 } from '../ScreenOperationsV3';
import type { OpsScreen } from '../screenOps';

const refreshMutate = jest.fn();
const createGroupMutate = jest.fn();
const uploadFloorMutate = jest.fn(async () => ({ id: 'fp1' }));
const updateGroupMutate = jest.fn();
const deleteGroupMutate = jest.fn();
const updateScreenMutate = jest.fn();
const setOrientationMutate = jest.fn();
const forceApkMutate = jest.fn();
const deleteScreenMutate = jest.fn();

const setCanvasMutate = jest.fn();
const setConsoleMutate = jest.fn();
const setHardwareMutate = jest.fn();
const setSyncOffsetMutate = jest.fn();

// The group ⋮'s "Calibrate sync…" entry is a link built from the route's
// schoolId, so the surface needs a route to render it at all.
jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'riot' }) }));
jest.mock('@/components/ui/AddressAutocomplete', () => ({
  AddressAutocomplete: (p: { value: string; onChange: (v: string) => void; ariaLabel?: string; placeholder?: string }) => (
    <input aria-label={p.ariaLabel} placeholder={p.placeholder} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
  ),
}));
const bulkMutate = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useBulkScreenAction: () => ({ mutateAsync: (...a: any[]) => bulkMutate(...a), isPending: false }),
  useRefreshWeb: () => ({ mutate: refreshMutate, isPending: false }),
  useCreateScreenGroup: () => ({ mutate: createGroupMutate, mutateAsync: createGroupMutate, isPending: false }),
  useUploadFloorPlan: () => ({ mutateAsync: uploadFloorMutate, isPending: false }),
  useUpdateScreenGroup: () => ({ mutate: updateGroupMutate, isPending: false }),
  useDeleteScreenGroup: () => ({ mutate: deleteGroupMutate, isPending: false }),
  useUpdateScreen: () => ({ mutate: updateScreenMutate, mutateAsync: updateScreenMutate, isPending: false }),
  useSetScreenOrientation: () => ({ mutate: setOrientationMutate, isPending: false }),
  useForceApkUpdate: () => ({ mutate: forceApkMutate, isPending: false }),
  useDeleteScreen: () => ({ mutate: deleteScreenMutate, isPending: false }),
  useScreenEvents: () => ({ data: { events: [] }, isLoading: false, isError: false }),
  useScreenDeviceInventory: () => ({ data: undefined, isLoading: false, isError: false }),
  // ── the "Full settings" popover's own reads/writes (2026-09-01) ──
  // It mounts INSIDE this surface now instead of behind a hop into the classic
  // page, so its hooks have to exist in this mock or the module throws on load.
  useHardwareCatalog: () => ({ data: { models: [] }, isLoading: false }),
  useLatestPlayerVersion: () => ({ data: { versionName: '1.1.11' } }),
  useSetScreenCanvas: () => ({ mutate: setCanvasMutate, isPending: false, isError: false }),
  useSetScreenConsoleProfile: () => ({ mutate: setConsoleMutate, isPending: false, isError: false }),
  useSetScreenHardwareModel: () => ({ mutate: setHardwareMutate, isPending: false, isError: false }),
  useSetScreenSyncOffset: () => ({ mutate: setSyncOffsetMutate, isPending: false, isError: false }),
  useSyncTrimSuggestions: () => ({ data: { suggestions: [] } }),
  // The LED-canvas section reads the tenant's standard poster size (2026-09-01).
  useTenantPosterStandard: () => ({
    w: 320, h: 1080, isDefault: true, storedW: null, storedH: null,
    isLoading: false, isError: false,
  }),
  // 2026-09-16 — double-sided displays. The drawer's Sides section renders
  // NOTHING unless the display has a second side or its own probe reports
  // one, and no screen in this fixture does — so these only have to exist
  // for the component to mount.
  useScreenFaces: () => ({ data: undefined, isLoading: false, refetch: jest.fn() }),
  useCreateScreenFace: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSetScreenFaceMode: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  // 2026-10-11 — per-screen automatic-update switch (AutoUpdateSection).
  useScreenAutoUpdate: () => ({ data: undefined, isLoading: false }),
  useSetScreenAutoUpdate: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
// The drawer's Restore trust action posts directly (its only caller, so it
// composes useMutation + apiFetch rather than adding a shared hook).
const apiFetchMock = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
}));
// The display-control panel's own behaviour is pinned in its suite; here it
// only has to mount inside the Settings tab.
jest.mock('@/components/screens/ScreenDisplayControls', () => ({
  ScreenDisplayControls: () => <div data-testid="display-controls" />,
}));
jest.mock('@/components/screens/ScreenSetupSection', () => ({
  ScreenSetupSection: () => <div data-testid="setup-section" />,
}));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn(async () => true) }));

const NOW = Date.parse('2026-08-31T17:00:00.000Z');
const MIN = 60_000;
const SHA = 'abc123def456';

function scr(over: Partial<OpsScreen> = {}): OpsScreen {
  return {
    id: 'x', name: 'Screen', status: 'ONLINE',
    lastPingAt: new Date(NOW - 8_000).toISOString(),
    renderHealth: 'OK', renderStale: false,
    lastRenderedAt: new Date(NOW - 20_000).toISOString(),
    lastRenderedHash: 'content:9f2',
    lastBundleSha: SHA, pendingRefreshAt: null, pushChannel: 'live',
    authState: 'PROVEN', hardwareModel: 'Wall Mount',
    ...over,
  };
}

const SAC = { id: 'sac', name: 'RIOT Sacramento' };
const HEN = { id: 'hen', name: 'RIOT Henderson' };

const FLEET: OpsScreen[] = [
  scr({ id: 'g43', name: 'G43', screenGroupId: 'sac', screenGroup: SAC, pendingRefreshAt: new Date(NOW - 18 * MIN).toISOString() }),
  scr({ id: 'm43', name: 'M43', screenGroupId: 'sac', screenGroup: SAC, pushChannel: 'stale', lastPushConnectedAt: new Date(NOW - 42 * MIN).toISOString() }),
  scr({ id: 'aframe', name: 'Mobile A-Frame', screenGroupId: 'sac', screenGroup: SAC }),
  scr({ id: 'hen1', name: 'Henderson Lobby', screenGroupId: 'hen', screenGroup: HEN }),
  scr({ id: 'hen2', name: 'Henderson Cardio', screenGroupId: 'hen', screenGroup: HEN }),
  scr({ id: 'back', name: 'Back Office', status: 'OFFLINE', lastPingAt: new Date(NOW - 3 * 3600_000).toISOString() }),
];

const onPairScreen = jest.fn();

/**
 * Every group with a screen starts expanded (2026-09-14, Greg: "expand the
 * ones that have screens in them and keep the others closed by default"), so
 * the rows most tests look at are on screen exactly as the page first paints.
 */
function renderPage(over: Partial<React.ComponentProps<typeof ScreenOperationsV3>> = {}) {
  // The drawer's Restore trust action is a real React Query mutation, so the
  // tree needs a client. Retries off so an error case resolves in one tick.
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
    <ScreenOperationsV3
      screens={FLEET}
      groups={[SAC, HEN]}
      schedules={[
        { id: 's1', playlistId: 'pl', screenGroupId: 'sac', isActive: true, mode: 'replace', startTime: new Date(NOW - 3600_000).toISOString(), playlist: { id: 'pl', name: 'Summer Strength' } },
      ]}
      playlists={[{ id: 'pl', name: 'Summer Strength', items: [{ asset: { fileUrl: '/a.png', mimeType: 'image/png' } }] }]}
      deployedSha={SHA}
isLoading={false}
      isError={false}
      onRetry={jest.fn()}
      canControl
      viewMode="list"
      onViewMode={jest.fn()}
      onPairScreen={onPairScreen}
      onSetGroupLocation={jest.fn()}
      onOpenDisplaySchedule={jest.fn()}
      onChanged={jest.fn()}
      buildPreviewHref={(s) => `/player?deviceId=${s.id}`}
      now={NOW}
      {...over}
    />
    </QueryClientProvider>,
  );
  return utils;
}

beforeEach(() => {
  refreshMutate.mockClear();
  onPairScreen.mockClear();
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ success: true });
  // scrollIntoView / rAF are not implemented in jsdom.
  Element.prototype.scrollIntoView = jest.fn();
});


// ═══════════════════════════════════════════════════════════════════
// BULK ACTIONS (2026-10-11) — Greg: "allow me to do a select-all and push —
// by group at least. Doing one at a time is not good when every screen needs it."
// ═══════════════════════════════════════════════════════════════════

type Bulk = { action: string; screenIds?: string[]; dryRun?: boolean; state?: string; mode?: string };

/** Answer a plan / a send the way the API does: every id named, sent unless told otherwise. */
function answer(req: Bulk, over: Record<string, { outcome: string; reason?: string; installPrompt?: boolean }> = {}) {
  const results = (req.screenIds ?? []).map((id) => ({ screenId: id, name: FLEET.find((s) => s.id === id)?.name ?? null, ...(over[id] ?? { outcome: 'sent' }) }));
  const summary = { requested: results.length, sent: 0, skipped: 0, failed: 0 } as Record<string, number>;
  for (const r of results) summary[r.outcome] += 1;
  return { action: req.action, dryRun: !!req.dryRun, corrId: req.dryRun ? null : 'bulk-1', summary, results, latestPlayerVersion: '1.1.21' };
}

const desktop = () => rtl.getByTestId('screens-desktop');

describe('bulk selection', () => {
  beforeEach(() => bulkMutate.mockReset());

  it('select-all selects every screen SHOWN, and a search narrows what it covers', () => {
    renderPage();
    fireEvent.click(rtl.getByTestId('screens-select-all'));
    expect(rtl.getByTestId('screens-bulk-count')).toHaveTextContent('6 screens selected');

    // Clear, search, select all again → only the matches.
    fireEvent.click(within(rtl.getByTestId('screens-bulk-bar')).getByRole('button', { name: 'Clear' }));
    fireEvent.change(rtl.getByRole('textbox', { name: /Search screens/i }), { target: { value: 'henderson' } });
    fireEvent.click(rtl.getByTestId('screens-select-all'));
    expect(rtl.getByTestId('screens-bulk-count')).toHaveTextContent('2 screens selected');
    expect(rtl.getByTestId('screens-select-hen1')).toBeChecked();
    expect(rtl.queryByTestId('screens-select-g43')).not.toBeInTheDocument();
  });

  it('a search that hides a selected screen drops it from the selection (what is checked is what is sent)', () => {
    renderPage();
    fireEvent.click(rtl.getByTestId('screens-select-g43'));
    fireEvent.click(rtl.getByTestId('screens-select-hen1'));
    expect(rtl.getByTestId('screens-bulk-count')).toHaveTextContent('2 screens selected');
    fireEvent.change(rtl.getByRole('textbox', { name: /Search screens/i }), { target: { value: 'henderson' } });
    expect(rtl.getByTestId('screens-bulk-count')).toHaveTextContent('1 screen selected');
  });

  it('the group box selects the whole group and goes tri-state; "Select all N" lives in the bar', () => {
    renderPage();
    const box = rtl.getByTestId('screens-select-group-sac');
    fireEvent.click(box);
    expect(rtl.getByTestId('screens-bulk-count')).toHaveTextContent('3 screens selected');
    expect(rtl.getByTestId('screens-select-g43')).toBeChecked();
    // Un-tick one → the group box shows the dash.
    fireEvent.click(rtl.getByTestId('screens-select-g43'));
    expect((rtl.getByTestId('screens-select-group-sac') as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(within(rtl.getByTestId('screens-bulk-bar')).getByRole('button', { name: 'Select all 6' }));
    expect(rtl.getByTestId('screens-bulk-count')).toHaveTextContent('6 screens selected');
  });

  it('a row box never opens the drawer', () => {
    renderPage();
    fireEvent.click(rtl.getByTestId('screens-select-hen2'));
    expect(rtl.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('no boxes for a role that cannot act, and none on the map', () => {
    const { unmount } = renderPage({ canControl: false });
    expect(rtl.queryByTestId('screens-select-all')).not.toBeInTheDocument();
    expect(rtl.queryByTestId('screens-select-g43')).not.toBeInTheDocument();
    unmount();
    renderPage({ viewMode: 'map', renderMap: () => <div /> });
    expect(rtl.queryByTestId('screens-select-all')).not.toBeInTheDocument();
  });
});

describe('bulk confirm + results sheet', () => {
  beforeEach(() => bulkMutate.mockReset());

  it('select all → Resync: asks the server for the plan, sends only on Confirm, then names every outcome', async () => {
    const onChanged = jest.fn();
    bulkMutate.mockImplementation(async (req: Bulk) => answer(req, req.dryRun ? {} : { back: { outcome: 'failed', reason: 'not-delivered' } }));
    renderPage({ onChanged });
    fireEvent.click(rtl.getByTestId('screens-select-all'));
    fireEvent.click(rtl.getByTestId('screens-bulk-resync'));

    const sheet = await rtl.findByTestId('screens-bulk-sheet');
    expect(within(sheet).getByRole('heading')).toHaveTextContent('Resync 6 screens?');
    await within(sheet).findByText('6 screens will get it');
    // The plan was a dry run; nothing sent yet.
    expect(bulkMutate).toHaveBeenCalledTimes(1);
    expect(bulkMutate.mock.calls[0][0]).toMatchObject({ action: 'resync', dryRun: true });
    expect([...bulkMutate.mock.calls[0][0].screenIds].sort()).toEqual(['aframe', 'back', 'g43', 'hen1', 'hen2', 'm43']);

    await act(async () => { fireEvent.click(within(sheet).getByTestId('screens-bulk-confirm')); });
    expect(bulkMutate.mock.calls[1][0]).toMatchObject({ action: 'resync', dryRun: false });
    expect(await within(sheet).findByTestId('screens-bulk-summary')).toHaveTextContent('5 sent · 0 skipped · 1 failed');
    const failed = within(sheet).getByTestId('screens-bulk-failed');
    expect(within(failed).getByText('Back Office')).toBeInTheDocument();
    expect(within(failed).getByText('could not be delivered')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();

    // Retry re-plans just the one that did not go.
    bulkMutate.mockImplementation(async (req: Bulk) => answer(req));
    await act(async () => { fireEvent.click(within(sheet).getByTestId('screens-bulk-retry')); });
    expect(bulkMutate.mock.calls[2][0]).toMatchObject({ action: 'resync', dryRun: true, screenIds: ['back'] });
  });

  it('Send update: skipped screens are counted with their reason, Install prompts are called out', async () => {
    bulkMutate.mockImplementation(async (req: Bulk) => answer(req, {
      hen1: { outcome: 'skipped', reason: 'already-current' },
      hen2: { outcome: 'skipped', reason: 'already-current' },
      g43: { outcome: 'sent', installPrompt: true },
    }));
    renderPage();
    fireEvent.click(rtl.getByTestId('screens-select-all'));
    fireEvent.click(rtl.getByTestId('screens-bulk-update'));
    const sheet = await rtl.findByTestId('screens-bulk-sheet');
    await within(sheet).findByText('4 screens will get it');
    expect(within(sheet).getByText('2 skipped — already on the latest Player')).toBeInTheDocument();
    expect(within(sheet).getByText(/1 screen cannot install silently and will show an Install prompt/)).toBeInTheDocument();
    expect(within(sheet).getByText(/newest Player \(1\.1\.21\)/)).toBeInTheDocument();
    expect(within(sheet).getByTestId('screens-bulk-confirm')).toHaveTextContent('Send update to 4 screens');
  });

  it('nothing to send → Confirm is disabled and says why', async () => {
    bulkMutate.mockImplementation(async (req: Bulk) => answer(req, { hen1: { outcome: 'skipped', reason: 'already-current' } }));
    renderPage();
    fireEvent.click(rtl.getByTestId('screens-select-hen1'));
    fireEvent.click(rtl.getByTestId('screens-bulk-update'));
    const sheet = await rtl.findByTestId('screens-bulk-sheet');
    await within(sheet).findByText('Nothing to send — every selected screen is skipped.');
    expect(within(sheet).getByTestId('screens-bulk-confirm')).toBeDisabled();
  });

  it('a failed send says nothing was sent and keeps the sheet open to try again', async () => {
    bulkMutate.mockImplementation(async (req: Bulk) => {
      if (!req.dryRun) throw new Error('Network down');
      return answer(req);
    });
    renderPage();
    fireEvent.click(rtl.getByTestId('screens-select-hen1'));
    fireEvent.click(rtl.getByTestId('screens-bulk-power-off'));
    const sheet = await rtl.findByTestId('screens-bulk-sheet');
    await within(sheet).findByText('1 screen will get it');
    expect(within(sheet).getByTestId('screens-bulk-confirm')).toHaveTextContent('Turn off 1 screen');
    await act(async () => { fireEvent.click(within(sheet).getByTestId('screens-bulk-confirm')); });
    expect(within(sheet).getByRole('alert')).toHaveTextContent('The request did not go through: Network down. Nothing was sent.');
    expect(bulkMutate.mock.calls[1][0]).toMatchObject({ action: 'power', state: 'off', screenIds: ['hen1'] });
  });

  it('automatic updates go through the same sheet', async () => {
    bulkMutate.mockImplementation(async (req: Bulk) => answer(req));
    renderPage();
    fireEvent.click(rtl.getByTestId('screens-select-hen1'));
    fireEvent.change(rtl.getByTestId('screens-bulk-auto'), { target: { value: 'auto-on' } });
    const sheet = await rtl.findByTestId('screens-bulk-sheet');
    await within(sheet).findByText('1 screen will get it');
    expect(bulkMutate.mock.calls[0][0]).toMatchObject({ action: 'auto-update', mode: 'on', dryRun: true });
  });

  it('group menu: "Resync group" covers the whole group, even screens a search hides', async () => {
    bulkMutate.mockImplementation(async (req: Bulk) => answer(req));
    renderPage();
    // The search shows only Henderson Lobby — the group shortcut still means the group.
    fireEvent.change(rtl.getByRole('textbox', { name: /Search screens/i }), { target: { value: 'lobby' } });
    expect(rtl.queryByTestId('screens-select-hen2')).not.toBeInTheDocument();
    fireEvent.click(within(desktop()).getByRole('button', { name: 'More actions for RIOT Henderson' }));
    await act(async () => { fireEvent.click(rtl.getByTestId('group-resync-hen')); });
    const sheet = await rtl.findByTestId('screens-bulk-sheet');
    await within(sheet).findByText('2 screens will get it');
    expect(bulkMutate.mock.calls[0][0]).toMatchObject({ action: 'resync', dryRun: true });
    expect([...bulkMutate.mock.calls[0][0].screenIds].sort()).toEqual(['hen1', 'hen2']);
  });

  it('group menu: "Send update to group"', async () => {
    bulkMutate.mockImplementation(async (req: Bulk) => answer(req));
    renderPage();
    fireEvent.click(within(desktop()).getByRole('button', { name: 'More actions for RIOT Sacramento' }));
    await act(async () => { fireEvent.click(rtl.getByTestId('group-update-sac')); });
    await rtl.findByTestId('screens-bulk-sheet');
    expect(bulkMutate.mock.calls[0][0]).toMatchObject({ action: 'update', dryRun: true });
    expect([...bulkMutate.mock.calls[0][0].screenIds].sort()).toEqual(['aframe', 'g43', 'm43']);
  });
});
