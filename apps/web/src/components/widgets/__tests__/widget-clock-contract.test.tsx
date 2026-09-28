/**
 * K-12 sports launch — the sport widgets on THE clock contract (K12-F17 +
 * F40 follow-up, 2026-09-27).
 *
 * B2's GameStateContext widgets did their own clock math: the device clock
 * with a crude skew, a floor-rounding formatter, no freshness, no revision
 * check — so a widget board and the /board route could disagree about the
 * same instant, and a widget kept running a clock the table may have stopped
 * while its poll was dead. These tests render the REAL widgets inside the
 * REAL provider next to the REAL /board scene (`DefaultBoardScene`, what
 * `ScoreboardPage` renders — CLAUDE.md rule #9) on injected fake clocks, with
 * a scripted API, and prove:
 *   1. the widget and the board paint the SAME clock at every instant —
 *      MM:SS rounding up, tenths in a tenths sport's final minute, count-up
 *      sports never in tenths;
 *   2. every clock is projected on the page's SERVER clock, never the
 *      device's (a device two minutes fast still reads the game);
 *   3. while the poll is stale every clock HOLDS and no LIVE claim is made;
 *      the next good read releases it straight to the true reading;
 *   4. an OLDER revision is never applied (another replica's cache);
 *   5. shot / play clocks and the penalty box read the board's digits and
 *      the board's rules (switched OFF means hidden; expired means gone).
 * Every one of these fails against the pre-contract widgets.
 */
import { act, cleanup, render } from '@testing-library/react';
import { formatSportClock, projectGameClockMs, sportForGame, type SportDefinition } from '@cms/api-types';
import { DefaultBoardScene, type BoardData } from '@/app/board/[gameId]/page';
import { serverClock } from '@/lib/server-clock';
import { GameStateProvider, RenderSurfaceProvider, hasRunningClock, type GameSnapshot } from '../sports/GameStateContext';
import { GameClockWidget, ScoreHomeWidget } from '../sports/SportWidgets';
import { GameStatusWidget, PlayClockWidget, ShotClockWidget } from '../sports/SportElementWidgets';
import { PenaltyBoxWidget, PowerPlayBadgeWidget } from '../sports/SportElementWidgets.sports';
import { MainScoreboardWidget } from '../sports/MainScoreboardWidget';
import { SportsScoreboardWidget } from '../v2/SportsScoreboardWidgets';
import { resolveCtsField } from '../sports/cts-fields';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const T0 = Date.parse('2026-09-27T19:00:00.000Z');

/** The scripted API: what GET /sports/board/:id answers right now. */
const api: { game: Record<string, unknown>; down: boolean; serverAheadMs: number; calls: number } = {
  game: {},
  down: false,
  serverAheadMs: 0,
  calls: 0,
};
const realFetch = global.fetch;

function installApi() {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() => {
    api.calls += 1;
    if (api.down) return Promise.reject(new Error('Failed to fetch'));
    // The server stamps ITS time into every response (the device's clock
    // may be wrong — serverAheadMs is how far the server is ahead of it).
    const body = { ...api.game, serverTime: Date.now() + api.serverAheadMs };
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve(body),
    });
  }) as unknown as typeof fetch;
}

async function flushMicrotasks() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** Advance the fake clocks in 100 ms steps, letting polls resolve. */
async function advance(ms: number, step = 100, each?: () => void) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => {
      jest.advanceTimersByTime(step);
      await flushMicrotasks();
    });
    each?.();
  }
}

/** Server "now" in the game's clock domain (the fake device clock + skew). */
const serverNow = () => Date.now() + api.serverAheadMs;

function game(overrides: Partial<BoardData> = {}): BoardData {
  return {
    id: 'g-contract',
    sport: 'basketball',
    status: 'LIVE',
    segment: 4,
    homeTeam: 'RIVERSIDE',
    awayTeam: 'LAKEVIEW',
    homeScore: 50,
    awayScore: 47,
    homeColor: '#0f766e',
    awayColor: '#7c2d12',
    homeLogoUrl: null,
    awayLogoUrl: null,
    clockMs: 61_500,
    clockRunning: true,
    clockUpdatedAt: new Date(serverNow()).toISOString(),
    stats: {},
    cues: [],
    serverTime: serverNow(),
    ...overrides,
  };
}

