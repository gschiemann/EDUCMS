/** K12-F36 — the automatic-celebration settings and play → cue mapping. */
import {
  CELEBRATION_COOLDOWN_OPTIONS_SEC,
  DEFAULT_CELEBRATION_SETTINGS,
  autoCelebrations,
  celebrationForPlay,
  celebrationSettingsPayload,
  parseCelebrationSettings,
  scoringPlaysOf,
} from './sports-celebrations';
import { SPORT_DEFINITIONS } from './sports';

const on = { ...DEFAULT_CELEBRATION_SETTINGS };

describe('celebration settings (K12-F36)', () => {
  it('defaults to what the engine always did: on, every cue, no cooldown', () => {
    expect(parseCelebrationSettings(undefined)).toEqual({ auto: true, off: [], cooldownSec: 0 });
    // The on/off switch keeps its stored name.
    expect(parseCelebrationSettings({ enabled: false })).toMatchObject({ auto: false });
  });

  it('round-trips, keeps only published cooldowns and sane keys', () => {
    const s = { auto: true, off: ['fieldGoal'], cooldownSec: 30 };
    expect(parseCelebrationSettings(celebrationSettingsPayload(s))).toEqual(s);
    expect(parseCelebrationSettings({ cooldownSec: 7, off: ['a', 'a', 3, ''] })).toEqual({
      auto: true,
      off: ['a'],
      cooldownSec: 0,
    });
    expect(CELEBRATION_COOLDOWN_OPTIONS_SEC).toContain(0);
  });
});

describe('the cue a scoring play fires (K12-F36)', () => {
  const fb = SPORT_DEFINITIONS.football;

  it('maps the play’s points to the sport’s automatic cue', () => {
    expect(celebrationForPlay(fb, 6, on)?.key).toBe('touchdown');
    expect(celebrationForPlay(fb, 3, on)?.key).toBe('fieldGoal');
    expect(celebrationForPlay(fb, 2, on)).toBeNull(); // a safety has no cue
    expect(celebrationForPlay(SPORT_DEFINITIONS.basketball, 3, on)?.key).toBe('threePointer');
    expect(celebrationForPlay(SPORT_DEFINITIONS.basketball, 2, on)).toBeNull();
  });

  it('honors the table: a cue switched off, or automatic celebrations off', () => {
    expect(celebrationForPlay(fb, 3, { ...on, off: ['fieldGoal'] })).toBeNull();
    expect(celebrationForPlay(fb, 6, { ...on, off: ['fieldGoal'] })?.key).toBe('touchdown');
    expect(celebrationForPlay(fb, 6, { ...on, auto: false })).toBeNull();
  });

  it('lists only the cues a play can fire by itself', () => {
    expect(autoCelebrations(fb).map((c) => c.key)).toEqual(['touchdown', 'fieldGoal']);
    expect(autoCelebrations(SPORT_DEFINITIONS.volleyball)).toEqual([]);
  });

  it('reads the plays an event recorded, and a legacy quick-button SCORE event', () => {
    expect(scoringPlaysOf({ plays: [{ team: 'home', points: 3 }, { team: 'x', points: 1 }] })).toEqual([
      { team: 'home', points: 3 },
    ]);
    expect(scoringPlaysOf({ team: 'away', appliedDelta: 2 })).toEqual([{ team: 'away', points: 2 }]);
    // A correction and a minus are not plays.
    expect(scoringPlaysOf({ team: 'set', homeScore: 13 })).toEqual([]);
    expect(scoringPlaysOf({ team: 'home', appliedDelta: -1 })).toEqual([]);
    expect(scoringPlaysOf({ plays: [] })).toEqual([]);
  });
});
