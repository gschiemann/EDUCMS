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
