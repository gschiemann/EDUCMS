/**
 * StadiumMeetBoardWidget — v3 "Record Chase" (boardStyle: 'chase')
 * render-tree proof (S6 #288, 2026-07-03). Sibling spec to
 * stadium-meet-board-widget.test.tsx (v1 'broadcast') and
 * stadium-meet-board-duel.test.tsx (v2 'duel') — this file covers ONLY
 * the behavior unique to StadiumChaseScene; the shared plumbing
 * (readResults sort, DQ guard, no-fake-data guard, Chromium-83 inset
 * safety) is already proven for the router by those specs and re-asserted
 * here only where the chase scene's own markup could plausibly diverge
 * (e.g. its own inset sweep, since it's an entirely separate JSX tree).
 *
 * Drives the SAME `WidgetPreview` dispatcher the template builder canvas
 * and the live player use (CLAUDE.md rule #9 — verify the render tree).
 *
 * Covers:
 *  - Builder-sample render: the mockup-faithful sample chase (race clock
 *    from the leader's mark, sample pool-record card, watermarked).
 *  - Live-data mapping via a real <GameStateProvider>: the race clock is
 *    the REAL leader's finish time (never a fabricated running clock);
 *    the pool-record card is OMITTED with no config (never the mockup's
 *    fabricated "50.84 A. WASHINGTON"); when configured, the progress
 *    bar + gap line are computed from real data.
 *  - Team-score chip: real homeScore/awayScore/homeTeam/awayTeam.
 *  - The no-fake-data guard on a real player surface with no game bound.
 *  - Chromium-83 / NovaStar Taurus safety: no `inset` shorthand anywhere
 *    in the rendered chase-scene tree.
 */

import { render } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';
import { GameStateProvider, RenderSurfaceProvider, type GameSnapshot } from '../sports/GameStateContext';

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
      <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{ boardStyle: 'chase', ...config }} width={100} height={100} live={false} />
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
    id: 'game-stadium-chase-test',
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

describe('STADIUM_MEET_BOARD boardStyle=chase — builder sample (no GameStateContext)', () => {
  it('renders the mockup-faithful sample chase: race clock, ladder leader, record card, watermark', () => {
    const { container } = renderWidget();
    const text = container.textContent || '';
    // Race clock is the leader's finish time, trimmed to one decimal
    // (mockup: "51.9" from a 51.90 mark).
    expect(text).toContain('51.9');
    expect(text).toContain('D. OKAFOR');
    expect(text).toContain('51.90');
    expect(text).toContain('SAMPLE');
  });

  it('renders the sample pool-record-chase card with the mockup "POOL RECORD CHASE" label', () => {
    const { container } = renderWidget();
    const text = container.textContent || '';
    // The chase card's default label is "POOL RECORD CHASE" (matches
    // stadium-lane-v3-chase.png), not v1's shorter "POOL RECORD".
    expect(text).toContain('POOL RECORD CHASE');
    expect(text).toContain('50.84');
    expect(text).toContain('A. WASHINGTON');
  });

  it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
    const { container } = renderWidget();
    expectNoInsetShorthand(container);
  });
});

