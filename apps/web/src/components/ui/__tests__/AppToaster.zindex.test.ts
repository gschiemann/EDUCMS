/**
 * LIFE-SAFETY LAYERING LOCK.
 *
 * The dashboard EmergencyOverlay must never be painted over. Both it and the
 * toast host are fixed/absolute boxes that compete in the ROOT stacking
 * context (every ancestor between <body> and each of them — the root
 * layout's <main>, DashboardLayout's shell — is `position: relative` with
 * `z-index: auto`, which does NOT open a stacking context), so their raw
 * z-index values decide who wins.
 *
 * sonner's own default is 999999, which would put "That change didn't save"
 * on top of an active lockdown screen. This test reads both sources and
 * fails if that ordering is ever broken — by a sonner upgrade, a "just bump
 * the z-index so toasts show over modals" fix, or an overlay refactor.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..', '..');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

describe('toast layering vs the emergency overlay', () => {
  const overlaySrc = read(join('components', 'layout', 'EmergencyOverlay.tsx'));
  const toasterSrc = read(join('components', 'ui', 'AppToaster.tsx'));
  const bannerSrc = read(join('components', 'layout', 'ApiStatusBanner.tsx'));

  /** The z-[NN] on the overlay's root element (not the ones in prose). */
  const overlayZ = (() => {
    const line = overlaySrc
      .split('\n')
      .find((l) => l.includes('className=') && /z-\[\d+\]/.test(l) && l.includes('absolute'));
    expect(line).toBeDefined();
    return Number(/z-\[(\d+)\]/.exec(line!)![1]);
  })();

  it('the emergency overlay still declares an explicit z-index', () => {
    expect(overlayZ).toBeGreaterThan(0);
  });

  it('the toast host sits BELOW the emergency overlay', () => {
    const match = /zIndex:\s*(\d+)/.exec(toasterSrc);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeLessThan(overlayZ);
  });

  it('the reconnect banner sits BELOW the emergency overlay', () => {
    const match = /z-\[(\d+)\]/.exec(bannerSrc);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeLessThan(overlayZ);
  });

  it('never falls back to sonner\'s default z-index', () => {
    // If the explicit style is dropped, sonner's stylesheet z-index:999999999
    // takes over and the overlay loses.
    expect(toasterSrc).toMatch(/style=\{\{\s*zIndex:/);
  });
});
