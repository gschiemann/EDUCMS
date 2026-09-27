/**
 * K-12 launch audit F28 (2026-09-27) — the High School / College / Pro live
 * scoreboard (`SportsScoreboardWidget`, v2 variants `scoreboard-hs|college|pro`)
 * must never present a fabricated game as live.
 *
 * Before this fix the widget treated "no config.gameId" as "preview" and
 * self-played a sample game — a ticking clock, scores going UP, a pulsing LIVE
 * pill — on every real screen. The three `sports-scoreboard-*` system presets
 * ship it with `gameId: ''`, so every school that scheduled one showed an
 * invented game to a real crowd. Assigned as a game's own scoreboard layout it
 * ignored the ambient game entirely and played the sample there too.
 *
 * These tests drive the same `WidgetPreview` dispatcher the player, the
 * builder and /board use (CLAUDE.md rule #9).
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';
import '../variants-register';
import { warmAllWidgetFamilies } from '../widget-families';
import { warmVariantRegistry } from '../WidgetRenderer';
import { GameStateProvider } from '../sports/GameStateContext';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
beforeAll(async () => {
  // The v2 pack renders through withMeasuredHeight, which renders nothing
  // until it measures a non-zero height — jsdom has no layout, so without
  // this every assertion below would run against an empty zone.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return 540; },
  });
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});
afterAll(() => {
  if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
});

const TIERS = ['scoreboard-hs', 'scoreboard-college', 'scoreboard-pro'] as const;

function renderTier(
  variant: string,
  config: Record<string, unknown> = {},
  opts: { renderSurface?: 'player'; live?: boolean } = {},
) {
  return render(
    <div style={{ position: 'relative', width: 960, height: 540 }}>
      <WidgetPreview
        widgetType="SCOREBOARD"
        config={{ variant, tier: variant.replace('scoreboard-', ''), gameId: '', ...config }}
        width={100}
        height={100}
        live={opts.live ?? opts.renderSurface === 'player'}
        renderSurface={opts.renderSurface}
      />
    </div>,
  );
}

const REAL_GAME = {
  id: 'game-77',
  sport: 'basketball',
  status: 'LIVE',
  segment: 2,
  homeTeam: 'RIVERSIDE HAWKS',
  awayTeam: 'LAKEVIEW WOLVES',
  homeScore: 41,
  awayScore: 37,
  homeColor: '#0f766e',
  awayColor: '#7c2d12',
  homeLogoUrl: null,
  awayLogoUrl: null,
  clockMs: 3 * 60_000 + 12_000,
  clockRunning: false,
  clockUpdatedAt: new Date().toISOString(),
  stats: {},
  serverTime: Date.now(),
};

function mockBoardFetch(expectedGameId: string) {
  const fn = jest.fn((url: string) => {
    expect(String(url)).toContain(`/sports/board/${expectedGameId}`);
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ ...REAL_GAME, id: expectedGameId }),
    });
  });
  (global as unknown as { fetch: unknown }).fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('F28 — HS/College/Pro scoreboard never self-plays on a real screen', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  for (const variant of TIERS) {
    it(`${variant}: real screen with nothing bound shows neutral dashes — no sample teams, no LIVE pill, no self-play`, () => {
      jest.useFakeTimers();
      renderTier(variant, {}, { renderSurface: 'player' });
      expect(screen.queryByText('EAGLES')).not.toBeInTheDocument();
      expect(screen.queryByText('TIGERS')).not.toBeInTheDocument();
      expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
      expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
      // Neutral team chrome: the name slot and the side tag both read HOME/AWAY.
      expect(screen.getAllByText('HOME').length).toBe(2);
      expect(screen.getAllByText('AWAY').length).toBe(2);
      // Both scores AND the period chip read as dashes.
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
      // The old preview loop scored every 7 s. Advance well past it: still
      // nothing invented.
      act(() => {
        jest.advanceTimersByTime(20_000);
      });
      expect(screen.queryByText('EAGLES')).not.toBeInTheDocument();
      expect(screen.queryByText('62')).not.toBeInTheDocument();
      expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    });

    it(`${variant}: builder keeps the self-playing demo, stamped SAMPLE, with no LIVE pill`, () => {
      renderTier(variant);
      expect(screen.getByText('EAGLES')).toBeInTheDocument();
      expect(screen.getByText('TIGERS')).toBeInTheDocument();
      expect(screen.getByText('SAMPLE')).toBeInTheDocument();
      expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    });
  }

  it('a bound zone (config.gameId) on a real screen shows that game, not the sample', async () => {
    const fetchMock = mockBoardFetch('game-77');
    renderTier('scoreboard-hs', { gameId: 'game-77' }, { renderSurface: 'player' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('RIVERSIDE HAWKS')).toBeInTheDocument());
    expect(screen.getByText('LAKEVIEW WOLVES')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.queryByText('EAGLES')).not.toBeInTheDocument();
    expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
  });

  it('assigned as a game\'s scoreboard layout (ambient provider, no config.gameId) it shows THAT game', async () => {
    const fetchMock = mockBoardFetch('ambient-9');
    render(
      <GameStateProvider gameId="ambient-9">
        <div style={{ position: 'relative', width: 960, height: 540 }}>
          <WidgetPreview
            widgetType="SCOREBOARD"
            config={{ variant: 'scoreboard-college', tier: 'college', gameId: '' }}
            width={100}
            height={100}
            live
          />
        </div>
      </GameStateProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('RIVERSIDE HAWKS')).toBeInTheDocument());
    expect(screen.queryByText('EAGLES')).not.toBeInTheDocument();
    expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
  });
});
