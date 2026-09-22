/**
 * The post-sign-in passkey offer — the pure, testable half (2026-09-22).
 *
 * Operator: "when i try to login with a passkey to my main account it says i
 * dont have one saved. shouldnt it walk me thru getting one?"
 *
 * So, right after a password (+ authenticator code) sign-in, an account with
 * no passkey on a device with Face ID / Touch ID / Windows Hello gets ONE
 * screen: "Sign in faster next time · Set up passkey · Not now". The screen
 * lives in the login page; what is here is everything about it that is a
 * plain decision rather than UI:
 *
 *   • whether "Not now" is still in force (30 days per device, and never
 *     twice in one session) — every storage access wrapped, because Safari
 *     private mode and locked-down kiosks THROW on storage, and a sign-in must
 *     never fail over a convenience;
 *   • which words to use for this device's authenticator;
 *   • reading the grant out of a login response without trusting its shape.
 *
 * The grant itself is never stored anywhere by this module — it lives in the
 * login page's memory for the one request that redeems it.
 */

/** How long "Not now" holds on this device. */
export const PASSKEY_OFFER_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** localStorage: the timestamp of the last "Not now" on this device. */
export const PASSKEY_OFFER_SNOOZE_KEY = 'venueos_passkey_offer_snoozed_at';
/** sessionStorage: this tab session has already answered the offer. */
export const PASSKEY_OFFER_SESSION_KEY = 'venueos_passkey_offer_answered';

/** Fallback for when sessionStorage itself is unavailable: this page load. */
let answeredThisPage = false;

function local(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Remember that the operator answered the offer.
 *
 * `forThirtyDays: true` is "Not now" (and Esc / Back on the offer, which say
 * the same thing): nothing more for 30 days on this device. `false` is a
 * softer "not again this session" — used after a cancelled or failed setup,
 * so the next sign-in in the same session does not ask again, while a later
 * day still can.
 */
export function snoozePasskeyOffer(
  opts: { forThirtyDays: boolean },
  now: number = Date.now(),
): void {
  answeredThisPage = true;
  try {
    session()?.setItem(PASSKEY_OFFER_SESSION_KEY, '1');
  } catch {
    /* private mode — the page-level flag still holds for this load */
  }
  if (opts.forThirtyDays) {
    try {
      local()?.setItem(PASSKEY_OFFER_SNOOZE_KEY, String(now));
    } catch {
      /* private mode — this session is still covered above */
    }
  }
}

/** Is the offer on hold for this device / session right now? */
export function isPasskeyOfferSnoozed(now: number = Date.now()): boolean {
  if (answeredThisPage) return true;
  try {
    if (session()?.getItem(PASSKEY_OFFER_SESSION_KEY) === '1') return true;
  } catch {
    /* unreadable — fall through */
  }
  try {
    const raw = local()?.getItem(PASSKEY_OFFER_SNOOZE_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    const age = now - at;
    // A timestamp from the FUTURE (a clock that was wrong, then fixed) does
    // not snooze forever: it simply stops counting, and the next "Not now"
    // writes a fresh one.
    return age >= 0 && age < PASSKEY_OFFER_SNOOZE_MS;
  } catch {
    return false;
  }
}

/** Test seam: forget the page-level flag. */
export function __resetPasskeyOfferMemoryForTests(): void {
  answeredThisPage = false;
}

/** Which family of built-in authenticator this device most likely has. */
export type PasskeyMethod = 'apple' | 'windows' | 'other';

/**
 * Best guess from the user agent. Only ever used to pick WORDS — never to
 * decide whether to offer (that is `platformPasskeyAvailable`). iPadOS reports
 * a Mac user agent, which is fine: it is Apple either way.
 */
export function passkeyMethodFor(
  ua: string | undefined = typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
): PasskeyMethod {
  const s = ua || '';
  if (/iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(s)) return 'apple';
  if (/Windows/i.test(s)) return 'windows';
  return 'other';
}

/** The `auth.*` catalog key that names this device's authenticator. */
export const PASSKEY_METHOD_KEYS: Record<PasskeyMethod, string> = {
  apple: 'passkeyMethodApple',
  windows: 'passkeyMethodWindows',
  other: 'passkeyMethodOther',
};

/**
 * The single-use grant a finished sign-in left behind, or `null`.
 *
 * Accepts only the exact shape the API mints (43 base64url characters) so a
 * malformed or hostile response can never reach the network as a "grant".
 */
export function readPasskeyEnrollmentGrant(data: unknown): string | null {
  const grant = (data as { passkeyEnrollment?: { grant?: unknown } } | null | undefined)
    ?.passkeyEnrollment?.grant;
  return typeof grant === 'string' && /^[A-Za-z0-9_-]{43}$/.test(grant) ? grant : null;
}
