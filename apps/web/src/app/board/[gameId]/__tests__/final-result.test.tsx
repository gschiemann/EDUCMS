/**
 * K12-F18 — the board's FINAL scene names the winner from the SPORT's result
 * model (gameResult, @cms/api-types sports-result.ts), never from the raw
 * score columns. Renders the production `DefaultBoardScene` (the component
 * ScoreboardPage mounts) at status FINAL, landscape and portrait.
 *
 * The audit's reproduction is case 1: a volleyball FINAL whose rally columns
 * were zeroed by the last set (0–0) with sets 3–1 read "0–0 TIE".
 */
import { render } from '@testing-library/react';
import { findSport } from '@cms/api-types';
import { DefaultBoardScene, type BoardData } from '../page';

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

function finalBoard(sport: string, over: Partial<BoardData>, vp = { w: 1920, h: 1080 }) {
  const data: BoardData = {
    id: 'game-final-test',
    sport,
    status: 'FINAL',
    segment: 4,
    homeTeam: 'Home Lions',
    awayTeam: 'Away Tigers',
    homeScore: 0,
    awayScore: 0,
    homeColor: '#1e3a5f',
    awayColor: '#9b1c2e',
    homeLogoUrl: null,
    awayLogoUrl: null,
    clockMs: 0,
    clockRunning: false,
    clockUpdatedAt: new Date().toISOString(),
    stats: {},
    cues: [],
    serverTime: Date.now(),
    ...over,
  };
  const def = findSport(sport)!;
  return render(
    <DefaultBoardScene data={data} def={def} displayData={data} vp={vp} activeCue={null} keyframes={null} />,
  );
}

/** The text of every element whose OWN text is exactly `t`. */
function exact(container: HTMLElement, t: string): Element[] {
  return Array.from(container.querySelectorAll('*')).filter(
    (el) => el.children.length === 0 && (el.textContent || '').trim() === t,
  );
}

describe('K12-F18 — the final scene shows the sport’s result', () => {
  it('volleyball 3–1 with zeroed rally columns: WINNER home, 3 and 1, never TIE, set by set', () => {
    const { container, getByTestId } = finalBoard('volleyball', {
      stats: {
        homeSets: 3,
        awaySets: 1,
        setScores: [
          { home: 25, away: 20 },
          { home: 22, away: 25 },
          { home: 25, away: 18 },
          { home: 25, away: 23 },
        ],
      },
    });
    expect(container.textContent).toContain('WINNER');
    expect(container.textContent).toContain('HOME LIONS');
    expect(exact(container, '3')).toHaveLength(1);
    expect(exact(container, '1')).toHaveLength(1);
    expect(exact(container, '0')).toHaveLength(0);
    expect(exact(container, 'TIE')).toHaveLength(0);
    expect(getByTestId('final-result-caption').textContent).toBe('sets   ·   25–20  ·  22–25  ·  25–18  ·  25–23');
  });

  it('pickleball 0–2 in games: the away team is crowned, counted in games', () => {
    const { container, getByTestId } = finalBoard('pickleball', { stats: { homeGames: 0, awayGames: 2 } });
    expect(container.textContent).toContain('AWAY TIGERS');
    expect(getByTestId('final-result-caption').textContent).toBe('games');
  });

  it('a wrestling dual: team points decide, not the last bout', () => {
    const { container, getByTestId } = finalBoard('wrestling', {
      homeScore: 2,
      awayScore: 9,
      stats: { homeTeamPoints: 30, awayTeamPoints: 27 },
    });
    expect(container.textContent).toContain('HOME LIONS');
    expect(exact(container, '30')).toHaveLength(1);
    expect(exact(container, '9')).toHaveLength(0);
    expect(getByTestId('final-result-caption').textContent).toBe('team points');
  });

  it('golf: the low score is crowned and the scene says why', () => {
    const { container, getByTestId } = finalBoard('golf', { homeScore: 312, awayScore: 305 });
    expect(container.textContent).toContain('AWAY TIGERS');
    expect(getByTestId('final-result-caption').textContent).toBe('low score wins');
  });

  it('a legitimate tie reads TIE with no winner', () => {
    const { container } = finalBoard('soccer', { homeScore: 1, awayScore: 1 });
    expect(exact(container, 'TIE')).toHaveLength(1);
    expect(container.textContent).not.toContain('WINNER');
  });

  it('a final that recorded nothing claims neither a winner nor a tie', () => {
    const { container } = finalBoard('volleyball', { stats: {} });
    expect(container.textContent).not.toContain('WINNER');
    expect(exact(container, 'TIE')).toHaveLength(0);
  });

  it('portrait (LED poster): the result totals and their unit, not the zeroed columns', () => {
    const { container } = finalBoard('volleyball', { stats: { homeSets: 1, awaySets: 3 } }, { w: 960, h: 1080 });
    expect(exact(container, '3')).toHaveLength(1);
    expect(exact(container, '1')).toHaveLength(1);
    expect(exact(container, '0')).toHaveLength(0);
    expect(exact(container, 'sets')).toHaveLength(2);
  });
});
