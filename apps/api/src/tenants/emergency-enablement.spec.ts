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

  describe('unknown / legacy verticals default to the K12 answer, never to a crash — but are not LOCKED', () => {
    // normalizeVertical maps unknown values to K12, which is the SAFE
    // direction for a life-safety capability: on, not silently off. An
    // assumption is not a lock, though (2026-09-24): a gym whose industry was
    // never stated must be able to turn alerts off from the dashboard.
    it('an unknown or unstated industry defaults on', () => {
      expect(effectiveEmergencyEnabled('NOT_A_VERTICAL', null)).toBe(true);
      expect(effectiveEmergencyEnabled(undefined, null)).toBe(true);
    });
    it('but a stored false wins, because nothing stated locks it', () => {
      expect(effectiveEmergencyEnabled(null, false)).toBe(false);
      expect(effectiveEmergencyEnabled('NOT_A_VERTICAL', false)).toBe(false);
    });
  });

  it('defaultEmergencyEnabled matches the locked set', () => {
    expect(defaultEmergencyEnabled('K12')).toBe(true);
    expect(defaultEmergencyEnabled('GYM')).toBe(false);
  });
});
