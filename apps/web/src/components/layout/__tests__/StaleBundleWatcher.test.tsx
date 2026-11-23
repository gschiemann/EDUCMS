/**
 * StaleBundleWatcher — a deploy never reloads a tab the operator can see.
 *
 * Pins the contract in StaleBundleWatcher.tsx / stale-bundle-policy.ts:
 *   - a new deployed SHA shows a persistent control; a visible tab is never
 *     reloaded on its own, however long it stays open;
 *   - "Later" hides the control until a DIFFERENT SHA is deployed;
 *   - an automatic reload happens only while the tab is hidden, with nothing
 *     dirty, no overlay or emergency, focus outside text fields, and a route
 *     that runs nothing live;
 *   - an unfinished upload counts as unsaved work;
 *   - /api/build-info is never fetched from a hidden tab, and at most once
 *     per interval from a visible one.
 * Real timers are faked; `freshReload` (the navigation) is the observed seam.
 * The re-check freshReload makes before it navigates is covered with the real
 * module in StaleBundleWatcher.in-flight.test.tsx.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StaleBundleWatcher } from '../StaleBundleWatcher';
import { freshReload } from '../fresh-reload';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  HIDDEN_RELOAD_DELAY_MS,
  LATE_TIMER_TOLERANCE_MS,
  autoReloadBlocker,
  isAutoReloadExemptPath,
  isEditingElement,
  type AutoReloadState,
} from '../stale-bundle-policy';
import { registerUnsavedWork } from '@/lib/unsaved-work';
import { clearUploadJobs, updateUploadItems, useUploadJobStore, type UploadItem, type UploadPhase } from '@/lib/upload-job-store';
import { useAppStore } from '@/lib/store';

jest.mock('../fresh-reload', () => ({ freshReload: jest.fn(() => Promise.resolve(true)) }));

const reload = freshReload as jest.MockedFunction<typeof freshReload>;
const MINE = 'aaaaaaaaaaaa';
const NEXT = 'bbbbbbbbbbbb';
const LATER = 'cccccccccccc';

let serverSha: string | null = NEXT;
let visibility: 'visible' | 'hidden' = 'visible';
const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ sha: serverSha }) }));
const savedEnv = { ...process.env };
const cleanups: Array<() => void> = [];
let logSpy: jest.SpyInstance;

/**
 * Advance fake time in 10 s steps, each in its own act(), so React renders
 * and runs effects between steps the way a browser does. One act() spanning
 * hours would hide any timer chain that needs a render to re-arm.
 */
const STEP_MS = 10_000;
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= STEP_MS) {
    const step = Math.min(STEP_MS, left);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(step);
    });
  }
}

