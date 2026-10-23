/**
 * The per-screen "Full settings" popover — the surface BOTH Screens pages now
 * mount (2026-09-01, when it was extracted out of ClassicScreensPage so the v3
 * page would stop swapping itself for the classic one to show it).
 *
 * Three things are pinned here, each bought with an operator report:
 *
 *   1. ANCHORING. *"it pulls up the menu but moves it to the top of the screen
 *      instead of it being next to the actual screen im working on"* — the
 *      panel used to be positioned from a rect measured BEFORE the row was
 *      scrolled into view. jsdom does no layout, so the rect is staged by hand
 *      and `scrollIntoView` is what moves it; an implementation that measures
 *      first can only produce the stale answer.
 *   2. THE COMPANION MANAGER. *"if the player is on the latest version but the
 *      manager is not, there is no way to push the updated manager"* — the
 *      quiet green "up to date" chip stood in front of the push button, graded
 *      on the Player alone.
 *   3. UNKNOWN STAYS UNKNOWN. An API that does not advertise a Manager version
 *      must leave the row exactly as it was — no button, no nag.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, waitFor, within } from '@testing-library/react';
import { compareInstalledVersion, ScreenSettingsSections } from '../ScreenSettingsMenu';

let latestVersionPayload: {
  versionName: string | null;
  managerVersionName?: string | null;
} = { versionName: '1.1.11', managerVersionName: '1.0.24' };

/** The tenant's standard LED poster size (2026-09-01) — swapped per test. */
let posterStandard = {
  w: 320, h: 1080, isDefault: true,
  storedW: null as number | null, storedH: null as number | null,
  isLoading: false, isError: false,
};
const setCanvasMutate = jest.fn();
/** POST /screens/:id/force-update/cancel (2026-10-18) — calls its handlers like React Query. */
let cancelOutcome: 'ok' | 'error' = 'ok';
const cancelMutate = jest.fn((id: string, h?: { onSuccess?: () => void; onError?: () => void }) => {
  if (cancelOutcome === 'ok') h?.onSuccess?.();
  else h?.onError?.();
});
const confirmMock = jest.fn(async (_opts: unknown) => true);
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: (opts: unknown) => confirmMock(opts) }));

jest.mock('@/hooks/use-api', () => ({
  useLatestPlayerVersion: () => ({ data: latestVersionPayload }),
  useHardwareCatalog: () => ({ data: { models: [] }, isLoading: false }),
  useScreenDeviceInventory: () => ({ data: undefined, isLoading: false, isError: false }),
  useScreenPlaybackCapability: () => ({ data: undefined, isLoading: false, isError: false }),
  // The Overview's interruptions section (2026-10-18): nothing recorded yet.
  useScreenInterruptions: () => ({ data: undefined, isLoading: false, isError: false }),
  useSetScreenOrientation: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSetScreenCanvas: () => ({ mutate: setCanvasMutate, isPending: false, isError: false }),
  useSetScreenConsoleProfile: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSetScreenHardwareModel: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSetScreenSyncOffset: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSyncTrimSuggestions: () => ({ data: { suggestions: [] } }),
  useTenantPosterStandard: () => posterStandard,
  // 2026-09-16 — double-sided displays. The Sides section renders NOTHING
  // unless the display has a second side or its probe reports one, so these
  // screens (all single-sided) are unaffected; the hooks only have to exist
  // for the component to mount.
  useScreenFaces: () => ({ data: undefined, isLoading: false, refetch: jest.fn() }),
  useCreateScreenFace: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSetScreenFaceMode: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  // 2026-10-11 — per-screen automatic-update switch (AutoUpdateSection).
  useScreenAutoUpdate: () => ({ data: undefined, isLoading: false }),
  useSetScreenAutoUpdate: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  // 2026-10-18 — "Cancel update" on a tracked push (TrackedPushFooter).
  useCancelApkUpdate: () => ({ mutate: cancelMutate, isPending: false }),
}));
// Both panels have their own suites; here they only have to mount.
jest.mock('@/components/screens/ScreenDisplayControls', () => ({
  ScreenDisplayControls: () => <div data-testid="display-controls" />,
}));
jest.mock('@/components/screens/ScreenSetupSection', () => ({
  ScreenSetupSection: () => <div data-testid="setup-section" />,
}));

