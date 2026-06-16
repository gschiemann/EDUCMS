"use server";

import { fetchWithTimeout } from '@/lib/fetch-timeout';

// LIFE-SAFETY (2026-06-16): a hung API used to leave the operator stuck on
// "Sending alert to all screens…" forever. Bound every emergency POST so a
// stalled connection fails loudly instead. 12s is long enough to tolerate a
// slow-but-working cellular uplink (aborting too early would falsely report a
// trigger that actually landed) and short enough that it can't hang the
// life-safety moment indefinitely.
const EMERGENCY_FETCH_TIMEOUT_MS = 12000;

interface EmergencyPayload {
  schoolId: string;
  type: string;
  playlistId?: string;
  triggeredBy: string;
  token?: string;
}

export async function broadcastEmergency(payload: EmergencyPayload) {
  const API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_URL}/emergency/trigger`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(payload.token ? { Authorization: `Bearer ${payload.token}` } : {})
        },
        body: JSON.stringify({
          scopeType: 'tenant',
          scopeId: payload.schoolId,
          overridePayload: { severity: 'CRITICAL', type: payload.type, playlistId: payload.playlistId },
        }),
      },
      EMERGENCY_FETCH_TIMEOUT_MS,
    );
  } catch (err) {
    // Hung or unreachable API. No DB state is mutated until the API returns,
    // so an abort here cannot leave an orphan trigger. Return a connectivity-
    // flavored error (contains "network"/"fetch") so the /panic page routes to
    // the "NOT broadcast — NOTIFY SECURITY MANUALLY" branch and the desktop
    // modal surfaces its loud red "alert was NOT sent" banner.
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error reaching the server (fetch): ${msg}` };
  }

  if (!res.ok) {
    return { success: false, error: `Emergency broadcast failed: ${res.status}` };
  }

  // Read overrideId out of the API response so the caller can pair this
  // trigger with its eventual all-clear in the audit log. Falls back to
  // success-only payload if the API ever omits it.
  let overrideId: string | undefined;
  try {
    const data = await res.json();
    if (data && typeof data.overrideId === 'string') overrideId = data.overrideId;
  } catch {
    /* response body not JSON; ignore — overrideId stays undefined */
  }

  // 2026-05-23 launch audit P2 #4 — removed the `revalidatePath`
  // call that passed a literal "[schoolId]" string. Server Actions
  // need a real path; the dynamic-segment placeholder was a no-op.
  // React Query on the client handles the actual dashboard refresh,
  // so removing the dead call has no behavior change.

  return { success: true, overrideId };
}

export async function allClearEmergency(payload: {
  schoolId: string;
  token?: string;
  overrideId?: string;
}) {
  const API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

  // emergency-002 fix: previously this hardcoded the literal string
  // 'global_clear' as the URL path param, which meant every all-clear
  // landed in the AuditLog with the same overrideId, breaking forensic
  // chain-of-custody. Now: if the caller knows which override they're
  // clearing, pass that real id through; otherwise mint a fresh
  // `clear_<uuid>` so this clear event is still uniquely identifiable
  // in the audit log alongside any concurrent clears.
  const overrideIdForUrl =
    payload.overrideId && payload.overrideId.trim().length > 0
      ? payload.overrideId
      : `clear_${crypto.randomUUID()}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${API_URL}/emergency/${encodeURIComponent(overrideIdForUrl)}/all-clear`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(payload.token ? { Authorization: `Bearer ${payload.token}` } : {})
        },
        body: JSON.stringify({
          scopeType: 'tenant',
          scopeId: payload.schoolId,
        }),
      },
      EMERGENCY_FETCH_TIMEOUT_MS,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error reaching the server (fetch): ${msg}` };
  }

  if (!res.ok) {
    return { success: false, error: `All clear failed: ${res.status}` };
  }

  // See above — same dead `revalidatePath` removed (audit P2 #4).
  return { success: true };
}