async function setVisibility(v: 'visible' | 'hidden') {
  visibility = v;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const control = () => screen.queryByRole('status');

/** Mount, let the first check land, and confirm the control is up. */
async function mountAndDetect() {
  render(<StaleBundleWatcher />);
  await advance(FIRST_CHECK_DELAY_MS);
  expect(control()).not.toBeNull();
}

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

beforeEach(() => {
  jest.useFakeTimers();
  delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  process.env.NEXT_PUBLIC_BUILD_SHA = MINE;
  serverSha = NEXT;
  visibility = 'visible';
  fetchMock.mockClear();
  reload.mockClear();
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  window.history.pushState({}, '', '/school-1/dashboard');
  useAppStore.setState({ overlayOpenCount: 0, isEmergencyActive: false });
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  clearUploadJobs(useUploadJobStore.getState().items.map((i) => i.id));
  useAppStore.setState({ user: null });
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  logSpy.mockRestore();
  process.env = { ...savedEnv };
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

describe('<StaleBundleWatcher />', () => {
  it('shows a persistent, translated reload control when a new SHA is deployed', async () => {
    await mountAndDetect();
    expect(control()).toHaveTextContent('A new version is available');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
  });

  it('a visible tab never reloads on its own, however long the control stays up', async () => {
    await mountAndDetect();
    await advance(3 * 60 * 60_000);
    expect(reload).not.toHaveBeenCalled();
    expect(control()).not.toBeNull();
  });

  it('Reload reloads at once, with no re-check (the operator asked for it)', async () => {
    await mountAndDetect();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith();
  });

  it('Later snoozes until the NEXT different SHA, not the next check', async () => {
    await mountAndDetect();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(control()).toBeNull();

    // Past the old 30 s re-arm and several checks that still see the same SHA.
    await advance(FIRST_CHECK_DELAY_MS + 1_000);
    expect(control()).toBeNull();
    await advance(3 * CHECK_INTERVAL_MS);
    expect(control()).toBeNull();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);

    // A snoozed version is not reloaded behind the operator's back either.
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();

    // The next deploy brings the control back.
    await setVisibility('visible');
    serverSha = LATER;
    await advance(CHECK_INTERVAL_MS);
    expect(control()).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('a hidden, clean tab reloads after the hidden delay, and only then', async () => {
    await mountAndDetect();
    await setVisibility('hidden');
    await advance(HIDDEN_RELOAD_DELAY_MS - 1_000);
    expect(reload).not.toHaveBeenCalled();
    await advance(1_000);
    expect(reload).toHaveBeenCalledTimes(1);
    // An automatic reload always hands freshReload its re-check.
    const recheck = reload.mock.calls[0][0];
    expect(typeof recheck).toBe('function');
    expect(recheck!()).toBe(true);
    // The same re-check says no once the operator is back.
    await setVisibility('visible');
    expect(recheck!()).toBe(false);
  });

  it('coming back before the hidden delay cancels the automatic reload', async () => {
    await mountAndDetect();
    await setVisibility('hidden');
    await advance(HIDDEN_RELOAD_DELAY_MS / 2);
    await setVisibility('visible');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a hidden tab with unsaved work does not reload; the same tab reloads once it is clean', async () => {
    let dirty = true;
    cleanups.push(registerUnsavedWork(() => dirty));
    await mountAndDetect();
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();

    // Control: the block was the dirty state, nothing else.
    dirty = false;
    await setVisibility('visible');
    await setVisibility('hidden');
    await advance(HIDDEN_RELOAD_DELAY_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a hidden tab with an unfinished upload does not reload; it does once the upload is done', async () => {
    const upload = (phase: UploadPhase): UploadItem => ({
      id: 'u1', file: new File(['v'], 'gym.mp4', { type: 'video/mp4' }), progress: 40, phase,
      ownerUserId: 'operator', ownerTenantId: 'school-1', folderId: null,
    });
    updateUploadItems(() => [upload('uploading')]);
    await mountAndDetect();
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[dashboard-drift] automatic reload held: unsaved-work');

    await act(async () => {
      updateUploadItems(() => [upload('success')]);
    });
    await setVisibility('visible');
    await setVisibility('hidden');
    await advance(HIDDEN_RELOAD_DELAY_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stacks above the upload tray while the tray is showing', async () => {
    await mountAndDetect();
    expect(screen.getByTestId('app-update-control').className).toContain('bottom-[calc(5rem+env(safe-area-inset-bottom))]');
    await act(async () => {
      useAppStore.setState({ user: { id: 'operator', tenantId: 'school-1' } as never });
      updateUploadItems(() => [{
        id: 'u2', file: new File(['v'], 'gym.mp4', { type: 'video/mp4' }), progress: 10, phase: 'uploading',
        ownerUserId: 'operator', ownerTenantId: 'school-1', folderId: null,
      }]);
    });
    expect(screen.getByTestId('app-update-control').className).toContain('bottom-[calc(8.75rem+env(safe-area-inset-bottom))]');
  });

  it('a dirty check that cannot answer counts as unsaved work', async () => {
    cleanups.push(registerUnsavedWork(() => { throw new Error('unreadable'); }));
    await mountAndDetect();
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it('logs which rule held the reload', async () => {
    window.history.pushState({}, '', '/school-1/emergency/broadcast');
    useAppStore.setState({ isEmergencyActive: true });
    await mountAndDetect();
    await setVisibility('hidden');
    await advance(HIDDEN_RELOAD_DELAY_MS);
    // The route is checked before the emergency flag.
    expect(logSpy).toHaveBeenCalledWith('[dashboard-drift] automatic reload held: exempt-route');
  });

  it.each([
    ['the live game console', '/school-1/sports/game-42'],
    ['the swim bridge under the console', '/school-1/sports/game-42/swim-bridge'],
    ['the emergency broadcast page', '/school-1/emergency/broadcast'],
    ['camera sync calibration', '/school-1/screens/sync-calibrate'],
  ])('a hidden, clean tab on %s does not reload', async (_label, path) => {
    window.history.pushState({}, '', path);
    await mountAndDetect();
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
    expect(control()).not.toBeNull();
  });

  it('an overlay registered with the store blocks the automatic reload', async () => {
    useAppStore.setState({ overlayOpenCount: 1 });
    await mountAndDetect();
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a modal in the document blocks the automatic reload', async () => {
    await mountAndDetect();
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    cleanups.push(() => { if (modal.parentNode) modal.parentNode.removeChild(modal); });
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it('an active emergency blocks the automatic reload', async () => {
    useAppStore.setState({ isEmergencyActive: true });
    await mountAndDetect();
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it('focus left in a text field blocks the automatic reload', async () => {
    await mountAndDetect();
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    cleanups.push(() => { if (input.parentNode) input.parentNode.removeChild(input); });
    input.focus();
    expect(document.activeElement).toBe(input);
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it('an offline browser does not reload (the reload clears the shell cache first)', async () => {
    await mountAndDetect();
    const onLine = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    cleanups.push(() => onLine.mockRestore());
    await setVisibility('hidden');
    await advance(2 * HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a reload timer that fires long after it was due (page suspended, now resuming) does not reload', async () => {
    await mountAndDetect();
    await setVisibility('hidden');
    // The wall clock jumps 30 min while the timer queue does not move — what a
    // sleeping laptop or a suspended phone tab looks like when it wakes.
    jest.setSystemTime(Date.now() + 30 * 60_000);
    await advance(HIDDEN_RELOAD_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it('never checks from a hidden tab; checks 30 s after it becomes visible', async () => {
    visibility = 'hidden';
    render(<StaleBundleWatcher />);
    await advance(60 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();

    await setVisibility('visible');
    await advance(FIRST_CHECK_DELAY_MS - 1_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checks at most once per interval while visible, including across tab switches', async () => {
    serverSha = MINE; // no drift: the steady state of every open tab
    render(<StaleBundleWatcher />);
    for (let i = 0; i < 24; i++) {
      await advance(2.5 * 60_000);
      await setVisibility(i % 2 ? 'visible' : 'hidden');
    }
    await setVisibility('visible');
    await advance(60 * 60_000);
    // 2 h total, of which ~1.5 h visible → at most 1 + 120/5 checks.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1 + (2 * 60) / 5);
    expect(control()).toBeNull();
  });

  it('renders nothing and never fetches without a baked SHA', async () => {
    delete process.env.NEXT_PUBLIC_BUILD_SHA;
    const { container } = render(<StaleBundleWatcher />);
    await advance(60 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('hides the control again when the deployed SHA matches this bundle', async () => {
    await mountAndDetect();
    serverSha = MINE;
    await advance(CHECK_INTERVAL_MS);
    expect(control()).toBeNull();
  });
});

describe('stale-bundle-policy', () => {
  const clear: AutoReloadState = {
    visibilityState: 'hidden',
    pathname: '/school-1/dashboard',
    unsavedWork: false,
    overlayOpenCount: 0,
    emergencyActive: false,
    overlayInDocument: false,
    editing: false,
    online: true,
    timerLateMs: 0,
  };
  // Every rule tripped at once, in the order autoReloadBlocker reports them.
  const tripped: Array<[NonNullable<ReturnType<typeof autoReloadBlocker>>, Partial<AutoReloadState>]> = [
    ['visible', { visibilityState: 'visible' }],
    ['exempt-route', { pathname: '/school-1/sports/game-42' }],
    ['emergency', { emergencyActive: true }],
    ['unsaved-work', { unsavedWork: true }],
    ['overlay', { overlayOpenCount: 1 }],
    ['editing', { editing: true }],
    ['offline', { online: false }],
    ['resumed-late', { timerLateMs: LATE_TIMER_TOLERANCE_MS + 1 }],
  ];

  it('allows a reload only when nothing blocks it', () => {
    expect(autoReloadBlocker(clear)).toBeNull();
    expect(autoReloadBlocker({ ...clear, overlayInDocument: true })).toBe('overlay');
    expect(autoReloadBlocker({ ...clear, visibilityState: 'prerender' })).toBe('visible');
    expect(autoReloadBlocker({ ...clear, timerLateMs: LATE_TIMER_TOLERANCE_MS })).toBeNull();
  });

  it('reports blockers in a fixed order', () => {
    for (let i = 0; i < tripped.length; i++) {
      const state = tripped.slice(i).reduce<AutoReloadState>((acc, [, patch]) => ({ ...acc, ...patch }), clear);
      expect(autoReloadBlocker(state)).toBe(tripped[i][0]);
    }
  });

  it.each([
    ['/school-1/sports/game-42', true],
    ['/school-1/sports/game-42/swim-bridge', true],
    ['/school-1/emergency/broadcast', true],
    ['/school-1/screens/sync-calibrate', true],
    ['/school-1/sports', false],
    ['/school-1/sports/sponsors', false],
    ['/school-1/settings/sports', false],
    ['/school-1/settings/emergency', false],
    ['/school-1/screens', false],
    ['/school-1/playlists/abc', false],
    ['/school-1/dashboard', false],
  ])('isAutoReloadExemptPath(%s) → %s', (path, exempt) => {
    expect(isAutoReloadExemptPath(path)).toBe(exempt);
  });

  it('treats text entry as editing and buttons/checkboxes as not', () => {
    const make = (html: string) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      return host.firstElementChild as Element;
    };
    expect(isEditingElement(make('<input type="text">'))).toBe(true);
    expect(isEditingElement(make('<input>'))).toBe(true);
    expect(isEditingElement(make('<textarea></textarea>'))).toBe(true);
    expect(isEditingElement(make('<select></select>'))).toBe(true);
    expect(isEditingElement(make('<div contenteditable="true"><span>x</span></div>'))).toBe(true);
    expect(isEditingElement(make('<input type="checkbox">'))).toBe(false);
    expect(isEditingElement(make('<button>Go</button>'))).toBe(false);
    expect(isEditingElement(null)).toBe(false);
  });
});
