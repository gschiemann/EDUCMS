/**
 * Sports Wave S2 (2026-07-02) — no-fake-data guard + per-zone game
 * binding render-tree proofs.
 *
 * Root bug (docs/research/2026-07-02-sports-deep-pass/00-AUDIT.md P0-2):
 * `GameStateProvider` mounts ONLY on the /board /ribbon /scorebug routes
 * — a sports preset scheduled to a screen through the NORMAL playlist
 * path (apps/web/src/app/player/page.tsx) rendered with NO provider at
 * all, so every widget fell back to its builder-only fabricated SAMPLE
 * (invented athletes/scores) on a real screen in front of a real crowd.
 *
 * These tests drive the SAME `WidgetPreview` dispatcher every real
 * render path uses (CLAUDE.md rule #9), so a regression here means the
 * operator sees fake data on a real screen for real, not just a type
 * error.
 *
 * S2-1 proofs:
 *  - A sports widget with NO ambient GameStateProvider on
 *    renderSurface="player" (the real player's signal) renders the
 *    "bind a game" callout and team-color-neutral chrome — NEVER the
 *    fabricated sample athletes/scores.
 *  - The exact same widget with no renderSurface prop at all (the
 *    builder/thumbnail/preview-modal default) still shows its
 *    self-playing SAMPLE, now with a visible "SAMPLE" watermark.
 *
 * S2-2 proof:
 *  - A sports widget with `config.gameId` set gets its own
 *    GameStateProvider (mocking the /sports/board/:id poll) and renders
 *    that specific game's live data — independent of whatever ambient
 *    ancestor context does or doesn't exist.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';
// The `scoreboard-main` variant (MainScoreboardWidget) is registered into
// the `variants.ts` Map by this side-effecting import — exactly what
// apps/web/src/app/player/page.tsx and .../templates/page.tsx already
// import for the SAME reason. Without it, `config.variant =
// 'scoreboard-main'` resolves to nothing and WidgetPreview silently
// falls through to the generic (non-sport) ScoreboardWidget — a real
// "render tree" trap (CLAUDE.md rule #9) this test would otherwise hide.
import '../variants-register';

// jsdom has no ResizeObserver — the sport widgets under test use the
// shared useScaleToFit primitive (same polyfill as swim-dive-widgets.test.tsx).
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

function renderWidget(
  type: string,
  config: Record<string, unknown> = {},
  extra: { renderSurface?: 'player' } = {},
) {
  return render(
    <div style={{ position: 'relative', width: 800, height: 450 }}>
      <WidgetPreview
        widgetType={type}
        config={config}
        width={100}
        height={100}
        live={extra.renderSurface === 'player'}
        renderSurface={extra.renderSurface}
      />
    </div>,
  );
}

describe('S2-1 — no-fake-data guard on real player surfaces', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('MainScoreboardWidget (SCOREBOARD / scoreboard-main variant)', () => {
    it('on the real player with no bound game: renders the bind-a-game callout, team-neutral names, and NEVER the fabricated sample score/teams', () => {
      renderWidget('SCOREBOARD', { variant: 'scoreboard-main' }, { renderSurface: 'player' });
      // The dignified empty state — never invented athletes.
      expect(screen.getByText('NO GAME BOUND')).toBeInTheDocument();
      expect(screen.getByText(/Bind a game in the score keeper/i)).toBeInTheDocument();
      // The fabricated SAMPLE team names/score must never appear on a
      // real screen with no game bound.
      expect(screen.queryByText('EAGLES')).not.toBeInTheDocument();
      expect(screen.queryByText('TIGERS')).not.toBeInTheDocument();
      expect(screen.queryByText('62')).not.toBeInTheDocument();
      expect(screen.queryByText('58')).not.toBeInTheDocument();
      // Team-color-neutral chrome shows HOME/AWAY placeholders instead —
      // each appears twice (the team-name slot AND the fixed side tag),
      // so assert presence via getAllByText rather than the exact-one
      // getByText.
      expect(screen.getAllByText('HOME').length).toBeGreaterThan(0);
      expect(screen.getAllByText('AWAY').length).toBeGreaterThan(0);
      // No SAMPLE watermark on a real screen — this isn't a preview.
      expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
    });

    it('in the builder (no renderSurface prop at all): still self-plays the SAMPLE, now with a visible SAMPLE watermark', () => {
      renderWidget('SCOREBOARD', { variant: 'scoreboard-main' });
      expect(screen.getByText('EAGLES')).toBeInTheDocument();
      expect(screen.getByText('TIGERS')).toBeInTheDocument();
      expect(screen.getByText('SAMPLE')).toBeInTheDocument();
      // The bind-a-game callout is a live-surface-only affordance.
      expect(screen.queryByText('NO GAME BOUND')).not.toBeInTheDocument();
    });
  });

  describe('SWIM_LANE_GRID', () => {
    it('on the real player with no bound game: renders the bind-a-game callout and blank lane rows, never the fabricated swimmers', () => {
      renderWidget('SWIM_LANE_GRID', {}, { renderSurface: 'player' });
      expect(screen.getByText('NO GAME BOUND')).toBeInTheDocument();
      expect(screen.queryByText('J. RIVERA')).not.toBeInTheDocument();
      expect(screen.queryByText('D. OKAFOR')).not.toBeInTheDocument();
      // No DQ mark fabricated onto a real, unbound screen.
      expect(screen.queryByText('DQ')).not.toBeInTheDocument();
      expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
    });

    it('in the builder: still shows the sample heat with a SAMPLE watermark', () => {
      renderWidget('SWIM_LANE_GRID');
      expect(screen.getByText('J. RIVERA')).toBeInTheDocument();
      expect(screen.getByText('SAMPLE')).toBeInTheDocument();
      expect(screen.queryByText('NO GAME BOUND')).not.toBeInTheDocument();
    });
  });

  describe('DIVE_LEADERBOARD', () => {
    it('on the real player with no bound game: renders the bind-a-game callout, never the fabricated divers', () => {
      renderWidget('DIVE_LEADERBOARD', {}, { renderSurface: 'player' });
      expect(screen.getByText('NO GAME BOUND')).toBeInTheDocument();
      expect(screen.queryByText('A. WASHINGTON')).not.toBeInTheDocument();
      expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
    });

    it('in the builder: still shows the sample field with a SAMPLE watermark', () => {
      renderWidget('DIVE_LEADERBOARD');
      expect(screen.getByText('A. WASHINGTON')).toBeInTheDocument();
      expect(screen.getByText('SAMPLE')).toBeInTheDocument();
    });
  });

  describe('DIVE_JUDGES_PANEL', () => {
    it('on the real player with no bound game: renders the bind-a-game callout, never the fabricated diver/dive', () => {
      renderWidget('DIVE_JUDGES_PANEL', {}, { renderSurface: 'player' });
      expect(screen.getByText('NO GAME BOUND')).toBeInTheDocument();
      expect(screen.queryByText('A. WASHINGTON')).not.toBeInTheDocument();
      expect(screen.queryByText('305C')).not.toBeInTheDocument();
      expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
    });

    it('in the builder: still shows the sample dive with a SAMPLE watermark', () => {
      const { container } = renderWidget('DIVE_JUDGES_PANEL');
      // The header renders "🤿 A. WASHINGTON" as sibling text nodes under
      // one span — match on textContent rather than an exact single-node
      // string (Testing Library's own recommendation for split text).
      expect(container.textContent).toContain('A. WASHINGTON');
      expect(screen.getByText('SAMPLE')).toBeInTheDocument();
    });
  });

  describe('SWIM_RELAY_EXCHANGE', () => {
    it('on the real player with no operator-typed legs: renders the bind-a-game callout and blank legs, never the fabricated relay swimmers', () => {
      renderWidget('SWIM_RELAY_EXCHANGE', {}, { renderSurface: 'player' });
      expect(screen.getByText('NO GAME BOUND')).toBeInTheDocument();
      expect(screen.queryByText('D. OKAFOR')).not.toBeInTheDocument();
      expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
    });

    it('in the builder: still shows the sample 4-leg relay with a SAMPLE watermark', () => {
      renderWidget('SWIM_RELAY_EXCHANGE');
      expect(screen.getByText('D. OKAFOR')).toBeInTheDocument();
      expect(screen.getByText('SAMPLE')).toBeInTheDocument();
    });
  });
});

describe('S2-2 — per-zone config.gameId binding', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('mounts a GameStateProvider for the exact gameId and renders that game\'s live data (mocked poll)', async () => {
    const fetchMock = jest.fn((url: string) => {
      expect(String(url)).toContain('/sports/board/game-42');
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'game-42',
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
            clockMs: 3 * 60_000,
            clockRunning: false,
            clockUpdatedAt: new Date().toISOString(),
            stats: {},
            serverTime: Date.now(),
          }),
      });
    });
    (global as unknown as { fetch: unknown }).fetch = fetchMock as unknown as typeof fetch;

    // No ambient GameStateProvider anywhere above this call — an ordinary
    // signage template zone with a "Bind to game" picker set. This is
    // rendered as if on the real player (renderSurface="player") to
    // prove the two mechanisms compose: the per-zone provider supplies
    // real data, so the phantom-unbound/bind-a-game state never fires.
    renderWidget(
      'SCOREBOARD',
      { variant: 'scoreboard-main', gameId: 'game-42' },
      { renderSurface: 'player' },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('RIVERSIDE HAWKS')).toBeInTheDocument());
    expect(screen.getByText('LAKEVIEW WOLVES')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    // The real bound game's data displaces both the fabricated sample
    // AND the "no game bound" callout.
    expect(screen.queryByText('NO GAME BOUND')).not.toBeInTheDocument();
    expect(screen.queryByText('EAGLES')).not.toBeInTheDocument();
  });

  it('does NOT double-wrap when an ambient GameStateProvider already exists — a stale config.gameId never overrides the real ambient game', async () => {
    // Simulate the /board /ribbon /scorebug case: the WHOLE template is
    // already wrapped in one ambient GameStateProvider for gameId
    // "ambient-game" (as CustomScoreboardScene does), and this ONE zone
    // also happens to carry a stale/different config.gameId from before
    // it was bound ambiently. The ambient provider must win.
    const fetchMock = jest.fn((url: string) => {
      const isAmbient = String(url).includes('/sports/board/ambient-game');
      const isStale = String(url).includes('/sports/board/stale-game-id');
      // A per-zone wrap around the stale id would poll a SECOND
      // endpoint — assert it never does.
      expect(isStale).toBe(false);
      expect(isAmbient).toBe(true);
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'ambient-game',
            sport: 'basketball',
            status: 'LIVE',
            segment: 1,
            homeTeam: 'AMBIENT HOME',
            awayTeam: 'AMBIENT AWAY',
            homeScore: 10,
            awayScore: 5,
            homeColor: '#1e3a8a',
            awayColor: '#b91c1c',
            homeLogoUrl: null,
            awayLogoUrl: null,
            clockMs: 0,
            clockRunning: false,
            clockUpdatedAt: new Date().toISOString(),
            stats: {},
            serverTime: Date.now(),
          }),
      });
    });
    (global as unknown as { fetch: unknown }).fetch = fetchMock as unknown as typeof fetch;

    const { GameStateProvider } = jest.requireActual('../sports/GameStateContext') as typeof import('../sports/GameStateContext');

    render(
      <div style={{ position: 'relative', width: 800, height: 450 }}>
        <GameStateProvider gameId="ambient-game">
          <WidgetPreview
            widgetType="SCOREBOARD"
            config={{ variant: 'scoreboard-main', gameId: 'stale-game-id' }}
            width={100}
            height={100}
            live
          />
        </GameStateProvider>
      </div>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('AMBIENT HOME')).toBeInTheDocument());
    expect(screen.getByText('AMBIENT AWAY')).toBeInTheDocument();
    // Only ONE poll target ever fired — the ambient one.
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.every((u) => u.includes('/sports/board/ambient-game'))).toBe(true);
  });
});

function expectNoInsetShorthand(container: HTMLElement) {
  const styled = container.querySelectorAll('[style]');
  styled.forEach((el) => {
    const style = (el as HTMLElement).getAttribute('style') || '';
    expect(style).not.toMatch(/inset\s*:/);
  });
}

describe('S2-1/S2-2 Chromium-83 / Taurus safety', () => {
  it('the bind-a-game callout and SAMPLE watermark never use the inset shorthand', () => {
    const { container: c1 } = renderWidget('SCOREBOARD', { variant: 'scoreboard-main' }, { renderSurface: 'player' });
    expectNoInsetShorthand(c1);
    const { container: c2 } = renderWidget('SCOREBOARD', { variant: 'scoreboard-main' });
    expectNoInsetShorthand(c2);
    const { container: c3 } = renderWidget('SWIM_LANE_GRID', {}, { renderSurface: 'player' });
    expectNoInsetShorthand(c3);
  });
});
