/**
 * StaleBundleWatcher with the REAL freshReload: an automatic reload that is
 * already preparing (waiting on the service worker) is re-checked right
 * before it navigates, so a tab the operator has come back to is never
 * reloaded, and nothing in the shell is changed for a reload that will not
 * happen.
 *
 * The service-worker container, CacheStorage and the navigation are stubbed;
 * `pageNavigation.reload` stands in for `location.reload`, which jsdom does
 * not let a test replace.
 */
import { act, render, screen } from '@testing-library/react';
import { StaleBundleWatcher } from '../StaleBundleWatcher';
import { pageNavigation } from '../fresh-reload';
import { FIRST_CHECK_DELAY_MS, HIDDEN_RELOAD_DELAY_MS } from '../stale-bundle-policy';
import { registerUnsavedWork } from '@/lib/unsaved-work';
import { useAppStore } from '@/lib/store';

const MINE = 'aaaaaaaaaaaa';
const NEXT = 'bbbbbbbbbbbb';

let visibility: 'visible' | 'hidden' = 'visible';
let resolveRegistration: ((reg: unknown) => void) | null = null;
const postMessage = jest.fn();
const update = jest.fn(async () => undefined);
const cacheDelete = jest.fn(async () => true);
const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ sha: NEXT }) }));
const cleanups: Array<() => void> = [];
let navigate: jest.SpyInstance;
let logSpy: jest.SpyInstance;
const savedEnv = { ...process.env };

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

/** Let the service worker answer now (it was "wedged" until this call). */
async function workerAnswers() {
  expect(resolveRegistration).not.toBeNull();
  await act(async () => {
    resolveRegistration!({ update, waiting: { postMessage } });
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/** Mount, detect the new SHA, hide the tab and let the hidden delay fire. */
async function reachPreparingReload() {
  render(<StaleBundleWatcher />);
  await advance(FIRST_CHECK_DELAY_MS);
  expect(screen.queryByRole('status')).not.toBeNull();
  await setVisibility('hidden');
  await advance(HIDDEN_RELOAD_DELAY_MS);
  // The timer fired and freshReload is now waiting on getRegistration().
  expect(resolveRegistration).not.toBeNull();
  expect(navigate).not.toHaveBeenCalled();
}

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

beforeEach(() => {
  jest.useFakeTimers();
  delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  process.env.NEXT_PUBLIC_BUILD_SHA = MINE;
  visibility = 'visible';
  resolveRegistration = null;
  postMessage.mockClear();
  update.mockClear();
  cacheDelete.mockClear();
  fetchMock.mockClear();
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: () => new Promise((resolve) => { resolveRegistration = resolve; }),
    },
  });
  (globalThis as { caches?: unknown }).caches = {
    keys: async () => ['edu-shell-v41', 'edu-player-media', 'edu-shell-v40'],
    delete: cacheDelete,
  };
  navigate = jest.spyOn(pageNavigation, 'reload').mockImplementation(() => {});
  window.history.pushState({}, '', '/school-1/dashboard');
  useAppStore.setState({ overlayOpenCount: 0, isEmergencyActive: false });
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  navigate.mockRestore();
  logSpy.mockRestore();
  delete (window.navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  delete (globalThis as { caches?: unknown }).caches;
  process.env = { ...savedEnv };
});

describe('<StaleBundleWatcher /> automatic reload in flight', () => {
  it('control: a tab that stays hidden and clean reloads once the worker answers, clearing only the shell cache', async () => {
    await reachPreparingReload();
    await workerAnswers();
    expect(update).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(cacheDelete.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['edu-shell-v41', 'edu-shell-v40']);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('the operator comes back while the worker is slow: no reload, and the shell is left alone', async () => {
    await reachPreparingReload();
    await setVisibility('visible');
    await workerAnswers();
    expect(navigate).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeNull();
  });

  it('visible and hidden again while the worker is slow: the stale attempt does not reload', async () => {
    await reachPreparingReload();
    await setVisibility('visible');
    await setVisibility('hidden');
    await workerAnswers();
    expect(navigate).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
  });

  it('unsaved work that appears while the worker is slow stops the reload', async () => {
    await reachPreparingReload();
    cleanups.push(registerUnsavedWork(() => true));
    await workerAnswers();
    expect(navigate).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[dashboard-drift] automatic reload held: unsaved-work');
  });

  it('a worker that answers long after the decision (page frozen, now resuming) does not reload', async () => {
    await reachPreparingReload();
    jest.setSystemTime(Date.now() + 30 * 60_000);
    await workerAnswers();
    expect(navigate).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[dashboard-drift] automatic reload held: resumed-late');
  });
});
