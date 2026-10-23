/**
 * One mapper from a signed SOS / TEXT_BROADCAST / MEDIA_ALERT payload to the
 * player's pushed-message state — shared by the WebSocket and SSE transports
 * (2026-10-22).
 *
 * WHY ONE MAPPER. The API signs the DB row id as `messageId`
 * (`emergency.controller.ts`: `signMessage('TEXT_BROADCAST', { messageId, … })`).
 * The SSE branch read `payload.messageId || payload.id`; the WS branch read
 * `p.id || msg.eventId` — so over WebSocket the overlay carried the envelope's
 * random eventId, never the row id. The life-safety reconcile
 * (`emergencyReconcile.ts`) compares the SHOWN id against the ids the
 * device-authed `/emergency/messages` poll returns and clears after two
 * consecutive misses: an id that can never match is cleared ~24 s after it
 * was pushed, on every WS-connected screen. Both transports now go through
 * this function, and a unit test pins the real signer shape.
 *
 * Field aliases are kept exactly as before: TEXT_BROADCAST signs its body as
 * `text`, SOS / MEDIA_ALERT as `textBlob`; a payload may still carry a
 * literal `id` (the e2e harness does), and the eventId remains the LAST
 * resort so a malformed payload still paints rather than being dropped —
 * fail-safe toward over-alerting.
 *
 * PURE — no React, no DOM.
 */

export type PushedEmergencyType = 'SOS' | 'TEXT_BROADCAST' | 'MEDIA_ALERT';
export type PushedEmergencySeverity = 'INFO' | 'WARN' | 'CRITICAL';

export interface PushedEmergencyMessage {
  id: string;
  type: PushedEmergencyType;
  severity: PushedEmergencySeverity;
  textBlob: string | null;
  mediaUrls: string[];
  audioUrl: string | null;
  expiresAt: number | null;
  createdAt: string;
}

export function pushedEmergencyFromPayload(
  type: PushedEmergencyType,
  rawPayload: unknown,
  eventId: unknown,
  now: () => number = Date.now,
): PushedEmergencyMessage {
  const p = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const id =
    str(p.messageId) ??
    str(p.id) ??
    str(eventId) ??
    `msg-${now()}`;
  const severity = p.severity;
  return {
    id,
    type,
    severity:
      severity === 'INFO' || severity === 'WARN' || severity === 'CRITICAL' ? severity : 'CRITICAL',
    textBlob: typeof p.textBlob === 'string' ? p.textBlob : typeof p.text === 'string' ? p.text : null,
    mediaUrls: Array.isArray(p.mediaUrls) ? (p.mediaUrls as string[]) : [],
    audioUrl: typeof p.audioUrl === 'string' ? p.audioUrl : null,
    expiresAt: typeof p.expiresAt === 'number' ? p.expiresAt : null,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date(now()).toISOString(),
  };
}
