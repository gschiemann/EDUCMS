/**
 * SEC-010 (2026-09-05) — the browser half of the durable session.
 *
 * Everything here talks to THIS origin (`/api/session/*`), never to the API.
 * The refresh credential lives in an HttpOnly cookie those routes own; this
 * module can neither read it nor write it, which is the property the audit
 * finding demanded.
 *
 * MOBILE-PERF CONTRACT (CLAUDE.md, binding): there is no timer in this file
 * and there must never be one. A refresh happens on exactly two triggers —
 * cold start with the remember marker set, and a 401 on a real request — and
 * both go through the single-flight below, so a burst of parallel 401s
 * produces ONE network call.
 */

import {
  SESSION_REQUEST_HEADER,
  SESSION_REQUEST_HEADER_VALUE,
} from './session-bff';

/** Not a credential: a boolean saying "this browser opted into staying
 *  signed in", so a cold start knows whether a refresh is even worth a round
 *  trip. Reading it tells an attacker nothing they cannot see anyway. */
export const REMEMBER_MARKER_KEY = 'edu_cms_remember';

export interface RefreshResult {
  access_token: string;
  user: any | null;
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    [SESSION_REQUEST_HEADER]: SESSION_REQUEST_HEADER_VALUE,
  };
}

export function hasRememberMarker(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(REMEMBER_MARKER_KEY) === '1';
  } catch {
    return false;
  }
}

export function setRememberMarker(on: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    if (on) window.localStorage.setItem(REMEMBER_MARKER_KEY, '1');
    else window.localStorage.removeItem(REMEMBER_MARKER_KEY);
  } catch {
    /* private mode / storage full — the cookie is still the source of truth */
  }
}

/**
 * Trade the access token we just received for an HttpOnly refresh cookie.
 *
 * Failure is SILENT and non-fatal by design: the operator stays signed in on
 * the short session they already have. "Keep me signed in" degrading to
 * "signed in for an hour" is a small disappointment; failing the login over
 * it would be a real outage.
 */
export async function adoptRememberedSession(accessToken: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const res = await fetch('/api/session/adopt', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...headers(), Authorization: `Bearer ${accessToken}` },
      body: '{}',
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    const adopted = !!body?.adopted;
    setRememberMarker(adopted);
    return adopted;
  } catch {
    return false;
  }
}

// ── Single-flight refresh ────────────────────────────────────────────────
// A dashboard load fires a dozen queries at once. When the access token has
// expired they all 401 together, and without this every one of them would
// spend a refresh token — which the server correctly grades as a REPLAY and
// answers by revoking the family. So: one call, everyone awaits it.
let inFlight: Promise<RefreshResult | null> | null = null;

/** Test seam — reset between cases so a memoized promise can't leak. */
export function __resetSessionRefreshState(): void {
  inFlight = null;
}

export async function refreshRememberedSession(): Promise<RefreshResult | null> {
  if (typeof window === 'undefined') return null;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch('/api/session/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers(),
        body: '{}',
      });
      if (!res.ok) {
        // 401 = the cookie is dead (expired, revoked, replayed) and the route
        // has already cleared it. Drop the marker so the next cold start does
        // not spend a round trip proving the same thing.
        if (res.status === 401 || res.status === 403) setRememberMarker(false);
        return null;
      }
      const body = await res.json().catch(() => null);
      if (!body?.access_token) return null;
      return { access_token: body.access_token as string, user: body.user ?? null };
    } catch {
      // Network failure — retryable, so the marker stays set.
      return null;
    } finally {
      // Cleared in a microtask so late awaiters of THIS call still get its
      // result rather than starting a second refresh.
      queueMicrotask(() => {
        inFlight = null;
      });
    }
  })();
  return inFlight;
}

/** Revoke the family and clear the cookie. Best-effort: logout must never
 *  block on the network. */
export async function endRememberedSession(): Promise<void> {
  setRememberMarker(false);
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/session/end', {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers(),
      body: '{}',
    });
  } catch {
    /* best-effort */
  }
}