describe('STADIUM_MEET_BOARD boardStyle=chase — live data (real GameStateProvider)', () => {
  function renderLive(stats: Record<string, unknown>, config: Record<string, unknown> = {}, snapshotOverrides: Partial<GameSnapshot> = {}) {
    const initial = baseSnapshot({ stats, ...snapshotOverrides });
    return render(
      <div style={{ position: 'relative', width: 1600, height: 900 }}>
        <GameStateProvider gameId="game-stadium-chase-test" initial={initial}>
          <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{ boardStyle: 'chase', ...config }} width={100} height={100} live />
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

  it('renders the REAL leader finish time as the race clock, not a fabricated running clock', () => {
    const { container } = renderLive(twoLaneResults);
    const text = container.textContent || '';
    expect(text).toContain('51.9');
    expect(text).not.toContain('SAMPLE');
  });

  it('makes the EVENT NAME the giant hero headline and the ROUND the LIVE pill (matches the mockup, inverse of v1/v2)', () => {
    // Canonical mockup event string: "EVENT <n> · <name> — <round>".
    const { container } = renderLive({
      currentEvent: 'EVENT 12 · GIRLS 100M FREESTYLE — FINALS',
      ...twoLaneResults,
    });
    // Hero <h1> = the bare event NAME (event-number prefix + round stripped).
    const hero = Array.from(container.querySelectorAll('h1')).find((el) => (el.textContent || '').includes('GIRLS 100M FREESTYLE'));
    expect(hero).toBeTruthy();
    expect(hero!.textContent).toBe('GIRLS 100M FREESTYLE');
    // The LIVE pill's trailing text = the round/session ("FINALS"), NOT the
    // event name. Match the innermost pill element (textContent EQUALS the
    // pill string), not an ancestor rail container that merely starts with it.
    const pill = Array.from(container.querySelectorAll('div')).find((el) => el.textContent === '● LIVE — FINALS');
    expect(pill).toBeTruthy();
    // Subtitle keeps "EVENT 12 · HEAT …" (event number back in the subtitle).
    const text = container.textContent || '';
    expect(text).toContain('EVENT 12');
  });

  it('shows "—" for the race clock when there is no leader yet (no fabricated time)', () => {
    const { container } = renderLive({
      results: [{ event: 'EVENT 12', order: 1, entries: [{ place: 0, name: 'K. Anderson', team: null, lane: 7, mark: 'DQ' }] }],
    });
    const clockEl = Array.from(container.querySelectorAll('b')).find((el) =>
      el.previousElementSibling?.textContent === 'RACE CLOCK',
    );
    expect(clockEl?.textContent).toBe('—');
  });

  it('OMITS the pool-record-chase card entirely when not configured (never the mockup-fabricated sample)', () => {
    const { container } = renderLive(twoLaneResults);
    const text = container.textContent || '';
    expect(text).not.toContain('POOL RECORD');
    expect(text).not.toContain('A. WASHINGTON');
    expect(text).not.toContain('50.84');
  });

  it('renders the pool-record card when the operator configures it (config-or-omit)', () => {
    const { container } = renderLive(twoLaneResults, {
      recordLabel: 'POOL RECORD',
      recordValue: '50.84',
      recordHolder: 'A. Washington 2024',
    });
    const text = container.textContent || '';
    expect(text).toContain('POOL RECORD');
    expect(text).toContain('50.84');
    expect(text).toContain('A. Washington 2024');
  });

  it('computes the progress-bar fill + gap line from the REAL leader time vs the configured record (never a fabricated ratio)', () => {
    const { container } = renderLive(twoLaneResults, { recordValue: '50.84' });
    const text = container.textContent || '';
    // 51.90 leader vs 50.84 record → +1.06 off the record, computed.
    expect(text).toContain('D. OKAFOR FINISHED +1.06 OFF THE RECORD');
    // Progress bar fill = 50.84 / 51.90 * 100 ≈ 97.96%.
    const fillEl = Array.from(container.querySelectorAll('div')).find((el) => {
      const w = (el as HTMLElement).style.width;
      return w && w.startsWith('97.9');
    });
    expect(fillEl).toBeTruthy();
  });

  it('renders a "NEW RECORD" gap line when the leader beats the configured record (never a nonsensical negative gap)', () => {
    const { container } = renderLive(
      { results: [{ event: 'EVENT 12', order: 1, entries: [{ place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '49.00' }] }] },
      { recordValue: '50.84' },
    );
    const text = container.textContent || '';
    expect(text).toContain('D. OKAFOR SET A NEW RECORD');
    expect(text).not.toContain('OFF THE RECORD');
  });

  it('omits the progress bar + gap line when the record value does not parse (blank/garbage), never draws a meaningless bar', () => {
    const { container } = renderLive(twoLaneResults, { recordLabel: 'POOL RECORD', recordValue: '' });
    const text = container.textContent || '';
    expect(text).toContain('POOL RECORD');
    expect(text).not.toContain('OFF THE RECORD');
    expect(text).not.toContain('SET A NEW RECORD');
  });

  it('renders the REAL bound team scores in the team chip, not the builder sample 96/74', () => {
    const { container } = renderLive(twoLaneResults, {}, { homeScore: 41, awayScore: 33, homeTeam: 'Central Sharks', awayTeam: 'Westview Waves' });
    const text = container.textContent || '';
    expect(text).toContain('41');
    expect(text).toContain('33');
    expect(text).not.toContain('96');
    expect(text).not.toContain('74');
  });

  it('falls back to HOME/AWAY when the bound game has no team names set', () => {
    const { container } = renderLive(twoLaneResults, {}, { homeTeam: '', awayTeam: '' });
    const text = container.textContent || '';
    expect(text).toContain('HOME');
    expect(text).toContain('AWAY');
  });

  it('renders club labels from the REAL bound team names, never a fabricated per-swimmer color', () => {
    const { container } = renderLive(twoLaneResults, {}, { homeTeam: 'Central Sharks', awayTeam: 'Westview Waves' });
    const text = container.textContent || '';
    expect(text).toContain('CENTRAL SHARKS');
    expect(text).toContain('WESTVIEW WAVES');
  });

  it('renders "DQ" dignity for a disqualified swimmer instead of a fabricated time', () => {
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
    }, { dqReasons: { '7': 'FALSE START' } });
    const text = container.textContent || '';
    // Row name is force-uppercased via CSS text-transform (not JS
    // .toUpperCase()), which jsdom's textContent does NOT reflect — same
    // caveat v1/v2's specs call out. Assert the as-typed name instead;
    // the real rendered-DOM uppercase is proven by the Playwright
    // screenshot harness, which reads genuine browser-computed styles.
    expect(text).toContain('K. Anderson');
    expect(text).toContain('DQ');
    expect(text).toContain('FALSE START');
    const nameEl = Array.from(container.querySelectorAll('b')).find((el) => el.textContent === 'K. Anderson');
    expect(nameEl).toBeTruthy();
    expect((nameEl as HTMLElement).style.textTransform).toBe('uppercase');
    expect((nameEl as HTMLElement).style.textDecoration).toBe('line-through');
  });

  it('never uses the inset shorthand on a live-bound chase render (Taurus / Chromium-83 safety)', () => {
    const { container } = renderLive(twoLaneResults, { recordValue: '50.84' });
    expectNoInsetShorthand(container);
  });
});

describe('STADIUM_MEET_BOARD boardStyle=chase — no-fake-data guard on a real player surface', () => {
  it('renders "NO GAME BOUND" instead of the sample chase when no ambient provider exists', () => {
    const { container } = render(
      <div style={{ position: 'relative', width: 1600, height: 900 }}>
        <RenderSurfaceProvider surface="player">
          <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{ boardStyle: 'chase' }} width={100} height={100} live />
        </RenderSurfaceProvider>
      </div>,
    );
    const text = container.textContent || '';
    expect(text).toContain('NO GAME BOUND');
    // Never the fabricated sample chase (D. OKAFOR, the pool record) on a
    // real, unbound screen.
    expect(text).not.toContain('D. OKAFOR');
    expect(text).not.toContain('A. WASHINGTON');
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
          <GameStateProvider gameId="game-stadium-chase-test" initial={initial}>
            <WidgetPreview widgetType="STADIUM_MEET_BOARD" config={{ boardStyle: 'chase' }} width={100} height={100} live />
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
