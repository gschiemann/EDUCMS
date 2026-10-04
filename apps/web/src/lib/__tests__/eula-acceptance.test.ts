/**
 * EULA click-through — where a browser's acceptance is kept (2026-10-04).
 *
 * The keys and values here are the ones the sign-in page has always written;
 * a change to any of them silently makes every browser "first time" again (or
 * worse, makes a new browser look like it already accepted).
 */
import {
  clearPendingEulaAcceptance,
  commitPendingEulaAcceptance,
  eulaAcceptedOnThisDevice,
  EULA_ACCEPTED_KEY,
  EULA_PENDING_KEY,
  EULA_VERSION,
  recordEulaAcceptance,
  stashPendingEulaAcceptance,
} from '../eula-acceptance';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the record', () => {
  it('uses the key the sign-in page has always used, versioned', () => {
    expect(EULA_VERSION).toBe('1.0');
    expect(EULA_ACCEPTED_KEY).toBe('edu_cms_eula_accepted_v1.0');
  });

  it('a browser with nothing stored has NOT accepted', () => {
    expect(eulaAcceptedOnThisDevice()).toBe(false);
  });

  it('only the exact value for THIS version counts', () => {
    localStorage.setItem('edu_cms_eula_accepted_v0.9', 'yes');
    expect(eulaAcceptedOnThisDevice()).toBe(false);
    localStorage.setItem(EULA_ACCEPTED_KEY, 'true');
    expect(eulaAcceptedOnThisDevice()).toBe(false);
    localStorage.setItem(EULA_ACCEPTED_KEY, 'yes');
    expect(eulaAcceptedOnThisDevice()).toBe(true);
  });

  it('records acceptance, when, and by whom — the same three keys as before', () => {
    recordEulaAcceptance('pat@elsewhere.example', '2026-10-04T12:00:00.000Z');
    expect(localStorage.getItem(EULA_ACCEPTED_KEY)).toBe('yes');
    expect(localStorage.getItem(`${EULA_ACCEPTED_KEY}_at`)).toBe('2026-10-04T12:00:00.000Z');
    expect(localStorage.getItem(`${EULA_ACCEPTED_KEY}_by`)).toBe('pat@elsewhere.example');
    expect(eulaAcceptedOnThisDevice()).toBe(true);
  });
});

describe('single sign-on: the tick is parked, and recorded only when the sign-in finishes', () => {
  it('parking a tick records NOTHING', () => {
    stashPendingEulaAcceptance('2026-10-04T12:00:00.000Z');
    expect(sessionStorage.getItem(EULA_PENDING_KEY)).toBe('2026-10-04T12:00:00.000Z');
    expect(eulaAcceptedOnThisDevice()).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('the landing page turns it into the record — with the time of the tick and the signed-in address', () => {
    stashPendingEulaAcceptance('2026-10-04T12:00:00.000Z');
    expect(commitPendingEulaAcceptance('teacher@northfield.example')).toBe(true);
    expect(eulaAcceptedOnThisDevice()).toBe(true);
    expect(localStorage.getItem(`${EULA_ACCEPTED_KEY}_at`)).toBe('2026-10-04T12:00:00.000Z');
    expect(localStorage.getItem(`${EULA_ACCEPTED_KEY}_by`)).toBe('teacher@northfield.example');
    // Single use.
    expect(sessionStorage.getItem(EULA_PENDING_KEY)).toBeNull();
    expect(commitPendingEulaAcceptance('someone.else@northfield.example')).toBe(false);
    expect(localStorage.getItem(`${EULA_ACCEPTED_KEY}_by`)).toBe('teacher@northfield.example');
  });

  it('a landing with nothing parked records nothing — a sign-in is not an acceptance', () => {
    expect(commitPendingEulaAcceptance('teacher@northfield.example')).toBe(false);
    expect(eulaAcceptedOnThisDevice()).toBe(false);
  });

  it('a round trip that did not finish is forgotten on the next visit to the sign-in page', () => {
    stashPendingEulaAcceptance();
    clearPendingEulaAcceptance();
    expect(commitPendingEulaAcceptance('teacher@northfield.example')).toBe(false);
    expect(eulaAcceptedOnThisDevice()).toBe(false);
  });
});

describe('storage that throws (Safari private mode, locked-down kiosks)', () => {
  it('never throws, and reads as "not accepted"', () => {
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const remove = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      expect(eulaAcceptedOnThisDevice()).toBe(false);
      expect(() => recordEulaAcceptance('a@b.example')).not.toThrow();
      expect(() => stashPendingEulaAcceptance()).not.toThrow();
      expect(() => clearPendingEulaAcceptance()).not.toThrow();
      expect(commitPendingEulaAcceptance('a@b.example')).toBe(false);
    } finally {
      set.mockRestore();
      get.mockRestore();
      remove.mockRestore();
    }
  });
});
