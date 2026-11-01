/**
 * The two reads behind alert targeting (2026-10-05) — shared by /panic, the
 * dashboard trigger modal and the active-alert overlay.
 *
 * Plain bounded fetches with the caller's bearer token, the same transport
 * /panic already uses for its session check, so a hung API surfaces as an
 * error instead of a spinner (see fetch-timeout.ts). Neither one is ever on
 * the trigger's critical path: "All screens" works with both of them failed.
 */
import { API_URL } from '@/lib/api-url';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import type { ActiveAlert, EmergencyTargets } from '@/lib/emergency-target';

const READ_TIMEOUT_MS = 8000;

async function readJson<T>(path: string, token: string | null | undefined, timeoutMs = READ_TIMEOUT_MS): Promise<T> {
  const res = await fetchWithTimeout(
    `${API_URL}${path}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/** GET /emergency/targets — groups and screens an alert can be aimed at. */
export function fetchEmergencyTargets(token: string | null | undefined): Promise<EmergencyTargets> {
  return readJson<EmergencyTargets>('/emergency/targets', token);
}

/** GET /emergency/active — every live alert with its target. */
export async function fetchActiveAlerts(
  token: string | null | undefined,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<ActiveAlert[]> {
  const data = await readJson<{ alerts?: ActiveAlert[] }>('/emergency/active', token, timeoutMs);
  return Array.isArray(data?.alerts) ? data.alerts : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom messages (2026-10-26) — the typed-in message that used to live on its
// own Broadcast page and is now a card on the Emergency page.
//
// Same transport and the same bounds the Broadcast page always had: a bearer
// token, `credentials: 'include'`, and a timeout on EVERY call so a stalled
// connection fails loudly ("the message was NOT sent") instead of hanging the
// operator. The body for a send is built by `customMessageBody`
// (emergency-target.ts); nothing here decides who receives it.
// ─────────────────────────────────────────────────────────────────────────────

/** A non-2xx answer, carrying the HTTP status so the UI can say it in words. */
export class EmergencyApiError extends Error {
  constructor(public readonly status: number, public readonly path: string) {
    super(`${path} failed: ${status}`);
    this.name = 'EmergencyApiError';
  }
}

/** One live emergency message as GET /emergency/status lists it for an operator. */
export interface LiveMessage {
  id: string;
  type: string;
  severity: string;
  textBlob: string | null;
  scopeType: string;
  scopeId: string;
  /** UNIX seconds, or null for "until cleared". */
  expiresAt: number | null;
  createdAt: string;
  /** A send to specific screens: one entry for the whole set, named. */
  sendId?: string;
  targetScreens?: Array<{ id: string; name: string | null }>;
  targetScreenCount?: number;
}

/** GET /emergency/status — what is on screens right now (the caller's tenant, and the schools below it). */
export async function fetchLiveMessages(
  token: string | null | undefined,
  tenantId: string,
  timeoutMs = 4000,
): Promise<LiveMessage[]> {
  const data = await readJson<{ active?: LiveMessage[] }>(
    `/emergency/status?tenantId=${encodeURIComponent(tenantId)}`,
    token,
    timeoutMs,
  );
  return Array.isArray(data?.active) ? data.active : [];
}

async function postJson(
  path: string,
  token: string | null | undefined,
  body?: unknown,
  timeoutMs = 12000,
): Promise<Response> {
  const res = await fetchWithTimeout(
    `${API_URL}${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'include',
    },
    timeoutMs,
  );
  if (!res.ok) throw new EmergencyApiError(res.status, path);
  return res;
}

/** POST /emergency/broadcast — resolves with the server's own account of where it went. */
export async function sendCustomMessage(
  token: string | null | undefined,
  body: unknown,
): Promise<{ messageId?: string; affectedScreenCount?: number; affectedTenantCount?: number }> {
  const res = await postJson('/emergency/broadcast', token, body);
  try {
    return (await res.json()) ?? {};
  } catch {
    return {};
  }
}

/** POST /emergency/messages/:id/all-clear — ends the message (and, for a screen-list send, the whole set). */
export async function clearCustomMessage(token: string | null | undefined, messageId: string): Promise<void> {
  await postJson(`/emergency/messages/${encodeURIComponent(messageId)}/all-clear`, token);
}
