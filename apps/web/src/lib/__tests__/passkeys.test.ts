/**
 * lib/passkeys — the parts of WebAuthn that can actually be unit-tested.
 *
 * The ceremony itself cannot be (jsdom has no authenticator), so what is
 * covered here is what an operator SEES when it goes wrong, and what we name
 * their device. Both are table tests, because both are lookup tables and a
 * lookup table's bug is always a missing row.
 *
 * `@simplewebauthn/browser` is mocked: we assert the CALL SHAPE (v13 takes
 * `{ optionsJSON }`, which is the one detail this wrapper exists to own) and
 * drive `browserSupportsWebAuthn`'s answer directly.
 */
const browserSupportsWebAuthn = jest.fn();
const startRegistration = jest.fn();
const startAuthentication = jest.fn();
const platformAuthenticatorIsAvailable = jest.fn();
const browserSupportsWebAuthnAutofill = jest.fn();
const cancelCeremony = jest.fn();

jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: (...a: any[]) => browserSupportsWebAuthn(...a),
  startRegistration: (...a: any[]) => startRegistration(...a),
  startAuthentication: (...a: any[]) => startAuthentication(...a),
  platformAuthenticatorIsAvailable: (...a: unknown[]) => platformAuthenticatorIsAvailable(...a),
  browserSupportsWebAuthnAutofill: (...a: unknown[]) => browserSupportsWebAuthnAutofill(...a),
  WebAuthnAbortService: { cancelCeremony: (...a: unknown[]) => cancelCeremony(...a) },
}));

import en from '../../i18n/messages/en.json';
import {
  cancelPasskeyCeremony,
  conditionalPasskeyAvailable,
  createPasskey,
  describePasskeyError,
  formatPasskeyLastUsed,
  getPasskey,
  getPasskeyFromAutofill,
  guessDeviceLabel,
  passkeyPhoneKind,
  passkeysSupported,
  platformPasskeyAvailable,
  type PasskeyCeremony,
  type PasskeyErrorReason,
} from '../passkeys';

/** A bare DOMException-shaped error, as the browser raises it. */
function domError(name: string): Error {
  const e = new Error(`${name} raised`);
  e.name = name;
  return e;
}

/**
 * What `@simplewebauthn/browser` actually throws: a WebAuthnError whose
 * `name` is copied off the wrapped cause. Modelled here rather than imported
 * so a library change shows up as a RED TEST instead of silently reshaping
 * every error we map.
 */
function wrappedError(causeName: string, ownName?: string): Error {
  const cause = domError(causeName);
  const e = new Error('wrapped') as Error & { cause: Error; code: string };
  e.name = ownName ?? causeName;
  e.cause = cause;
  e.code = 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY';
  return e;
}

beforeEach(() => {
  browserSupportsWebAuthn.mockReset();
  startRegistration.mockReset();
  startAuthentication.mockReset();
  platformAuthenticatorIsAvailable.mockReset();
  browserSupportsWebAuthnAutofill.mockReset();
  cancelCeremony.mockReset();
});

describe('passkeysSupported', () => {
  it('reports what the browser reports', () => {
    browserSupportsWebAuthn.mockReturnValue(true);
    expect(passkeysSupported()).toBe(true);
    browserSupportsWebAuthn.mockReturnValue(false);
    expect(passkeysSupported()).toBe(false);
  });

  it('an unsupported browser that THROWS is still just "unsupported"', () => {
    // A locked-down/embedded WebView can throw on the capability probe
    // itself. That must degrade to "no passkeys here", never to a page that
    // fails to render its sign-in form.
    browserSupportsWebAuthn.mockImplementation(() => { throw new Error('blocked'); });
    expect(passkeysSupported()).toBe(false);
  });
});

