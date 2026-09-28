/**
 * K12-F18 — the console's one-line FINAL summary reads the sport's result
 * (gameResult), and the unit keys the surfaces print exist in the catalog.
 */
import { gameResult } from '@cms/api-types';
import en from '@/i18n/messages/en.json';
import { finalSummary, RESULT_UNIT_KEY } from '../sports-result-labels';

const messages = (en as { sportsResult: Record<string, string> }).sportsResult;
// A minimal formatter over the real English messages (placeholders only).
const t = (key: 'finalWon' | 'finalTie' | 'finalNone', values: Record<string, string> = {}) =>
  messages[key].replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);
const teams = { home: 'Central', away: 'Westview' };

describe('finalSummary (K12-F18)', () => {
  it('names the winner with the winning total first — a 3–1 volleyball match, not 0–0', () => {
    const vb = gameResult({ sport: 'volleyball', status: 'FINAL', homeScore: 0, awayScore: 0, stats: { homeSets: 1, awaySets: 3 } });
    expect(finalSummary(t, vb, teams)).toBe('Final: Westview won 3–1');
  });

  it('says tied for a real tie and "no result" when nothing was recorded', () => {
    expect(finalSummary(t, gameResult({ sport: 'soccer', status: 'FINAL', homeScore: 2, awayScore: 2 }), teams)).toBe(
      'Final: tied 2–2',
    );
    expect(finalSummary(t, gameResult({ sport: 'volleyball', status: 'FINAL' }), teams)).toBe(
      'Final: no result was recorded',
    );
  });

  it('is empty for a game still in play', () => {
    expect(finalSummary(t, gameResult({ sport: 'soccer', status: 'LIVE', homeScore: 1 }), teams)).toBe('');
  });

  it('every result unit has its catalog message', () => {
    for (const key of Object.values(RESULT_UNIT_KEY)) expect(messages[key]).toBeTruthy();
  });
});
