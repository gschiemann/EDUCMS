/**
 * repairChipPolicy.ts — WHERE the "Re-pair required" chip is allowed to
 * paint (2026-09-01 operator decision).
 *
 * ============================================================
 * WHAT THIS DOES NOT CHANGE
 * ============================================================
 *
 * Nothing about the TRUTH. `Screen.authState` / `requiresRePair` is still a
 * real, server-stamped, persisted state; the player still surfaces it; the
 * dashboard still grades it (`deriveRenderTrustGrade` carries `authState`).
 * The 2026-08-30 reliability program's W1-2 requirement — a device running
 * on renewed temporary tokens must never be silently "fine" — is preserved
 * in full. The DURABLE telling is:
 *
 *   • the dashboard chip (fleet UI, always on, never expires), and
 *   • the player's own operator surfaces — the pairing / registering
 *     splash, the paused state, the diagnostics card, the info overlay —
 *     where the chip renders unconditionally, forever, for as long as the
 *     credential is unproven.
 *
 * What is RETIRED is only the PERMANENT placement over LIVE PUBLIC CONTENT.
 * The chip used to paint an amber admin box on top of whatever the public
 * was looking at — a lobby board, a menu, a scoreboard — all day, every day,
 * for a condition the public cannot act on and the operator already sees in
 * two other places. Admin state does not get to own public glass.
 *
 * ============================================================
 * THE 5-MINUTE BOOT WINDOW
 * ============================================================
 *
 * The chip still shows over live content for the first 5 minutes after the
 * page boots. That window exists for exactly one person: the installer or
 * IT staffer standing at the panel who just power-cycled it. A walk-up
 * diagnostic has to be honest — if you reboot a screen to see what is wrong
 * with it, the screen must tell you it is running on a temporary credential
 * without making you find a remote and open a menu. After five minutes
 * nobody is standing there any more, the audience is the public again, and
 * the chip steps off the glass.
 *
 * Pure module — no React, no DOM, no network (same discipline as
 * `deviceCredential.ts` / `emergencyHold.ts`), so the policy is unit-tested
 * without mounting the player page.
 */

/**
 * How long after boot the chip may still paint over live public content.
 *
 * Exported so the caller can arm a single timeout at exactly the boundary
 * (the player must NOT poll for this — no interval, no per-frame clock read).
 */
export const REPAIR_CHIP_BOOT_WINDOW_MS = 5 * 60_000;

export interface RepairChipPolicyInput {
  /** Server-stamped: this device's credential is unproven (`requiresRePair`). */
  repairRequired: boolean;
  /**
   * TRUE when the surface underneath the chip is an operator/diagnostic view
   * — the registering or pairing splash, the paused state, the "Screen Paired
   * Successfully" / "Content Unavailable" diagnostics card, or the info
   * overlay. FALSE when live assigned content is on the glass for the public.
   */
  onOperatorSurface: boolean;
  /** Milliseconds since this player page mounted. */
  msSinceBoot: number;
}

/**
 * Should the amber "Re-pair required" chip render right now?
 *
 * Truth first: never shown unless the server actually said the credential is
 * unproven. Then placement: always on an operator surface; on live public
 * content only inside the boot window described above.
 */
export function shouldShowRepairChip(opts: RepairChipPolicyInput): boolean {
  if (!opts.repairRequired) return false;
  if (opts.onOperatorSurface) return true;
  return opts.msSinceBoot < REPAIR_CHIP_BOOT_WINDOW_MS;
}
