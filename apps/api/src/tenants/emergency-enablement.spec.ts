/**
 * The pure enablement resolver (@cms/api-types/emergency-enablement).
 *
 * This is the function that replaced a browser `localStorage` key as the
 * source of truth for "is emergency on for this tenant" (handoff §19.5).
 * Its whole job is that NULL — the value every pre-existing row carries —
 * resolves to the SAME answer the old client-side default produced, so
 * shipping the column changes nobody's behavior.
 */
import {
  defaultEmergencyEnabled,
  effectiveEmergencyEnabled,
  emergencyEnablementLocked,
} from '@cms/api-types';

describe('effectiveEmergencyEnabled', () => {
  describe('NULL (never stated) reproduces the old client-side default', () => {
    it('K12 → on', () => {
      expect(effectiveEmergencyEnabled('K12', null)).toBe(true);
      expect(effectiveEmergencyEnabled('K12', undefined)).toBe(true);
    });

    it.each(['GYM', 'RETAIL', 'CORPORATE', 'QSR', 'BAR', 'SPORTS', 'WORSHIP'])(
      '%s → off',
      (vertical) => {
        expect(effectiveEmergencyEnabled(vertical, null)).toBe(false);
        expect(effectiveEmergencyEnabled(vertical, undefined)).toBe(false);
      },
    );
  });

  describe('an explicit stored value wins for an unlocked vertical', () => {
    it('true turns a gym on', () => {
      expect(effectiveEmergencyEnabled('GYM', true)).toBe(true);
    });
    it('false keeps a gym off', () => {
      expect(effectiveEmergencyEnabled('GYM', false)).toBe(false);
    });
  });

  describe('K-12 is locked ON regardless of what is stored', () => {
    // The API refuses to WRITE a false for a K12 tenant, but a row that
    // predates that guard (or a hand-edited one) must never disarm a school.
    it('a stored false still resolves ON', () => {
      expect(effectiveEmergencyEnabled('K12', false)).toBe(true);
    });
    it('is reported as locked', () => {
      expect(emergencyEnablementLocked('K12')).toBe(true);
      expect(emergencyEnablementLocked('GYM')).toBe(false);
    });
  });

  describe('unknown / legacy verticals fail to the K12 default, never to a crash', () => {
    // normalizeVertical maps unknown values to K12, which is the SAFE
    // direction for a life-safety capability: on, not silently off.
    it('an unknown string resolves like K12', () => {
      expect(effectiveEmergencyEnabled('NOT_A_VERTICAL', null)).toBe(true);
      expect(effectiveEmergencyEnabled(undefined, null)).toBe(true);
      expect(effectiveEmergencyEnabled(null, false)).toBe(true);
    });
  });

  it('defaultEmergencyEnabled matches the locked set', () => {
    expect(defaultEmergencyEnabled('K12')).toBe(true);
    expect(defaultEmergencyEnabled('GYM')).toBe(false);
  });
});
