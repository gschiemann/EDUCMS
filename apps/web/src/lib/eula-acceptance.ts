/**
 * EULA click-through — where a browser's acceptance is kept (2026-10-04).
 *
 * The storage half of the sign-in page's EULA gate, lifted out of the page so
 * the two places that finish a sign-in (the login page, and the single
 * sign-on landing page) write the SAME record, and so it can be tested.
 *
 * WHAT IS STORED, AND WHEN — unchanged from what the login page has always
 * written, key for key:
 *
 *   edu_cms_eula_accepted_v<version>      'yes'
 *   edu_cms_eula_accepted_v<version>_at   ISO time
 *   edu_cms_eula_accepted_v<version>_by   the address that signed in
 *
 * The version is part of the key, so publishing a new EULA version makes
 * every browser ask again. The record is written ONLY when a sign-in actually
 * finishes — ticking the box and then failing to sign in records nothing.
 *
 * Single sign-on finishes on another page, after a round trip to the
 * organization's identity provider. So the tick is parked in sessionStorage
 * (same tab, survives the round trip, gone when the tab closes) and the
 * landing page commits it once the session really exists.
 *
 * This is a per-browser record, exactly as before. Moving acceptance onto the
 * account (server-side, per user and version) is a separate change.
 *
 * Every storage access is wrapped: Safari private mode and locked-down kiosks
 * THROW on storage, and a sign-in must never fail over bookkeeping.
 */

export const EULA_VERSION = '1.0';
export const EULA_ACCEPTED_KEY = `edu_cms_eula_accepted_v${EULA_VERSION}`;
/** sessionStorage: the box was ticked and a single sign-on round trip is in flight. */
export const EULA_PENDING_KEY = `venueos_eula_pending_v${EULA_VERSION}`;

/** Has this browser already accepted THIS version? */
export function eulaAcceptedOnThisDevice(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(EULA_ACCEPTED_KEY) === 'yes';
  } catch {
    return false;
  }
}

/** Record an acceptance. Call only once the sign-in has actually finished. */
export function recordEulaAcceptance(by: string, at: string = new Date().toISOString()): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(EULA_ACCEPTED_KEY, 'yes');
    window.localStorage.setItem(`${EULA_ACCEPTED_KEY}_at`, at);
    window.localStorage.setItem(`${EULA_ACCEPTED_KEY}_by`, by);
  } catch {
    /* best-effort */
  }
}

/** The box was ticked and the browser is leaving for the identity provider. */
export function stashPendingEulaAcceptance(at: string = new Date().toISOString()): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(EULA_PENDING_KEY, at);
  } catch {
    /* no storage — the next visit simply asks again */
  }
}

/** A fresh visit to the sign-in page: whatever was in flight did not finish. */
export function clearPendingEulaAcceptance(): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(EULA_PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * The single sign-on round trip ended in a real session: turn the parked tick
 * into the record. Returns whether there was one. A landing with nothing
 * parked (a returning browser, or a sign-in started elsewhere) records nothing.
 */
export function commitPendingEulaAcceptance(by: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const at = window.sessionStorage.getItem(EULA_PENDING_KEY);
    if (!at) return false;
    window.sessionStorage.removeItem(EULA_PENDING_KEY);
    recordEulaAcceptance(by, at);
    return true;
  } catch {
    return false;
  }
}
