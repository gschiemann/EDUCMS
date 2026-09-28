/**
 * K12-F18 — the words every surface prints beside a game's RESULT
 * (gameResult, @cms/api-types sports-result.ts): what the two numbers count
 * when they are not the score shown all game, and the operator's one-line
 * summary of a final. Messages live in the `sportsResult` catalog namespace
 * (en / es / zh); this module only maps a result onto them, so the board,
 * the ribbon, the game list and the console can never word it differently.
 */
import type { GameResult, ResultUnit } from '@cms/api-types';

/** The `sportsResult` message key of a result unit. */
export const RESULT_UNIT_KEY: Record<ResultUnit, 'unitSets' | 'unitGames' | 'unitTeamPoints'> = {
  sets: 'unitSets',
  games: 'unitGames',
  'team-points': 'unitTeamPoints',
};

type ResultT = (key: 'finalWon' | 'finalTie' | 'finalNone', values?: Record<string, string>) => string;

/**
 * The console's one-line FINAL summary: "Final: Central won 3–1", "Final:
 * tied 2–2", "Final: no result was recorded". The winner's total is printed
 * first, the way a result is read out. Empty for a game that is not final.
 */
export function finalSummary(
  t: ResultT,
  result: GameResult,
  teams: { home: string; away: string },
): string {
  if (!result.final) return '';
  if (result.outcome === 'tie') return t('finalTie', { score: `${result.homeText}–${result.awayText}` });
  if (result.winner === 'home') {
    return t('finalWon', { team: teams.home, score: `${result.homeText}–${result.awayText}` });
  }
  if (result.winner === 'away') {
    return t('finalWon', { team: teams.away, score: `${result.awayText}–${result.homeText}` });
  }
  return t('finalNone');
}