describe('createPasskey / getPasskey — v13 call shape', () => {
  it('wraps the server options as { optionsJSON }', async () => {
    startRegistration.mockResolvedValue({ id: 'cred-1' });
    startAuthentication.mockResolvedValue({ id: 'cred-2' });

    await expect(createPasskey({ challenge: 'abc' } as any)).resolves.toEqual({ id: 'cred-1' });
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'abc' } });

    await expect(getPasskey({ challenge: 'def' } as any)).resolves.toEqual({ id: 'cred-2' });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'def' } });
  });
});

describe('describePasskeyError — the mapping table', () => {
  const rows: Array<{
    what: string;
    err: unknown;
    ceremony: PasskeyCeremony;
    reason: PasskeyErrorReason;
    quiet: boolean;
    messageKey: string | null;
  }> = [
    // The one everybody hits. Both platforms overload NotAllowedError for
    // "dismissed" and "timed out"; both are the operator's decision.
    { what: 'NotAllowedError (create)', err: domError('NotAllowedError'), ceremony: 'create', reason: 'cancelled', quiet: true, messageKey: null },
    { what: 'NotAllowedError (get)', err: domError('NotAllowedError'), ceremony: 'get', reason: 'cancelled', quiet: true, messageKey: null },
    { what: 'AbortError', err: domError('AbortError'), ceremony: 'create', reason: 'cancelled', quiet: true, messageKey: null },
    { what: 'InvalidStateError on CREATE', err: domError('InvalidStateError'), ceremony: 'create', reason: 'already-registered', quiet: false, messageKey: 'passkeys.errAlreadyRegistered' },
    // Not "already registered" on a get — that sentence would be a lie. And
    // (2026-09-22) not "couldn't finish SETTING UP the passkey" either: a get
    // is a sign-in, and every get row below gets SIGN-IN copy.
    { what: 'InvalidStateError on GET', err: domError('InvalidStateError'), ceremony: 'get', reason: 'failed', quiet: false, messageKey: 'passkeys.errSignInGeneric' },
    { what: 'SecurityError (get)', err: domError('SecurityError'), ceremony: 'get', reason: 'wrong-domain', quiet: false, messageKey: 'passkeys.errWrongDomain' },
    { what: 'SecurityError (create)', err: domError('SecurityError'), ceremony: 'create', reason: 'wrong-domain', quiet: false, messageKey: 'passkeys.errWrongDomain' },
    { what: 'NotSupportedError (create)', err: domError('NotSupportedError'), ceremony: 'create', reason: 'unsupported', quiet: false, messageKey: 'passkeys.errUnsupported' },
    { what: 'ConstraintError (create)', err: domError('ConstraintError'), ceremony: 'create', reason: 'unsupported', quiet: false, messageKey: 'passkeys.errUnsupported' },
    { what: 'NotSupportedError (get)', err: domError('NotSupportedError'), ceremony: 'get', reason: 'unsupported', quiet: false, messageKey: 'passkeys.errSignInUnsupported' },
    { what: 'ConstraintError (get)', err: domError('ConstraintError'), ceremony: 'get', reason: 'unsupported', quiet: false, messageKey: 'passkeys.errSignInUnsupported' },
    { what: 'UnknownError (create)', err: domError('UnknownError'), ceremony: 'create', reason: 'failed', quiet: false, messageKey: 'passkeys.errGeneric' },
    { what: 'UnknownError (get)', err: domError('UnknownError'), ceremony: 'get', reason: 'failed', quiet: false, messageKey: 'passkeys.errSignInGeneric' },
    { what: 'a plain Error', err: new Error('boom'), ceremony: 'create', reason: 'failed', quiet: false, messageKey: 'passkeys.errGeneric' },
    { what: 'null', err: null, ceremony: 'create', reason: 'failed', quiet: false, messageKey: 'passkeys.errGeneric' },
    { what: 'undefined', err: undefined, ceremony: 'get', reason: 'failed', quiet: false, messageKey: 'passkeys.errSignInGeneric' },
    { what: 'a string', err: 'nope', ceremony: 'get', reason: 'failed', quiet: false, messageKey: 'passkeys.errSignInGeneric' },
    // SimpleWebAuthn's wrapper copies `name` off the cause…
    { what: 'WebAuthnError wrapping NotAllowedError', err: wrappedError('NotAllowedError'), ceremony: 'get', reason: 'cancelled', quiet: true, messageKey: null },
    { what: 'WebAuthnError wrapping InvalidStateError', err: wrappedError('InvalidStateError'), ceremony: 'create', reason: 'already-registered', quiet: false, messageKey: 'passkeys.errAlreadyRegistered' },
    // …and if a future version ever stops doing that, `cause.name` still maps.
    { what: 'a wrapper named "Error" with a NotAllowedError cause', err: wrappedError('NotAllowedError', 'Error'), ceremony: 'get', reason: 'cancelled', quiet: true, messageKey: null },
  ];

  it.each(rows)('$what → $reason', ({ err, ceremony, reason, quiet, messageKey }) => {
    expect(describePasskeyError(err, ceremony)).toEqual({ reason, quiet, messageKey });
  });

  it('defaults to the create ceremony', () => {
    expect(describePasskeyError(domError('InvalidStateError')).reason).toBe('already-registered');
  });

  it('a quiet result NEVER carries a message — a cancel must paint nothing', () => {
    for (const r of rows.filter((x) => x.quiet)) {
      const d = describePasskeyError(r.err, r.ceremony);
      expect(d.quiet).toBe(true);
      expect(d.messageKey).toBeNull();
    }
  });

  it('NO sign-in failure ever talks about setting up or creating a passkey (the copy itself, en)', () => {
    // Read the SENTENCE, not just the key: the bug was a key whose English
    // said "couldn't finish setting up the passkey" on the sign-in screen.
    const passkeysCopy = (en as unknown as { passkeys: Record<string, string> }).passkeys;
    const loud = rows.filter((r) => r.ceremony === 'get' && !r.quiet);
    expect(loud.length).toBeGreaterThan(4);
    for (const r of loud) {
      const key = describePasskeyError(r.err, 'get').messageKey as string;
      const sentence = passkeysCopy[key.replace(/^passkeys\./, '')];
      expect(sentence).toEqual(expect.any(String));
      expect(sentence).not.toMatch(/set(ting)? ?up|creat/i);
    }
  });
});

