/**
 * Passkeys (WebAuthn) — the thin, testable layer between our UI and
 * `@simplewebauthn/browser`.
 *
 * Operator (2026-09-21): "can we add pass key to our security? im sick of the
 * damn auth app". So: Face ID / Touch ID / Windows Hello / a security key,
 * both as the SECOND factor at login and as a passwordless first factor.
 *
 * Everything here is pure or a one-line delegation, on purpose. The browser
 * ceremony itself cannot be unit-tested (jsdom has no authenticator), so the
 * parts that CAN go wrong in a way an operator sees — what we say when the
 * ceremony fails, and what we name the device — live here where they are
 * covered by a plain table test.
 *
 * i18n note: `describePasskeyError` returns a next-intl KEY, never a sentence.
 * A lib that returned English would quietly ship untranslated copy to the ES
 * and ZH catalogs (and the parity gate cannot see strings that never became
 * keys). `guessDeviceLabel` is the deliberate exception — its output is the
 * DEFAULT VALUE of a user-editable label that we persist, i.e. data, not UI
 * chrome, and the operator can rename it to anything they like.
 */
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

/**
 * Can this browser do WebAuthn at all? Safe to call during SSR —
 * `browserSupportsWebAuthn` reads `globalThis?.PublicKeyCredential`, never
 * `window`, so it answers `false` on the server instead of throwing.
 */
export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/**
 * Does this device have a BUILT-IN authenticator — Face ID / Touch ID,
 * Windows Hello, an Android fingerprint or screen lock — that can verify the
 * person? That, not mere WebAuthn support, is what decides whether offering
 * "set up a passkey on this device" makes sense.
 *
 * Never throws and never hangs: an embedded WebView that throws on the probe,
 * or one whose promise never settles, answers `false` within `timeoutMs`.
 */
export async function platformPasskeyAvailable(timeoutMs = 2_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!passkeysSupported()) return false;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    return (await Promise.race([platformAuthenticatorIsAvailable(), timeout])) === true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Create a passkey. `options` is the server's
 * `PublicKeyCredentialCreationOptionsJSON` verbatim — v13 takes it wrapped as
 * `{ optionsJSON }`, which is the single detail every caller would otherwise
 * have to remember.
 *
 * ⚠️ SAFARI USER GESTURE: this is a plain delegation with NO await in front of
 * `navigator.credentials.create()` (neither here nor inside `startRegistration`
 * v13, which only builds the options synchronously before calling it). So a
 * click handler that calls this FIRST — before any `await` — makes the
 * ceremony inside the tap's user activation. Keep it that way: an `await`
 * added here would silently break every such caller on WebKit.
 */
export function createPasskey(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  return startRegistration({ optionsJSON: options });
}

/**
 * Abandon a ceremony that is still waiting on the device sheet — used when
 * the operator leaves the screen that started it, so a credential cannot be
 * created for a screen that is no longer there to confirm it.
 */
export function cancelPasskeyCeremony(): void {
  try {
    WebAuthnAbortService.cancelCeremony();
  } catch {
    /* nothing pending, or an older library — either way nothing to cancel */
  }
}

/** Use an existing passkey (login / second factor). Same wrapping note. */
export function getPasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  return startAuthentication({ optionsJSON: options });
}

/** Which WebAuthn ceremony raised the error — `InvalidStateError` only means
 *  "already registered" for a create. */
export type PasskeyCeremony = 'create' | 'get';

export type PasskeyErrorReason =
  /** The operator dismissed the sheet, or the platform timed out waiting. */
  | 'cancelled'
  /** create only: this authenticator already holds a credential for the account. */
  | 'already-registered'
  /** The page is not on the origin the credential is bound to. */
  | 'wrong-domain'
  /** The authenticator cannot satisfy what the server asked for. */
  | 'unsupported'
  /** Anything we cannot name. */
  | 'failed';

export interface PasskeyErrorDescription {
  reason: PasskeyErrorReason;
  /**
   * TRUE for a cancel/timeout. The caller must show NOTHING — no red banner,
   * just put the operator back on the button. Dismissing the Face ID sheet is
   * a decision, not a failure, and treating it as one trains people to
   * distrust the error area that real problems use.
   */
  quiet: boolean;
  /** next-intl key under the `passkeys.` namespace, or null when `quiet`. */
  messageKey: string | null;
}

