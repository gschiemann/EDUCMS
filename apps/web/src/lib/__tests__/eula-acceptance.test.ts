/**
 * EULA click-through — where a browser's acceptance is kept (2026-10-04).
 *
 * The keys and values here are the ones the sign-in page has always written;
 * a change to any of them silently makes every browser "first time" again (or
 * worse, makes a new browser look like it already accepted).
 */
import { EULA_VERSION as API_EULA_VERSION } from '@cms/api-types';
import {
  clearParkedServerTermsAcceptance,
  clearPendingEulaAcceptance,
  commitPendingEulaAcceptance,
  eulaAcceptedOnThisDevice,
  EULA_ACCEPTED_KEY,
  EULA_PENDING_KEY,
  EULA_VERSION,
  parkedServerTermsAcceptance,
  parkServerTermsAcceptance,
  recordEulaAcceptance,
  stashPendingEulaAcceptance,
  TERMS_SERVER_PENDING_KEY,
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

// Launch QA S2 (2026-10-24) — the record that counts is the account's.
describe('the version the server records against', () => {
  it('is the SAME version the browser asks for — a drift would record acceptance of terms nobody saw', () => {
    expect(EULA_VERSION).toBe(API_EULA_VERSION);
  });
});

describe('a tick parked for the account (committed by the dashboard)', () => {
  it('is bound to the account it was given for', () => {
    parkServerTermsAcceptance('u1', new Date().toISOString());
    expect(parkedServerTermsAcceptance('u1')).not.toBeNull();
    expect(parkedServerTermsAcceptance('u2')).toBeNull();
    expect(sessionStorage.getItem(TERMS_SERVER_PENDING_KEY)).toContain('"userId":"u1"');
  });

  it('is short-lived — evidence for the sign-in it was given in, not a later one', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    parkServerTermsAcceptance('u1', new Date(now - 31 * 60_000).toISOString());
    expect(parkedServerTermsAcceptance('u1', now)).toBeNull();
    parkServerTermsAcceptance('u1', new Date(now - 5 * 60_000).toISOString());
    expect(parkedServerTermsAcceptance('u1', now)).not.toBeNull();
  });

  it('is forgotten once used, and a garbled value is never trusted', () => {
    parkServerTermsAcceptance('u1');
    clearParkedServerTermsAcceptance();
    expect(parkedServerTermsAcceptance('u1')).toBeNull();
    sessionStorage.setItem(TERMS_SERVER_PENDING_KEY, '{not json');
    expect(parkedServerTermsAcceptance('u1')).toBeNull();
  });
});
