"use server";

import { revalidatePath } from "next/cache";

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

  revalidatePath(`/[schoolId]/dashboard`, 'page');
  
  return { success: true };
}

export async function allClearEmergency(payload: { schoolId: string; token?: string }) {
  const API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
  
  const res = await fetch(`${API_URL}/emergency/global_clear/all-clear`, {
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

  revalidatePath(`/[schoolId]/dashboard`, 'page');
  return { success: true };
}
