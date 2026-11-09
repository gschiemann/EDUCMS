/**
 * The companion (Manager) upgrade waiting for an Install tap (Manager wave 3,
 * #12). The Player reports it as NEEDS_TAP, exactly like its own update, but
 * the report is ABOUT THE COMPANION and must never be read as the Player's
 * pending push waiting for a tap:
 *
 *  - it is only believed from the device itself (signed with its token) — an
 *    anonymous caller cannot paint a screen "waiting for a tap";
 *  - while an operator push is pending for the Player it is acknowledged and
 *    not stored, so it can neither close the push's offers nor hold it
 *    (`holdFromOtaReport`, `pushWaitsForTap`);
 *  - otherwise it is stored in the ordinary OTA status line (state + message)
 *    and holds nothing. The next CHECKING from the Player replaces it.
 */
export const COMPANION_TAP_PREFIX = 'Companion service';

export function isCompanionTapReport(state: string, message: string | null | undefined): boolean {
  return (
    state === 'NEEDS_TAP' &&
    typeof message === 'string' &&
    message.trim().startsWith(COMPANION_TAP_PREFIX)
  );
}

export type CompanionTapVerdict = 'store' | 'ignore-anonymous' | 'ignore-push-pending';

export function companionTapVerdict(f: {
  deviceAuthenticated: boolean;
  pushPending: boolean;
}): CompanionTapVerdict {
  if (!f.deviceAuthenticated) return 'ignore-anonymous';
  if (f.pushPending) return 'ignore-push-pending';
  return 'store';
}
