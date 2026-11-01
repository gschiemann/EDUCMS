/**
 * A custom message that ENDS must never put an alert on the glass on its way
 * out (2026-10-26 — the owner, on site, clearing a broadcast: "it also had the
 * same issue of showing emergency real quick when you click disable on it").
 *
 * WHAT HAPPENED. A pushed message (SOS / TEXT_BROADCAST / MEDIA_ALERT) raises
 * the display hold the instant it lands — eagerly, by design — and the hold is
 * released from exactly ONE place: the manifest handler (`emergencyHold.ts`,
 * rule 1, so a forged or replayed clear can never unlock blanking on a screen
 * that is still in a real lockdown). When the message ended — `ALL_CLEAR_MESSAGE`,
 * the stranded-message reconcile, the poll finding it gone — the page dropped
 * the message at once, then asked the server for a manifest to release the
 * hold. For that whole round trip the surface decision saw "hold engaged,
 * nothing identified" and answered with a protective takeover: the red
 * "EMERGENCY" board before 2026-10-26, a black screen after it
 * (`emergencySurface.ts`, `hold`). Every clear — Info banner or Critical
 * takeover — flashed an alert board (or a blank) before the content came back.
 *
 * THE RULE. When a message ends and the message is the ONLY thing the page
 * knows is holding the glass, the hold is "message-only": the page keeps
 * showing the content (it is still waiting for the manifest to release the
 * hold — nothing about THAT changes) instead of a protective surface for an
 * alert it knows has ended.
 *
 * "ONLY thing" is decided from the page's own live evidence, never assumed:
 *
 *   • the hold is the page's own — not one the APK was already holding when this
 *     document booted (a persisted native hold has a reason the page cannot
 *     see, and must not explain away);
 *   • no manifest / provisional alert is on the glass;
 *   • no signed OVERRIDE is awaiting its manifest confirm;
 *   • no OTHER message (the poll-only one) is still showing.
 *
 * Any of those, and the protective surface stays exactly as it was. And
 * `emergencySurface.decideEmergencySurface` checks every one of them BEFORE it
 * reaches this answer, so a lockdown that arrives while the hold is releasing
 * still takes the glass.
 *
 * PURE — unit-tested per shape in `__tests__/messageEnd.test.ts`.
 */

export interface MessageEndEvidence {
  /** False when the APK was already holding at boot — a reason the page cannot see. */
  holdIsOurs: boolean;
  /** A manifest alert (or the provisional one raised from a signed push) is on the glass. */
  activeEmergency: boolean;
  /** A signed OVERRIDE is still waiting for its manifest confirm. */
  pendingOverrideConfirm: boolean;
  /** Another (poll-only) message is still showing. */
  anotherMessageShowing: boolean;
}

/** True when the message that just ended was the only reason the hold is engaged. */
export function messageWasTheOnlyHold(e: MessageEndEvidence): boolean {
  return e.holdIsOurs && !e.activeEmergency && !e.pendingOverrideConfirm && !e.anotherMessageShowing;
}