const ANDROID_SCREEN = {
  id: 'g43',
  name: 'G43',
  status: 'ONLINE',
  osInfo: 'Android 11',
  resolution: '1920x1080',
  playerVersion: '1.1.11',
  managerVersion: '1.0.23',
  deviceFingerprint: 'fp-g43',
};

const onPushApk = jest.fn();
const onRefreshWeb = jest.fn();
const onOpenDisplaySchedule = jest.fn();
const onClose = jest.fn();

function contentProps(screen: Record<string, unknown> = {}) {
  return {
    screen: { ...ANDROID_SCREEN, ...screen },
    pushState: undefined,
    pending: false,
    onPushApk,
    onRefreshWeb,
    refreshWebPending: false,
    previewHref: '/player?deviceId=fp-g43',
    onOpenDisplaySchedule,
    capabilitySource: null,
  };
}

/** A button-sized rect at `top`, over on the right of the row. */
function stagedRect(top: number): DOMRect {
  const height = 32;
  const right = 900;
  return {
    top, bottom: top + height, left: right - height, right,
    width: height, height, x: right - height, y: top, toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  latestVersionPayload = { versionName: '1.1.11', managerVersionName: '1.0.24' };
  posterStandard = {
    w: 320, h: 1080, isDefault: true, storedW: null, storedH: null,
    isLoading: false, isError: false,
  };
  setCanvasMutate.mockClear();
  cancelMutate.mockClear();
  confirmMock.mockClear();
  cancelOutcome = 'ok';
  onPushApk.mockClear();
  onRefreshWeb.mockClear();
  onClose.mockClear();
  Element.prototype.scrollIntoView = jest.fn();
});