/**
 * Resolve the DOMException name behind an error.
 *
 * `@simplewebauthn/browser` wraps the DOMException in a `WebAuthnError` whose
 * `name` is copied from `cause.name` (see its webAuthnError.ts), so `.name`
 * alone covers both the wrapped and the raw case — `cause` is checked second
 * only so a future library change cannot silently turn every mapped error
 * into the generic sentence.
 */
function domExceptionName(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const e = err as { name?: unknown; cause?: { name?: unknown } };
  if (typeof e.name === 'string' && e.name && e.name !== 'Error') return e.name;
  if (e.cause && typeof e.cause === 'object' && typeof e.cause.name === 'string') {
    return e.cause.name;
  }
  return '';
}

/**
 * Map a failed ceremony to something an operator can act on.
 *
 * `NotAllowedError` is the one everybody hits: every platform overloads it for
 * "user dismissed the sheet" AND "we timed out" — and, on a SIGN-IN with a
 * discoverable request, "this device has no passkey for this site" (Safari
 * says so in its own sheet, then rejects with this same error). There is no
 * way to tell them apart from script. All are quiet; the sign-in page follows
 * a quiet cancel with a calm hint rather than an error.
 *
 * The CEREMONY picks the copy (2026-09-22). The generic and unsupported
 * sentences used to talk about "setting up" / "creating" a passkey on every
 * ceremony — wrong on the sign-in screen, where nothing is being created.
 */
export function describePasskeyError(
  err: unknown,
  ceremony: PasskeyCeremony = 'create',
): PasskeyErrorDescription {
  const signIn = ceremony === 'get';
  const generic: PasskeyErrorDescription = {
    reason: 'failed',
    quiet: false,
    messageKey: signIn ? 'passkeys.errSignInGeneric' : 'passkeys.errGeneric',
  };
  switch (domExceptionName(err)) {
    case 'NotAllowedError':
    case 'AbortError':
      return { reason: 'cancelled', quiet: true, messageKey: null };
    case 'InvalidStateError':
      // Only meaningful for a create — on a get it is not a "this device
      // already has one" situation, so it falls through to the plain sentence.
      return signIn
        ? generic
        : { reason: 'already-registered', quiet: false, messageKey: 'passkeys.errAlreadyRegistered' };
    case 'SecurityError':
      return { reason: 'wrong-domain', quiet: false, messageKey: 'passkeys.errWrongDomain' };
    case 'NotSupportedError':
    case 'ConstraintError':
      return {
        reason: 'unsupported',
        quiet: false,
        messageKey: signIn ? 'passkeys.errSignInUnsupported' : 'passkeys.errUnsupported',
      };
    default:
      return generic;
  }
}

/**
 * A sensible default name for the device the operator is enrolling, so the
 * list reads "iPhone" instead of a credential id. They can rename it.
 *
 * Order matters: an iPhone's UA contains "like Mac OS X", so the Apple mobile
 * checks have to come before the Mac one or every iPhone would be labelled
 * "Mac".
 */
export function guessDeviceLabel(
  ua: string | undefined = typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
): string {
  const s = ua || '';
  if (/iPhone/i.test(s)) return 'iPhone';
  if (/iPad/i.test(s)) return 'iPad';
  if (/Android/i.test(s)) return 'Android phone';
  if (/Macintosh|Mac OS X/i.test(s)) return 'Mac';
  if (/Windows/i.test(s)) return 'Windows PC';
  return 'Passkey';
}

/**
 * "3 days ago" / "today" for the last-used column, in the operator's locale.
 *
 * `Intl.RelativeTimeFormat` rather than a dozen i18n keys for the units: it is
 * in every browser we support (Safari 14+, Chrome 71+) and it is a DURATION,
 * so the rendered text does not depend on the machine's timezone — which is
 * what keeps this deterministic under CI's TZ=UTC.
 */
export function formatPasskeyLastUsed(
  iso: string,
  locale = 'en',
  now: number = Date.now(),
): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  // `numeric: 'auto'` turns a zero offset into the idiomatic word for "now"
  // in each locale ("now" / "ahora" / "现在") rather than "in 0 seconds".
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 2_592_000) return rtf.format(Math.round(seconds / 86_400), 'day');
  if (abs < 31_536_000) return rtf.format(Math.round(seconds / 2_592_000), 'month');
  return rtf.format(Math.round(seconds / 31_536_000), 'year');
}
