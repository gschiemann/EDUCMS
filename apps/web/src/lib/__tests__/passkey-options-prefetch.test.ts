/**
 * The passkey-options cache behind "the tap opens the sheet at once" (Safari
 * user-activation fix, 2026-10-11). Pure — a fake fetcher and a fake clock.
 */
import {
  createPasskeyOptionsCache,
  isLikelyExpiredActivation,
  PASSKEY_OPTIONS_MAX_AGE_MS,
  type PasskeyOptionsReply,
} from '../passkey-options-prefetch';

/** A fetcher whose replies the test resolves by hand. */
function manualFetcher() {
  const pending: Array<{ key: string; resolve: (r: PasskeyOptionsReply) => void; reject: (e: unknown) => void }> = [];
  const fetcher = jest.fn(
    (key: string) =>
      new Promise<PasskeyOptionsReply>((resolve, reject) => {
        pending.push({ key, resolve, reject });
      }),
  );
  return { fetcher, pending };
}

const ok = (challenge: string): PasskeyOptionsReply => ({ ok: true, status: 200, data: { options: { challenge } } });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createPasskeyOptionsCache', () => {
  let clock = 1_000_000;
  const now = () => clock;
  beforeEach(() => { clock = 1_000_000; });

  it('prefetch → take hands the options out SYNCHRONOUSLY, once', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok');
    expect(cache.take('tok')).toBeNull(); // not landed yet
    pending[0].resolve(ok('c1'));
    await flush();
    const got = cache.take('tok');
    expect(got?.data.options.challenge).toBe('c1');
    // One-time: a challenge can be answered once.
    expect(cache.take('tok')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never hands out options older than the limit (server TTL is 5 min)', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok');
    pending[0].resolve(ok('c1'));
    await flush();
    clock += PASSKEY_OPTIONS_MAX_AGE_MS + 1;
    expect(cache.hasFresh('tok')).toBe(false);
    expect(cache.take('tok')).toBeNull();
  });

  it('refreshIfStale re-fetches only when nothing fresh is held', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok');
    pending[0].resolve(ok('c1'));
    await flush();
    cache.refreshIfStale('tok');
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += PASSKEY_OPTIONS_MAX_AGE_MS + 1;
    cache.refreshIfStale('tok');
    expect(fetcher).toHaveBeenCalledTimes(2);
    pending[1].resolve(ok('c2'));
    await flush();
    expect(cache.take('tok')?.data.options.challenge).toBe('c2');
  });

  it('a refused request is not re-sent on every focus — at most every 30 s', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok');
    pending[0].resolve({ ok: false, status: 429, data: {} });
    await flush();
    clock += 5_000;
    cache.refreshIfStale('tok');
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 30_000;
    cache.refreshIfStale('tok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('never runs two requests at once for the same key', () => {
    const { fetcher } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok');
    cache.prefetch('tok');
    cache.refreshIfStale('tok');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('is keyed: options for one sign-in attempt are never used for another', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok-A');
    pending[0].resolve(ok('A'));
    await flush();
    expect(cache.take('tok-B')).toBeNull();
    cache.prefetch('tok-B'); // a new attempt drops A's options
    expect(cache.take('tok-A')).toBeNull();
  });

  it('a refused or unreachable request stores nothing', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok');
    pending[0].resolve({ ok: false, status: 429, data: {} });
    await flush();
    expect(cache.take('tok')).toBeNull();
    cache.prefetch('tok');
    pending[1].reject(new TypeError('Failed to fetch'));
    await flush();
    expect(cache.take('tok')).toBeNull();
  });

  it('while a ceremony runs NO options request is made (it would replace the per-user challenge)', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok');
    pending[0].resolve(ok('c1'));
    await flush();
    expect(cache.take('tok')).not.toBeNull();
    const ticket = cache.begin();
    cache.prefetch('tok');
    cache.refreshIfStale('tok');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.end(ticket)).toBe(true);
    // Consumed → re-prefetch for the next tap.
    cache.prefetch('tok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('a superseded tap does not unlock the cache under the newer one', () => {
    const { fetcher } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    const first = cache.begin();
    const second = cache.begin();
    expect(cache.end(first)).toBe(false);
    cache.prefetch('tok');
    expect(fetcher).not.toHaveBeenCalled();
    expect(cache.end(second)).toBe(true);
    cache.prefetch('tok');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('acquire waits for the prefetch already in flight instead of racing it', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok');
    const got = cache.acquire('tok');
    expect(fetcher).toHaveBeenCalledTimes(1);
    pending[0].resolve(ok('c1'));
    expect((await got).data.options.challenge).toBe('c1');
    // …and the caller owns it: it is NOT also stored for a later take.
    await flush();
    expect(cache.take('tok')).toBeNull();
  });

  it('acquire with nothing in flight makes the request itself', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    const got = cache.acquire('tok');
    expect(fetcher).toHaveBeenCalledWith('tok');
    pending[0].resolve({ ok: false, status: 401, data: { code: 'MFA_TOKEN_INVALID' } });
    expect((await got).data.code).toBe('MFA_TOKEN_INVALID');
  });

  it('reset discards a result that lands afterwards', async () => {
    const { fetcher, pending } = manualFetcher();
    const cache = createPasskeyOptionsCache(fetcher, { now });
    cache.prefetch('tok');
    cache.reset();
    pending[0].resolve(ok('late'));
    await flush();
    expect(cache.take('tok')).toBeNull();
  });
});

describe('isLikelyExpiredActivation', () => {
  it('only a fast NotAllowedError on the fetch-first path', () => {
    expect(isLikelyExpiredActivation('NotAllowedError', false, 30)).toBe(true);
    // Prefetched: the tap had its activation — a refusal is the person's.
    expect(isLikelyExpiredActivation('NotAllowedError', true, 30)).toBe(false);
    // A sheet that was up for seconds was seen and closed.
    expect(isLikelyExpiredActivation('NotAllowedError', false, 5_000)).toBe(false);
    expect(isLikelyExpiredActivation('AbortError', false, 30)).toBe(false);
    expect(isLikelyExpiredActivation('SecurityError', false, 30)).toBe(false);
  });
});
