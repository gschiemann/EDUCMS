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
import {
  compareInstalledVersion, ScreenSettingsMenu, ScreenSettingsPopover,
} from '../ScreenSettingsMenu';

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

jest.mock('@/hooks/use-api', () => ({
  useLatestPlayerVersion: () => ({ data: latestVersionPayload }),
  useHardwareCatalog: () => ({ data: { models: [] }, isLoading: false }),
  useScreenDeviceInventory: () => ({ data: undefined, isLoading: false, isError: false }),
  useSetScreenOrientation: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSetScreenCanvas: () => ({ mutate: setCanvasMutate, isPending: false, isError: false }),
  useSetScreenConsoleProfile: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSetScreenHardwareModel: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSetScreenSyncOffset: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
  useSyncTrimSuggestions: () => ({ data: { suggestions: [] } }),
  useTenantPosterStandard: () => posterStandard,
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
describe('the classic gear button', () => {
  it('opens the popover for its own screen, and closes again', async () => {
    render(<ScreenSettingsMenu {...contentProps()} />);
    expect(rtl.queryByTestId('screen-settings-popover')).not.toBeInTheDocument();
    fireEvent.click(rtl.getByRole('button', { name: /settings/i }));
    const panel = await rtl.findByTestId('screen-settings-popover');
    expect(panel).toHaveAttribute('data-screen-id', 'g43');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(rtl.queryByTestId('screen-settings-popover')).not.toBeInTheDocument());
  });

  it('a deliberate gear click does NOT scroll the page', async () => {
    render(<ScreenSettingsMenu {...contentProps()} />);
    const gear = rtl.getByRole('button', { name: /settings/i });
    jest.spyOn(gear, 'getBoundingClientRect').mockImplementation(() => stagedRect(300));
    fireEvent.click(gear);
    await rtl.findByTestId('screen-settings-popover');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('the ?screen= deep link centres the row and measures AFTER the scroll', async () => {
    const { container } = render(<ScreenSettingsMenu {...contentProps()} autoOpen />);
    const gear = container.querySelector('button')!;
    // The deep-linked row starts far below the fold — the shape that used to
    // park the panel away from its row.
    let staged = stagedRect(2400);
    jest.spyOn(gear, 'getBoundingClientRect').mockImplementation(() => staged);
    (Element.prototype.scrollIntoView as jest.Mock).mockImplementation(() => {
      staged = stagedRect(360);
    });
    // Re-render is not needed: the popover measures in its own mount effect,
    // which has not run against the stub yet on the first pass.
    fireEvent.click(gear); // close
    fireEvent.click(gear); // and reopen, now with the staged rect in place
    const panel = await rtl.findByTestId('screen-settings-popover');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    // 360 (post-scroll top) + 32 (button) + 8 (gap). Measured before the
    // scroll this would have been a `bottom` of -1624px instead.
    expect(panel.style.top).toBe('400px');
    expect(panel.style.bottom).toBe('');
  });

  it('opens once from autoOpen — a StrictMode double-mount does not re-open it', async () => {
    render(
      <React.StrictMode>
        <ScreenSettingsMenu {...contentProps()} autoOpen />
      </React.StrictMode>,
    );
    await rtl.findByTestId('screen-settings-popover');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(rtl.queryByTestId('screen-settings-popover')).not.toBeInTheDocument());
    // Closed stays closed: the guard is a ref checked before it is set, never
    // a call count.
    expect(rtl.queryByTestId('screen-settings-popover')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// The player app row — and the companion Manager (2026-09-01).
// ═══════════════════════════════════════════════════════════════════
function renderPopover(screen: Record<string, unknown> = {}) {
  const host = document.createElement('button');
  document.body.appendChild(host);
  return render(
    <ScreenSettingsPopover
      {...contentProps(screen)}
      getAnchorEl={() => host}
      onClose={onClose}
    />,
  );
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
    expect(push.getAttribute('title')).toMatch(/player app is already on v1\.1\.11/i);
    expect(push.getAttribute('title')).toMatch(/only the companion Manager app/i);

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
