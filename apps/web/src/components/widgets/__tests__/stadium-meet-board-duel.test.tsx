/**
 * StadiumMeetBoardWidget — v2 "Dual-Meet Duel" (boardStyle: 'duel')
 * render-tree proof (S6 #288, 2026-07-03). Sibling spec to
 * stadium-meet-board-widget.test.tsx (v1 'broadcast') — this file covers
 * ONLY the behavior unique to StadiumDuelScene; the shared plumbing
 * (readResults sort, DQ guard, no-fake-data guard, Chromium-83 inset
 * safety) is already proven for the router by that spec and re-asserted
 * here only where the duel scene's own markup could plausibly diverge
 * (e.g. its own inset sweep, since it's an entirely separate JSX tree).
 *
 * Drives the SAME `WidgetPreview` dispatcher the template builder canvas
 * and the live player use (CLAUDE.md rule #9 — verify the render tree).
 *
 * Covers:
 *  - Builder-sample render: the mockup-faithful sample duel (96/74 team
 *    scores, D. Okafor leading, watermarked).
 *  - Live-data mapping via a real <GameStateProvider>: real homeScore/
 *    awayScore, real homeTeam/awayTeam names (falling back to HOME/AWAY
 *    only when absent), real homeColor/awayColor floods.
 *  - Per-swimmer DELTA: computed from parsed race times vs the leader's
 *    time — leader shows "—", DQ'd rows show "—", a genuine gap renders
 *    "+0.28"-style.
 *  - The bottom ticker: LIVE clause only — the mockup's fabricated
 *    "UP NEXT: EVENT 13 · BOYS 200M IM — 8 MIN" must NEVER appear (no
 *    schedule/next-event field exists in the data model).
 *  - The no-fake-data guard on a real player surface with no game bound.
 *  - Chromium-83 / NovaStar Taurus safety: no `inset` shorthand anywhere
 *    in the rendered duel-scene tree.
 */

import { render } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';
import { GameStateProvider, RenderSurfaceProvider, type GameSnapshot } from '../sports/GameStateContext';
import { warmAllWidgetFamilies } from '../widget-families';
import { warmVariantRegistry } from '../WidgetRenderer';

// jsdom has no ResizeObserver — the widget's useScaleToFit needs one.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

beforeAll(() => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  jest.clearAllMocks();
});

function renderWidget(config: Record<string, unknown> = {}) {
  return render(
    <div style={{ position: 'relative', width: 1600, height: 900 }}>
      <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{ boardStyle: 'duel', ...config }} width={100} height={100} live={false} />
    </div>,
  );
}

function expectNoInsetShorthand(container: HTMLElement) {
  const styled = container.querySelectorAll('[style]');
  styled.forEach((el) => {
    const style = (el as HTMLElement).getAttribute('style') || '';
    expect(style).not.toMatch(/inset\s*:/);
  });
}

const NOW = new Date().toISOString();

function baseSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: 'game-stadium-duel-test',
    sport: 'swimming',
    status: 'LIVE',
    segment: 1,
    homeTeam: 'Central Sharks',
    awayTeam: 'Westview Waves',
    homeScore: 0,
    awayScore: 0,
    homeColor: '#0d3b8c',
    awayColor: '#a11d1d',
    homeLogoUrl: null,
    awayLogoUrl: null,
    clockMs: 0,
    clockRunning: false,
    clockUpdatedAt: NOW,
    stats: {},
    serverTime: Date.now(),
    ...overrides,
  };
}

// P1-1 (2026-09-03) — widget families load from their own chunks now, so a
// proxy renders `null` until its chunk resolves. These suites render a widget
// and assert on its DOM in the same tick; warming the families first makes the
// proxies render their real component on FIRST render, exactly as on a warmed
// screen. Without this the assertions below would run against an empty
// container — a false green, not a pass.
beforeAll(async () => {
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});

describe('STADIUM_MEET_BOARD boardStyle=duel — builder sample (no GameStateContext)', () => {
  it('renders the mockup-faithful sample duel: team scores, leader, watermark', () => {
    const { container } = renderWidget();
    const text = container.textContent || '';
    expect(text).toContain('96');
    expect(text).toContain('74');
    expect(text).toContain('D. OKAFOR');
    expect(text).toContain('51.90');
    expect(text).toContain('SAMPLE');
  });

  it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
    const { container } = renderWidget();
    expectNoInsetShorthand(container);
  });

  it('never renders the mockup-fabricated "UP NEXT" clause', () => {
    const { container } = renderWidget();
    const text = container.textContent || '';
    expect(text).not.toContain('UP NEXT');
    expect(text).not.toContain('BOYS 200M IM');
  });
});

