/**
 * The overlay interlock of `applyManifest` (deep audit F8, 2026-08-30),
 * as one pure decision so it can be tested without mounting the page:
 *
 *   A CACHED manifest (the offline fallback replayed off disk) may RAISE an
 *   alert but may never RELEASE one. Only the server of record clears an
 *   alert: a stale disk copy carrying no emergency is not evidence that the
 *   emergency ended — the screen may be riding a live alert through a
 *   network failure, and blanking it would be the failure mode.
 *
 * The expression is the page's own (`fromCache && !em &&
 * !!activeEmergencyRef.current`), moved here byte-for-byte in meaning; the
 * page still runs it FIRST in applyManifest (rule 11) and still applies the
 * manifest's emergency in every other case.
 */
export function cachedManifestWouldClearLiveAlert(input: {
  /** The manifest came off DISK (the offline fallback), not from the server. */
  fromCache: boolean;
  /** The manifest carries an active emergency (flat fields or the legacy envelope). */
  manifestHasEmergency: boolean;
  /** An alert is on the glass right now. */
  liveAlertOnGlass: boolean;
}): boolean {
  return input.fromCache && !input.manifestHasEmergency && input.liveAlertOnGlass;
}

/**
 * The second interlock (2026-10-26): a SIGNED trigger's own pre-commit
 * manifest may not release the alert that trigger raised.
 *
 * The API dispatches the OVERRIDE fan-out BEFORE its transaction commits
 * (deliberately — a stalled write must never delay an alert). The page raises
 * the typed alert from that signed push (`alertFromOverridePush`) or from the
 * rev body (`alertFromRevEnvelope`), marked `provisional`, and opens the
 * E-P0-01 confirmation window. A live manifest read inside that window that
 * still says "no emergency" is the trigger's not-yet-committed state, not an
 * all-clear: applying it would take the alert down and put it back a second
 * later — the red → normal → red flap. Bounded on both sides: the committed
 * manifest replaces the provisional object (no flag), and the window's own
 * 30 s timeout drops it. A manifest that carries an emergency always applies;
 * an alert the manifest itself asserted is never provisional and releases
 * exactly as before. Never a release path: this only decides when NOT to
 * release.
 */
export function provisionalAlertSurvivesPreCommitManifest(input: {
  /** The manifest came off DISK (the offline fallback), not from the server. */
  fromCache: boolean;
  /** The manifest carries an active emergency (flat fields or the legacy envelope). */
  manifestHasEmergency: boolean;
  /** The alert on the glass was raised from a signed push / rev body, not yet confirmed by a manifest. */
  provisionalAlertOnGlass: boolean;
  /** The E-P0-01 confirmation window for a signed OVERRIDE is still open. */
  confirmWindowOpen: boolean;
}): boolean {
  return !input.fromCache && !input.manifestHasEmergency && input.provisionalAlertOnGlass && input.confirmWindowOpen;
}
