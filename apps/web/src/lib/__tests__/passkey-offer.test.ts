/**
 * lib/passkey-offer — the decisions behind the post-sign-in passkey offer.
 *
 * "Not now" must hold for 30 days per device and never ask twice in one
 * session — and a browser whose storage THROWS (Safari private mode, a
 * locked-down kiosk profile) must still sign in, just without the memory.
 */
import {
  __resetPasskeyOfferMemoryForTests,
  isPasskeyOfferSnoozed,
  PASSKEY_METHOD_KEYS,
  PASSKEY_OFFER_SESSION_KEY,
  PASSKEY_OFFER_SNOOZE_KEY,
  PASSKEY_OFFER_SNOOZE_MS,
  passkeyMethodFor,
  readPasskeyEnrollmentGrant,
  snoozePasskeyOffer,
} from '../passkey-offer';
import en from '../../i18n/messages/en.json';

const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const DAY = 86_400_000;

beforeEach(() => {
  __resetPasskeyOfferMemoryForTests();
  localStorage.clear();
  sessionStorage.clear();
  jest.restoreAllMocks();
});

describe('snooze — "Not now"', () => {
  it('nothing on hold by default', () => {
    expect(isPasskeyOfferSnoozed(NOW)).toBe(false);
  });

  it('"Not now" holds for 30 days on this device…', () => {
    snoozePasskeyOffer({ forThirtyDays: true }, NOW);
    expect(localStorage.getItem(PASSKEY_OFFER_SNOOZE_KEY)).toBe(String(NOW));
    // A new session on the same device (page flag + sessionStorage gone).
    __resetPasskeyOfferMemoryForTests();
    sessionStorage.clear();
    expect(isPasskeyOfferSnoozed(NOW + 29 * DAY)).toBe(true);
  });

  it('…and asks again after them', () => {
    snoozePasskeyOffer({ forThirtyDays: true }, NOW);
    __resetPasskeyOfferMemoryForTests();
    sessionStorage.clear();
    expect(isPasskeyOfferSnoozed(NOW + PASSKEY_OFFER_SNOOZE_MS)).toBe(false);
    expect(isPasskeyOfferSnoozed(NOW + 31 * DAY)).toBe(false);
  });

  it('never twice in one session — even a "session only" answer holds for the tab', () => {
    snoozePasskeyOffer({ forThirtyDays: false }, NOW);
    expect(localStorage.getItem(PASSKEY_OFFER_SNOOZE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PASSKEY_OFFER_SESSION_KEY)).toBe('1');
    expect(isPasskeyOfferSnoozed(NOW)).toBe(true);
    // A reload in the same tab: page memory is gone, sessionStorage is not.
    __resetPasskeyOfferMemoryForTests();
    expect(isPasskeyOfferSnoozed(NOW)).toBe(true);
    // A new tab / next day: asks again.
    sessionStorage.clear();
    expect(isPasskeyOfferSnoozed(NOW + DAY)).toBe(false);
  });

  it('a timestamp from the FUTURE (a clock that was wrong) never snoozes forever', () => {
    localStorage.setItem(PASSKEY_OFFER_SNOOZE_KEY, String(NOW + 365 * DAY));
    expect(isPasskeyOfferSnoozed(NOW)).toBe(false);
  });

  it('garbage in storage is "not snoozed", not a crash', () => {
    localStorage.setItem(PASSKEY_OFFER_SNOOZE_KEY, 'yesterday-ish');
    expect(isPasskeyOfferSnoozed(NOW)).toBe(false);
  });

  it('storage that THROWS on every call: no crash, and the answer still holds for this page', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => snoozePasskeyOffer({ forThirtyDays: true }, NOW)).not.toThrow();
    expect(isPasskeyOfferSnoozed(NOW)).toBe(true);
  });

  it('storage that throws on READ with nothing answered yet is simply "not snoozed"', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(isPasskeyOfferSnoozed(NOW)).toBe(false);
  });
});

describe('passkeyMethodFor — the words for this device', () => {
  const UA = {
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  };

  it.each([
    ['a Mac', UA.mac, 'apple'],
    ['an iPhone', UA.iphone, 'apple'],
    ['Windows', UA.windows, 'windows'],
    ['Android', UA.android, 'other'],
    ['an empty UA', '', 'other'],
  ])('%s → %s', (_what, ua, expected) => {
    expect(passkeyMethodFor(ua)).toBe(expected);
  });

  it('every method has a sentence in the catalog', () => {
    const auth = (en as unknown as { auth: Record<string, string> }).auth;
    expect(auth[PASSKEY_METHOD_KEYS.apple]).toBe('Face ID or Touch ID');
    expect(auth[PASSKEY_METHOD_KEYS.windows]).toBe('Windows Hello');
    expect(auth[PASSKEY_METHOD_KEYS.other]).toEqual(expect.any(String));
  });
});

describe('readPasskeyEnrollmentGrant — never trust the response shape', () => {
  const GRANT = 'a'.repeat(21) + '_-' + 'B'.repeat(20); // 43 base64url chars

  it('reads the grant the API mints', () => {
    expect(GRANT).toHaveLength(43);
    expect(readPasskeyEnrollmentGrant({ passkeyEnrollment: { grant: GRANT, expiresAt: 'x' } })).toBe(GRANT);
  });

  it.each([
    ['no field at all', { access_token: 't' }],
    ['a null body', null],
    ['a non-string grant', { passkeyEnrollment: { grant: 42 } }],
    ['a short grant', { passkeyEnrollment: { grant: 'abc' } }],
    ['a JWT-looking value', { passkeyEnrollment: { grant: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig' } }],
    ['illegal characters', { passkeyEnrollment: { grant: `${'a'.repeat(42)}/` } }],
  ])('%s → null', (_what, body) => {
    expect(readPasskeyEnrollmentGrant(body)).toBeNull();
  });
});
