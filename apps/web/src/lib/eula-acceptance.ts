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
 * This is the per-browser record, exactly as before — it decides whether the
 * sign-in form shows the checkbox. Since 2026-10-24 (launch QA S2) the record
 * that COUNTS lives on the person's account, on the server (who, when, which
 * version): a tick on the sign-in form is parked for that account below and
 * committed by `TermsGate` once the account is past first-login setup, and
 * anyone the server has no acceptance for is asked once in the dashboard.
 *
 * Every storage access is wrapped: Safari private mode and locked-down kiosks
 * THROW on storage, and a sign-in must never fail over bookkeeping.
 */

/**
 * The EULA version. The API's own copy (`EULA_VERSION` in @cms/api-types) is
 * what it records acceptances against; `eula-version-parity.test.ts` fails the
 * moment the two differ. Kept as a literal here rather than imported so the
 * sign-in page does not pull the shared schema package into its bundle.
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

// ── The account's record (launch QA S2, 2026-10-24) ──────────────────────

/**
 * sessionStorage: "this account ticked the EULA box during THIS sign-in, in
 * this tab". The sign-in form cannot record it on the server itself — an
 * account still in first-login setup may reach nothing but the setup screen —
 * so `TermsGate` commits it (`POST /users/me/terms`, method `sign-in`) the
 * moment the dashboard is open to it. Bound to the account id, and short-lived:
 * a tick is evidence for the sign-in it was given in, not for a later one.
 */
export const TERMS_SERVER_PENDING_KEY = `venueos_terms_server_pending_v${EULA_VERSION}`;
const SERVER_PENDING_TTL_MS = 30 * 60_000;

/** Park a tick given during this sign-in for `userId`. */
export function parkServerTermsAcceptance(userId: string, at: string = new Date().toISOString()): void {
  try {
    if (typeof window === 'undefined' || !userId) return;
    window.sessionStorage.setItem(TERMS_SERVER_PENDING_KEY, JSON.stringify({ userId, at }));
  } catch {
    /* no storage — the dashboard simply asks once */
  }
}

/** A tick parked for `userId` within the last half hour, or null. */
export function parkedServerTermsAcceptance(userId: string, nowMs: number = Date.now()): { at: string } | null {
  try {
    if (typeof window === 'undefined' || !userId) return null;
    const raw = window.sessionStorage.getItem(TERMS_SERVER_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId?: unknown; at?: unknown };
    if (parsed?.userId !== userId || typeof parsed.at !== 'string') return null;
    const atMs = Date.parse(parsed.at);
    if (!Number.isFinite(atMs) || nowMs - atMs > SERVER_PENDING_TTL_MS || atMs - nowMs > 60_000) return null;
    return { at: parsed.at };
  } catch {
    return null;
  }
}

/** The parked tick was recorded (or refused for good): forget it. */
export function clearParkedServerTermsAcceptance(): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(TERMS_SERVER_PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}
