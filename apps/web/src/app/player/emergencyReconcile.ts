/**
 * Life-safety backstop decision (2026-07-04, Fable).
 *
 * A pushed emergency message (SOS / TEXT_BROADCAST / MEDIA_ALERT) is shown on
 * the player via a WS/SSE push and, historically, cleared ONLY by an
 * `ALL_CLEAR_MESSAGE` over that same transport. If that clear is dropped (a WS
 * blip) or freshness-gated (a clock-skewed kiosk past the 30s staleness gate),
 * the takeover strands on the wall indefinitely — and EmergencyOverlay's own
 * self-poll is disabled whenever a pushed `message` prop is present.
 *
 * The player therefore reconciles the shown message against the device-authed
 * `/emergency/messages` endpoint (the server = the sole arbiter, mirroring how
 * the manifest already arbitrates tenant-wide lockdowns). This pure function
 * encodes the DECISION so it can be exhaustively unit-tested without mounting
 * the 7k-line player page.
 *
 * FAIL-SAFE toward OVER-alerting: it only reports `clear` after **two
 * consecutive** successful polls that both confirm the message is gone. A
 * single transient empty/partial response can therefore never drop a real,
 * still-active life-safety alert. (Callers must NOT advance the miss count on a
 * failed/offline poll — pass the prior count through unchanged in that case, so
 * the alert stays up.)
 *
 * @param serverActiveIds  ids the server currently reports as ACTIVE for this device
 * @param shownId          id of the message currently on screen
 * @param priorConsecutiveMisses  consecutive prior polls that found it absent
 * @returns clear=true only once it's been confirmed-absent twice in a row
 */
export function reconcileStrandedEmergency(
  serverActiveIds: Set<string>,
  shownId: string,
  priorConsecutiveMisses: number,
): { clear: boolean; consecutiveMisses: number } {
  // Still active server-side → reset the miss streak, never clear.
  if (serverActiveIds.has(shownId)) {
    return { clear: false, consecutiveMisses: 0 };
  }
  // Absent this poll — count it. Only a SECOND consecutive absence clears,
  // so a lone transient empty response can't drop a live alert.
  const consecutiveMisses = priorConsecutiveMisses + 1;
  return { clear: consecutiveMisses >= 2, consecutiveMisses };
}

/** Consecutive confirmed-absent polls required before clearing a stranded overlay. */
export const STRANDED_EMERGENCY_CLEAR_STRIKES = 2;
