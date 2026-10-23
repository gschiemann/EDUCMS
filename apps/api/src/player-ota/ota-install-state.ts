/**
 * The install outcomes a screen reports, and the one server rule they drive
 * (2026-10-17, unattended-updates program, piece 2).
 *
 * THE FIELD FAILURE. After an operator pushed v1.1.29 on 2026-10-15, the API
 * answered `install v1.1.29` to the M24 (an Android 9 panel) on every
 * 30-minute check for 24 hours: 48 full APK downloads, 48 install commits
 * ending at Android's "Install?" dialog that nobody was there to tap, and a
 * dashboard that said "Updating…" throughout. The 30-minute check was the
 * companion Manager's (refused in player-ota.controller.ts); this file is the
 * other half — the Player now SAYS when Android is waiting for a person, and
 * the server stops offering the push to a screen that said so.
 *
 * VenueOS will not be the device owner (owner decision 2026-10-17). So the
 * only unattended install is the Player as its own installer of record on
 * Android 12+; on Android 11 and below a person must tap Install, and the
 * honest answer is to say so — not to retry.
 *
 * The states (POST /screens/status/:fp/ota-state):
 *   NEEDS_TAP      Android is waiting for a person to tap Install on the
 *                  glass. The Player keeps the verified APK and will not commit
 *                  it again on its own; a person pressing Update on the panel
 *                  re-commits it (OtaAttemptPolicy in the Player).
 *   FAILED_<CODE>  a terminal PackageInstaller status — FAILED_ABORTED,
 *                  FAILED_INCOMPATIBLE, FAILED_STORAGE, … (OtaAttemptPolicy
 *                  .failedState). A failure, like ERROR, for the sticky stamp.
 *
 * Pure: no I/O, no clock.
 */

/** `FAILED_<CODE>` — the device's terminal install failure states. */
export const FAILED_STATE = /^FAILED_[A-Z0-9_]{1,40}$/;

export const NEEDS_TAP = 'NEEDS_TAP';

/** The Player's "nobody tapped Install within 30 minutes of the dialog" (PendingInstallConfirmation.EXPIRED_STATE). */
export const TAP_EXPIRED = 'FAILED_TAP_EXPIRED';

export type ReportHold = 'NEEDS_TAP' | 'FAILED' | 'EXPIRED';

/**
 * Which hold, if any, a DEVICE-AUTHENTICATED ota-state report puts on an
 * active push (player 1.1.51 — the API half of Fix 9, item 4).
 *
 * Before: a report could only hold a push that was NOT already held, so the
 * Player's `FAILED_TAP_EXPIRED` landed on a push already held NEEDS_TAP and
 * changed nothing — the dashboard kept saying "tap Install" after the dialog
 * had expired and been abandoned. Now a tap-expiry moves a NEEDS_TAP hold (or
 * an unheld push) to EXPIRED; every other hold stays as it was. Anonymous
 * reports hold nothing (the state is still recorded).
 */
export function holdFromOtaReport(f: {
  deviceAuthenticated: boolean;
  pendingAt: Date | string | null | undefined;
  currentHold: string | null | undefined;
  state: string;
}): ReportHold | null {
  if (!f.deviceAuthenticated || !f.pendingAt) return null;
  if (f.state === TAP_EXPIRED) {
    return !f.currentHold || f.currentHold === NEEDS_TAP ? 'EXPIRED' : null;
  }
  if (f.currentHold) return null;
  if (f.state === NEEDS_TAP) return 'NEEDS_TAP';
  if (FAILED_STATE.test(f.state)) return 'FAILED';
  return null;
}

/** ERROR or a FAILED_<CODE>: stamps the sticky OTA failure (OTA-02). */
export function isFailureState(state: string): boolean {
  return state === 'ERROR' || FAILED_STATE.test(state);
}

export interface PushTapFacts {
  /** Screen.forceApkUpdatePendingAt — the operator's pending push. */
  pendingAt: Date | string | null | undefined;
  /** Screen.lastOtaState / lastOtaAt — the device's latest report. */
  lastOtaState: string | null | undefined;
  lastOtaAt: Date | string | null | undefined;
}

const ms = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Is this push waiting for a person to tap Install on the glass?
 *
 * True when the screen reported NEEDS_TAP AFTER the operator pushed. Both
 * timestamps are the server's own (never the device clock). A NEEDS_TAP from
 * before the push is about an earlier attempt: a NEW push (another build, or a
 * deliberate retry) is offered once, and a screen that still needs a tap
 * simply says so again.
 */
export function pushWaitsForTap(f: PushTapFacts): boolean {
  if (f.lastOtaState !== NEEDS_TAP) return false;
  const pushed = ms(f.pendingAt);
  const said = ms(f.lastOtaAt);
  return pushed !== null && said !== null && said >= pushed;
}