describe('platformPasskeyAvailable — "does this device have Face ID / Touch ID / Windows Hello?"', () => {
  it('answers what the platform answers', async () => {
    browserSupportsWebAuthn.mockReturnValue(true);
    platformAuthenticatorIsAvailable.mockResolvedValue(true);
    await expect(platformPasskeyAvailable()).resolves.toBe(true);
    platformAuthenticatorIsAvailable.mockResolvedValue(false);
    await expect(platformPasskeyAvailable()).resolves.toBe(false);
  });

  it('is false without WebAuthn at all, and never even asks', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    await expect(platformPasskeyAvailable()).resolves.toBe(false);
    expect(platformAuthenticatorIsAvailable).not.toHaveBeenCalled();
  });

  it('a probe that THROWS or REJECTS is just "no"', async () => {
    browserSupportsWebAuthn.mockReturnValue(true);
    platformAuthenticatorIsAvailable.mockImplementation(() => { throw new Error('blocked'); });
    await expect(platformPasskeyAvailable()).resolves.toBe(false);
    platformAuthenticatorIsAvailable.mockRejectedValue(new Error('nope'));
    await expect(platformPasskeyAvailable()).resolves.toBe(false);
  });

  it('a probe that NEVER settles is "no" within the timeout — a sign-in is never held hostage', async () => {
    jest.useFakeTimers();
    try {
      browserSupportsWebAuthn.mockReturnValue(true);
      platformAuthenticatorIsAvailable.mockReturnValue(new Promise(() => undefined));
      const pending = platformPasskeyAvailable(500);
      await jest.advanceTimersByTimeAsync(600);
      await expect(pending).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('conditionalPasskeyAvailable — "can the browser offer passkeys from a field\'s own autofill?"', () => {
  it('answers what the browser answers', async () => {
    browserSupportsWebAuthn.mockReturnValue(true);
    browserSupportsWebAuthnAutofill.mockResolvedValue(true);
    await expect(conditionalPasskeyAvailable()).resolves.toBe(true);
    browserSupportsWebAuthnAutofill.mockResolvedValue(false);
    await expect(conditionalPasskeyAvailable()).resolves.toBe(false);
  });

  it('is false without WebAuthn at all, and never even asks', async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    await expect(conditionalPasskeyAvailable()).resolves.toBe(false);
    expect(browserSupportsWebAuthnAutofill).not.toHaveBeenCalled();
  });

  it('a probe that THROWS or REJECTS is just "no" — the page falls back to the plain link', async () => {
    browserSupportsWebAuthn.mockReturnValue(true);
    browserSupportsWebAuthnAutofill.mockImplementation(() => { throw new Error('blocked'); });
    await expect(conditionalPasskeyAvailable()).resolves.toBe(false);
    browserSupportsWebAuthnAutofill.mockRejectedValue(new Error('nope'));
    await expect(conditionalPasskeyAvailable()).resolves.toBe(false);
  });

  it('a probe that NEVER settles is "no" within the timeout', async () => {
    jest.useFakeTimers();
    try {
      browserSupportsWebAuthn.mockReturnValue(true);
      browserSupportsWebAuthnAutofill.mockReturnValue(new Promise(() => undefined));
      const pending = conditionalPasskeyAvailable(500);
      await jest.advanceTimersByTimeAsync(600);
      await expect(pending).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('getPasskeyFromAutofill', () => {
  it('asks the library for a CONDITIONAL request — the one call shape that shows no sheet', async () => {
    const options = { challenge: 'Y2hhbGw', rpId: 'venue-os.app', allowCredentials: [] };
    const assertion = { id: 'cred-1' };
    startAuthentication.mockResolvedValue(assertion);
    await expect(getPasskeyFromAutofill(options as never)).resolves.toBe(assertion);
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options, useBrowserAutofill: true });
  });

  it('an aborted request is a QUIET outcome, like a dismissed sheet', async () => {
    startAuthentication.mockRejectedValue(wrappedError('AbortError'));
    const err = await getPasskeyFromAutofill({ challenge: 'x' } as never).catch((e: unknown) => e);
    expect(describePasskeyError(err, 'get')).toEqual({ reason: 'cancelled', quiet: true, messageKey: null });
  });
});

describe('cancelPasskeyCeremony', () => {
  it('abandons the pending ceremony through the library, and never throws', () => {
    cancelPasskeyCeremony();
    expect(cancelCeremony).toHaveBeenCalledTimes(1);
    cancelCeremony.mockImplementation(() => { throw new Error('nothing pending'); });
    expect(() => cancelPasskeyCeremony()).not.toThrow();
  });
});

describe('guessDeviceLabel', () => {
  const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  };

  it.each([
    ['iPhone', UA.iphone, 'iPhone'],
    ['iPad', UA.ipad, 'iPad'],
    ['Mac', UA.mac, 'Mac'],
    ['Windows', UA.windows, 'Windows PC'],
    ['Android', UA.android, 'Android phone'],
    ['an empty UA', '', 'Passkey'],
    ['something exotic', 'Mozilla/5.0 (PlayStation; PlayStation 5/6.02)', 'Passkey'],
  ])('%s → %s', (_what, ua, expected) => {
    expect(guessDeviceLabel(ua)).toBe(expected);
  });

  it('an iPhone is not labelled "Mac" — its UA says "like Mac OS X"', () => {
    // This ordering is the whole reason the function has a fixed sequence.
    expect(UA.iphone).toContain('Mac OS X');
    expect(guessDeviceLabel(UA.iphone)).toBe('iPhone');
    expect(guessDeviceLabel(UA.ipad)).toBe('iPad');
  });

  it('falls back to the live navigator when no UA is passed', () => {
    // jsdom's default UA is neither Apple nor Windows nor Android.
    expect(guessDeviceLabel()).toBe('Passkey');
  });
});

describe('passkeyPhoneKind — "Set up a passkey on this iPhone" only on a phone or tablet (2026-10-05)', () => {
  const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    // iPadOS Safari's default "desktop site" user agent — indistinguishable from a Mac by UA.
    ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    otherMobile: 'Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5',
    linuxDesktop: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  };

  it.each<[string, string, number, string | null]>([
    ['iPhone', UA.iphone, 5, 'iphone'],
    ['iPad', UA.ipad, 5, 'ipad'],
    // No Mac has a touch screen: a "Mac" with touch points is an iPad.
    ['iPad asking for the desktop site', UA.ipadDesktop, 5, 'ipad'],
    ['Android', UA.android, 5, 'android'],
    ['another phone we cannot name', UA.otherMobile, 1, 'other'],
    // Computers keep the second step exactly as it was.
    ['Mac', UA.mac, 0, null],
    ['Windows (even a touch laptop)', UA.windows, 10, null],
    ['Linux desktop', UA.linuxDesktop, 0, null],
    ['an empty UA', '', 0, null],
  ])('%s → %s', (_what, ua, touchPoints, expected) => {
    expect(passkeyPhoneKind(ua, touchPoints)).toBe(expected);
  });

  it('reads the live navigator when nothing is passed (jsdom: a desktop)', () => {
    expect(passkeyPhoneKind()).toBeNull();
  });
});

describe('formatPasskeyLastUsed', () => {
  // A fixed instant; every assertion is a DURATION from it, so nothing here
  // depends on the machine's timezone (CI runs TZ=UTC).
  const NOW = Date.parse('2026-09-21T12:00:00.000Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it.each([
    ['30 seconds', ago(30_000), 'now'],
    ['5 minutes', ago(5 * 60_000), '5 minutes ago'],
    ['3 hours', ago(3 * 3_600_000), '3 hours ago'],
    ['2 days', ago(2 * 86_400_000), '2 days ago'],
    ['3 months', ago(92 * 86_400_000), '3 months ago'],
    ['2 years', ago(730 * 86_400_000), '2 years ago'],
  ])('%s ago → %s', (_what, iso, expected) => {
    expect(formatPasskeyLastUsed(iso, 'en', NOW)).toBe(expected);
  });

  it('returns null for an unparseable timestamp rather than "Invalid Date"', () => {
    expect(formatPasskeyLastUsed('not-a-date', 'en', NOW)).toBeNull();
    expect(formatPasskeyLastUsed('', 'en', NOW)).toBeNull();
  });

  it('speaks the operator locale', () => {
    expect(formatPasskeyLastUsed(ago(5 * 86_400_000), 'es', NOW)).toBe('hace 5 días');
    expect(formatPasskeyLastUsed(ago(5 * 86_400_000), 'zh', NOW)).toBe('5天前');
  });

  it("uses each locale's idiom near the boundaries (numeric: 'auto')", () => {
    // This is the point of `numeric: 'auto'` and the reason we did NOT build
    // this out of i18n keys: Spanish has a single word for "the day before
    // yesterday" and English does not, and no hand-written key set would
    // have produced either one.
    expect(formatPasskeyLastUsed(ago(2 * 86_400_000), 'es', NOW)).toBe('anteayer');
    expect(formatPasskeyLastUsed(ago(86_400_000), 'en', NOW)).toBe('yesterday');
  });
});
