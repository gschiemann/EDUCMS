/**
 * "Sign in another way on this device" + the passkey-miss diagnostics — the
 * pure decisions (2026-10-05). The page-level states are proved in
 * app/login/__tests__/passkey-elsewhere.test.tsx; these are the tables.
 */
jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  browserSupportsWebAuthnAutofill: () => Promise.resolve(false),
  platformAuthenticatorIsAvailable: () => Promise.resolve(true),
  startAuthentication: jest.fn(),
  startRegistration: jest.fn(),
  WebAuthnAbortService: { cancelCeremony: jest.fn() },
}));

import en from '../../i18n/messages/en.json';
import {
  emailCodeSendErrorKey,
  emailCodeVerifyError,
  otherWaysFor,
  readMfaFallbacks,
} from '../mfa-other-ways';
import { passkeyDeviceKind, passkeyErrorName, passkeyMissDiagnostics } from '../passkeys';

const authKeys = en.auth as Record<string, string>;

describe('readMfaFallbacks', () => {
  it.each([
    [{ mfaFallbacks: ['backup', 'email'] }, ['backup', 'email']],
    [{ mfaFallbacks: [] }, []],
    // Anything the page does not know how to offer is dropped, not trusted.
    [{ mfaFallbacks: ['email', 'sms', 42, null] }, ['email']],
    // ABSENT (an API from before 2026-10-05) is null — "not said", not "none".
    [{}, null],
    [{ mfaFallbacks: 'email' }, null],
    [null, null],
  ])('%j → %j', (input, out) => {
    expect(readMfaFallbacks(input)).toEqual(out);
  });
});

describe('otherWaysFor — what the list offers', () => {
  it.each<[string[], string[] | null, string[]]>([
    // The owner: passkey only (on his Mac), backup codes, mail configured.
    [['passkey'], ['backup', 'email'], ['backup', 'email']],
    [['passkey', 'totp'], ['backup', 'email'], ['totp', 'backup', 'email']],
    // Mail not configured / a fresh password reset: no emailed code.
    [['passkey'], ['backup'], ['backup']],
    // Nothing else at all: an empty list — the page then says to use the
    // device that has the passkey.
    [['passkey'], [], []],
    // An older API (no field): exactly what shipped — backup code, no email.
    [['passkey'], null, ['backup']],
    [['totp'], null, ['totp', 'backup']],
  ])('methods %j + fallbacks %j → %j', (methods, fallbacks, out) => {
    expect(otherWaysFor(methods, fallbacks)).toEqual(out);
  });
});

describe('emailed-code refusals map to catalog sentences (never the server English)', () => {
  it.each([
    [409, 'MFA_EMAIL_CODE_AFTER_RESET', 'emailCodeAfterReset'],
    [409, 'MFA_EMAIL_CODE_UNAVAILABLE', 'emailCodeUnavailable'],
    [429, 'MFA_EMAIL_CODE_TOO_MANY', 'emailCodeTooMany'],
    [429, undefined, 'emailCodeTooMany'],
    [503, 'MFA_EMAIL_CODE_SEND_FAILED', 'emailCodeSendFailed'],
    [500, undefined, 'emailCodeSendFailed'],
  ])('send %s %s → auth.%s', (status, code, key) => {
    expect(emailCodeSendErrorKey(status, code)).toBe(key);
    expect(authKeys[key]).toBeTruthy();
  });

  it.each([
    [401, { code: 'MFA_EMAIL_CODE_INVALID', attemptsLeft: 3 }, { key: 'emailCodeWrong', values: { count: 3 } }],
    [401, { code: 'MFA_EMAIL_CODE_INVALID' }, { key: 'mfaCodeMismatch' }],
    [401, { code: 'MFA_EMAIL_CODE_EXPIRED' }, { key: 'emailCodeExpired' }],
    [401, { code: 'MFA_EMAIL_CODE_LOCKED', attemptsLeft: 0 }, { key: 'emailCodeLocked' }],
    [400, { code: 'MFA_EMAIL_CODE_FORMAT' }, { key: 'emailCodeEnter' }],
    [429, { code: 'MFA_LOCKED_OUT' }, { key: 'passkeyTooMany' }],
  ])('verify %s %j → %j', (status, body, out) => {
    expect(emailCodeVerifyError(status, body)).toEqual(out);
    expect(authKeys[out.key]).toBeTruthy();
  });
});

describe('passkeyDeviceKind — "Add a passkey for this <device>"', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iphone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'ipad'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'mac'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'other'],
    ['', 'other'],
  ])('%j → %s', (ua, kind) => {
    expect(passkeyDeviceKind(ua)).toBe(kind);
  });

  it('every kind has its own sentence in the catalog', () => {
    const msg = (en.passkeys as Record<string, string>).addForDevice;
    for (const kind of ['iphone', 'ipad', 'android', 'mac', 'windows', 'other']) {
      expect(msg).toMatch(new RegExp(`\\b${kind} \\{Add a passkey for this `));
    }
  });
});

describe('passkeyMissDiagnostics — tell "not synced" from "different web address"', () => {
  const err = (name: string) => Object.assign(new Error('x'), { name });

  it('records the error name, the page host and whether the account had passkeys — nothing else', () => {
    expect(
      passkeyMissDiagnostics({ stage: 'mfa', err: err('NotAllowedError'), accountHasPasskeys: true, host: 'venue-os.app' }),
    ).toEqual({ stage: 'mfa', errorName: 'NotAllowedError', reason: 'cancelled', host: 'venue-os.app', accountHasPasskeys: true });
    // A wrong-address refusal is told apart by its own name.
    expect(
      passkeyMissDiagnostics({ stage: 'passwordless', err: err('SecurityError'), accountHasPasskeys: null, host: 'educms-five.vercel.app' }),
    ).toMatchObject({ errorName: 'SecurityError', reason: 'wrong-domain', host: 'educms-five.vercel.app', accountHasPasskeys: null });
    // A create ceremony is graded as a create (InvalidStateError = already registered).
    expect(
      passkeyMissDiagnostics({ stage: 'offer-create', err: err('InvalidStateError'), accountHasPasskeys: null, host: 'h' }),
    ).toMatchObject({ reason: 'already-registered' });
  });

  it('defaults the host to this page, and an unnamed error is "unknown"', () => {
    const d = passkeyMissDiagnostics({ stage: 'mfa', err: new Error('boom'), accountHasPasskeys: true });
    expect(d.host).toBe(window.location.host);
    expect(d.errorName).toBe('unknown');
    expect(Object.keys(d).sort()).toEqual(['accountHasPasskeys', 'errorName', 'host', 'reason', 'stage']);
  });

  it('passkeyErrorName reads a wrapped WebAuthnError cause too', () => {
    expect(passkeyErrorName({ name: 'Error', cause: { name: 'AbortError' } })).toBe('AbortError');
    expect(passkeyErrorName(null)).toBe('');
  });
});
