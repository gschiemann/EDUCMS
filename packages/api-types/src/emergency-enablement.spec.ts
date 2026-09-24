/**
 * An unstated industry must never LOCK a life-safety toggle (2026-09-24). It
 * still defaults on, like a school, because a legacy school that never picked
 * an industry must keep its alarm — but the operator keeps the switch.
 */
import {
  defaultEmergencyEnabled,
  effectiveEmergencyEnabled,
  emergencyEnablementLocked,
  emergencyVerticalStated,
  statedVertical,
} from './emergency-enablement';

describe('statedVertical', () => {
  it('reads a stated industry, its case and its aliases', () => {
    expect(statedVertical('K12')).toBe('K12');
    expect(statedVertical('gym')).toBe('GYM');
    expect(statedVertical('fitness')).toBe('GYM');
  });
  it('is null when nothing was stated', () => {
    expect(statedVertical(null)).toBeNull();
    expect(statedVertical(undefined)).toBeNull();
    expect(statedVertical('')).toBeNull();
    expect(statedVertical('bogus')).toBeNull();
    expect(emergencyVerticalStated(null)).toBe(false);
    expect(emergencyVerticalStated('K12')).toBe(true);
  });
});

describe('an unstated industry', () => {
  it('defaults on like a school, but is NOT locked', () => {
    expect(defaultEmergencyEnabled(null)).toBe(true);
    expect(emergencyEnablementLocked(null)).toBe(false);
    expect(emergencyEnablementLocked('bogus')).toBe(false);
  });
  it('so a stored OFF wins, and nothing stored stays on', () => {
    expect(effectiveEmergencyEnabled(null, false)).toBe(false);
    expect(effectiveEmergencyEnabled(null, null)).toBe(true);
    expect(effectiveEmergencyEnabled(null, true)).toBe(true);
  });
});

describe('a stated K-12 school', () => {
  it('is locked on regardless of what is stored', () => {
    expect(emergencyEnablementLocked('K12')).toBe(true);
    expect(effectiveEmergencyEnabled('K12', false)).toBe(true);
  });
});

describe('a stated gym', () => {
  it('is off until turned on', () => {
    expect(emergencyEnablementLocked('GYM')).toBe(false);
    expect(effectiveEmergencyEnabled('GYM', null)).toBe(false);
    expect(effectiveEmergencyEnabled('GYM', true)).toBe(true);
  });
});
