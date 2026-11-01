/**
 * Which emergency SURFACE the player shows (2026-10-23, launch QA B3).
 *
 * THE BUG THIS CLOSES. The native-to-overlay hand-off (dbe1a48d, 2026-10-21)
 * swaps the WHOLE player for a protective red "transition" surface whenever
 * ANY emergency state is set — the display hold, a manifest override, a
 * pushed message, a poll-only message. That is right for a lockdown-type
 * alert: content must leave the glass and nothing regular may mount in the
 * gap the removed native video left. It was wrong for a routine INFO / WARN
 * TEXT_BROADCAST: the product has always drawn those as a BANNER on top of
 * the running content (`EmergencyOverlay.isBanner`), yet the transition took
 * the content down and showed a blank red screen under an orange banner.
 *
 * THE RULE
 *   takeover — content leaves the glass; the red transition surface hosts
 *              the alert (or the protective "EMERGENCY" pending text until the
 *              alert's identity is known):
 *                • a manifest override (lockdown / evacuate / weather / …),
 *                • a pushed or poll-only message that renders FULL-SCREEN
 *                  (SOS, MEDIA_ALERT, CRITICAL text),
 *                • a pending signed OVERRIDE awaiting its manifest confirm,
 *                • the display hold raised with NO identified reason (a WS
 *                  OVERRIDE raised it eagerly, or the page just reloaded under
 *                  a persisted hold) — protective, fail-safe toward alerting.
 *   overlay  — content keeps playing; the banner-style message is drawn over
 *              it (INFO / WARN TEXT_BROADCAST, pushed or polled). The display
 *              hold may be raised for it too — a WARN banner still refuses
 *              blanking — but it is not a reason to take content down.
 *   content  — nothing emergency is on, or the emergency PLAYLIST itself is
 *              the content (it renders through the normal branch).
 *
 * Never weakens a real takeover: every input that took the glass before
 * still does, except a banner whose ONLY companion is the hold it raised
 * itself. PURE — unit-tested per shape in `emergencySurface.test.ts`.
 *
 * 2026-10-26 — A MESSAGE THAT ENDS (`messageEnded`). The hold a pushed message
 * raised is released only by the manifest, one round trip after the message
 * is gone. Until then "hold engaged, nothing identified" used to answer
 * `takeover` (red) and then `hold` (black) — an alert board, or a blank, for
 * every Clear of an Info banner or a Critical message. When the page KNOWS
 * the message was the only reason for the hold (`messageEnd.ts`), nothing is
 * identified because nothing is left to identify: the content stays. Checked
 * LAST, so a lockdown, a pending signed OVERRIDE or another message still
 * takes the glass first.
 */

/**
 * `hold` (2026-10-26): the display hold is engaged — the page observed it on
 * the APK at boot, or raised it itself — and the page cannot yet say WHICH
 * alert it is for (no manifest alert, no pushed message, no pending signed
 * OVERRIDE). Content must not mount under an engaged hold (player rule 11: a
 * page that reloads under a persisted hold used to boot onto its cached
 * NORMAL manifest), but the page also cannot claim an emergency it has no
 * evidence for (rule 10) — least of all a RED one during a drill. So: a
 * black protective surface, no words, until the live manifest decides.
 */
export type EmergencySurface = 'takeover' | 'overlay' | 'content' | 'hold';

export interface SurfaceMessage {
  type: string;
  severity: string;
}

/** The overlay's own rule: an INFO / WARN text broadcast is a top banner. */
export function isBannerEmergencyMessage(m: SurfaceMessage | null | undefined): boolean {
  return !!m && m.type === 'TEXT_BROADCAST' && m.severity !== 'CRITICAL';
}

export interface EmergencySurfaceInput {
  /** The manifest's own alert (tenant / per-screen override). */
  activeEmergency: boolean;
  /** The WS / SSE pushed message currently held by the page. */
  pushed: SurfaceMessage | null | undefined;
  /** A poll-only message is displayed by the overlay … */
  polledActive: boolean;
  /** … and it is a full-screen one (SOS / media / CRITICAL), not a banner. */
  polledTakeover: boolean;
  /** `displayEmergencyHoldRaised()` — the eager hold (also persisted natively). */
  renderHold: boolean;
  /** A signed OVERRIDE is still being confirmed by the manifest. */
  pendingOverrideConfirm: boolean;
  /** The current playlist IS the emergency content. */
  playlistIsEmergency: boolean;
  /**
   * The message that raised the hold has ENDED and was the only thing holding
   * the glass (`messageWasTheOnlyHold`); the hold itself is still waiting for
   * the manifest. Absent = false = exactly the pre-2026-10-26 decision.
   */
  messageEnded?: boolean;
}

export function decideEmergencySurface(i: EmergencySurfaceInput): EmergencySurface {
  if (i.playlistIsEmergency) return 'content';
  if (i.activeEmergency || i.pendingOverrideConfirm) return 'takeover';
  if (i.pushed && !isBannerEmergencyMessage(i.pushed)) return 'takeover';
  if (i.polledActive && i.polledTakeover) return 'takeover';
  const bannerShown = isBannerEmergencyMessage(i.pushed) || (i.polledActive && !i.polledTakeover);
  if (bannerShown) return 'overlay';
  // The hold is the ended message's own, still waiting for the manifest: there
  // is nothing left to protect, so the content stays (no flash of any board).
  if (i.renderHold && i.messageEnded === true) return 'content';
  // Hold engaged with nothing identified yet: protective, but unattributed —
  // black, never a red claim the page cannot back (see `hold` above).
  if (i.renderHold) return 'hold';
  return 'content';
}
