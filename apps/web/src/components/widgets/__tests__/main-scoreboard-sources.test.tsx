/**
 * K-12 launch audit F29 (2026-09-27) — the Main Scoreboard's source modes,
 * proven through the real `WidgetPreview` dispatcher (CLAUDE.md rule #9).
 *
 * Acceptance from the register: "Type a sample score, bind a game,
 * save/reopen and score from the console. Live mode updates correctly; an
 * intentional override is clearly identified and can be removed."
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';
import '../variants-register';
import { warmAllWidgetFamilies } from '../widget-families';
import { warmVariantRegistry } from '../WidgetRenderer';
import { clearFactOverridesPatch, overriddenFacts } from '../sports/scoreboard-sources';

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

beforeAll(async () => {
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});

const GAME = {
  id: 'g-main',
  sport: 'basketball',
  status: 'LIVE',
  segment: 2,
  homeTeam: 'RIVERSIDE',
  awayTeam: 'LAKEVIEW',
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
};

const originalFetch = global.fetch;
function mockGame(game = GAME) {
  const fn = jest.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(game) }));
  (global as unknown as { fetch: unknown }).fetch = fn as unknown as typeof fetch;
  return fn;
}
afterEach(() => {
  global.fetch = originalFetch;
  cleanup();
});

function renderMain(config: Record<string, unknown>, surface?: 'player') {
  return render(
    <div style={{ position: 'relative', width: 960, height: 540 }}>
      <WidgetPreview widgetType="SCOREBOARD" config={{ variant: 'scoreboard-main', ...config }} width={100} height={100} live={surface === 'player'} renderSurface={surface} />
    </div>,
  );
}

describe('F29 acceptance — a typed sample score never survives binding', () => {
  it('type 9, bind (the panel clears the fact overrides), reopen → the live 41 shows, no override chip', async () => {
    mockGame();
    const typed = { homeScore: 9, awayScore: 3, homeName: 'LIONS' };
    // What MainScoreboardFields writes when a game is picked.
    const saved = { ...typed, gameId: 'g-main', ...clearFactOverridesPatch() };
    // Save/reopen = a JSON round trip (undefined keys vanish).
    const reopened = JSON.parse(JSON.stringify(saved));
    expect(overriddenFacts(reopened)).toEqual([]);
    const { container } = renderMain(reopened, 'player');
    await waitFor(() => expect(screen.getByText('41')).toBeInTheDocument());
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.queryByText('9')).not.toBeInTheDocument();
    // Branding the operator chose is kept.
    expect(screen.getByText('LIONS')).toBeInTheDocument();
    expect(container.querySelector('[data-sb-override-chip]')).toBeNull();
  });

  it('a deliberate override is identified in the builder (and never on the public screen)', async () => {
    mockGame();
    const cfg = { gameId: 'g-main', homeScore: 50 };
    const builder = renderMain(cfg);
    await waitFor(() => expect(builder.container.textContent).toContain('RIVERSIDE'));
    expect(builder.container.querySelector('[data-sb-override-chip]')?.textContent).toBe('1 VALUE OVERRIDES LIVE');
    cleanup();
    mockGame();
    const player = renderMain(cfg, 'player');
    await waitFor(() => expect(player.container.textContent).toContain('RIVERSIDE'));
    expect(player.container.querySelector('[data-sb-override-chip]')).toBeNull();
  });
});

describe('F29 — manual mode is a hand-typed board, never a live claim', () => {
  it('on a real screen: typed values, no "bind a game" callout, no LIVE pill', () => {
    renderMain({ dataMode: 'manual', homeName: 'BLUE', awayName: 'GOLD', homeScore: 7, awayScore: 5, clock: '2:00', status: 'LIVE' }, 'player');
    expect(screen.getByText('BLUE')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
    expect(screen.queryByText('NO GAME BOUND')).not.toBeInTheDocument();
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    expect(screen.queryByText('SAMPLE')).not.toBeInTheDocument();
  });

  it('on a real screen with nothing typed: neutral, never the sample game', () => {
    renderMain({ dataMode: 'manual' }, 'player');
    expect(screen.queryByText('EAGLES')).not.toBeInTheDocument();
    expect(screen.queryByText('62')).not.toBeInTheDocument();
    expect(screen.queryByText('NO GAME BOUND')).not.toBeInTheDocument();
  });

  it('ignores a bound game entirely — and does not even poll it', async () => {
    const fetchMock = mockGame();
    renderMain({ dataMode: 'manual', gameId: 'g-main', homeName: 'BLUE', awayName: 'GOLD', homeScore: 7, awayScore: 5 }, 'player');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('RIVERSIDE')).not.toBeInTheDocument();
    expect(screen.queryByText('41')).not.toBeInTheDocument();
    expect(screen.getByText('BLUE')).toBeInTheDocument();
  });

  it('in the builder: unset values show the stamped sample', () => {
    renderMain({ dataMode: 'manual' });
    expect(screen.getByText('EAGLES')).toBeInTheDocument();
    expect(screen.getByText('SAMPLE')).toBeInTheDocument();
  });
});
