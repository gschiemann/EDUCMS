/**
 * Panic phones (2026-11-14) — the browser half. Talks ONLY to this origin's
 * `/api/panic/*`; it can neither read nor write the credential (HttpOnly).
 * No timers in this file: a call happens on open, on a press, or on the
 * panic page's own all-clear watch.
 */
import { PANIC_MARKER_COOKIE_NAME } from './panic-bff-names';
import { SESSION_REQUEST_HEADER, SESSION_REQUEST_HEADER_VALUE } from './session-bff';

const HEADERS = { 'Content-Type': 'application/json', [SESSION_REQUEST_HEADER]: SESSION_REQUEST_HEADER_VALUE };

/** "This phone may be ready" — the readable companion of the HttpOnly cookie. */
export function hasPanicMarker(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    return document.cookie.split(';').some((c) => c.trim() === `${PANIC_MARKER_COOKIE_NAME}=1`);
  } catch {
    return false;
  }
}

export type PanicCallOutcome<T> =
  | { ok: true; body: T }
  /** refused = the credential is dead (no cookie / the server said so); unavailable = could not use it now. */
  | { ok: false; outcome: 'refused' | 'unavailable'; status: number; body: any };

async function call<T>(action: string, body: unknown = {}, extraHeaders: Record<string, string> = {}): Promise<PanicCallOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/panic/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...HEADERS, ...extraHeaders },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, outcome: 'unavailable', status: 0, body: null };
  }
  const json = await res.json().catch(() => null);
  if (res.ok) return { ok: true, body: json as T };
  const refused = res.status === 401 && (json?.reason === 'refused' || json?.reason === 'no-cookie');
  return { ok: false, outcome: refused ? 'refused' : 'unavailable', status: res.status, body: json };
}

export interface PanicStatus {
  device: { id: string; label: string };
  user: { id: string; email: string; role: string; tenantId: string; tenantName: string | null; canTriggerPanic: boolean };
}

export const panicStatus = () => call<PanicStatus>('status');
export const panicTargets = () => call<any>('targets');
export const panicActive = () => call<{ alerts?: any[] }>('active');
export const panicTrigger = (body: { type: string; isDrill?: true; target?: { scopeType: 'group' | 'device'; scopeId: string } }) =>
  call<any>('trigger', body);
/** Mint — needs the page's own (fresh) session token. */
export const panicEnroll = (accessToken: string) =>
  call<{ enrolled: boolean; device: { id: string; label: string } | null }>('enroll', {}, { Authorization: `Bearer ${accessToken}` });
/** "Turn off on this phone." Always clears the cookie on this phone. */
export const panicEnd = () => call<{ ended: boolean }>('end');
