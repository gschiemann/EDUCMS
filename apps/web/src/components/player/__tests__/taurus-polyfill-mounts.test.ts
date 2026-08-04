/**
 * Taurus polyfill coverage (2026-08-03).
 *
 * The flex-`gap` and container-query-unit polyfills for Chromium 83/95/101
 * (NovaStar Taurus LED controllers) mounted in exactly ONE place: a useEffect
 * inside `apps/web/src/app/player/page.tsx`.
 *
 * But `/board`, `/ribbon` and `/scorebug` render the SAME widget tree, and the
 * repo's own gate says so: `apps/web/tools/check-taurus-safety.cjs` lists all
 * three route dirs in `SCAN_DIRS` under "Lane-6 P0: sports surfaces also
 * render on Taurus". So the gate policed those routes for Chromium-83
 * landmines while the runtime fixes for that exact browser never loaded there
 * — a scoreboard reached by its standalone URL on a Taurus wall lost every
 * flex `gap` and every container-query unit.
 *
 * Static-source assertions: a runtime test would need a Chromium-83 UA and a
 * real layout pass. What must not regress is that each surface MOUNTS the
 * thing, and that there is only ONE implementation to keep in step.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.join(__dirname, '..', '..', '..', 'app');
const COMPONENT = path.join(__dirname, '..', 'TaurusPolyfills.tsx');
const read = (...p: string[]) => fs.readFileSync(path.join(...p), 'utf8');

const SPORTS_LAYOUTS: Array<[route: string, file: string]> = [
  ['/board', path.join(APP, 'board', '[gameId]', 'layout.tsx')],
  ['/ribbon', path.join(APP, 'ribbon', '[gameId]', 'layout.tsx')],
  ['/scorebug', path.join(APP, 'scorebug', '[gameId]', 'layout.tsx')],
];

describe('Taurus polyfills reach every surface that renders the widget tree', () => {
  it.each(SPORTS_LAYOUTS)('%s mounts <TaurusPolyfills />', (_route, file) => {
    const s = fs.readFileSync(file, 'utf8');
    expect(s).toMatch(/from '@\/components\/player\/TaurusPolyfills'/);
    expect(s).toMatch(/<TaurusPolyfills\s*\/>/);
  });

  it('the player uses the same hoisted implementation, not its own copy', () => {
    const s = read(APP, 'player', 'page.tsx');
    expect(s).toMatch(/useTaurusPolyfills\(\)/);
    // The inline duplicate is gone — one implementation, no drift.
    expect(s).not.toMatch(/applyFlexGapPolyfill/);
    expect(s).not.toMatch(/applyCqUnitPolyfill/);
  });

  it('the shared component gates BOTH polyfills independently', () => {
    // Different cutoffs: flex `gap` is Chrome 84, container-query units are
    // Chrome 105 — a Chrome 95 box supports gap but NOT cq units, so a single
    // combined check would miss the 95/101 boxes.
    const s = read(COMPONENT);
    expect(s).toMatch(/const needsGap = !isFlexGapSupported\(\)/);
    expect(s).toMatch(/const needsCq = !isCqUnitSupported\(\)/);
    expect(s).toMatch(/if \(!needsGap && !needsCq\) return;/);
  });

  it('is a hard no-op on a modern engine (no timer scheduled before the gate)', () => {
    const s = read(COMPONENT);
    const gate = s.indexOf('if (!needsGap && !needsCq) return;');
    expect(gate).toBeGreaterThan(-1);
    // Nothing may be scheduled above the early return.
    expect(s.slice(0, gate)).not.toMatch(/setInterval|requestAnimationFrame/);
  });

  it('never breaks playback — every polyfill call is wrapped', () => {
    const s = read(COMPONENT);
    expect(s).toMatch(/try \{ applyFlexGapPolyfill\(\); \} catch/);
    expect(s).toMatch(/try \{ applyCqUnitPolyfill\(\); \} catch/);
  });

  it('introduces no `inset` shorthand or Tailwind inset-* (CLAUDE.md rule #10)', () => {
    // The pattern is ASSEMBLED, not written as a literal: check-taurus-safety
    // scans components/player, so a literal would make this very test a
    // "regression" in the gate that shares its purpose.
    const shorthand = new RegExp(['inset', ':\\s*0', '|', 'inset', '(-x|-y)?-[0-9]'].join(''));
    const files = [COMPONENT, ...SPORTS_LAYOUTS.map(([, f]) => f)];
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      expect({ f, hit: shorthand.test(s) }).toEqual({ f, hit: false });
    }
  });
});
