/**
 * The companion Manager's own update lane — RETIRED behind one switch
 * (2026-11-08, one release unit).
 *
 * THE FIELD FAILURE. `POST /api/v1/player/manager-update-check` resolved the
 * newest `manager-v*` GitHub release and handed it to every Manager that asked
 * (ManagerSelfUpdateWorker, every 30 minutes, every panel). Publishing a
 * Manager tag was therefore a FLEET-WIDE push within half an hour — no field
 * window, no tracked push, no canary, no hardware class, no off-hours: none of
 * the ladder every Player build climbs (field-candidate.ts, push-tracking.ts,
 * canary-auto-promote.ts, fleet-push-policy.ts). CLAUDE.md §7 forbids exactly
 * that. It also never fired for a month: the Manager's version was typed by
 * hand and never bumped, so two fixes sat unreleased.
 *
 * THE RULE. The Manager has ONE path to a screen: inside the Player APK, which
 * bundles it (`:app:bundleManagerApk`) and installs it on the device only when
 * the bundled versionCode is newer than the installed one (the Player's
 * ManagerBootstrap / ManagerUpgradeMath). The Player reaches the screen
 * through its own ladder, per screen and per class, so the Manager inherits
 * every gate. This endpoint therefore answers every Manager:
 *
 *     { uptoDate: true, installVia: 'player' }
 *
 * which Manager 1.0.24's worker reads as "no `latest` → up to date" and exits
 * before any network fetch (no download, no commit, no loop; its follow-up
 * "Manager v1.0.24 (up to date)" ota-state report is already discarded by
 * screens.controller as Manager-self noise). The unified Manager (≥ the unit
 * version) never calls this route at all.
 *
 * THE KILL SWITCH. `MANAGER_SELF_UPDATE_LEGACY_LANE=on` restores the previous
 * behaviour exactly (resolve the newest manager-v* release, policy-gate it,
 * offer it). It is the one-way kind the rulebook allows: unset = the gated
 * default, and a stale value can only re-open a lane the owner deliberately
 * re-opened. Failure direction: when the mode cannot be read, the lane is
 * 'player' — nothing is offered.
 *
 * Pure: no I/O, no clock. player-ota.controller.ts reads the verdict.
 */

export const MANAGER_LEGACY_LANE_ENV = 'MANAGER_SELF_UPDATE_LEGACY_LANE';

export type ManagerLaneMode = 'player' | 'legacy-github';

/** 'legacy-github' only when the variable is exactly `on` (case-insensitive, trimmed). */
export function managerLaneMode(env: Record<string, string | undefined> = process.env): ManagerLaneMode {
  const raw = env[MANAGER_LEGACY_LANE_ENV];
  if (typeof raw !== 'string') return 'player';
  return raw.trim().toLowerCase() === 'on' ? 'legacy-github' : 'player';
}

export interface InstallViaPlayerAnswer {
  uptoDate: true;
  installVia: 'player';
}

/**
 * The answer every Manager gets while the lane is retired. Deliberately
 * carries NO `latest` block — that absence is what the deployed 1.0.24 worker
 * treats as "up to date", and what keeps it from downloading anything.
 */
export function installViaPlayerAnswer(): InstallViaPlayerAnswer {
  return { uptoDate: true, installVia: 'player' };
}

/**
 * What Manager 1.0.24's ManagerSelfUpdateWorker does with an answer: it
 * downloads only when `latest.versionCode` is ABOVE its own versionCode.
 * Pinned here (and in the Manager's own ManagerUpdatePolicyTest) so the two
 * sides cannot drift: an answer is "safe for 1.0.24" when it starts no fetch.
 */
export function legacyWorkerWouldDownload(
  answer: { latest?: { versionCode?: unknown } | null } | null | undefined,
  callerVersionCode: number,
): boolean {
  const latest = answer?.latest;
  if (!latest || typeof latest !== 'object') return false;
  const vc = typeof latest.versionCode === 'number' ? latest.versionCode : 0;
  return vc > callerVersionCode;
}
