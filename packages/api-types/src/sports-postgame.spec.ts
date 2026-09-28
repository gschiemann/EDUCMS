/** K12-F37 — the postgame hold choices the API and the console share. */
import {
  POSTGAME_HOLD_DEFAULT_MINUTES,
  POSTGAME_HOLD_OPTIONS_MINUTES,
  cleanPostgameHoldMinutes,
  postgameHoldMinutes,
} from './sports-postgame';

describe('postgame hold (K12-F37)', () => {
  it('defaults to a real hold, never an instant cut', () => {
    expect(POSTGAME_HOLD_DEFAULT_MINUTES).toBeGreaterThan(0);
    expect(POSTGAME_HOLD_OPTIONS_MINUTES).toContain(POSTGAME_HOLD_DEFAULT_MINUTES);
    expect(postgameHoldMinutes(undefined)).toBe(POSTGAME_HOLD_DEFAULT_MINUTES);
    expect(postgameHoldMinutes(null)).toBe(POSTGAME_HOLD_DEFAULT_MINUTES);
  });

  it('accepts only the published choices (0 = return right away)', () => {
    expect(cleanPostgameHoldMinutes(0)).toBe(0);
    expect(cleanPostgameHoldMinutes(30)).toBe(30);
    expect(cleanPostgameHoldMinutes('15')).toBe(15);
    for (const bad of [7, -5, 2.5, 'x', '', null, {}, 10_000]) {
      expect(cleanPostgameHoldMinutes(bad)).toBeNull();
    }
    expect(postgameHoldMinutes(7)).toBe(POSTGAME_HOLD_DEFAULT_MINUTES);
    expect(postgameHoldMinutes(0)).toBe(0);
  });
});
