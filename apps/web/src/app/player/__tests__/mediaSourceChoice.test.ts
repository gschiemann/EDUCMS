import { chooseVideoSourceKind, isLoopWrap, upgradeAvailable } from '../mediaSourceChoice';

describe('chooseVideoSourceKind', () => {
  it('always mounts the primary when there is no fallback, cached or not', () => {
    expect(chooseVideoSourceKind({ primaryCached: false, hasFallback: false })).toBe('primary');
    expect(chooseVideoSourceKind({ primaryCached: true, hasFallback: false })).toBe('primary');
  });

  it('plays the smaller copy until the native file is in the cache', () => {
    expect(chooseVideoSourceKind({ primaryCached: false, hasFallback: true })).toBe('fallback');
    expect(chooseVideoSourceKind({ primaryCached: true, hasFallback: true })).toBe('primary');
  });
});

describe('upgradeAvailable', () => {
  it('is true only for a fallback slide whose primary has since been cached', () => {
    expect(upgradeAvailable({ kind: 'fallback', primaryCached: true, hasFallback: true })).toBe(true);
    expect(upgradeAvailable({ kind: 'fallback', primaryCached: false, hasFallback: true })).toBe(false);
    expect(upgradeAvailable({ kind: 'primary', primaryCached: true, hasFallback: true })).toBe(false);
    expect(upgradeAvailable({ kind: 'fallback', primaryCached: true, hasFallback: false })).toBe(false);
  });
});

describe('isLoopWrap', () => {
  it('reads a jump back to the start as a wrap, not jitter, and not a mid-clip sync seek', () => {
    expect(isLoopWrap(29.8, 0.1)).toBe(true);
    expect(isLoopWrap(29.8, 1.4)).toBe(true);
    expect(isLoopWrap(10, 9.5)).toBe(false); // jitter
    expect(isLoopWrap(10, 10.2)).toBe(false); // forward
    expect(isLoopWrap(20, 12)).toBe(false); // a servo seek backwards, mid-clip — not a wrap
    expect(isLoopWrap(1.2, 0.1)).toBe(true);
    expect(isLoopWrap(NaN, 0)).toBe(false);
    expect(isLoopWrap(5, NaN)).toBe(false);
  });
});
