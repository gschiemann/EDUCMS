/**
 * The per-team stat rows the phone Run view and the volunteer pad render
 * (K12-F15 / F16) — pinned against the REAL sport definitions so a def
 * change re-decides both surfaces, exactly as it re-decides the desktop tile.
 */
import { findSport, SPORTS } from '@cms/api-types';
import {
  baseballCountPatch,
  baseballHalfAdvance,
  basketballBonus,
  fmtMinSec,
  isBottomHalf,
  parseMinSec,
  shortStatLabel,
  shotClockResets,
  teamStatRows,
} from '../sports-stat-rows';

const sport = (k: string) => findSport(k)!;

describe('teamStatRows', () => {
  it('basketball: Fouls then Timeouts, each paired HOME | AWAY', () => {
    const rows = teamStatRows(sport('basketball'));
    expect(rows.map((r) => [r.id, r.kind, r.home?.key, r.away?.key])).toEqual([
      ['Fouls', 'fouls', 'homeFouls', 'awayFouls'],
      ['Timeouts', 'timeouts', 'homeTimeouts', 'awayTimeouts'],
    ]);
    expect(rows[0]).toMatchObject({ label: 'Fouls', min: 0, max: 30 });
  });

  it('baseball: pitch count, hits, errors — count keys are game-scope, not rows', () => {
    const rows = teamStatRows(sport('baseball'));
    expect(rows.map((r) => r.id)).toEqual(['PitchCount', 'Hits', 'Errors']);
    expect(rows.every((r) => r.home && r.away)).toBe(true);
  });

  it('wrestling: ride time is its own kind; team points a counter', () => {
    const rows = teamStatRows(sport('wrestling'));
    expect(rows.find((r) => r.id === 'RideTime')?.kind).toBe('rideTime');
    expect(rows.find((r) => r.id === 'TeamPoints')?.kind).toBe('counter');
  });

  it('golf vs-par and cheer routine are text rows', () => {
    expect(teamStatRows(sport('golf')).find((r) => r.id === 'Par')?.kind).toBe('text');
    expect(teamStatRows(sport('competitive_cheer')).find((r) => r.id === 'Routine')?.kind).toBe('text');
  });

  it('matches the desktop tile filter for every sport (number/text, home*/away*, no clock keys)', () => {
    for (const def of SPORTS) {
      const expected = def.stats
        .filter(
          (s) =>
            (s.type === 'number' || s.type === 'text') &&
            (s.key.toLowerCase().startsWith('home') || s.key.toLowerCase().startsWith('away')) &&
            !s.key.toLowerCase().includes('clock'),
        )
        .map((s) => s.key)
        .sort();
      const got = teamStatRows(def)
        .flatMap((r) => [r.home?.key, r.away?.key])
        .filter(Boolean)
        .sort();
      expect({ sport: def.key, keys: got }).toEqual({ sport: def.key, keys: expected });
    }
  });

  it('no sport → no rows', () => {
    expect(teamStatRows(undefined)).toEqual([]);
  });

  it('shortStatLabel drops the team word only', () => {
    expect(shortStatLabel('Home Yellow Cards')).toBe('Yellow Cards');
    expect(shortStatLabel('Away Ride Time (s)')).toBe('Ride Time (s)');
    expect(shortStatLabel('Homestand')).toBe('Homestand');
  });
});

describe('basketballBonus — one source for every console surface', () => {
  it('uses the same thresholds as the desktop tile today', () => {
    const bb = sport('basketball');
    expect(basketballBonus(bb, 6)).toBeNull();
    expect(basketballBonus(bb, 7)).toBe('BONUS');
    expect(basketballBonus(bb, 10)).toBe('DOUBLE BONUS');
    expect(basketballBonus(sport('water_polo'), 12)).toBeNull();
  });
});

describe('shotClockResets — the game’s own length, not the sport default', () => {
  it('a game configured to 35 resets to 35 (the audit’s “35 resets to 24” class)', () => {
    expect(shotClockResets(sport('basketball'), { shotClock: { len: 35, ms: 12_000 } })).toEqual({
      full: 35,
      short: 14,
    });
  });
  it('before the clock is armed (never configured), the sport default', () => {
    expect(shotClockResets(sport('basketball'), {})).toEqual({ full: 24, short: 14 });
    expect(shotClockResets(sport('water_polo'), {})).toEqual({ full: 30, short: 20 });
  });
  it('a shot clock the table switched OFF has no reset buttons (K12-F05: OFF is a kept state)', () => {
    expect(shotClockResets(sport('water_polo'), { shotClock: { len: 0, ms: 0, off: true } })).toBeNull();
    expect(shotClockResets(sport('basketball'), { shotClock: { len: 0 } })).toBeNull();
  });
  it('no short button when the short reset is not shorter; null for a sport with no shot clock', () => {
    expect(shotClockResets(sport('basketball'), { shotClock: { len: 14 } })).toEqual({ full: 14, short: null });
    expect(shotClockResets(sport('soccer'), {})).toBeNull();
  });
});

describe('ride time m:ss', () => {
  it('formats and parses', () => {
    expect(fmtMinSec(72)).toBe('1:12');
    expect(fmtMinSec(0)).toBe('0:00');
    expect(parseMinSec('1:12')).toBe(72);
    expect(parseMinSec('72')).toBe(72);
    expect(parseMinSec('')).toBeNull();
    expect(parseMinSec('1:75')).toBeNull();
    expect(parseMinSec('abc')).toBeNull();
  });
});

describe('baseball count — the console BaseTrayBall semantics', () => {
  it('ball / strike stop at 3 / 2; a foul never makes strike three; out clears the count', () => {
    expect(baseballCountPatch('ball', { balls: 2 })).toEqual({ balls: 3 });
    expect(baseballCountPatch('ball', { balls: 3 })).toEqual({ balls: 3 });
    expect(baseballCountPatch('strike', { strikes: 2 })).toEqual({ strikes: 2 });
    expect(baseballCountPatch('foul', { strikes: 1 })).toEqual({ strikes: 2 });
    expect(baseballCountPatch('foul', { strikes: 2 })).toBeNull();
    expect(baseballCountPatch('out', { outs: 2, balls: 3, strikes: 1 })).toEqual({ outs: 3, balls: 0, strikes: 0 });
    expect(baseballCountPatch('ball', null)).toEqual({ balls: 1 });
  });

  it('half advance: Top → Bot same inning; Bot → Top next inning; count + bases cleared', () => {
    expect(baseballHalfAdvance({ half: 'Top', on1B: 1, balls: 2 })).toEqual({
      patch: { half: 'Bot', balls: 0, strikes: 0, outs: 0, on1B: 0, on2B: 0, on3B: 0 },
      segmentDelta: 0,
    });
    expect(baseballHalfAdvance({ half: 'Bottom' }).segmentDelta).toBe(1);
    expect(baseballHalfAdvance({ half: 'Bottom' }).patch.half).toBe('Top');
    expect(isBottomHalf({ half: 'bot' })).toBe(true);
    expect(isBottomHalf({})).toBe(false);
  });
});
