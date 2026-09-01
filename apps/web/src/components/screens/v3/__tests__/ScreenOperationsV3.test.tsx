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
import { render, screen as rtl, fireEvent, within, act } from '@testing-library/react';
import { ScreenOperationsV3 } from '../ScreenOperationsV3';
import type { OpsScreen, ReadinessInput } from '../screenOps';

const refreshMutate = jest.fn();
const createGroupMutate = jest.fn();
const updateGroupMutate = jest.fn();
const deleteGroupMutate = jest.fn();
const updateScreenMutate = jest.fn();
const setOrientationMutate = jest.fn();
const forceApkMutate = jest.fn();
const deleteScreenMutate = jest.fn();

jest.mock('@/hooks/use-api', () => ({
  useRefreshWeb: () => ({ mutate: refreshMutate, isPending: false }),
  useCreateScreenGroup: () => ({ mutate: createGroupMutate, isPending: false }),
  useUpdateScreenGroup: () => ({ mutate: updateGroupMutate, isPending: false }),
  useDeleteScreenGroup: () => ({ mutate: deleteGroupMutate, isPending: false }),
  useUpdateScreen: () => ({ mutate: updateScreenMutate, isPending: false }),
  useSetScreenOrientation: () => ({ mutate: setOrientationMutate, isPending: false }),
  useForceApkUpdate: () => ({ mutate: forceApkMutate, isPending: false }),
  useDeleteScreen: () => ({ mutate: deleteScreenMutate, isPending: false }),
  useScreenEvents: () => ({ data: { events: [] }, isLoading: false, isError: false }),
  useScreenDeviceInventory: () => ({ data: undefined, isLoading: false, isError: false }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
// The display-control panel's own behaviour is pinned in its suite; here it
// only has to mount inside the Actions tab.
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

const READINESS: ReadinessInput = {
  known: true, locationsReady: 4, locationsTotal: 4,
  anyNotConfigured: false, anyNeedsAttention: false,
};

const onSwitchClassic = jest.fn();
const onPairScreen = jest.fn();
const onOpenFullSettings = jest.fn();

function renderPage(over: Partial<React.ComponentProps<typeof ScreenOperationsV3>> = {}) {
  return render(
    <ScreenOperationsV3
      screens={FLEET}
      groups={[SAC, HEN]}
      schedules={[
        { id: 's1', playlistId: 'pl', screenGroupId: 'sac', isActive: true, mode: 'replace', startTime: new Date(NOW - 3600_000).toISOString(), playlist: { id: 'pl', name: 'Summer Strength' } },
      ]}
      playlists={[{ id: 'pl', name: 'Summer Strength', items: [{ asset: { fileUrl: '/a.png', mimeType: 'image/png' } }] }]}
      deployedSha={SHA}
      readiness={READINESS}
      isLoading={false}
      isError={false}
      onRetry={jest.fn()}
      canControl
      viewMode="list"
      onViewMode={jest.fn()}
      onPairScreen={onPairScreen}
      onSetGroupLocation={jest.fn()}
      onOpenDisplaySchedule={jest.fn()}
      onOpenFullSettings={onOpenFullSettings}
      onSwitchClassic={onSwitchClassic}
      onChanged={jest.fn()}
      buildPreviewHref={(s) => `/player?deviceId=${s.id}`}
      now={NOW}
      {...over}
    />,
  );
}

beforeEach(() => {
  refreshMutate.mockClear();
  onSwitchClassic.mockClear();
  onPairScreen.mockClear();
  onOpenFullSettings.mockClear();
  // scrollIntoView / rAF are not implemented in jsdom.
  Element.prototype.scrollIntoView = jest.fn();
});

// ═══════════════════════════════════════════════════════════════════
describe('assurance strip (§6)', () => {
  it('shows the five items with a LOCATION-level emergency denominator', () => {
    renderPage();
    expect(rtl.getByRole('heading', { level: 1, name: 'Screens' })).toBeInTheDocument();
    expect(rtl.getByText(/Locations emergency ready/)).toBeInTheDocument();
    expect(rtl.getByText('4/4')).toBeInTheDocument();
    // The mock's per-screen "11 Emergency ready" must NOT come back.
    expect(rtl.queryByText(/\d+ Emergency ready/)).not.toBeInTheDocument();
  });

  it('carries the "online is not content" helper note', () => {
    renderPage();
    expect(rtl.getByText('Online does not mean content current.')).toBeInTheDocument();
  });
});

describe('grouped table (§8)', () => {
  it('auto-expands groups with problems and leaves healthy groups collapsed', () => {
    renderPage();
    // Sacramento has the behind + push-delayed screens → expanded.
    expect(rtl.getAllByText('G43').length).toBeGreaterThan(0);
    expect(rtl.getAllByText('M43').length).toBeGreaterThan(0);
    // Henderson is all-current → collapsed, so its screens are not rendered.
    expect(rtl.queryByText('Henderson Lobby')).not.toBeInTheDocument();
    const expander = rtl.getByRole('button', { name: /Expand RIOT Henderson/i });
    expect(expander).toHaveAttribute('aria-expanded', 'false');
  });

  it('a healthy group carries one quiet summary instead of five badges', () => {
    renderPage();
    expect(rtl.getAllByText('All screens current').length).toBeGreaterThan(0);
  });

  it('expanding a collapsed group reveals its screens', () => {
    renderPage();
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
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Actions', 'History']);
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Actions' }));
    expect(within(dialog).getByRole('tab', { name: 'Actions' })).toHaveAttribute('aria-selected', 'true');
    // The pattern keeps focus on the TAB, so the arrow key is delivered there.
    fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'Actions' }), { key: 'ArrowRight' });
    expect(within(dialog).getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  });

  it('groups the Actions tab by risk and keeps the display/restart panel reachable', () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Actions' }));
    expect(within(dialog).getByText('Safe')).toBeInTheDocument();
    expect(within(dialog).getByText('Configuration')).toBeInTheDocument();
    expect(within(dialog).getByText('Disruptive')).toBeInTheDocument();
    expect(within(dialog).getByTestId('display-controls')).toBeInTheDocument();
    expect(within(dialog).getByText(/type REBOOT first/)).toBeInTheDocument();
    // Everything the classic gear popover still owns is one click away.
    fireEvent.click(within(dialog).getByRole('button', { name: /Full settings/ }));
    expect(onOpenFullSettings).toHaveBeenCalledWith('g43');
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

describe('deep link + rollback', () => {
  it('?screen=<id> opens THAT screen’s drawer and scrolls it into view', () => {
    renderPage({ deepLinkScreenId: 'hen1' });
    const dialog = rtl.getByRole('dialog');
    expect(within(dialog).getByText(/Henderson Lobby/)).toBeInTheDocument();
    // Its group was healthy/collapsed — the deep link expands it.
    expect(rtl.getByRole('button', { name: /Collapse RIOT Henderson/i })).toBeInTheDocument();
  });

  it('the quiet Classic view link fires the rollback', () => {
    renderPage();
    fireEvent.click(rtl.getByRole('button', { name: 'More screen actions' }));
    fireEvent.click(rtl.getByRole('button', { name: 'Classic view' }));
    expect(onSwitchClassic).toHaveBeenCalledTimes(1);
  });

  it('group management lives in the overflow, not as a second header button', () => {
    renderPage();
    expect(rtl.queryByRole('button', { name: /New group/ })).not.toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: 'More screen actions' }));
    expect(rtl.getByRole('button', { name: /New group/ })).toBeInTheDocument();
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
    renderPage({ canControl });
    fireEvent.click(within(rtl.getByRole('table')).getAllByRole('button', { name: 'G43' })[0]);
    const dialog = rtl.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Actions' }));
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
      fireEvent.click(rtl.getByRole('button', { name: 'More screen actions' }));
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

    it('gates Push app update (POST /screens/:id/force-update)', () => {
      const dialog = openDrawer(canControl);
      check(within(dialog).getByRole('button', { name: /Push app update/ }));
    });

    it('gates Remove screen (DELETE /screens/:id)', () => {
      const dialog = openDrawer(canControl);
      check(within(dialog).getByRole('button', { name: /Remove screen/ }));
    });

    it('gates both of the drawer’s resync buttons', () => {
      const dialog = openDrawer(canControl);
      // The Actions tab and the sticky footer each carry the same command.
      const resyncs = within(dialog).getAllByRole('button', { name: /Resync content/ });
      expect(resyncs).toHaveLength(2);
      resyncs.forEach(check);
    });

    it('never gates the read-only escapes', () => {
      const dialog = openDrawer(canControl);
      expect(within(dialog).getByRole('button', { name: /Full settings/ })).toBeEnabled();
      expect(within(dialog).getByRole('tab', { name: 'History' })).toBeEnabled();
    });
  });
});