function defOf(data: BoardData): SportDefinition {
  const def = sportForGame(data);
  if (!def) throw new Error(`no sport ${data.sport}`);
  return def;
}

/** The /board route's clock text — the 188 px readout in BoardScene. */
function boardClock(el: HTMLElement): string {
  const node = el.querySelector('div[style*="font-size: 188px"]');
  if (!node) throw new Error('board clock not rendered');
  return (node.textContent || '').trim();
}

/** The /board route's shot-clock digits (the 88 px readout). */
function boardShot(el: HTMLElement): string | null {
  const node = el.querySelector('span[style*="font-size: 88px"]');
  return node ? (node.textContent || '').trim() : null;
}

function text(el: Element | null): string {
  return (el?.textContent || '').trim();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(T0));
  jest.spyOn(Math, 'random').mockReturnValue(0.5); // board-poll jitter = 0
  serverClock.reset();
  api.game = {};
  api.down = false;
  api.serverAheadMs = 0;
  api.calls = 0;
  installApi();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.fetch = realFetch;
  serverClock.reset();
});

// ═══════════════════════════════════════════════════════════════════
// 1. The widget board and the /board route paint the same clock
// ═══════════════════════════════════════════════════════════════════

describe('one clock: the widget and the /board route agree at every instant', () => {
  function renderPair(data: BoardData) {
    api.game = data as unknown as Record<string, unknown>;
    const def = defOf(data);
    const view = render(
      <div>
        <div data-testid="board">
          <DefaultBoardScene data={data} def={def} displayData={data} vp={{ w: 1920, h: 1080 }} activeCue={null} keyframes={null} />
        </div>
        <div data-testid="widget">
          <GameStateProvider gameId={data.id} initial={data as unknown as GameSnapshot}>
            <GameClockWidget config={{}} />
          </GameStateProvider>
        </div>
      </div>,
    );
    return {
      board: view.getByTestId('board'),
      widget: view.getByTestId('widget'),
      def,
    };
  }

  it('basketball, 1:01.5 running down through the final minute: same digits every 100 ms (MM:SS rounds up, then tenths)', async () => {
    const data = game();
    const { board, widget, def } = renderPair(data);
    const seen: string[] = [];
    const check = () => {
      const w = text(widget);
      expect(w).toBe(boardClock(board));
      // …and it is THE projection on the SERVER clock, THE formatter.
      expect(w).toBe(formatSportClock(def, projectGameClockMs(data, 'countdown', serverClock.now())));
      if (seen[seen.length - 1] !== w) seen.push(w);
    };
    check();
    expect(text(widget)).toBe('1:02'); // 61.5 s REMAIN: rounds up, like the board
    await advance(4_000, 100, check);
    // Crossed into the final minute: tenths, exactly as the board shows them.
    expect(seen).toContain('1:01');
    expect(seen).toContain('59.9');
    expect(text(widget)).toMatch(/^57\.[45]$/);
  });

  it('a count-up sport never shows tenths, and rounds exactly like the board', async () => {
    const data = game({ sport: 'soccer', segment: 1, clockMs: 44_600, clockRunning: true });
    const { board, widget, def } = renderPair(data);
    expect(def.clock.type).toBe('countup');
    await advance(1_500, 100, () => expect(text(widget)).toBe(boardClock(board)));
    expect(text(widget)).toBe(formatSportClock(def, projectGameClockMs(data, 'countup', serverClock.now())));
    expect(text(widget)).not.toMatch(/^\d+\.\d$/);
  });

  it('a stopped clock is the stored reading on both, with no timer ticking it', async () => {
    const data = game({ clockMs: 7 * 60_000 + 41_500, clockRunning: false });
    const { board, widget } = renderPair(data);
    await advance(2_000);
    expect(text(widget)).toBe('7:42');
    expect(boardClock(board)).toBe('7:42');
    expect(hasRunningClock(data as unknown as GameSnapshot)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. The server clock, never the device's
// ═══════════════════════════════════════════════════════════════════

describe('every clock is projected on the page\'s SERVER clock', () => {
  it('a player whose own clock is two minutes fast still reads the game (after its first poll)', async () => {
    api.serverAheadMs = -120_000; // the device is 2 minutes FAST
    const data = game({ clockMs: 5 * 60_000, clockUpdatedAt: new Date(serverNow() - 10_000).toISOString() });
    api.game = data as unknown as Record<string, unknown>;
    const view = render(
      <GameStateProvider gameId={data.id}>
        <GameClockWidget config={{}} />
      </GameStateProvider>,
    );
    await advance(800); // the first poll lands and samples the server clock
    // 10 s had run at the anchor, 0.8 s since: 4:49.2 remain → "4:50".
    expect(text(view.container)).toBe('4:50');
    await advance(1_000);
    expect(text(view.container)).toBe('4:49');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Freshness: hold while stale, never claim LIVE, recover
// ═══════════════════════════════════════════════════════════════════

describe('K12-F40 — while the poll is stale every clock HOLDS and nothing claims LIVE', () => {
  it('the Main Scoreboard: clock and LIVE flag follow the link', async () => {
    // 5:00.5 — half-second offsets keep every reading off a rounding edge.
    const data = game({ clockMs: 5 * 60_000 + 500 });
    api.game = data as unknown as Record<string, unknown>;
    const view = render(
      <RenderSurfaceProvider surface="player">
        <GameStateProvider gameId={data.id} initial={data as unknown as GameSnapshot}>
          <div data-testid="main" style={{ position: 'relative', width: 960, height: 540 }}>
            <MainScoreboardWidget config={{}} />
          </div>
          <div data-testid="status"><GameStatusWidget config={{}} /></div>
        </GameStateProvider>
      </RenderSurfaceProvider>,
    );
    const main = view.getByTestId('main');
    const status = view.getByTestId('status');
    // The flag is the only "LIVE" text the Main Scoreboard paints.
    const liveFlag = () => /LIVE/.test(main.textContent || '');
    // The status pill's white "live now" dot.
    const statusDot = () => status.querySelector('span[style*="width: 0.5em"]');
    await advance(2_000);
    expect(liveFlag()).toBe(true);
    expect(statusDot()).not.toBeNull();
    expect(main.textContent).toContain('4:59'); // 298.5 s remain

    // The API goes away. Eight seconds without a good read → stale.
    api.down = true;
    await advance(10_000, 100);
    const heldText = main.textContent || '';
    expect(liveFlag()).toBe(false); // no LIVE claim while stale
    // The status pill keeps the game's status, without the "live now" dot.
    expect(status.textContent).toContain('LIVE');
    expect(statusDot()).toBeNull();
    await advance(5_000);
    // Nothing moved: the clock the table may have stopped is not run on
    // unconfirmed data.
    expect(main.textContent).toBe(heldText);

    // The API comes back: the next good read (the poll is in its 5 s
    // backoff by now) releases the hold, and the clock is straight at the
    // TRUE reading — elapsed since T0 on the server clock, not the held one.
    api.down = false;
    await advance(6_000);
    expect(serverClock.isHeld()).toBe(false);
    const elapsed = Date.now() - T0; // the server's clock here = the device's
    const truth = formatSportClock(defOf(data), 300_500 - elapsed);
    expect(truth).not.toBe(heldText.match(/\d+:\d\d/)?.[0]);
    expect(main.textContent).toContain(truth);
    expect(liveFlag()).toBe(true);
    expect(statusDot()).not.toBeNull();
  });

  it('the widget board holds together with the /board route\'s own hold, and neither releases the other', async () => {
    // A second link on the page (what the /board route runs) goes stale with
    // the widgets' provider; when the provider recovers first, the page is
    // still stale — so the page's clocks, the widgets' included, stay held.
    const data = game({ clockMs: 5 * 60_000 });
    api.game = data as unknown as Record<string, unknown>;
    const pageOwner = {};
    const view = render(
      <GameStateProvider gameId={data.id} initial={data as unknown as GameSnapshot}>
        <GameClockWidget config={{}} />
      </GameStateProvider>,
    );
    await advance(1_000);
    api.down = true;
    // The page's own link saw the outage first and holds; the provider's
    // goes stale a few seconds later and holds too.
    serverClock.hold(pageOwner);
    await advance(9_500);
    const held = text(view.container);
    api.down = false;
    await advance(3_000); // the provider recovers; the page's link does not
    expect(text(view.container)).toBe(held);
    serverClock.release(pageOwner); // …until the page's own read lands
    await advance(200);
    expect(text(view.container)).not.toBe(held);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Never an older revision
// ═══════════════════════════════════════════════════════════════════

describe('K12-F40 — a payload OLDER than one already shown is never applied', () => {
  it('another replica\'s cached score never rolls the widget back', async () => {
    api.game = game({ homeScore: 50, revision: 7 }) as unknown as Record<string, unknown>;
    const view = render(
      <GameStateProvider gameId="g-contract">
        <ScoreHomeWidget config={{}} />
      </GameStateProvider>,
    );
    await advance(800);
    expect(text(view.container)).toBe('50');
    api.game = game({ homeScore: 48, revision: 6 }) as unknown as Record<string, unknown>;
    await advance(2_000);
    expect(text(view.container)).toBe('50'); // revision 6 < 7: refused
    api.game = game({ homeScore: 52, revision: 8 }) as unknown as Record<string, unknown>;
    await advance(1_000);
    expect(text(view.container)).toBe('52');
    expect((window as unknown as { __sportsLink: Record<string, { revision: number }> }).__sportsLink.widgets.revision).toBe(8);
  });

  it('a zone re-bound to ANOTHER game starts over — its revisions are its own', async () => {
    api.game = game({ id: 'g-a', homeScore: 50, revision: 40 }) as unknown as Record<string, unknown>;
    const view = render(
      <GameStateProvider gameId="g-a">
        <ScoreHomeWidget config={{}} />
      </GameStateProvider>,
    );
    await advance(800);
    expect(text(view.container)).toBe('50');
    api.game = game({ id: 'g-b', homeScore: 3, revision: 2 }) as unknown as Record<string, unknown>;
    view.rerender(
      <GameStateProvider gameId="g-b">
        <ScoreHomeWidget config={{}} />
      </GameStateProvider>,
    );
    await advance(800);
    expect(text(view.container)).toBe('3');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Shot clock, play clock, penalty box: the board's digits and rules
// ═══════════════════════════════════════════════════════════════════

describe('shot / play clocks and the penalty box read like the board', () => {
  function shotGame(shotClock: Record<string, unknown>) {
    return game({ clockMs: 6 * 60_000, stats: { shotClock } });
  }

  it('a running shot clock: the board, the element widget, the Main Scoreboard and the tier scoreboard paint the same digits', async () => {
    const data = shotGame({ len: 24, ms: 24_000, at: new Date(serverNow()).toISOString(), running: true });
    api.game = data as unknown as Record<string, unknown>;
    const def = defOf(data);
    const view = render(
      <div>
        <div data-testid="board">
          <DefaultBoardScene data={data} def={def} displayData={data} vp={{ w: 1920, h: 1080 }} activeCue={null} keyframes={null} />
        </div>
        <RenderSurfaceProvider surface="player">
          <GameStateProvider gameId={data.id} initial={data as unknown as GameSnapshot}>
            <div data-testid="element"><ShotClockWidget config={{ label: '' }} /></div>
            <div data-testid="main" style={{ position: 'relative', width: 960, height: 540 }}><MainScoreboardWidget config={{}} /></div>
            <div data-testid="tier" style={{ position: 'relative', width: 960, height: 540 }}><SportsScoreboardWidget config={{ gameId: data.id }} /></div>
          </GameStateProvider>
        </RenderSurfaceProvider>
      </div>,
    );
    const board = view.getByTestId('board');
    const element = view.getByTestId('element');
    const mainCoin = () => {
      const spans = Array.from(view.getByTestId('main').querySelectorAll('span[style*="font-size: 92px"]'));
      return spans.length ? text(spans[0]) : null;
    };
    const tierCoin = () => text(view.getByTestId('tier').querySelector('[data-sb-shot]'));
    const check = () => {
      const b = boardShot(board);
      expect(b).not.toBeNull();
      expect(text(element)).toBe(b);
      expect(mainCoin()).toBe(b);
      expect(tierCoin()).toBe(b);
    };
    check();
    expect(text(element)).toBe('24');
    await advance(19_600, 100, check);
    expect(text(element)).toBe('4.4'); // final five seconds: tenths
  });

  it('a shot clock the table switched OFF is hidden everywhere the board hides it', async () => {
    const data = shotGame({ len: 0, ms: 0, at: new Date(serverNow()).toISOString(), running: false, off: true });
    api.game = data as unknown as Record<string, unknown>;
    const def = defOf(data);
    const view = render(
      <div>
        <div data-testid="board">
          <DefaultBoardScene data={data} def={def} displayData={data} vp={{ w: 1920, h: 1080 }} activeCue={null} keyframes={null} />
        </div>
        <RenderSurfaceProvider surface="player">
          <GameStateProvider gameId={data.id} initial={data as unknown as GameSnapshot}>
            <div data-testid="element"><ShotClockWidget config={{}} /></div>
            <div data-testid="main" style={{ position: 'relative', width: 960, height: 540 }}><MainScoreboardWidget config={{}} /></div>
            <div data-testid="tier" style={{ position: 'relative', width: 960, height: 540 }}><SportsScoreboardWidget config={{ gameId: data.id }} /></div>
          </GameStateProvider>
        </RenderSurfaceProvider>
      </div>,
    );
    await advance(1_000);
    expect(boardShot(view.getByTestId('board'))).toBeNull();
    expect(text(view.getByTestId('element'))).toBe('');
    expect(view.getByTestId('main').textContent).not.toContain('SHOT');
    expect(view.getByTestId('tier').querySelector('[data-sb-shot]')).toBeNull();
  });

  it('the football play clock: projected like the board, the idle "40" when the table turned it OFF, nothing on a screen with no game', async () => {
    const running = game({
      sport: 'football',
      segment: 2,
      clockMs: 5 * 60_000,
      clockRunning: false,
      stats: { playClock: { ms: 25_000, at: new Date(serverNow()).toISOString(), running: true } },
    });
    api.game = running as unknown as Record<string, unknown>;
    const def = defOf(running);
    const view = render(
      <div>
        <div data-testid="board">
          <DefaultBoardScene data={running} def={def} displayData={running} vp={{ w: 1920, h: 1080 }} activeCue={null} keyframes={null} />
        </div>
        <RenderSurfaceProvider surface="player">
          <GameStateProvider gameId={running.id} initial={running as unknown as GameSnapshot}>
            <div data-testid="play"><PlayClockWidget config={{ label: '' }} /></div>
          </GameStateProvider>
        </RenderSurfaceProvider>
      </div>,
    );
    // The play clock runs while the GAME clock is stopped — the provider
    // still ticks it (it used to tick only a running game clock).
    await advance(21_000, 100, () => expect(text(view.getByTestId('play'))).toBe(boardShot(view.getByTestId('board'))));
    expect(text(view.getByTestId('play'))).toBe('4.0');
    cleanup();

    const off = game({ ...running, stats: { playClock: { ms: 25_000, at: new Date(serverNow()).toISOString(), running: false, off: true } } });
    api.game = off as unknown as Record<string, unknown>;
    const offView = render(
      <RenderSurfaceProvider surface="player">
        <GameStateProvider gameId={off.id} initial={off as unknown as GameSnapshot}>
          <PlayClockWidget config={{ label: '' }} />
        </GameStateProvider>
      </RenderSurfaceProvider>,
    );
    await advance(500);
    expect(text(offView.container)).toBe('40'); // the board's idle reading, never a frozen count
    cleanup();

    const unbound = render(
      <RenderSurfaceProvider surface="player">
        <PlayClockWidget config={{ label: '' }} />
      </RenderSurfaceProvider>,
    );
    expect(text(unbound.container)).toBe(''); // never the sample "40" on a real screen
  });

  it('the penalty box: the board\'s rows, the board\'s MM:SS, the board\'s power play', async () => {
    const at = new Date(serverNow()).toISOString();
    const data = game({
      sport: 'hockey',
      segment: 2,
      clockMs: 10 * 60_000,
      clockRunning: true,
      stats: {
        penalties: [
          { id: 'p1', team: 'home', player: '12', ms: 120_000, at, running: true },
          // Expired: served, still in the array until the table clears it.
          { id: 'p2', team: 'away', player: '7', ms: 0, at, running: false },
          { id: 'p3', team: 'away', player: '9', ms: 60_000, at, running: true },
        ],
      },
    });
    api.game = data as unknown as Record<string, unknown>;
    const view = render(
      <RenderSurfaceProvider surface="player">
        <GameStateProvider gameId={data.id} initial={data as unknown as GameSnapshot}>
          <div data-testid="home-box"><PenaltyBoxWidget config={{ team: 'home' }} /></div>
          <div data-testid="away-box"><PenaltyBoxWidget config={{ team: 'away' }} /></div>
          <div data-testid="home-pp"><PowerPlayBadgeWidget config={{ team: 'home' }} /></div>
        </GameStateProvider>
      </RenderSurfaceProvider>,
    );
    await advance(1_500);
    // 118.5 s remain → "1:59" (rounding up, like the board's fmtPenalty).
    expect(text(view.getByTestId('home-box'))).toBe('#121:59');
    // The expired #7 is gone; #9 remains.
    expect(text(view.getByTestId('away-box'))).toBe('#90:59');
    // One active penalty each side → even strength, exactly the board's
    // answer (the old widget counted the expired row: "PENALTY KILL").
    expect(text(view.getByTestId('home-pp'))).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. The CTS field resolver (every re-pointable widget reads through it)
// ═══════════════════════════════════════════════════════════════════

describe('resolveCtsField — the shared formatter and projection', () => {
  const snap = (over: Partial<GameSnapshot> = {}): GameSnapshot =>
    ({ ...game(), ...over }) as unknown as GameSnapshot;

  it('the game clock is formatSportClock: tenths only in a tenths sport\'s final minute', () => {
    expect(resolveCtsField(snap(), 45_300, 'clock')).toBe('45.3');
    expect(resolveCtsField(snap(), 7 * 60_000 + 41_500, 'clock')).toBe('7:42');
    expect(resolveCtsField(snap({ sport: 'soccer' }), 45_300, 'clock')).toBe('0:46');
  });

  it('shot clocks are projected at the provider\'s instant; OFF reads blank', () => {
    const at = new Date(T0).toISOString();
    const running = snap({ stats: { shotClock: { len: 24, ms: 24_000, at, running: true } } });
    expect(resolveCtsField(running, 0, 'shotClock', { nowMs: T0 + 20_000 })).toBe('4.0');
    // Without an instant: the stored anchor reading (back-compat).
    expect(resolveCtsField(running, 0, 'shotClock')).toBe('24');
    const off = snap({ stats: { shotClock: { len: 0, ms: 0, at, running: false, off: true } } });
    expect(resolveCtsField(off, 0, 'shotClock', { nowMs: T0 })).toBe('');
    const sideOff = snap({ stats: { homeShotClock: { ms: 9_000, at, running: false, off: true } } });
    expect(resolveCtsField(sideOff, 0, 'homeShotClock', { nowMs: T0 })).toBe('');
    const expired = snap({ stats: { shotClock: { len: 24, ms: 3_000, at, running: true } } });
    expect(resolveCtsField(expired, 0, 'shotClock', { nowMs: T0 + 9_000 })).toBe('0.0');
  });
});
