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
