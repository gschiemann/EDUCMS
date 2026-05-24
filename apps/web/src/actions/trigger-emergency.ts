"use server";


interface EmergencyPayload {
  schoolId: string;
  type: string;
  playlistId?: string;
  triggeredBy: string;
  token?: string;
}

export async function broadcastEmergency(payload: EmergencyPayload) {
  const API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

  const res = await fetch(`${API_URL}/emergency/trigger`, {
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
  });

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

  const res = await fetch(`${API_URL}/emergency/${encodeURIComponent(overrideIdForUrl)}/all-clear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(payload.token ? { Authorization: `Bearer ${payload.token}` } : {})
    },
    body: JSON.stringify({
      scopeType: 'tenant',
      scopeId: payload.schoolId,
    }),
  });

  if (!res.ok) {
    return { success: false, error: `All clear failed: ${res.status}` };
  }

  // See above — same dead `revalidatePath` removed (audit P2 #4).
  return { success: true };
}