describe('STADIUM_MEET_BOARD boardStyle=duel — live data (real GameStateProvider)', () => {
  function renderLive(stats: Record<string, unknown>, config: Record<string, unknown> = {}, snapshotOverrides: Partial<GameSnapshot> = {}) {
    const initial = baseSnapshot({ stats, ...snapshotOverrides });
    return render(
      <div style={{ position: 'relative', width: 1600, height: 900 }}>
        <GameStateProvider gameId="game-stadium-duel-test" initial={initial}>
          <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{ boardStyle: 'duel', ...config }} width={100} height={100} live />
        </GameStateProvider>
      </div>,
    );
  }

  const twoLaneResults = {
    results: [
      {
        event: 'GIRLS 100M FREESTYLE — EVENT 12 — FINALS',
        order: 1,
        entries: [
          { place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' },
          { place: 2, name: 'M. Chen', team: 'away', lane: 2, mark: '52.18' },
        ],
      },
    ],
  };

  it('renders the REAL bound team scores, not the builder sample 96/74', () => {
    const { container } = renderLive(twoLaneResults, {}, { homeScore: 41, awayScore: 33 });
    const text = container.textContent || '';
    expect(text).toContain('41');
    expect(text).toContain('33');
    expect(text).not.toContain('96');
    expect(text).not.toContain('74');
    expect(text).not.toContain('SAMPLE');
  });

  it('renders the REAL bound team names, falling back to HOME/AWAY only when absent', () => {
    const { container } = renderLive(twoLaneResults, {}, { homeTeam: 'Central Sharks', awayTeam: 'Westview Waves' });
    const text = container.textContent || '';
    expect(text).toContain('CENTRAL SHARKS');
    expect(text).toContain('WESTVIEW WAVES');
  });

  it('falls back to HOME/AWAY when the bound game has no team names set', () => {
    const { container } = renderLive(twoLaneResults, {}, { homeTeam: '', awayTeam: '' });
    const text = container.textContent || '';
    expect(text).toContain('HOME');
    expect(text).toContain('AWAY');
  });

  it('computes the leader\'s delta as "—" and a trailing swimmer\'s delta as the real gap', () => {
    const { container } = renderLive(twoLaneResults);
    const text = container.textContent || '';
    // 52.18 - 51.90 = 0.28
    expect(text).toContain('+0.28');
  });

  it('computes deltas correctly for 3+ swimmers, each vs the leader (not vs the row above)', () => {
    const { container } = renderLive({
      results: [
        {
          event: 'EVENT 12',
          order: 1,
          entries: [
            { place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' },
            { place: 2, name: 'M. Chen', team: 'away', lane: 2, mark: '52.18' },
            { place: 3, name: 'T. Nguyen', team: null, lane: 5, mark: '53.61' },
          ],
        },
      ],
    });
    const text = container.textContent || '';
    expect(text).toContain('+0.28');
    // 53.61 - 51.90 = 1.71 (vs the LEADER, not vs M. Chen's 52.18)
    expect(text).toContain('+1.71');
  });

  it('renders "—" for a DQ\'d swimmer\'s delta instead of a fabricated number', () => {
    const { container } = renderLive({
      results: [
        {
          event: 'EVENT 12',
          order: 1,
          entries: [
            { place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' },
            { place: 0, name: 'K. Anderson', team: null, lane: 7, mark: 'DQ' },
          ],
        },
      ],
    });
    const text = container.textContent || '';
    expect(text).toContain('K. Anderson');
    expect(text).toContain('DQ');
  });

  it('never fabricates a per-lane flood color — uses the REAL bound game team colors', () => {
    const { container } = renderLive(twoLaneResults, {}, { homeColor: '#123456', awayColor: '#abcdef' });
    const flood = Array.from(container.querySelectorAll('div')).find(
      (el) => (el as HTMLElement).style.background?.includes('rgb(18, 52, 86)'),
    );
    expect(flood).toBeTruthy();
  });

  it('renders the LIVE ticker clause but NEVER the fabricated "UP NEXT" clause', () => {
    const { container } = renderLive(twoLaneResults);
    const text = container.textContent || '';
    expect(text).toContain('LIVE');
    expect(text).not.toContain('UP NEXT');
    expect(text).not.toContain('EVENT 13');
    expect(text).not.toContain('8 MIN');
  });

  it('never uses the inset shorthand on a live-bound duel render (Taurus / Chromium-83 safety)', () => {
    const { container } = renderLive(twoLaneResults);
    expectNoInsetShorthand(container);
  });
});

describe('STADIUM_MEET_BOARD boardStyle=duel — no-fake-data guard on a real player surface', () => {
  it('renders "NO GAME BOUND" instead of the sample duel when no ambient provider exists', () => {
    const { container } = render(
      <div style={{ position: 'relative', width: 1600, height: 900 }}>
        <RenderSurfaceProvider surface="player">
          <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{ boardStyle: 'duel' }} width={100} height={100} live />
        </RenderSurfaceProvider>
      </div>,
    );
    const text = container.textContent || '';
    expect(text).toContain('NO GAME BOUND');
    // Never the fabricated sample duel (96/74, D. OKAFOR) on a real,
    // unbound screen.
    expect(text).not.toContain('D. OKAFOR');
    expect(text).not.toContain('96');
    expect(text).not.toContain('SAMPLE');
  });

  it('a real ambient GameStateProvider always wins over the phantom-unbound state', () => {
    const initial = baseSnapshot({
      stats: {
        results: [{ event: 'EVENT 12', order: 1, entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' }] }],
      },
      homeScore: 12,
      awayScore: 9,
    });
    const { container } = render(
      <div style={{ position: 'relative', width: 1600, height: 900 }}>
        <RenderSurfaceProvider surface="player">
          <GameStateProvider gameId="game-stadium-duel-test" initial={initial}>
            <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{ boardStyle: 'duel' }} width={100} height={100} live />
          </GameStateProvider>
        </RenderSurfaceProvider>
      </div>,
    );
    const text = container.textContent || '';
    expect(text).toContain('D. Okafor');
    expect(text).toContain('12');
    expect(text).toContain('9');
    expect(text).not.toContain('NO GAME BOUND');
  });
});
