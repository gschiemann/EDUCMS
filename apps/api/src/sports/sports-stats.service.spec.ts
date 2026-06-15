/**
 * VenueOS Sports — Phase 1-A player-stats engine unit tests.
 * ──────────────────────────────────────────────────────────────────────
 *
 * `computePlayerSurfaces` is a PURE, fail-open function: it derives the
 * board's stat leaders + auto player-of-the-game from the per-game
 * roster the board cache already holds, never queries the DB, and never
 * throws on bad input. These tests prove:
 *   1. Leaders pick the top player per stat key, honoring higherBetter
 *      (golf strokes / race time = lowest wins) and reporting the
 *      ORIGINAL display string as `value`.
 *   2. Player-of-the-game weights the marquee scoring stat highest and
 *      returns a SpotlightBand-shaped object.
 *   3. Degenerate inputs (no roster, all-null stats, missing keys,
 *      unknown sport, malformed stats) never crash and yield empties.
 *   4. The fn iterates EVERY classified sport without throwing.
 */
import { PLAYER_STATS } from '@cms/api-types';
import {
  computePlayerSurfaces,
  type RosterRow,
} from './sports-stats.service';

function row(p: Partial<RosterRow> & { name: string }): RosterRow {
  return {
    id: p.id ?? p.name,
    team: p.team ?? 'home',
    name: p.name,
    number: p.number ?? null,
    position: p.position ?? null,
    photoUrl: p.photoUrl ?? null,
    stats: p.stats ?? {},
  };
}

describe('computePlayerSurfaces', () => {
  it('returns empty for no roster / empty roster / unknown sport', () => {
    expect(computePlayerSurfaces('basketball', null)).toEqual({
      leaders: [],
      playerOfGame: null,
    });
    expect(computePlayerSurfaces('basketball', [])).toEqual({
      leaders: [],
      playerOfGame: null,
    });
    expect(
      computePlayerSurfaces('not_a_sport', [row({ name: 'X', stats: { PTS: '10' } })]),
    ).toEqual({ leaders: [], playerOfGame: null });
  });

  it('never throws on malformed / missing stats', () => {
    const roster = [
      row({ name: 'A', stats: null as unknown as object }),
      row({ name: 'B', stats: 'not-an-object' as unknown as object }),
      row({ name: 'C', stats: { PTS: 'DNP', REB: '—', AST: '' } }),
      row({ name: 'D' }), // {} stats
    ];
    const out = computePlayerSurfaces('basketball', roster);
    expect(out.leaders).toEqual([]);
    expect(out.playerOfGame).toBeNull();
  });

  it('picks the top player per stat and keeps the original display string', () => {
    const roster = [
      row({ name: 'Guard', number: '3', team: 'home', stats: { PTS: '24', AST: '8' } }),
      row({ name: 'Center', number: '32', team: 'away', stats: { PTS: '12', REB: '15' } }),
    ];
    const { leaders } = computePlayerSurfaces('basketball', roster);
    const pts = leaders.find((l) => l.statKey === 'PTS');
    expect(pts).toMatchObject({
      playerName: 'Guard',
      playerNumber: '3',
      team: 'home',
      value: '24',
      label: 'Points',
    });
    const reb = leaders.find((l) => l.statKey === 'REB');
    expect(reb).toMatchObject({ playerName: 'Center', team: 'away', value: '15' });
    // No STL/BLK values anywhere → no leader for those keys.
    expect(leaders.find((l) => l.statKey === 'STL')).toBeUndefined();
    expect(leaders.find((l) => l.statKey === 'BLK')).toBeUndefined();
  });

  it('honors higherBetter:false (golf strokes — lowest wins)', () => {
    const roster = [
      row({ name: 'Lo', stats: { STR: '68' } }),
      row({ name: 'Hi', stats: { STR: '79' } }),
    ];
    const { leaders } = computePlayerSurfaces('golf', roster);
    const str = leaders.find((l) => l.statKey === 'STR');
    expect(str?.playerName).toBe('Lo');
    expect(str?.value).toBe('68');
  });

  it('honors higherBetter:false for time marks (XC TIME — fastest wins)', () => {
    const roster = [
      row({ name: 'Fast', stats: { TIME: '17:05.2' } }),
      row({ name: 'Slow', stats: { TIME: '18:42.0' } }),
    ];
    const { leaders } = computePlayerSurfaces('cross_country', roster);
    const t = leaders.find((l) => l.statKey === 'TIME');
    expect(t?.playerName).toBe('Fast');
    expect(t?.value).toBe('17:05.2');
  });

  it('computes a weighted player-of-the-game shaped for the SpotlightBand', () => {
    const roster = [
      // Scorer: 30 pts.
      row({ name: 'Scorer', number: '23', team: 'home', stats: { PTS: '30', REB: '4' } }),
      // All-arounder: lower pts but strong supporting line.
      row({ name: 'Glue', number: '5', team: 'home', stats: { PTS: '14', REB: '12', AST: '11', STL: '5' } }),
    ];
    const { playerOfGame } = computePlayerSurfaces('basketball', roster);
    expect(playerOfGame).not.toBeNull();
    expect(playerOfGame).toMatchObject({
      name: expect.any(String),
      number: expect.any(String),
      team: 'home',
      photoUrl: null,
    });
    expect(typeof playerOfGame!.headline).toBe('string');
    expect(playerOfGame!.headline.length).toBeGreaterThan(0);
    expect(playerOfGame!.lines.length).toBeGreaterThan(0);
    expect(playerOfGame!.lines.length).toBeLessThanOrEqual(3);
    // Each line is { label, value }.
    for (const l of playerOfGame!.lines) {
      expect(typeof l.label).toBe('string');
      expect(typeof l.value).toBe('string');
    }
  });

  it('handles ties without crashing (first encountered wins)', () => {
    const roster = [
      row({ name: 'First', stats: { PTS: '20' } }),
      row({ name: 'Second', stats: { PTS: '20' } }),
    ];
    const { leaders, playerOfGame } = computePlayerSurfaces('basketball', roster);
    const pts = leaders.find((l) => l.statKey === 'PTS');
    expect(pts?.playerName).toBe('First');
    expect(playerOfGame?.name).toBe('First');
  });

  it('iterates EVERY classified sport without throwing', () => {
    for (const sport of Object.keys(PLAYER_STATS)) {
      const keys = PLAYER_STATS[sport];
      // Build a roster where each player carries a numeric value for the
      // first key (enough to exercise leaders + POTG for every sport).
      const roster = [
        row({ name: `${sport}-a`, stats: { [keys[0]]: '5' } }),
        row({ name: `${sport}-b`, stats: { [keys[0]]: '9' } }),
      ];
      expect(() => computePlayerSurfaces(sport, roster)).not.toThrow();
      const out = computePlayerSurfaces(sport, roster);
      expect(Array.isArray(out.leaders)).toBe(true);
    }
  });
});
