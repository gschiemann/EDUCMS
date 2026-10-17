/**
 * The companion Manager's Player-update lane, after its checks stopped being
 * offered the APK (2026-10-17, unattended-updates piece 2).
 *
 * Manager 1.0.24 — on every panel that cannot update it without a person,
 * i.e. most of the fleet — still runs its Player lane every 30 minutes, and
 * every path through it reports to /screens/status/:fp/ota-state:
 *   CHECKING   "v1.1.23 → checking"                  (before the check)
 *   UP_TO_DATE "v1.1.23 — no newer release offered"  (after the refusal)
 * Stored as-is, that UP_TO_DATE tells the dashboard "Already on v1.1.23 ✓" —
 * on a screen with a pending push that is behind, a false success every 30
 * minutes. Neither report says anything about the Player's update.
 *
 *  - CHECKING carries a message only the Manager writes (`… → checking`; the
 *    Player's own CHECKING has none), so it is recognised outright.
 *  - UP_TO_DATE is worded exactly like the Player's own, so it is recognised by
 *    timing: it arrives within seconds of a Manager check this API refused for
 *    the same fingerprint. In-process memory, bounded; on a multi-replica
 *    deploy a report that lands on another replica is simply stored, as before.
 *
 * Only ANONYMOUS reports are ever judged here (the caller checks): the Player
 * from 1.1.41 signs its reports with its device token. Manager 1.0.25 does not
 * run the lane at all once a Player is installed.
 */

const REFUSAL_ECHO_MS = 2 * 60_000;
const MAX_TRACKED = 5_000;
const refusedAt = new Map<string, number>();

/** player-ota.controller: a Manager check for this fingerprint was just refused. */
export function noteManagerCheckRefused(fingerprint: string, nowMs: number = Date.now()): void {
  if (!fingerprint) return;
  if (refusedAt.size >= MAX_TRACKED) refusedAt.clear();
  refusedAt.set(fingerprint, nowMs);
}

/** Is this anonymous OTA report the Manager's refused lane talking? */
export function isManagerLaneNoise(
  fingerprint: string,
  state: string,
  message: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (state === 'CHECKING') return typeof message === 'string' && /→ checking$/.test(message.trim());
  if (state !== 'UP_TO_DATE') return false;
  const at = refusedAt.get(fingerprint);
  return at !== undefined && nowMs - at >= 0 && nowMs - at <= REFUSAL_ECHO_MS;
}

/** Tests only. */
export function resetManagerLaneNoise(): void {
  refusedAt.clear();
}
