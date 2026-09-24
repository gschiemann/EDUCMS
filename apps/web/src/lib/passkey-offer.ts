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
 *   • whether the offer is on hold — every storage access wrapped, because
 *     Safari private mode and locked-down kiosks THROW on storage, and a
 *     sign-in must never fail over a convenience;
 *   • which words to use for this device's authenticator;
 *   • reading the grant out of a login response without trusting its shape.
 *
 * ── HOW LONG AN ANSWER HOLDS (2026-09-24) ─────────────────────────────────
 * Operator, two days after the offer shipped: "it seems like the passkey
 * still has no way to get setup for me". It did not — one "Not now" (or Esc,
 * or Back) on 2026-09-22 had put the offer away for THIRTY DAYS, and nothing
 * else in the product pointed at Settings → My security. A month of silence
 * for a single tap is the wrong scale, so the two answers are now separate:
 *
 *   • "Not now" / Esc / Back / a cancelled or failed setup  → THIS SESSION.
 *     sessionStorage, so a new tab or the next day asks again, and an explicit
 *     sign-out ends the session too (`clearPasskeyOfferSessionAnswer`, called
 *     by the store's `logout`). Within the session — including a re-login
 *     after the access token expires — it is not asked twice.
 *   • "Don't ask on this device"                            → 30 DAYS.
 *     localStorage, under a VERSIONED key. The pre-2026-09-24 key held the
 *     30-day answer that "Not now" used to write; it is ignored (and removed
 *     when seen), so a device that dismissed the old offer once is asked
 *     again exactly once rather than staying dark for the rest of the month.
 *
 * The grant itself is never stored anywhere by this module — it lives in the
 * login page's memory for the one request that redeems it.
 */

/** How long "Don't ask on this device" holds. */
export const PASSKEY_OFFER_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * localStorage: the timestamp of the last "Don't ask on this device".
 * VERSIONED (`.v2`) — see the header for why the unversioned key is ignored.
 */
export const PASSKEY_OFFER_SNOOZE_KEY = 'venueos_passkey_offer_snoozed_at.v2';
/**
 * The key "Not now" wrote before 2026-09-24, when it meant 30 days. Never
 * read as a snooze; removed the first time it is seen.
 */
export const LEGACY_PASSKEY_OFFER_SNOOZE_KEYS: readonly string[] = ['venueos_passkey_offer_snoozed_at'];
/** sessionStorage: this session has already answered the offer. */
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
 * `forThirtyDays: true` is "Don't ask on this device": nothing more for 30
 * days here. `false` is every other exit — "Not now", Esc, Back, a cancelled
 * or failed setup — and holds for THIS SESSION only, so the next sign-in
 * (a new tab, tomorrow, or after signing out) asks again.
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

/**
 * The session's answer is over — called by the store's `logout`, because a
 * deliberate sign-out ends the session the answer was given in. A 30-day
 * "Don't ask on this device" is untouched: that one is about the device.
 */
export function clearPasskeyOfferSessionAnswer(): void {
  answeredThisPage = false;
  try {
    session()?.removeItem(PASSKEY_OFFER_SESSION_KEY);
  } catch {
    /* unreadable storage — the page flag above is already cleared */
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
  // The pre-versioning key is never honoured. Drop it so it cannot be
  // mistaken for anything later — hygiene only, never a decision.
  for (const legacy of LEGACY_PASSKEY_OFFER_SNOOZE_KEYS) {
    try {
      local()?.removeItem(legacy);
    } catch {
      /* private mode — nothing to remove or no way to; either is fine */
    }
  }
  try {
    const raw = local()?.getItem(PASSKEY_OFFER_SNOOZE_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    const age = now - at;
    // A timestamp from the FUTURE (a clock that was wrong, then fixed) does
    // not snooze forever: it simply stops counting, and the next "Don't ask"
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
