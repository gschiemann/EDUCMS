/**
 * Deploy-skew recovery (2026-10-27): the reload decision and the inline
 * script, both as SHIPPED bytes.
 */
import {
  decideSkewRecovery,
  SKEW_AFTER_LOAD_MS,
  SKEW_BACKOFF_MS,
  SKEW_ERROR_GRACE_MS,
  SKEW_LADDER_RESET_MS,
  SKEW_MIN_SINCE_START_MS,
  SKEW_REFETCH_BUDGET_MS,
  SKEW_RECOVERY_INLINE_JS,
  SKEW_RECOVERY_KEY,
} from '../skewRecovery';

const T0 = 1_800_000_000_000;

describe('decideSkewRecovery — one clean reload, then back off', () => {
  it('no ladder → reload now, attempt 1', () => {
    expect(decideSkewRecovery(null, T0)).toEqual({ action: 'reload', next: { n: 1, last: T0 } });
  });

  it('after the first reload → wait 2 min, then reload again', () => {
    const s = { n: 1, last: T0 };
    expect(decideSkewRecovery(s, T0 + 30_000)).toEqual({ action: 'wait', waitMs: SKEW_BACKOFF_MS[0] - 30_000 });
    expect(decideSkewRecovery(s, T0 + SKEW_BACKOFF_MS[0])).toEqual({ action: 'reload', next: { n: 2, last: T0 + SKEW_BACKOFF_MS[0] } });
  });

  it('ladder 2 → 10 min, 3 and beyond → 30 min (never shorter)', () => {
    expect(decideSkewRecovery({ n: 2, last: T0 }, T0 + 1)).toEqual({ action: 'wait', waitMs: SKEW_BACKOFF_MS[1] - 1 });
    expect(decideSkewRecovery({ n: 3, last: T0 }, T0 + 1)).toEqual({ action: 'wait', waitMs: SKEW_BACKOFF_MS[2] - 1 });
    expect(decideSkewRecovery({ n: 40, last: T0 }, T0 + 1)).toEqual({ action: 'wait', waitMs: SKEW_BACKOFF_MS[2] - 1 });
  });

  it('a ladder from long ago, or from the future (clock stepped back), starts fresh', () => {
    expect(decideSkewRecovery({ n: 5, last: T0 - SKEW_LADDER_RESET_MS - 1 }, T0)).toMatchObject({ action: 'reload', next: { n: 1 } });
    expect(decideSkewRecovery({ n: 5, last: T0 + 60_000 }, T0)).toMatchObject({ action: 'reload', next: { n: 1 } });
  });

  it('garbage state is treated as no ladder', () => {
    expect(decideSkewRecovery({ n: NaN, last: NaN } as never, T0)).toMatchObject({ action: 'reload', next: { n: 1 } });
    expect(decideSkewRecovery({ n: -3, last: T0 } as never, T0)).toMatchObject({ action: 'reload', next: { n: 1 } });
  });

  it('no sequence of failed boots reloads faster than the ladder allows (no loop)', () => {
    let state: { n: number; last: number } | null = null;
    let now = T0;
    const reloads: number[] = [];
    // A page that never boots, re-checked every second for 3 hours.
    for (let i = 0; i < 3 * 3600; i++, now += 1000) {
      const d = decideSkewRecovery(state, now);
      if (d.action === 'reload') { reloads.push(now); state = d.next; }
    }
    // 0 s, 2 min, +10 min, then every 30 min.
    expect(reloads.length).toBeLessThanOrEqual(3 + Math.ceil((3 * 3600_000) / SKEW_BACKOFF_MS[2]));
    for (let i = 1; i < reloads.length; i++) expect(reloads[i] - reloads[i - 1]).toBeGreaterThanOrEqual(SKEW_BACKOFF_MS[0]);
  });

  it('the inline script is plain ES5 (Chromium 83) — no arrow, let/const, template, class', () => {
    expect(SKEW_RECOVERY_INLINE_JS).not.toMatch(/=>|\blet\s|\bconst\s|`|\bclass\s/);
    expect(() => new Function(SKEW_RECOVERY_INLINE_JS)).not.toThrow();
  });
});

describe('inline script — triggers', () => {
  let replaced: string[];
  let loc: { href: string; search: string; replace: (u: string) => void; reload: () => void };

  // jsdom's location cannot be replaced; the script reads `location` as a free
  // identifier, so a parameter of that name stands in for it.
  function run() {
    new Function('location', SKEW_RECOVERY_INLINE_JS)(loc);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    localStorage.clear();
    document.documentElement.removeAttribute('data-edu-booted');
    // Per-test sink: listeners a previous test's script left on `window`
    // still hold the previous test's stand-in, never this one.
    const mine: string[] = [];
    replaced = mine;
    loc = {
      href: 'https://venue-os.app/player?client=android&token=t',
      search: '?client=android&token=t',
      replace: (u: string) => { mine.push(u); },
      reload: () => { mine.push('reload'); },
    };
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function failChunk() {
    const s = document.createElement('script');
    s.src = 'https://venue-os.app/_next/static/immutable/chunks/abc.js';
    document.head.appendChild(s);
    s.dispatchEvent(new Event('error'));
  }

  it('a /_next/static script error before boot → ONE cache-busted reload, APK params kept', () => {
    run();
    failChunk();
    failChunk();
    jest.advanceTimersByTime(SKEW_ERROR_GRACE_MS + 10);
    expect(replaced).toHaveLength(1);
    const u = new URL(replaced[0]);
    expect(u.searchParams.get('client')).toBe('android');
    expect(u.searchParams.get('token')).toBe('t');
    expect(u.searchParams.get('_v')).toBe(String(T0 + SKEW_ERROR_GRACE_MS));
    expect(JSON.parse(localStorage.getItem(SKEW_RECOVERY_KEY)!)).toMatchObject({ n: 1 });
  });

  it('the failed build file is re-fetched past every cache BEFORE the reload; a hung re-fetch is bounded', async () => {
    const calls: Array<{ url: string; cache?: string }> = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = (url: string, init?: { cache?: string }) => {
      calls.push({ url, cache: init?.cache });
      return new Promise(() => { /* never settles */ });
    };
    try {
      run();
      failChunk();
      jest.advanceTimersByTime(SKEW_ERROR_GRACE_MS + 10);
      expect(calls).toEqual([{ url: 'https://venue-os.app/_next/static/immutable/chunks/abc.js', cache: 'reload' }]);
      expect(replaced).toHaveLength(0);
      jest.advanceTimersByTime(SKEW_REFETCH_BUDGET_MS);
      expect(replaced).toHaveLength(1);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = realFetch;
    }
  });

  it('the reloaded document failing again waits for the backoff instead of reloading', () => {
    localStorage.setItem(SKEW_RECOVERY_KEY, JSON.stringify({ n: 1, last: T0 }));
    run();
    failChunk();
    jest.advanceTimersByTime(SKEW_ERROR_GRACE_MS + 60_000);
    expect(replaced).toHaveLength(0);
    jest.advanceTimersByTime(SKEW_BACKOFF_MS[0]);
    expect(replaced).toHaveLength(1);
  });

  it('loaded but never booted → the backstop reloads (no error needed)', () => {
    run();
    window.dispatchEvent(new Event('load'));
    jest.advanceTimersByTime(Math.max(SKEW_AFTER_LOAD_MS, SKEW_MIN_SINCE_START_MS) + 2_100);
    expect(replaced).toHaveLength(1);
  });

  it('NEGATIVE CONTROL: a page that boots never reloads, and clears the ladder', () => {
    localStorage.setItem(SKEW_RECOVERY_KEY, JSON.stringify({ n: 1, last: T0 - 1 }));
    run();
    document.documentElement.setAttribute('data-edu-booted', '1');
    window.dispatchEvent(new Event('load'));
    failChunk(); // a lazy chunk failing AFTER boot is not this module's case
    jest.advanceTimersByTime(60 * 60_000);
    expect(replaced).toHaveLength(0);
    expect(localStorage.getItem(SKEW_RECOVERY_KEY)).toBeNull();
  });

  it('NEGATIVE CONTROL: still loading (slow link) → no reload', () => {
    const rs = jest.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    try {
      run();
      jest.advanceTimersByTime(5 * 60_000); // `load` never fired
    } finally {
      rs.mockRestore();
    }
    expect(replaced).toHaveLength(0);
  });

  it('a non-build script error is ignored', () => {
    run();
    const s = document.createElement('script');
    s.src = 'https://cdn.example.com/widget.js';
    document.head.appendChild(s);
    s.dispatchEvent(new Event('error'));
    jest.advanceTimersByTime(SKEW_ERROR_GRACE_MS + 10);
    expect(replaced).toHaveLength(0);
  });

  it('preview tiles never reload', () => {
    loc.search = '?preview=1';
    run();
    failChunk();
    jest.advanceTimersByTime(SKEW_ERROR_GRACE_MS + 10);
    expect(replaced).toHaveLength(0);
  });

  it('storage that cannot persist → never reloads automatically (a backoff it cannot keep would be a loop)', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      run();
      failChunk();
      window.dispatchEvent(new Event('load'));
      jest.advanceTimersByTime(10 * 60_000);
      expect(replaced).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