// ═══════════════════════════════════════════════════════════════════
describe('compareInstalledVersion', () => {
  it('compares numerically, not as strings (1.1.11 is newer than 1.1.9)', () => {
    expect(compareInstalledVersion('1.1.11', '1.1.9')).toBe(true);
    expect(compareInstalledVersion('1.1.9', '1.1.11')).toBe(false);
    expect(compareInstalledVersion('v1.1.11', '1.1.11')).toBe(true);
  });

  it('answers UNKNOWN — never a verdict — when either side is missing', () => {
    expect(compareInstalledVersion(null, '1.0.24')).toBeNull();
    expect(compareInstalledVersion('1.0.24', null)).toBeNull();
    expect(compareInstalledVersion('1.0.24', undefined)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// The settings BODY, mounted the way the v3 drawer mounts it (the classic
// gear/popover wrappers were retired 2026-09-14).
function renderPopover(screen: Record<string, unknown> = {}) {
  return render(<ScreenSettingsSections {...contentProps(screen)} />);
}

describe('player app row', () => {
  it('player current and manager current → one quiet line, no push button', () => {
    latestVersionPayload = { versionName: '1.1.11', managerVersionName: '1.0.23' };
    renderPopover();
    expect(rtl.getByText('Player app v1.1.11 — up to date')).toBeInTheDocument();
    expect(rtl.queryByRole('button', { name: /Push update/ })).not.toBeInTheDocument();
  });

  it('player behind → the push button names the player version', () => {
    latestVersionPayload = { versionName: '1.2.0', managerVersionName: '1.0.23' };
    renderPopover();
    expect(rtl.getByRole('button', { name: /Push update to v1\.2\.0/ })).toBeEnabled();
  });

  it('player current, MANAGER stale → the push button is offered and enabled', () => {
    // The operator report: "if the player is on the latest version but the
    // manager is not, there is no way to push the updated manager."
    latestVersionPayload = { versionName: '1.1.11', managerVersionName: '1.0.24' };
    renderPopover(); // screen: player 1.1.11 (current), manager 1.0.23 (behind)

    // The quiet green chip must NOT be what the operator sees — it was the
    // thing standing in front of the button.
    expect(rtl.queryByText('Player app v1.1.11 — up to date')).not.toBeInTheDocument();

    const push = rtl.getByRole('button', { name: /Push update — Manager v1\.0\.24 available/ });
    expect(push).toBeEnabled();
    // The sub-line says which half is current and which is not.
    expect(rtl.getByText('Player v1.1.11 is current · Manager v1.0.23 → v1.0.24')).toBeInTheDocument();
    // …and the tooltip says the player is already current, so nobody reads the
    // button as a pointless re-push of the player.
    expect(push.getAttribute('title')).toMatch(/player is current/i);
    expect(push.getAttribute('title')).toMatch(/companion Manager app/i);

    // Same transport as every other push — CHECK_FOR_UPDATES via onPushApk.
    fireEvent.click(push);
    expect(onPushApk).toHaveBeenCalledTimes(1);
  });

  it('an API with no manager version leaves the row exactly as it was', () => {
    // UNKNOWN is not stale. A deploy whose API predates `managerVersionName`
    // must not sprout a push button on every up-to-date screen.
    latestVersionPayload = { versionName: '1.1.11' };
    renderPopover();
    expect(rtl.getByText('Player app v1.1.11 — up to date')).toBeInTheDocument();
    expect(rtl.queryByRole('button', { name: /Push update/ })).not.toBeInTheDocument();
  });

  it('a device that has never reported a manager version is unknown, not stale', () => {
    latestVersionPayload = { versionName: '1.1.11', managerVersionName: '1.0.24' };
    renderPopover({ managerVersion: null });
    expect(rtl.getByText('Player app v1.1.11 — up to date')).toBeInTheDocument();
    expect(rtl.queryByRole('button', { name: /Push update/ })).not.toBeInTheDocument();
  });

  // ── 2026-10-17 — the screen's own terminal answer to a pending push ───
  // An Android 9 panel downloaded one update 48 times while this row said
  // "Updating…". A screen that says Android needs a person to tap Install
  // (NEEDS_TAP) or that the install failed (FAILED_<CODE>) is shown as that —
  // read off the SERVER's pending push, so it survives a page reload.
  const pushedAt = '2026-10-16T10:00:00.000Z';
  const after = (min: number) => new Date(Date.parse(pushedAt) + min * 60_000).toISOString();

  it('NEEDS_TAP after the push → "needs an Install tap on the screen", even after a reload', () => {
    latestVersionPayload = { versionName: '1.1.29', managerVersionName: '1.0.23' };
    renderPopover({
      playerVersion: '1.1.23',
      forceApkUpdatePendingAt: pushedAt,
      lastOtaState: 'NEEDS_TAP',
      lastOtaAt: after(3),
    });
    const row = rtl.getByTestId('apk-update-status');
    expect(within(row).getByText('Needs an Install tap on the screen')).toBeInTheDocument();
    expect(within(row).getByText(/Press Install now on the screen, then tap Install/)).toBeInTheDocument();
    // Not dressed as progress.
    expect(within(row).queryByText(/Updating/)).not.toBeInTheDocument();
  });

  it('a NEEDS_TAP older than the push says nothing about it', () => {
    latestVersionPayload = { versionName: '1.1.29', managerVersionName: '1.0.23' };
    renderPopover({
      playerVersion: '1.1.23',
      forceApkUpdatePendingAt: pushedAt,
      lastOtaState: 'NEEDS_TAP',
      lastOtaAt: after(-5),
    });
    expect(rtl.queryByText('Needs an Install tap on the screen')).not.toBeInTheDocument();
  });

  it('a push from this session that the screen answered NEEDS_TAP is not stuck on "Updating…"', () => {
    latestVersionPayload = { versionName: '1.1.29', managerVersionName: '1.0.23' };
    render(
      <ScreenSettingsSections
        {...contentProps({ playerVersion: '1.1.23', lastOtaState: 'NEEDS_TAP', lastOtaAt: new Date(Date.now() - 1_000).toISOString() })}
        pushState={{ at: Date.now() - 120_000, priorVersion: '1.1.23' }}
      />,
    );
    expect(rtl.getByText('Needs an Install tap on the screen')).toBeInTheDocument();
    expect(rtl.getByTestId('apk-push')).toBeEnabled();
    expect(rtl.getByTestId('apk-push')).toHaveTextContent('Push update');
  });

  it('a push answered "already on the latest" settles on "Already on" — no Updating…, no push footer (2026-10-22)', () => {
    // L55VEC: pushed while no newer build was allowed for it. The screen
    // answered UP_TO_DATE; the server still holds a push it never offered.
    latestVersionPayload = { versionName: null };
    const pushedAt = new Date(Date.now() - 60_000).toISOString();
    render(
      <ScreenSettingsSections
        {...contentProps({
          playerVersion: '1.1.47-field.1',
          forceApkUpdatePendingAt: pushedAt, forceApkUpdateOfferCount: 0,
          lastOtaState: 'UP_TO_DATE', lastOtaAt: new Date(Date.now() - 1_000).toISOString(),
        })}
        pushState={{ at: Date.now() - 60_000, priorVersion: '1.1.47-field.1' }}
      />,
    );
    const row = rtl.getByTestId('apk-update-status');
    expect(within(row).getByText('Already on v1.1.47-field.1 ✓')).toBeInTheDocument();
    expect(within(row).queryByText(/Updating/)).not.toBeInTheDocument();
    expect(rtl.queryByTestId('apk-push')).not.toBeInTheDocument();
    expect(within(row).queryByText(/not offered yet/)).not.toBeInTheDocument();
  });

  it('FAILED_<CODE> after the push → the install failed, named, with Retry', () => {
    latestVersionPayload = { versionName: '1.1.29', managerVersionName: '1.0.23' };
    renderPopover({
      playerVersion: '1.1.23',
      forceApkUpdatePendingAt: pushedAt,
      lastOtaState: 'FAILED_ABORTED',
      lastOtaAt: after(4),
    });
    expect(rtl.getByText('Install failed (ABORTED)')).toBeInTheDocument();
    expect(rtl.getByText(/kept the downloaded update/)).toBeInTheDocument();
    expect(rtl.getByTestId('apk-push')).toHaveTextContent('Retry update');
  });

  // ── 2026-10-18 — tracked pushes: the SERVER's record of the push ──────
  // A push no longer expires on its own. The row says what the server knows —
  // waiting, sent N times, or why it stopped offering it — from the screen
  // row itself (so it survives a reload), and offers Cancel.
  const tracked = (over: Record<string, unknown> = {}) => ({
    playerVersion: '1.1.23',
    forceApkUpdatePendingAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    forceApkUpdateHold: null,
    forceApkUpdateHoldAt: null,
    forceApkUpdateHoldReason: null,
    forceApkUpdateOfferCount: 0,
    forceApkUpdateLastOfferAt: null,
    forceApkUpdateTargetVersion: null,
    ...over,
  });
  const heldAt = new Date(Date.now() - 60 * 60_000).toISOString();

  describe('tracked push', () => {
    beforeEach(() => { latestVersionPayload = { versionName: '1.1.41', managerVersionName: '1.0.23' }; });

    it('sent, not handed over yet → "waiting for the screen to pick it up", with when and how often', () => {
      renderPopover(tracked());
      const row = rtl.getByTestId('apk-update-status');
      expect(within(row).getByText('Update sent — waiting for the screen to pick it up')).toBeInTheDocument();
      expect(within(row).getByTestId('apk-push-facts')).toHaveTextContent('Sent 2 hours ago · not offered yet');
      expect(within(row).getByTestId('apk-push-cancel')).toHaveTextContent('Cancel update');
    });

    it('handed over → "waiting for it to install", the offer count and the build', () => {
      renderPopover(tracked({ forceApkUpdateOfferCount: 2, forceApkUpdateTargetVersion: '1.1.41' }));
      expect(rtl.getByText('Sent to the screen — waiting for it to install')).toBeInTheDocument();
      expect(rtl.getByTestId('apk-push-facts')).toHaveTextContent('Sent 2 hours ago · offered 2 times · v1.1.41');
    });

    it('held NEEDS_TAP → the tap line, never "Updating…", Push re-offered', () => {
      renderPopover(tracked({
        forceApkUpdateHold: 'NEEDS_TAP', forceApkUpdateHoldAt: heldAt, forceApkUpdateOfferCount: 1,
        forceApkUpdateHoldReason: 'device-reported-needs-tap: Android on this screen is waiting…',
        lastOtaState: 'NEEDS_TAP', lastOtaAt: heldAt,
      }));
      const row = rtl.getByTestId('apk-update-status');
      expect(within(row).getByText('Needs an Install tap on the screen')).toBeInTheDocument();
      expect(within(row).getByText(/Press Install now on the screen, then tap Install/)).toBeInTheDocument();
      expect(within(row).queryByText(/Updating/)).not.toBeInTheDocument();
      expect(within(row).getByTestId('apk-push-facts')).toHaveTextContent('offered 1 time');
    });

    it('a NEEDS_TAP the server only INFERRED on a screen it cannot read says "most likely"', () => {
      renderPopover(tracked({
        forceApkUpdateHold: 'NEEDS_TAP', forceApkUpdateHoldAt: heldAt, forceApkUpdateOfferCount: 1,
        forceApkUpdateHoldReason: 'did-not-land-unknown-class: v1.1.41 did not install…',
      }));
      expect(rtl.getByText(/Most likely Android on this screen is waiting/)).toBeInTheDocument();
    });

    it('held STALLED at the offer limit → stalled, how many times, Retry', () => {
      renderPopover(tracked({
        forceApkUpdateHold: 'STALLED', forceApkUpdateHoldAt: heldAt, forceApkUpdateOfferCount: 4,
        forceApkUpdateHoldReason: 'offer-limit-reached: v1.1.41 was offered 4 times and did not install…',
        // The device's last words were a download that died — the hold wins.
        lastOtaState: 'DOWNLOADING', lastOtaAt: new Date(Date.now() - 90 * 60_000).toISOString(),
      }));
      expect(rtl.getByText('Update stalled — the screen did not install it')).toBeInTheDocument();
      expect(rtl.getByText(/It was offered 4 times and never installed/)).toBeInTheDocument();
      expect(rtl.getByTestId('apk-push')).toHaveTextContent('Retry update');
    });

    it('held EXPIRED → not picked up within 24 hours, nothing installs later, Retry', () => {
      renderPopover(tracked({
        forceApkUpdatePendingAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
        forceApkUpdateHold: 'EXPIRED', forceApkUpdateHoldAt: heldAt,
        forceApkUpdateHoldReason: 'not-offered-within-24h: The update was not handed…',
      }));
      expect(rtl.getByText('Update expired — not picked up within 24 hours')).toBeInTheDocument();
      expect(rtl.getByText(/so nothing will install later/)).toBeInTheDocument();
      expect(rtl.getByTestId('apk-push-facts')).toHaveTextContent('Sent yesterday · not offered yet');
      expect(rtl.getByTestId('apk-push')).toHaveTextContent('Retry update');
    });

    it('held FAILED names the code when there is one, and says "Install failed" when there is not', () => {
      const { unmount } = renderPopover(tracked({
        forceApkUpdateHold: 'FAILED', forceApkUpdateHoldAt: heldAt, forceApkUpdateOfferCount: 1,
        forceApkUpdateHoldReason: 'device-reported-failed_incompatible: Installing v1.1.41 failed…',
      }));
      expect(rtl.getByText('Install failed (INCOMPATIBLE)')).toBeInTheDocument();
      unmount();
      renderPopover(tracked({
        forceApkUpdateHold: 'FAILED', forceApkUpdateHoldAt: heldAt, forceApkUpdateOfferCount: 1,
        forceApkUpdateHoldReason: 'device-reported-install-error: Installing v1.1.41 failed…',
      }));
      expect(rtl.getByText('Install failed')).toBeInTheDocument();
      // An older player's install error keeps no file — don't promise one.
      expect(rtl.getByText(/The screen reported that the install failed/)).toBeInTheDocument();
    });

    it('progress AFTER the hold (someone pressed Install now on the panel) is shown instead of the hold', () => {
      renderPopover(tracked({
        forceApkUpdateHold: 'NEEDS_TAP', forceApkUpdateHoldAt: heldAt, forceApkUpdateOfferCount: 1,
        lastOtaState: 'DOWNLOADING', lastOtaProgress: 40, lastOtaAt: new Date(Date.now() - 60_000).toISOString(),
      }));
      expect(rtl.getByText('Downloading… 40%')).toBeInTheDocument();
      expect(rtl.queryByText('Needs an Install tap on the screen')).not.toBeInTheDocument();
    });

    it('an "up to date" answer to a push that was held back is not "Already on v1.1.23 ✓" on a screen that is behind', () => {
      renderPopover(tracked({ lastOtaState: 'UP_TO_DATE', lastOtaAt: new Date(Date.now() - 60_000).toISOString() }));
      expect(rtl.queryByText(/Already on/)).not.toBeInTheDocument();
      expect(rtl.getByText('Update sent — waiting for the screen to pick it up')).toBeInTheDocument();
    });

    it('a screen already on the newest release with a push still pending shows the push, not the quiet chip', () => {
      renderPopover(tracked({ playerVersion: '1.1.41', forceApkUpdateOfferCount: 1 }));
      expect(rtl.queryByText(/— up to date/)).not.toBeInTheDocument();
      expect(rtl.getByTestId('apk-push-cancel')).toBeInTheDocument();
    });

    it('a push from this session is not called "No update after 35 minutes" by an API that tracks it', () => {
      render(
        <ScreenSettingsSections
          {...contentProps(tracked({ forceApkUpdateOfferCount: 1 }))}
          pushState={{ at: Date.now() - 40 * 60_000, priorVersion: '1.1.23' }}
        />,
      );
      expect(rtl.queryByText(/No update after 35 minutes/)).not.toBeInTheDocument();
      expect(rtl.getByText('Sent to the screen — waiting for it to install')).toBeInTheDocument();
    });

    it('…while an API that does not track pushes keeps the old stopwatch', () => {
      render(
        <ScreenSettingsSections
          {...contentProps({ playerVersion: '1.1.23', forceApkUpdatePendingAt: new Date(Date.now() - 40 * 60_000).toISOString() })}
          pushState={{ at: Date.now() - 40 * 60_000, priorVersion: '1.1.23' }}
        />,
      );
      expect(rtl.getByText(/No update after 35 minutes/)).toBeInTheDocument();
    });

    it('Cancel asks first, then cancels THIS screen\'s push, says so, and ends the page\'s own record of it', async () => {
      const onPushCancelled = jest.fn();
      render(<ScreenSettingsSections {...contentProps(tracked({ forceApkUpdateHold: 'NEEDS_TAP', forceApkUpdateHoldAt: heldAt }))} onPushCancelled={onPushCancelled} />);
      fireEvent.click(rtl.getByTestId('apk-push-cancel'));
      await waitFor(() => expect(cancelMutate).toHaveBeenCalledTimes(1));
      expect(cancelMutate.mock.calls[0][0]).toBe('g43');
      const asked = confirmMock.mock.calls[0][0] as { title: string; message: string; confirmLabel: string; cancelLabel: string };
      expect(asked.title).toBe('Cancel the update for G43?');
      // Honest about what Cancel cannot do.
      expect(asked.message).toMatch(/Install prompt on it, that prompt stays until someone answers it/);
      expect(asked.cancelLabel).toBe('Keep it');
      expect(await rtl.findByText('Update cancelled.')).toBeInTheDocument();
      expect(onPushCancelled).toHaveBeenCalledTimes(1);
    });

    it('declining the confirm cancels nothing', async () => {
      confirmMock.mockResolvedValueOnce(false);
      renderPopover(tracked());
      fireEvent.click(rtl.getByTestId('apk-push-cancel'));
      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
      expect(cancelMutate).not.toHaveBeenCalled();
    });

    it('a failed cancel says so and leaves the button', async () => {
      cancelOutcome = 'error';
      renderPopover(tracked());
      fireEvent.click(rtl.getByTestId('apk-push-cancel'));
      expect(await rtl.findByText("Couldn't cancel the update. Try again.")).toBeInTheDocument();
      expect(rtl.getByTestId('apk-push-cancel')).toBeInTheDocument();
    });

    it('a role that cannot push cannot cancel either (the facts still show)', () => {
      render(<ScreenSettingsSections {...contentProps(tracked({ forceApkUpdateOfferCount: 1 }))} displayReadOnly />);
      expect(rtl.getByTestId('apk-push-facts')).toBeInTheDocument();
      expect(rtl.queryByTestId('apk-push-cancel')).not.toBeInTheDocument();
    });
  });

  it('a browser player has no APK row at all', () => {
    renderPopover({ osInfo: 'Chrome 120 on macOS', playerVersion: null, managerVersion: null });
    expect(rtl.queryByText(/Player app v/)).not.toBeInTheDocument();
    expect(rtl.queryByRole('button', { name: /Push update/ })).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// LED canvas — poster size × panels (2026-09-01).
//
// A NovaStar TB poster cannot report its own LED module size, so the picker
// used to hard-code "panels of 320×1080" — only the 1.86 mm poster. The size
// now comes from the tenant standard (or a one-off Custom), and the saved
// canvas is `size.w × panels` by `size.h`. What is pinned here is the
// ARITHMETIC that reaches the server, plus the gating that keeps this section
// off every LCD screen in the fleet.
// ═══════════════════════════════════════════════════════════════════
describe('LED canvas section', () => {
  const TAURUS = { hardwareModel: 'novastar-taurus' };
  /** Scope every query to the section — plain "3" is a common button label. */
  const section = () => rtl.getByTestId('led-canvas-section');
  const btn = (name: string | RegExp) =>
    within(section()).getByRole('button', { name });

  it('3 standard 320×1080 posters save a 960×1080 canvas', () => {
    renderPopover(TAURUS);
    fireEvent.click(btn('3'));
    expect(setCanvasMutate).toHaveBeenCalledWith({ id: 'g43', canvasW: 960, canvasH: 1080 });
  });

  it('follows the TENANT standard, not a hard-coded 320 (1.56 mm poster × 2)', () => {
    posterStandard = {
      w: 360, h: 1200, isDefault: false, storedW: 360, storedH: 1200,
      isLoading: false, isError: false,
    };
    renderPopover(TAURUS);
    expect(btn(/Standard 360×1200/)).toBeInTheDocument();
    fireEvent.click(btn('2'));
    expect(setCanvasMutate).toHaveBeenCalledWith({ id: 'g43', canvasW: 720, canvasH: 1200 });
  });

  it('a one-off Custom 360×1200 × 1 saves 360×1200 without touching the standard', () => {
    renderPopover(TAURUS);
    fireEvent.click(btn('Custom'));
    fireEvent.change(within(section()).getByLabelText('Custom poster width'), { target: { value: '360' } });
    fireEvent.change(within(section()).getByLabelText('Custom poster height'), { target: { value: '1200' } });
    fireEvent.click(btn('1'));
    expect(setCanvasMutate).toHaveBeenCalledWith({ id: 'g43', canvasW: 360, canvasH: 1200 });
  });

  it('an incomplete Custom size cannot be multiplied by a panel count', () => {
    renderPopover(TAURUS);
    fireEvent.click(btn('Custom'));
    fireEvent.change(within(section()).getByLabelText('Custom poster width'), { target: { value: '9' } });
    expect(btn('2')).toBeDisabled();
    fireEvent.click(btn('2'));
    expect(setCanvasMutate).not.toHaveBeenCalled();
  });

  it('Off clears to null/null — automatic, not a canvas of zeros', () => {
    renderPopover({ ...TAURUS, canvasW: 960, canvasH: 1080 });
    fireEvent.click(btn('Off'));
    expect(setCanvasMutate).toHaveBeenCalledWith({ id: 'g43', canvasW: null, canvasH: null });
  });

  it('states the arithmetic AND the stored value as two separate facts', () => {
    renderPopover({ ...TAURUS, canvasW: 960, canvasH: 1080 });
    expect(within(section()).getByText('3 × 320×1080 = 960×1080')).toBeInTheDocument();
    expect(within(section()).getByText(/Screen: 960×1080/)).toBeInTheDocument();
  });

  it('a stored canvas that is NOT a chain of standard posters opens on Custom', () => {
    // 360×1200 against a 320×1080 standard: describing it as N standard
    // posters would be a lie, so the section shows the real numbers.
    renderPopover({ ...TAURUS, canvasW: 360, canvasH: 1200 });
    expect(within(section()).getByLabelText('Custom poster width')).toHaveValue(360);
    expect(within(section()).getByLabelText('Custom poster height')).toHaveValue(1200);
    expect(within(section()).getByText('1 × 360×1200 = 360×1200')).toBeInTheDocument();
  });

  it('is hidden on generic Android with no override — and returns for one', () => {
    renderPopover({ hardwareModel: 'generic-android' });
    expect(rtl.queryByTestId('led-canvas-section')).not.toBeInTheDocument();
  });

  it('still renders on non-LED hardware when an override exists, so it can be cleared', () => {
    renderPopover({ hardwareModel: 'generic-android', canvasW: 960, canvasH: 1080 });
    expect(rtl.getByTestId('led-canvas-section')).toBeInTheDocument();
    expect(rtl.getByText(/Canvas override set on non-LED hardware/)).toBeInTheDocument();
  });
});
