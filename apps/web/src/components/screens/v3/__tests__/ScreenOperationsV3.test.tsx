/**
 * Render-level proof for the Calm Operations v3 Screens surface.
 *
 * The derivation matrix is pinned in screenOps.test.ts; THIS suite proves the
 * operator actually SEES it — worst-first grouping with healthy groups
 * collapsed, single-select chips with a path back to All, the drawer's tabs
 * and focus behaviour, and the `?screen=` deep link. "Verify the render tree"
 * (CLAUDE.md #9 / #21): a green derivation that nothing mounts is not a
 * feature.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within, act, cleanup, waitFor } from '@testing-library/react';
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

jest.mock('@/components/ui/AddressAutocomplete', () => ({
  AddressAutocomplete: (p: { value: string; onChange: (v: string) => void; ariaLabel?: string; placeholder?: string }) => (
    <input aria-label={p.ariaLabel} placeholder={p.placeholder} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
  ),
}));
jest.mock('@/hooks/use-api', () => ({
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
 * Groups start collapsed (2026-09-14). Most tests here look at rows, so the
 * harness opens every group after mounting — pass `{ collapsed: true }` to
 * see the page exactly as it first paints.
 */
function renderPage(over: Partial<React.ComponentProps<typeof ScreenOperationsV3>> = {}, opts: { collapsed?: boolean } = {}) {
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
  if (!opts.collapsed) {
    rtl.queryAllByRole('button', { name: /^Expand / }).forEach((b) => fireEvent.click(b));
  }
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
describe('grouped table (§8)', () => {
  it('groups start collapsed; the group row carries the verdict (2026-09-14)', () => {
    renderPage({}, { collapsed: true });
    // Nothing inside a group is on screen yet — even the one with problems.
    expect(rtl.queryByText('G43')).not.toBeInTheDocument();
    expect(rtl.queryByText('Henderson Lobby')).not.toBeInTheDocument();
    expect(rtl.getByRole('button', { name: /Expand RIOT Sacramento/i })).toHaveAttribute('aria-expanded', 'false');
    // …but the row already says what is wrong inside.
    expect(rtl.getAllByText(/need(s)? attention/).length).toBeGreaterThan(0);
  });

  it('a healthy group carries one quiet summary instead of five badges', () => {
    renderPage();
    expect(rtl.getAllByText('All screens current').length).toBeGreaterThan(0);
  });

  it('expanding a collapsed group reveals its screens', () => {
    renderPage({}, { collapsed: true });
    fireEvent.click(rtl.getByRole('button', { name: /Expand RIOT Henderson/i }));
    expect(rtl.getAllByText('Henderson Lobby').length).toBeGreaterThan(0);
  });

  it('shows ONE dominant status per row, with its action verb', () => {
    renderPage();
    const table = rtl.getByRole('table');
    expect(within(table).getByText('Content behind · 18m')).toBeInTheDocument();
    expect(within(table).getByText('Push delayed · 42m')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Resync' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('the row action fires only that action — it does not also open the drawer', () => {
    renderPage();
    fireEvent.click(within(rtl.getByRole('table')).getByRole('button', { name: 'Resync' }));
    expect(refreshMutate).toHaveBeenCalledTimes(1);
    expect(refreshMutate.mock.calls[0][0]).toEqual({ screenId: 'g43' });
    expect(rtl.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the scheduled content, never a made-up revision label', () => {
    renderPage();
    expect(rtl.getAllByText('Summer Strength').length).toBeGreaterThan(0);
    expect(rtl.queryByText(/\bv1[12]\b/)).not.toBeInTheDocument();
  });
});

describe('filter chips (§7)', () => {
  it('renders an All chip so there is always a path back to the full fleet', () => {
    renderPage();
    const all = rtl.getByRole('button', { name: /^All/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
  });

  it('is single-select: picking one chip releases the previous one', () => {
    renderPage();
    const chips = rtl.getByRole('group', { name: 'Filter screens' });
    fireEvent.click(within(chips).getByRole('button', { name: /Needs attention/ }));
    expect(within(chips).getByRole('button', { name: /Needs attention/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(chips).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(chips).getByRole('button', { name: /^Offline/ }));
    expect(within(chips).getByRole('button', { name: /Needs attention/ })).toHaveAttribute('aria-pressed', 'false');
    expect(within(chips).getByRole('button', { name: /^Offline/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filtering to Needs attention hides the healthy screens, and All brings them back', () => {
    renderPage();
    fireEvent.click(rtl.getByRole('button', { name: /Needs attention/ }));
    expect(rtl.queryByText('Mobile A-Frame')).not.toBeInTheDocument();
    expect(rtl.getByText(/Showing 3 of 6 screens/)).toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: /^All/ }));
    expect(rtl.getAllByText('Mobile A-Frame').length).toBeGreaterThan(0);
  });

  it('honours a preselected filter from a dashboard exception link', () => {
    renderPage({ deepLinkFilter: 'attention' });
    expect(rtl.getByRole('button', { name: /Needs attention/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('no results offers a way out instead of a dead end', () => {
    renderPage();
    fireEvent.change(rtl.getByLabelText(/Search screens/i), { target: { value: 'zzzz' } });
    expect(rtl.getByText('No screens match')).toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: 'Clear filters' }));
    expect(rtl.getAllByText('G43').length).toBeGreaterThan(0);
  });

  it('search composes with the selected chip', () => {
    renderPage();
    fireEvent.click(rtl.getByRole('button', { name: /Needs attention/ }));
    fireEvent.change(rtl.getByLabelText(/Search screens/i), { target: { value: 'M43' } });
    expect(rtl.getAllByText('M43').length).toBeGreaterThan(0);
    expect(rtl.queryByText('G43')).not.toBeInTheDocument();
  });
});

describe('detail drawer (§10 / §14)', () => {
  const open = (name = 'G43') => {
    renderPage();
    fireEvent.click(within(rtl.getByRole('table')).getAllByRole('button', { name })[0]);
    return rtl.getByRole('dialog');
  };

  it('opens on the screen name with the location in the title and Online kept separate', () => {
    const dialog = open();
    expect(within(dialog).getByText(/G43/)).toBeInTheDocument();
    expect(within(dialog).getByText(/RIOT Sacramento/)).toBeInTheDocument();
    expect(within(dialog).getByText('Online')).toBeInTheDocument();
    // …and the issue banner is a separate line from connectivity.
    expect(within(dialog).getByText(/Content behind · 18 minutes/)).toBeInTheDocument();
  });

  it('says "Reported content", never "On screen"', () => {
    const dialog = open();
    expect(within(dialog).getByText('Reported content')).toBeInTheDocument();
    expect(within(dialog).queryByText('On screen')).not.toBeInTheDocument();
  });

  it('draws three evidence steps — no Downloaded, Physical display not instrumented', () => {
    const dialog = open();
    expect(within(dialog).getAllByText('Sent').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Rendered').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Physical display').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('Downloaded')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Not instrumented')).toBeInTheDocument();
    expect(within(dialog).getByText(/Physical display not verified/)).toBeInTheDocument();
  });

  it('shows the recovery card only from a real outstanding command', () => {
    const dialog = open();
    expect(within(dialog).getByText('Resync in progress')).toBeInTheDocument();
    // Never claims a milestone the player did not emit.
    expect(within(dialog).queryByText(/fetched/i)).not.toBeInTheDocument();
  });

  it('takes initial focus on Close and closes on Escape', () => {
    const dialog = open();
    const close = within(dialog).getByRole('button', { name: 'Close details' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(rtl.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('traps Tab inside the panel', () => {
    const dialog = open();
    const focusables = within(dialog).getAllByRole('button');
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    // Wrapped back to the top of the panel rather than escaping to the table.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('switches tabs by click and by arrow key (ARIA tabs pattern)', () => {
    const dialog = open();
    const tabs = within(dialog).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Settings', 'History']);
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Settings' }));
    expect(within(dialog).getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    // The pattern keeps focus on the TAB, so the arrow key is delivered there.
    fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'Settings' }), { key: 'ArrowRight' });
    expect(within(dialog).getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  });

  it('groups the Settings tab by risk and keeps the display/restart panel reachable', async () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Settings' }));
    expect(within(dialog).getByText('Safe')).toBeInTheDocument();
    expect(within(dialog).getByText('Configuration')).toBeInTheDocument();
    expect(within(dialog).getByText('Disruptive')).toBeInTheDocument();
    expect(await within(dialog).findByTestId('display-controls')).toBeInTheDocument();
  });

  /**
   * 2026-09-01 — the operator asked for the separate full-settings popover to
   * be folded into this tab ("just dont miss any settings"). These assert the
   * sections that ONLY that popover used to carry are now here, and that the
   * old escape hatch to a second surface is gone.
   */
  it('carries every setting the separate popover used to own, on this tab', async () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Settings' }));
    // The shared sections load lazily; wait for the first of them.
    expect(await within(dialog).findByTestId('display-controls')).toBeInTheDocument();
    // Orientation — was duplicated here and in the popover; now one control.
    expect(within(dialog).getByRole('button', { name: 'Portrait' })).toBeInTheDocument();
    // The app-update control, with the popover's real push reporting behind it.
    expect(within(dialog).getByText(/Player/i)).toBeInTheDocument();
    // Device details — the read-only diagnostics drawer.
    expect(within(dialog).getByRole('button', { name: /Device details/i })).toBeInTheDocument();
  });

  /**
   * Operator, 2026-09-01: "dont miss the taurus controls that show up and
   * allow for the poster selection." The LED-canvas panel-count picker renders
   * ONLY on LED-controller hardware, so a fixture of generic Android screens
   * cannot see it — and a regression would ship silently. This uses a real
   * NovaStar Taurus.
   */
  it('shows the Taurus LED-canvas panel picker for LED-controller hardware', async () => {
    renderPage({
      screens: FLEET.map((s) =>
        s.id === 'g43'
          ? { ...s, hardwareModel: 'novastar-taurus', osInfo: 'Android 8.1 (NovaStar Taurus)', playerVersion: '1.1.12' }
          : s) as any,
    });
    fireEvent.click(within(rtl.getByRole('table')).getAllByRole('button', { name: 'G43' })[0]);
    const dialog = rtl.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Settings' }));
    expect(await within(dialog).findByText(/LED canvas/i)).toBeInTheDocument();
    // Off + one button per daisy-chained 320×1080 panel.
    for (const label of ['Off', '1', '2', '3', '4', '5', '6']) {
      expect(within(dialog).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('does NOT show the LED-canvas picker on hardware that has no LED canvas', async () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Settings' }));
    await within(dialog).findByTestId('display-controls');
    expect(within(dialog).queryByText(/LED canvas/i)).not.toBeInTheDocument();
  });

  it('no longer sends the operator to a second settings surface', async () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Settings' }));
    await within(dialog).findByTestId('display-controls');
    expect(within(dialog).queryByRole('button', { name: /Full settings/ })).not.toBeInTheDocument();
    expect(rtl.queryByTestId('screen-settings-popover')).not.toBeInTheDocument();
    // The drawer stays open — there is nothing left to navigate away to.
    expect(rtl.getByRole('dialog')).toBeInTheDocument();
  });

  it('an offline screen is told the truth about what a resync can do', () => {
    renderPage();
    fireEvent.click(within(rtl.getByRole('table')).getAllByRole('button', { name: 'Back Office' })[0]);
    const dialog = rtl.getByRole('dialog');
    expect(within(dialog).getByText(/Offline · 3 hours/)).toBeInTheDocument();
    expect(within(dialog).getByText(/check its power and\s+network at the site/)).toBeInTheDocument();
    // §13: never offer Resync as though it can land — it queues, and says so.
    expect(within(dialog).getByRole('button', { name: /Queue a resync/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Resync content/ })).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Restore trust (2026-09-01) — the operator half of deep-audit B-P1-7.
//
// Before this, the fleet chip and the on-glass banner both told the operator
// to "re-pair from the dashboard" and the dashboard had no control that did
// it: a REPAIR_REQUIRED screen never shows a pairing code, because it is
// still happily playing content on renewed 1-hour unproven tokens.
// ═══════════════════════════════════════════════════════════════════
describe('Restore trust', () => {
  const REPAIR_FLEET: OpsScreen[] = [
    scr({ id: 'g43', name: 'G43', screenGroupId: 'sac', screenGroup: SAC, authState: 'REPAIR_REQUIRED' }),
    scr({ id: 'hen1', name: 'Henderson Lobby', screenGroupId: 'hen', screenGroup: HEN }),
  ];

  const openActions = (name: string, over: Partial<React.ComponentProps<typeof ScreenOperationsV3>> = {}) => {
    renderPage({ screens: REPAIR_FLEET, ...over });
    fireEvent.click(within(rtl.getByRole('table')).getAllByRole('button', { name })[0]);
    const dialog = rtl.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Settings' }));
    return dialog;
  };

  it('renders on the Settings tab for a REPAIR_REQUIRED screen', () => {
    const dialog = openActions('G43');
    expect(within(dialog).getByText('Credential')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Restore trust/ })).toBeInTheDocument();
  });

  it('is ABSENT on a healthy screen — no button for a problem that is not there', () => {
    // Default FLEET: every screen is authState PROVEN, and G43 is expanded
    // because it is behind on content — a different problem entirely.
    renderPage();
    fireEvent.click(within(rtl.getByRole('table')).getAllByRole('button', { name: 'G43' })[0]);
    const dialog = rtl.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Settings' }));
    expect(within(dialog).queryByText('Credential')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Restore trust/ })).not.toBeInTheDocument();
  });

  it('is where the row’s own "Re-pair" action lands — that verb opens this tab', () => {
    renderPage({ screens: REPAIR_FLEET });
    fireEvent.click(within(rtl.getByRole('table')).getByRole('button', { name: 'Re-pair' }));
    const dialog = rtl.getByRole('dialog');
    expect(within(dialog).getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('button', { name: /Restore trust/ })).toBeInTheDocument();
  });

  it('POSTs to the narrow endpoint for THAT screen', async () => {
    const dialog = openActions('G43');
    fireEvent.click(within(dialog).getByRole('button', { name: /Restore trust/ }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(apiFetchMock).toHaveBeenCalledWith('/screens/g43/restore-trust', { method: 'POST' });
  });

  it('never claims the screen is healthy — the copy says the DEVICE still has to check in', async () => {
    const dialog = openActions('G43');
    fireEvent.click(within(dialog).getByRole('button', { name: /Restore trust/ }));
    await waitFor(() =>
      expect(within(dialog).getByText(/It has not happened yet/)).toBeInTheDocument(),
    );
    expect(within(dialog).getByText(/within ten minutes/)).toBeInTheDocument();
    // …and the button latches so a second click can't churn the credential.
    expect(within(dialog).getByRole('button', { name: /Restore requested/ })).toBeDisabled();
  });

  it('re-pulls the fleet payload on success (the chip clears only when the device heals)', async () => {
    const onChanged = jest.fn();
    const dialog = openActions('G43', { onChanged });
    fireEvent.click(within(dialog).getByRole('button', { name: /Restore trust/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('surfaces a failure instead of a silent no-op', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('Not found'));
    const dialog = openActions('G43');
    fireEvent.click(within(dialog).getByRole('button', { name: /Restore trust/ }));
    await waitFor(() =>
      // Twice, deliberately: the visible line in the card AND the drawer's
      // aria-live region, so a screen-reader user hears the failure too.
      expect(within(dialog).getAllByText(/Couldn’t restore trust: Not found/)).toHaveLength(2),
    );
    // Still offerable — a failed attempt must not latch the button closed.
    expect(within(dialog).getByRole('button', { name: /Restore trust/ })).not.toBeDisabled();
  });

  it('says so plainly when the server was already trusting the screen', async () => {
    apiFetchMock.mockResolvedValueOnce({ success: true, alreadyProven: true });
    const dialog = openActions('G43');
    fireEvent.click(within(dialog).getByRole('button', { name: /Restore trust/ }));
    await waitFor(() =>
      expect(within(dialog).getByText(/already has this screen on a full credential/)).toBeInTheDocument(),
    );
  });

  it('is admin-gated, exactly like every other write in this drawer', () => {
    const dialog = openActions('G43', { canControl: false });
    expect(within(dialog).getByRole('button', { name: /Restore trust/ })).toBeDisabled();
  });
});

describe('deep link + rollback', () => {
  it('?screen=<id> opens THAT screen’s settings — the one place they now live', async () => {
    // The link is the dashboard device drawer's "Full settings". Since
    // 2026-09-01 every per-screen setting is on this drawer's Settings tab, so
    // that is where it lands; there is no second settings surface left for one
    // link to mean two different things.
    renderPage({ deepLinkScreenId: 'hen1' });
    // Its group was healthy/collapsed — still expanded, so closing the drawer
    // does not strand the operator on a list without the screen they just left.
    expect(rtl.getByRole('button', { name: /Collapse RIOT Henderson/i })).toBeInTheDocument();
    const dialog = rtl.getByRole('dialog');
    expect(within(dialog).getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(dialog).findByTestId('display-controls')).toBeInTheDocument();
  });

  it('New group is a visible header button that opens a form with optional address + floor map (2026-09-14)', () => {
    // Greg: "adding a new group should not be hidden behind the 3 dots".
    renderPage();
    const btn = rtl.getByRole('button', { name: /New group/ });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    const form = rtl.getByRole('form', { name: 'New group' });
    expect(within(form).getByLabelText('New group name')).toBeInTheDocument();
    expect(within(form).getByLabelText('New group address')).toBeInTheDocument();
    expect(within(form).getByLabelText('New group floor map')).toBeInTheDocument();
    // And there is no overflow menu left to hide anything in (classic retired 2026-09-14).
    expect(rtl.queryByRole('button', { name: 'More screen actions' })).not.toBeInTheDocument();
  });
});

describe('filter chips carry only what has screens behind it (2026-09-14)', () => {
  it('a problem chip with a zero count is not rendered; All and Needs attention always are', () => {
    // Nothing offline → no Offline chip. The push-delayed and behind screens remain.
    renderPage({ screens: FLEET.filter((s: any) => s.status !== 'OFFLINE') });
    const chips = within(rtl.getByRole('group', { name: 'Filter screens' }));
    expect(chips.getByRole('button', { name: /^All/ })).toBeInTheDocument();
    expect(chips.getByRole('button', { name: /Needs attention/ })).toBeInTheDocument();
    expect(chips.queryByRole('button', { name: /Offline/ })).not.toBeInTheDocument();
    expect(chips.getByRole('button', { name: /Content behind/ })).toBeInTheDocument();
  });
});

describe('the connect how-to (2026-09-14)', () => {
  it('lives behind an info button beside Pair screen and opens in a dialog', () => {
    renderPage({ connectSlot: <div data-testid="howto">steps</div> });
    expect(rtl.queryByTestId('howto')).not.toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: 'How to connect a screen' }));
    const dlg = rtl.getByRole('dialog', { name: 'How to connect a screen' });
    expect(within(dlg).getByTestId('howto')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(rtl.queryByRole('dialog', { name: 'How to connect a screen' })).not.toBeInTheDocument();
  });
});

describe('groups with no screens (ported from classic, 2026-09-14)', () => {
  const EMPTY = { id: 'reno', name: 'RIOT Reno', address: null, syncMode: null };
  it('an empty group is still a row, with a way to pair into it', () => {
    renderPage({ groups: [SAC, HEN, EMPTY] });
    const rows = rtl.getAllByTestId('empty-group');
    expect(rows.length).toBeGreaterThan(0);
    expect(within(rows[0]).getByText('RIOT Reno')).toBeInTheDocument();
    expect(within(rows[0]).getByText('No screens yet')).toBeInTheDocument();
    fireEvent.click(within(rows[0]).getByRole('button', { name: /^Pair$/ }));
    expect(onPairScreen).toHaveBeenCalledWith('reno');
  });
  it('"Add screen" on an empty group picks from unassigned screens and other groups, never its own (2026-09-14)', async () => {
    renderPage({ groups: [SAC, HEN, EMPTY] });
    fireEvent.click(within(rtl.getAllByTestId('empty-group')[0]).getByRole('button', { name: /^Add screen$/ }));
    const dlg = rtl.getByRole('dialog', { name: 'Add screens to RIOT Reno' });
    // Unassigned first, then the other groups by name.
    const headings = within(dlg).getAllByText(/·\s*\d+$/).map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(headings[0]).toMatch(/^Not in a group/);
    fireEvent.click(within(dlg).getByRole('checkbox', { name: 'Add G43' }));
    fireEvent.click(within(dlg).getByRole('checkbox', { name: 'Add Back Office' }));
    fireEvent.click(within(dlg).getByRole('button', { name: /^Add 2 screens$/ }));
    await waitFor(() => expect(updateScreenMutate).toHaveBeenCalledWith({ id: 'g43', screenGroupId: 'reno' }));
    expect(updateScreenMutate).toHaveBeenCalledWith({ id: 'back', screenGroupId: 'reno' });
  });
  it('the group menu offers "Add screens…" for a group that already has screens, listing only outsiders', () => {
    renderPage();
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for RIOT Sacramento' }));
    fireEvent.click(rtl.getByRole('button', { name: 'Add screens…' }));
    const dlg = rtl.getByRole('dialog', { name: 'Add screens to RIOT Sacramento' });
    expect(within(dlg).queryByRole('checkbox', { name: 'Add G43' })).not.toBeInTheDocument();   // already in Sacramento
    expect(within(dlg).getByRole('checkbox', { name: 'Add Henderson Lobby' })).toBeInTheDocument();
  });
  it('the header Pair screen button opens the modal with no group preselected', () => {
    renderPage();
    fireEvent.click(rtl.getByRole('button', { name: /^Pair screen$/ }));
    expect(onPairScreen).toHaveBeenLastCalledWith();
  });
  it('the group menu can turn synced playback on (and offers Calibrate only once it is on)', () => {
    renderPage();
    fireEvent.click(rtl.getByRole('button', { name: 'More actions for RIOT Sacramento' }));
    expect(rtl.queryByRole('link', { name: /Calibrate sync/ })).not.toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: 'Sync playback across the group' }));
    expect(updateGroupMutate).toHaveBeenCalledWith({ id: 'sac', syncMode: 'locked' }, expect.anything());
  });
});

describe('states (§13)', () => {
  it('loading keeps the table geometry instead of a centred spinner', () => {
    renderPage({ isLoading: true });
    expect(rtl.getByLabelText('Loading screens')).toBeInTheDocument();
  });

  it('an empty fleet invites the first pairing', () => {
    renderPage({ screens: [] });
    expect(rtl.getByText('Connect your first screen')).toBeInTheDocument();
    fireEvent.click(rtl.getAllByRole('button', { name: /Pair screen/ })[1]);
    expect(onPairScreen).toHaveBeenCalled();
  });

  it('a failed load says so instead of showing an empty fleet', () => {
    renderPage({ isError: true });
    expect(rtl.getByText(/Couldn’t load your screens/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
/**
 * A control must never be enabled for a role the API will answer with 403.
 *
 * `canControl` mirrors `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN,
 * SCHOOL_ADMIN)` — the decorator on every write route this surface reaches.
 * The bug this pins: these gates used to read a separate `readOnly` prop wired
 * to `userRole === 'RESTRICTED_VIEWER'`, so a CONTRIBUTOR (neither admin nor
 * viewer) saw every button enabled and collected a 403 on click. Both
 * non-admin roles resolve to `canControl: false`, which is why one matrix
 * covers them.
 */
describe('write gates match the API’s @RequireRoles', () => {
  const openDrawer = (canControl: boolean) => {
    // An ANDROID screen: the app-update control is deliberately absent on a
    // browser player (it has no APK), so gating it can only be asserted on a
    // device that is actually offered it.
    renderPage({
      canControl,
      screens: FLEET.map((s) =>
        s.id === 'g43' ? { ...s, osInfo: 'Android 11', playerVersion: '1.1.0' } : s) as any,
    });
    fireEvent.click(within(rtl.getByRole('table')).getAllByRole('button', { name: 'G43' })[0]);
    const dialog = rtl.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Settings' }));
    return dialog;
  };

  describe.each([
    ['a CONTRIBUTOR / RESTRICTED_VIEWER', false, true],
    ['a SCHOOL_ADMIN', true, false],
  ])('%s', (_label, canControl, expectDisabled) => {
    const check = (el: HTMLElement) =>
      expectDisabled ? expect(el).toBeDisabled() : expect(el).toBeEnabled();

    it('gates Pair screen (POST /screens/pair)', () => {
      renderPage({ canControl });
      check(rtl.getByRole('button', { name: /Pair screen/ }));
    });

    it('gates the empty-fleet Pair screen button', () => {
      renderPage({ canControl, screens: [] });
      check(rtl.getAllByRole('button', { name: /Pair screen/ })[1]);
    });

    it('gates the row Resync (POST /screens/:id/refresh-web)', () => {
      renderPage({ canControl });
      const resync = within(rtl.getByRole('table')).getByRole('button', { name: 'Resync' });
      check(resync);
      fireEvent.click(resync);
      expect(refreshMutate).toHaveBeenCalledTimes(expectDisabled ? 0 : 1);
    });

    it('gates New group (POST /screen-groups)', () => {
      renderPage({ canControl });
      check(rtl.getByRole('button', { name: /New group/ }));
    });

    it('gates the group menu’s writes (PUT/DELETE /screen-groups/:id)', () => {
      renderPage({ canControl });
      fireEvent.click(rtl.getByRole('button', { name: 'More actions for RIOT Sacramento' }));
      check(rtl.getByRole('button', { name: 'Rename group' }));
      check(rtl.getByRole('button', { name: 'Set group address' }));
      check(rtl.getByRole('button', { name: 'Delete group' }));
      // Read-only escapes stay open to every role that can see the page.
      expect(rtl.getByRole('button', { name: 'On/off schedule' })).toBeEnabled();
    });

    it('gates the drawer’s rename (PUT /screens/:id)', () => {
      const dialog = openDrawer(canControl);
      check(within(dialog).getByLabelText('Screen name'));
      // The Save button also waits on a dirty draft, so drive a real edit.
      fireEvent.change(within(dialog).getByLabelText('Screen name'), { target: { value: 'G43 North' } });
      check(within(dialog).getByRole('button', { name: 'Save' }));
    });

    it('gates the drawer’s orientation (PUT /screens/:id/orientation)', () => {
      const dialog = openDrawer(canControl);
      check(within(dialog).getByRole('button', { name: 'Portrait' }));
    });

    it('gates the drawer’s group move (PUT /screens/:id)', () => {
      const dialog = openDrawer(canControl);
      check(within(dialog).getByLabelText('Group'));
    });

    it('gates Push app update (POST /screens/:id/force-update)', async () => {
      const dialog = openDrawer(canControl);
      check(await within(dialog).findByTestId('apk-push'));
    });

    it('gates Remove screen (DELETE /screens/:id)', () => {
      const dialog = openDrawer(canControl);
      check(within(dialog).getByRole('button', { name: /Remove screen/ }));
    });

    it('gates both of the drawer’s resync buttons', () => {
      const dialog = openDrawer(canControl);
      // The Settings tab and the sticky footer each carry the same command.
      const resyncs = within(dialog).getAllByRole('button', { name: /Resync content/ });
      expect(resyncs).toHaveLength(2);
      resyncs.forEach(check);
    });

    it('never gates the read-only escapes', () => {
      const dialog = openDrawer(canControl);
      // Reading is never gated: the live preview link and the History tab stay
      // open to anyone who can see the screen at all.
      // The Settings tab and the sticky footer each carry it.
      expect(within(dialog).getAllByRole('link', { name: /Open live preview/ }).length).toBeGreaterThan(0);
      expect(within(dialog).getByRole('tab', { name: 'History' })).toBeEnabled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// The row ⋮ menu (2026-09-01 — operator: "none of these buttons hidden
// under the 3 dots do anything")
//
// ⚠️ HONESTY NOTE about what this suite can and cannot prove. The live bug
// was environment-specific: under the App Router, React hydrates the whole
// document, so React's listener and the dismiss listener sat on the SAME
// node, `stopPropagation` could not stop a same-node sibling listener, and
// the panel unmounted on pointerdown before the click landed. Under RTL,
// React attaches to the render container instead, so `stopPropagation`
// DOES work and the old code passes these tests. jsdom cannot reproduce it.
//
// So this suite guards two things it CAN prove: every item still invokes
// its handler (the symptom, for any future refactor), and the structural
// attributes the fix depends on are present (the fix, since stripping them
// silently restores the bug).
// ═══════════════════════════════════════════════════════════════════

describe('row overflow menu', () => {
  const openRowMenu = () => {
    renderPage();
    fireEvent.click(rtl.getAllByRole('button', { name: /More actions for G43/ })[0]);
  };

  it('Open details opens the drawer on Overview', () => {
    openRowMenu();
    fireEvent.click(rtl.getByRole('button', { name: 'Open details' }));
    expect(rtl.getByRole('dialog')).toBeInTheDocument();
    expect(rtl.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('Settings opens the drawer on the Settings tab', () => {
    openRowMenu();
    fireEvent.click(rtl.getByRole('button', { name: 'Settings' }));
    expect(rtl.getByRole('dialog')).toBeInTheDocument();
    expect(rtl.getByRole('tab', { name: /Settings/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('has no separate Full settings item — Settings is where they live', async () => {
    openRowMenu();
    expect(rtl.queryByRole('button', { name: 'Full settings' })).not.toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: 'Settings' }));
    const dialog = rtl.getByRole('dialog');
    expect(within(dialog).getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    // The surface it was clicked on is still the surface it is on: nothing
    // asked the page to roll back to classic (the 2026-09-01 report).
    // And the row menu that launched it steps out of the way.
    expect(rtl.queryByRole('button', { name: 'Open details' })).not.toBeInTheDocument();
  });

  it('Open live preview is a real link, not a dead button', () => {
    openRowMenu();
    expect(rtl.getByRole('link', { name: 'Open live preview' })).toHaveAttribute(
      'href', '/player?deviceId=g43',
    );
  });

  it('the panel and trigger carry the markers the dismiss handler keys on', () => {
    // Removing either attribute silently restores the "nothing happens" bug:
    // the document-level pointerdown listener would close the panel before
    // the click could land. See the useEffect in ScreenOperationsV3.
    openRowMenu();
    const item = rtl.getByRole('button', { name: 'Open details' });
    expect(item.closest('[data-popover-panel]')).not.toBeNull();
    expect(
      rtl.getAllByRole('button', { name: /More actions for G43/ })[0]
        .closest('[data-popover-trigger]'),
    ).not.toBeNull();
  });

  it('a pointerdown inside the panel does not dismiss it', () => {
    openRowMenu();
    const item = rtl.getByRole('button', { name: 'Open details' });
    fireEvent.pointerDown(item);
    expect(rtl.getByRole('button', { name: 'Open details' })).toBeInTheDocument();
  });

  it('a pointerdown outside closes it', () => {
    openRowMenu();
    fireEvent.pointerDown(document.body);
    expect(rtl.queryByRole('button', { name: 'Open details' })).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// "Full settings" (2026-09-01 — operator: "it reverts the entire screen back
// to the classic layout and it pulls up the menu but moves it to the top of
// the screen instead of it being next to the actual screen im working on")
//
// Two separate failures, two separate guards below:
//   1. The action swapped the whole page for the classic surface. It now
//      mounts the SAME popover in place (the tests above pin that).
//   2. The panel was anchored off a rect measured BEFORE the row had been
//      scrolled into view, so a row below the fold anchored the panel to
//      wherever it used to be. jsdom does no layout, so the rect is staged by
//      hand: off-screen until `scrollIntoView` runs, on-screen after. An
//      implementation that measures first can only produce the off-screen
//      answer, and the assertion below names the on-screen one.
// ═══════════════════════════════════════════════════════════════════

/** A button-sized rect at `top`, on the right-hand side of the row. */
function stagedRect(top: number): DOMRect {
  const height = 32;
  const right = 900;
  return {
    top, bottom: top + height, left: right - height, right,
    width: height, height, x: right - height, y: top, toJSON: () => ({}),
  } as DOMRect;
}

