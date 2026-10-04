/**
 * "Keep me signed in" for a passkey sign-in (2026-10-04).
 *
 * The checkbox lives on the PASSWORD step. A passkey picked from the email
 * field on step 1 never passes it — and before identifier-first sign-in, a
 * passkey sign-in honoured that checkbox. Without this file every passkey
 * sign-in would silently become a short session.
 *
 * So the page remembers, PER ACCOUNT, the choice last made with the checkbox
 * on this browser, and a passkey sign-in for that same account follows it.
 *
 * ── WHY PER ACCOUNT, AND WHY A HASH ───────────────────────────────────────
 *
 *  • Per account, not per browser: on a shared computer, one person ticking
 *    "Keep me signed in" must not make the NEXT person's passkey sign-in a
 *    30-day session they never chose.
 *  • The default is OFF. An account that has never used the checkbox on this
 *    browser gets exactly what an unticked box gives.
 *  • What is stored is the account's WebAuthn user handle — `sha256(userId)`,
 *    base64url — never the id or the email. That is the same opaque value the
 *    authenticator already holds and echoes back in every assertion
 *    (`PasskeyController.userHandle` on the API), which is what lets a passkey
 *    sign-in find its account's choice BEFORE the server has said who it is:
 *    `rememberMe` has to travel WITH the verify request.
 *
 * It is a preference, not a credential: knowing or forging an entry buys
 * nothing but a longer session for someone who has already authenticated.
 *
 * Every storage access is wrapped — Safari private mode and locked-down
 * kiosks THROW on storage, and a sign-in must never fail over a preference.
 */

export const KEEP_SIGNED_IN_KEY = 'venueos_keep_signed_in.v1';
/** A browser is used by a handful of accounts at most; cap what is kept. */
const MAX_ENTRIES = 8;

function readHandles(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(KEEP_SIGNED_IN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : [];
  } catch {
    return [];
  }
}

function writeHandles(handles: string[]): void {
  try {
    if (typeof window === 'undefined') return;
    if (handles.length) window.localStorage.setItem(KEEP_SIGNED_IN_KEY, JSON.stringify(handles.slice(0, MAX_ENTRIES)));
    else window.localStorage.removeItem(KEEP_SIGNED_IN_KEY);
  } catch {
    /* no storage — the next passkey sign-in is simply a normal session */
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The account's WebAuthn user handle, as an assertion reports it:
 * base64url(sha256(userId)). `null` where WebCrypto is unavailable (an
 * insecure origin — which has no WebAuthn either, so nothing is lost).
 */
export async function passkeyUserHandleFor(userId: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || !userId) return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(userId));
    return toBase64Url(new Uint8Array(digest));
  } catch {
    return null;
  }
}

/**
 * Record the choice a finished sign-in was made with. Called for every
 * finished sign-in; for a passkey sign-in it re-records the value it read.
 */
export async function rememberKeepSignedInChoice(userId: unknown, keep: boolean): Promise<void> {
  if (typeof userId !== 'string' || !userId) return;
  const handle = await passkeyUserHandleFor(userId);
  if (!handle) return;
  const others = readHandles().filter((h) => h !== handle);
  writeHandles(keep ? [handle, ...others] : others);
}

/**
 * Should THIS passkey sign-in keep the account signed in? True only when the
 * assertion names an account that last chose it on this browser.
 */
export function keepSignedInForPasskey(assertion: unknown): boolean {
  const handle = (assertion as { response?: { userHandle?: unknown } } | null)?.response?.userHandle;
  if (typeof handle !== 'string' || !handle) return false;
  return readHandles().includes(handle);
}
