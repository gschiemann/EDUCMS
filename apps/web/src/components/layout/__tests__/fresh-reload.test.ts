/**
 * freshReload — the reload that clears the dashboard's stale shell first.
 *
 * Pinned:
 *   - it updates the service worker, tells a waiting worker to take over and
 *     deletes ONLY the dashboard shell caches (edu-shell-*); the player's
 *     offline store on the same origin is never touched;
 *   - any failure on the way still reloads (the operator is never stuck);
 *   - with a re-check (automatic reloads), a "no" or a throw stops it before
 *     the shell is changed or the page navigates.
 */
import { freshReload, pageNavigation } from '../fresh-reload';

const update = jest.fn(async () => undefined);
const postMessage = jest.fn();
const cacheDelete = jest.fn(async () => true);
let navigate: jest.SpyInstance;

function stubWorker(getRegistration: () => Promise<unknown>) {
  Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: { getRegistration } });
}

function stubCaches(keys: () => Promise<string[]>) {
  (globalThis as { caches?: unknown }).caches = { keys, delete: cacheDelete };
}

beforeEach(() => {
  update.mockClear();
  postMessage.mockClear();
  cacheDelete.mockClear();
  navigate = jest.spyOn(pageNavigation, 'reload').mockImplementation(() => {});
  stubWorker(async () => ({ update, waiting: { postMessage } }));
  stubCaches(async () => ['edu-shell-v41', 'edu-player-media', 'edu-player-emergency', 'edu-shell-v40']);
});

afterEach(() => {
  navigate.mockRestore();
  delete (window.navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  delete (globalThis as { caches?: unknown }).caches;
});

const deleted = () => cacheDelete.mock.calls.map((c) => (c as unknown[])[0]);

describe('freshReload', () => {
  it('updates the worker, activates a waiting one, clears only edu-shell-* and reloads', async () => {
    await expect(freshReload()).resolves.toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(deleted()).toEqual(['edu-shell-v41', 'edu-shell-v40']);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('still reloads when the worker lookup fails', async () => {
    stubWorker(() => Promise.reject(new Error('wedged')));
    await expect(freshReload()).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('still reloads when CacheStorage fails', async () => {
    stubCaches(() => Promise.reject(new Error('blocked')));
    await expect(freshReload()).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('still reloads with no service worker and no CacheStorage', async () => {
    delete (window.navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    delete (globalThis as { caches?: unknown }).caches;
    await expect(freshReload()).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('reloads when the re-check says yes every time it is asked', async () => {
    const recheck = jest.fn(() => true);
    await expect(freshReload(recheck)).resolves.toBe(true);
    expect(recheck).toHaveBeenCalledTimes(3);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('a "no" after the worker answers changes nothing and does not reload', async () => {
    await expect(freshReload(() => false)).resolves.toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a "no" just before the navigation does not reload', async () => {
    let asked = 0;
    await expect(freshReload(() => ++asked < 3)).resolves.toBe(false);
    expect(deleted()).toEqual(['edu-shell-v41', 'edu-shell-v40']);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a re-check that throws counts as "no", even after a failed step', async () => {
    stubCaches(() => Promise.reject(new Error('blocked')));
    let asked = 0;
    const recheck = () => {
      asked += 1;
      if (asked > 1) throw new Error('unreadable');
      return true;
    };
    await expect(freshReload(recheck)).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
