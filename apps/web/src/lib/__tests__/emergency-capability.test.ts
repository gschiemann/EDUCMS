import { hasPanicAuthority, canSendAllClear } from '../emergency-capability';

/**
 * Mobile design package §10 / §4.4 — emergency discovery follows the
 * CAPABILITY. The delegated-staff cases below are the ones the three old
 * role-only gates got wrong.
 */
describe('hasPanicAuthority', () => {
  it.each(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'])(
    '%s carries authority from the role alone',
    (role) => {
      expect(hasPanicAuthority({ role })).toBe(true);
    },
  );

  it('a CONTRIBUTOR granted canTriggerPanic is authorized — the delegated staffer', () => {
    expect(hasPanicAuthority({ role: 'CONTRIBUTOR', canTriggerPanic: true })).toBe(true);
  });

  it('a RESTRICTED_VIEWER granted canTriggerPanic is authorized (the flag is the grant)', () => {
    expect(hasPanicAuthority({ role: 'RESTRICTED_VIEWER', canTriggerPanic: true })).toBe(true);
  });

  it('a CONTRIBUTOR without the flag is not', () => {
    expect(hasPanicAuthority({ role: 'CONTRIBUTOR' })).toBe(false);
    expect(hasPanicAuthority({ role: 'CONTRIBUTOR', canTriggerPanic: false })).toBe(false);
  });

  it('fails closed on no user and on an unknown role', () => {
    expect(hasPanicAuthority(null)).toBe(false);
    expect(hasPanicAuthority(undefined)).toBe(false);
    expect(hasPanicAuthority({})).toBe(false);
    expect(hasPanicAuthority({ role: 'SOMETHING_NEW' })).toBe(false);
  });

  it('only the exact boolean true grants — a truthy non-boolean does not', () => {
    // A session that predates the column, or a payload that stringified it,
    // is "no evidence" — never a grant.
    expect(hasPanicAuthority({ role: 'CONTRIBUTOR', canTriggerPanic: 'true' as never })).toBe(false);
    expect(hasPanicAuthority({ role: 'CONTRIBUTOR', canTriggerPanic: 1 as never })).toBe(false);
    expect(hasPanicAuthority({ role: 'CONTRIBUTOR', canTriggerPanic: null })).toBe(false);
  });
});

describe('canSendAllClear', () => {
  it('matches the trigger rule today, and is its own call site for when it stops', () => {
    expect(canSendAllClear({ role: 'SCHOOL_ADMIN' })).toBe(true);
    expect(canSendAllClear({ role: 'CONTRIBUTOR', canTriggerPanic: true })).toBe(true);
    expect(canSendAllClear({ role: 'CONTRIBUTOR' })).toBe(false);
    expect(canSendAllClear(null)).toBe(false);
  });
});
