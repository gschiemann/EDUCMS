import { isEmergencyStatusActive } from './emergency-status';

describe('isEmergencyStatusActive', () => {
  it('a calm tenant is NOT in emergency — INACTIVE is what the schema defaults to and all-clear writes', () => {
    expect(isEmergencyStatusActive('INACTIVE')).toBe(false);
  });

  it('every severity the trigger writes IS active', () => {
    for (const s of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])
      expect(isEmergencyStatusActive(s)).toBe(true);
  });

  it('empty, null, and the historical calm spellings stay calm', () => {
    for (const s of [
      null,
      undefined,
      '',
      'NORMAL',
      'NONE',
      'CLEARED',
      'inactive',
      ' INACTIVE ',
    ]) {
      expect(isEmergencyStatusActive(s)).toBe(false);
    }
  });

  it('an unknown non-calm value fails toward ACTIVE — a rollup must never hide a real alert', () => {
    expect(isEmergencyStatusActive('LOCKDOWN')).toBe(true);
  });
});
