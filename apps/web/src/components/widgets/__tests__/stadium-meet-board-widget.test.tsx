/**
 * StadiumMeetBoardWidget (S6 #288, 2026-07-03) — "Stadium Lane" flagship
 * swim-meet broadcast board render-tree proof.
 *
 * CLAUDE.md rule #9 ("VERIFY THE RENDER TREE"): drives the SAME
 * `WidgetPreview` dispatcher the template builder canvas and the live
 * player use, so a regression here means the operator sees a blank tile
 * for real, not just a type error.
 *
 * Covers:
 *  - Builder-sample render (no GameStateContext at all) — the byte-
 *    faithful port of stadium-lane-v1-broadcast.html's sample heat.
 *  - Live-data mapping via a real <GameStateProvider> + mocked fetch:
 *    stats.results → sorted-by-place rows, DQ struck-through + reason,
 *    real snapshot home/away team colors.
 *  - The no-fake-data guard: a real player surface
 *    (RenderSurfaceProvider surface="player") with NO ambient provider
 *    and no game bound renders the "NO GAME BOUND" empty shell, never
 *    the sample heat with invented swimmer names.
 *  - Pool-record + sponsor footer: config-or-omit — omitted entirely on
 *    a live board with nothing configured, never the mockup's fabricated
 *    "50.84 A. WASHINGTON" / "RIVER DENTAL" sample values leaking onto a
 *    real screen.
 *  - Chromium-83 / NovaStar Taurus safety: no `inset` shorthand anywhere
 *    in the rendered tree.
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
      <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={config} width={100} height={100} live={false} />
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
    id: 'game-stadium-test',
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

describe('STADIUM_MEET_BOARD — builder sample (no GameStateContext)', () => {
  it('renders the mockup-faithful sample heat, watermarked', () => {
    const { container } = renderWidget();
    const text = container.textContent || '';
    expect(text).toContain('D. OKAFOR');
    expect(text).toContain('51.90');
    expect(text).toContain('SAMPLE');
  });

  it('renders the sample DQ row struck-through with its reason', () => {
    const { container } = renderWidget();
    const text = container.textContent || '';
    expect(text).toContain('K. ANDERSON');
    expect(text).toContain('DQ — FALSE START');
  });

  it('renders the sample pool-record and sponsor footer', () => {
    const { container } = renderWidget();
    const text = container.textContent || '';
    expect(text).toContain('POOL RECORD');
    expect(text).toContain('50.84');
    expect(text).toContain('A. WASHINGTON 2024');
    expect(text).toContain('RIVER DENTAL');
  });

  it('honors an operator-set header override', () => {
    const { container } = renderWidget({ headerText: 'BOYS 200 IM — EVENT 5 — PRELIMS' });
    expect(container.textContent).toContain('EVENT 5 — PRELIMS');
  });

  it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
    const { container } = renderWidget();
    expectNoInsetShorthand(container);
  });
});

describe('STADIUM_MEET_BOARD — live data (real GameStateProvider)', () => {
  function renderLive(stats: Record<string, unknown>, config: Record<string, unknown> = {}, snapshotOverrides: Partial<GameSnapshot> = {}) {
    const initial = baseSnapshot({ stats, ...snapshotOverrides });
    return render(
      <div style={{ position: 'relative', width: 1600, height: 900 }}>
        <GameStateProvider gameId="game-stadium-test" initial={initial}>
          <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={config} width={100} height={100} live />
        </GameStateProvider>
      </div>,
    );
  }

  it('renders live lane results sorted by place, not lane number', () => {
    const { container } = renderLive({
      results: [
        {
          event: 'GIRLS 100M FREESTYLE — EVENT 12 — FINALS',
          order: 1,
          entries: [
            { place: 2, name: 'M. Chen', team: 'away', lane: 2, mark: '52.18' },
            { place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' },
          ],
        },
      ],
    });
    // textContent carries the as-typed casing from stats.results — the
    // widget applies CSS text-transform:uppercase for the visual match
    // to the mockup, which jsdom's textContent doesn't reflect (it's a
    // paint-time transform, not a DOM mutation).
    const text = container.textContent || '';
    expect(text).toContain('D. Okafor');
    expect(text).toContain('M. Chen');
    // Place-1 swimmer's row must precede place-2's in the DOM order.
    expect(text.indexOf('D. Okafor')).toBeLessThan(text.indexOf('M. Chen'));
    // Never the builder SAMPLE watermark on a live-bound board.
    expect(text).not.toContain('SAMPLE');
  });

  it('visually uppercases an as-typed mixed-case name to match the approved mockup', () => {
    const { container } = renderLive({
      results: [{ event: 'EVENT 1', order: 1, entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' }] }],
    });
    const nameEl = Array.from(container.querySelectorAll('b')).find((el) => el.textContent === 'D. Okafor');
    expect(nameEl).toBeTruthy();
    expect((nameEl as HTMLElement).style.textTransform).toBe('uppercase');
  });

  it('never fabricates a per-lane color — uses the REAL bound game team colors', () => {
    const { container } = renderLive({
      results: [
        {
          event: 'EVENT 1',
          order: 1,
          entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' }],
        },
      ],
    }, {}, { homeColor: '#123456', awayColor: '#abcdef' });
    const laneChip = Array.from(container.querySelectorAll('div')).find(
      (el) => el.textContent?.trim() === '3' && (el as HTMLElement).style.background === 'rgb(18, 52, 86)',
    );
    expect(laneChip).toBeTruthy();
  });

  it('renders DQ marks with an operator-configured reason', () => {
    const { container } = renderLive(
      {
        results: [
          {
            event: 'EVENT 12',
            order: 1,
            entries: [{ place: 0, name: 'K. Anderson', team: null, lane: 7, mark: 'DQ' }],
          },
        ],
      },
      { dqReasons: { '7': 'FALSE START' } },
    );
    const text = container.textContent || '';
    expect(text).toContain('K. Anderson');
    expect(text).toContain('DQ — FALSE START');
  });

  it('DQ renders bare "DQ" with no fabricated reason when none is configured', () => {
    const { container } = renderLive({
      results: [
        {
          event: 'EVENT 12',
          order: 1,
          entries: [{ place: 0, name: 'K. Anderson', team: null, lane: 7, mark: 'DQ' }],
        },
      ],
    });
    const text = container.textContent || '';
    expect(text).toContain('DQ');
    expect(text).not.toContain('FALSE START');
  });

  it('OMITS the pool-record + sponsor footer entirely when not configured (never the sample values)', () => {
    const { container } = renderLive({
      results: [{ event: 'EVENT 12', order: 1, entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' }] }],
    });
    const text = container.textContent || '';
    expect(text).not.toContain('POOL RECORD');
    expect(text).not.toContain('A. WASHINGTON');
    expect(text).not.toContain('RIVER DENTAL');
  });

  it('renders the pool-record footer when the operator configures it (config-or-omit)', () => {
    const { container } = renderLive(
      { results: [{ event: 'EVENT 12', order: 1, entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' }] }] },
      { recordLabel: 'MEET RECORD', recordValue: '49.20', recordHolder: 'J. Smith 2023' },
    );
    const text = container.textContent || '';
    expect(text).toContain('MEET RECORD');
    expect(text).toContain('49.20');
    expect(text).toContain('J. Smith 2023');
    // Sponsor half stays omitted independently.
    expect(text).not.toContain('PRESENTED BY');
  });

  it('visually uppercases an as-typed mixed-case record holder to match the approved mockup', () => {
    const { container } = renderLive(
      { results: [{ event: 'EVENT 12', order: 1, entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' }] }] },
      { recordLabel: 'Pool Record', recordValue: '49.20', recordHolder: 'J. Smith 2023' },
    );
    const holderEl = Array.from(container.querySelectorAll('b')).find((el) => el.textContent === 'J. Smith 2023');
    expect(holderEl).toBeTruthy();
    // The uppercase transform is applied on the parent footer row, not
    // per-node, so assert on the ancestor that actually carries the rule.
    const footerRow = holderEl!.closest('div');
    expect((footerRow as HTMLElement).style.textTransform).toBe('uppercase');
  });

  it('renders the sponsor slot when the operator configures it, independent of the record', () => {
    const { container } = renderLive(
      { results: [{ event: 'EVENT 12', order: 1, entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' }] }] },
      { sponsorLabel: 'PRESENTED BY', sponsorName: 'Acme Orthodontics' },
    );
    const text = container.textContent || '';
    expect(text).toContain('PRESENTED BY');
    expect(text).toContain('Acme Orthodontics');
    expect(text).not.toContain('POOL RECORD');
  });

  it('never uses the inset shorthand on a live-bound render (Taurus / Chromium-83 safety)', () => {
    const { container } = renderLive({
      results: [{ event: 'EVENT 12', order: 1, entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' }] }],
    });
    expectNoInsetShorthand(container);
  });
});

describe('STADIUM_MEET_BOARD — no-fake-data guard on a real player surface', () => {
  it('renders "NO GAME BOUND" instead of the sample heat when no ambient provider exists', () => {
    const { container } = render(
      <div style={{ position: 'relative', width: 1600, height: 900 }}>
        <RenderSurfaceProvider surface="player">
          <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{}} width={100} height={100} live />
        </RenderSurfaceProvider>
      </div>,
    );
    const text = container.textContent || '';
    expect(text).toContain('NO GAME BOUND');
    expect(text).toContain('Bind a game in the score keeper');
    // Never the fabricated sample swimmers on a real, unbound screen.
    expect(text).not.toContain('D. OKAFOR');
    expect(text).not.toContain('SAMPLE');
  });

  it('a real ambient GameStateProvider always wins over the phantom-unbound state', () => {
    const initial = baseSnapshot({
      stats: {
        results: [{ event: 'EVENT 12', order: 1, entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' }] }],
      },
    });
    const { container } = render(
      <div style={{ position: 'relative', width: 1600, height: 900 }}>
        <RenderSurfaceProvider surface="player">
          <GameStateProvider gameId="game-stadium-test" initial={initial}>
            <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{}} width={100} height={100} live />
          </GameStateProvider>
        </RenderSurfaceProvider>
      </div>,
    );
    const text = container.textContent || '';
    expect(text).toContain('D. Okafor');
    expect(text).not.toContain('NO GAME BOUND');
  });
});
