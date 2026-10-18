/**
 * Tracked APK pushes (2026-10-18, unattended-updates program piece 3).
 *
 * THE FIELD FAILURE. After an operator pushed v1.1.29 on 2026-10-15, the API
 * answered `install v1.1.29` to the M24 (an Android 9 "Commercial" panel) on
 * every 30-minute check for 24 hours. Each answer cost a full APK download
 * (48 in all), each install commit ended at Android's "Install?" dialog that
 * nobody was there to tap, and the dashboard said "Updating…" the whole time.
 * Then the 24-hour window expired and the push vanished without a word.
 *
 * Piece 2 (ota-install-state.ts, manager-lane-noise.ts) closed the loop itself:
 * the companion Manager's 30-minute check is never offered the Player, and a
 * screen that SAID it needs a tap is not offered the push again. This file is
 * the rest: a push now has a memory, and it ends VISIBLY.
 *   1. A push was fire-and-forget. Nothing remembered that the SAME offer had
 *      already been made, so nothing could notice that it never landed.
 *   2. The stalled-install check read `lastOtaState`, which the device itself
 *      overwrites with CHECKING at the head of every check — before the
 *      update-check that would have looked at it. It could never fire, and
 *      when it did it made the push disappear.
 *
 * The push carries its own state (Screen.forceApkUpdate* columns):
 *   offerCount / lastOfferAt — how often THIS push was handed to the device;
 *   target*                  — the build that was offered;
 *   hold                     — why the server stopped offering it.
 *
 * Holds are visible, never silent: the dashboard shows the push with its hold
 * until the screen reports the target build or an operator cancels it.
 *
 *   NEEDS_TAP  the install is waiting for a person to tap Install on the glass
 *              (the device said so, or it committed the install and the build
 *              did not land on a screen whose Android cannot install
 *              unattended). A tap on the panel's own Update button still
 *              works — that path never reaches this gate.
 *   STALLED    offered and given time to land, and the screen is still on the
 *              old build with no report that explains why — or it was offered
 *              PUSH_MAX_OFFERS times without ever reaching the install.
 *   FAILED     the device reported a terminal install failure (FAILED_<code>,
 *              or an install-step ERROR from an older player).
 *   EXPIRED    no check of this screen was handed the update within 24 h of
 *              the push (offline, outside its update window, held by a staged
 *              rollout, …), so the operator's intent is stale — no surprise
 *              install days later.
 *
 * WHY A CHECK THAT ARRIVES MID-DOWNLOAD IS OFFERED AGAIN. The Player enqueues
 * its one-shot check with WorkManager `ExistingWorkPolicy.REPLACE`
 * (PlayerApp.fireOtaCheckNow), and one dashboard push fires TWO of them within
 * a minute: the CHECK_FOR_UPDATES WebSocket nudge and the heartbeat's
 * `forceUpdatePending`. The second REPLACES the first — the download that was
 * offered may be cancelled. Answering the second "up to date" would leave
 * nothing installing, and the push would later be held as a NEEDS_TAP that is
 * not true. So until the device reports it COMMITTED the install
 * (INSTALLING), a new check is offered again — at most PUSH_MAX_OFFERS times
 * per push, which still ends the 48-download loop. Once the install is
 * committed, cancelling a worker cannot undo it: a check inside the settle
 * window is answered `installInFlight` and the commit is given time to land.
 *
 * WHO MAY MOVE THE STATE. `update-check` is anonymous by necessity (OTA-01).
 * An existing hold — and a NEEDS_TAP the screen reported for this push — is
 * honoured for every caller: withholding an offer can never install anything.
 * But only a DEVICE-AUTHENTICATED Player check may advance the record (count
 * an offer, infer a hold): otherwise anyone holding a fingerprint could stall
 * an operator's push by calling update-check twice. EXPIRED is purely
 * time-based, so any caller may observe it.
 *
 * Pure: the controller gathers the facts, this decides. No I/O, no clock.
 */
import type { SilentReadiness } from './auto-update-policy';
import { FAILED_STATE, pushWaitsForTap } from './ota-install-state';

export type PushHold = 'NEEDS_TAP' | 'STALLED' | 'FAILED' | 'EXPIRED';

export const PUSH_HOLDS: readonly PushHold[] = ['NEEDS_TAP', 'STALLED', 'FAILED', 'EXPIRED'];

/**
 * How long after an offer a COMMITTED install may still legitimately be
 * landing (a person reading the dialog, a slow package replace). Same 10
 * minutes as the stalled-install rule this replaces.
 */
export const PUSH_SETTLE_MS = 10 * 60_000;

/** A push no check of this screen was handed within this long is EXPIRED. */
export const PUSH_EXPIRE_MS = 24 * 60 * 60_000;

/**
 * Offers one push may make before it is STALLED. One dashboard push normally
 * costs two (the WebSocket nudge and the heartbeat both fire a check — see the
 * header), which leaves two more for a download that failed or was cut off.
 * The field loop this ends was 48.
 */
export const PUSH_MAX_OFFERS = 4;

export interface PushRecord {
  pendingAt: Date | null;
  hold: string | null;
  offerCount: number;
  lastOfferAt: Date | null;
  targetVersionCode: number | null;
}

export interface DeviceOtaReport {
  state: string | null;
  message: string | null;
  at: Date | null;
}

/**
 * silentUpdateReadiness(): 'silent' = Android 12+ and the Player is its own
 * installer of record — the only unattended install path we have (owner
 * decision 2026-10-17: VenueOS will not be the device owner).
 */
export type InstallReadiness = SilentReadiness;

export interface PushGateFacts {
  push: PushRecord;
  /** The build the caller reports running. */
  callerVersionCode: number;
  /** May this caller's check ADVANCE the record (see the header)? */
  callerAuthenticated: boolean;
  /**
   * A person pressed Install now on this panel (`source: "user"`). Honoured
   * only with `callerAuthenticated` — the same spoof-proofing as the
   * controller's panel-user-tap branch. Only a FIELD-candidate screen reaches
   * this gate with it (every other screen takes that branch first).
   */
  callerIsPerson?: boolean;
  /** The device's latest `ota-state` report (lastOtaState / Message / At). */
  report: DeviceOtaReport;
  readiness: InstallReadiness;
  now: Date;
}

export type PushGate =
  /** Hand the APK over (and count the offer when `tracked`). */
  | { action: 'offer'; reason: string; tracked: boolean }
  /** A committed install is still landing — answer up to date, no re-offer. */
  | { action: 'in-flight'; reason: string }
  /** Do not offer and change nothing (an unauthenticated caller, push past 24 h). */
  | { action: 'withhold'; reason: string }
  /** Do not offer. `record` = a NEW hold the controller must persist. */
  | { action: 'hold'; hold: PushHold; reason: string; record: boolean }
  /** The caller already runs the target build. */
  | { action: 'satisfied'; reason: string };

export function isPushHold(v: unknown): v is PushHold {
  return typeof v === 'string' && (PUSH_HOLDS as readonly string[]).includes(v);
}

/**
 * An ERROR report from the install step (as opposed to the download/verify
 * steps, which are worth one more try). Shipped players word every install
 * failure with "Install …" ("Install failed: FAILURE_ABORTED", "Install
 * stalled: …", "Install could not start automatically: …", "Install
 * succeeded but Player did not relaunch").
 */
export function isInstallPhaseError(message: string | null | undefined): boolean {
  return typeof message === 'string' && /\binstall(ed)?\b/i.test(message);
}

export function decidePushGate(f: PushGateFacts): PushGate {
  const p = f.push;
  if (!p.pendingAt) return { action: 'offer', reason: 'no-push', tracked: false };
  const nowMs = f.now.getTime();
  const pushAgeMs = nowMs - p.pendingAt.getTime();

  // 1. The caller already runs what was offered: the push is satisfied (the
  //    authenticated version report clears it; this only stops a re-offer).
  //    Checked before the hold, because a person tapping Install on a held
  //    push is exactly how a NEEDS_TAP push gets satisfied.
  if (p.targetVersionCode != null && f.callerVersionCode >= p.targetVersionCode) {
    return { action: 'satisfied', reason: 'caller-at-or-past-target' };
  }

  // 1b. A person standing at the panel asked for it: that is the one way a
  //     NEEDS_TAP push is finished, and the panel says "Install now" for a
  //     FAILED one too. Never held, never counted against the push.
  if (f.callerIsPerson && f.callerAuthenticated) {
    return { action: 'offer', reason: 'person-at-panel', tracked: false };
  }

  // 2. A recorded hold is honoured for every other caller.
  if (isPushHold(p.hold)) {
    return { action: 'hold', hold: p.hold, reason: `held-${p.hold.toLowerCase()}`, record: false };
  }

  // 3. The screen SAID it is waiting for a tap, after this push (piece 2's
  //    rule, kept for every caller — including a push armed before this
  //    record existed). Recorded only on an authenticated check.
  if (pushWaitsForTap({ pendingAt: p.pendingAt, lastOtaState: f.report.state, lastOtaAt: f.report.at })) {
    return { action: 'hold', hold: 'NEEDS_TAP', reason: 'device-reported-needs-tap', record: f.callerAuthenticated };
  }

  // 4. Never handed to the screen yet.
  if (p.offerCount <= 0 || !p.lastOfferAt) {
    if (pushAgeMs >= PUSH_EXPIRE_MS) {
      return { action: 'hold', hold: 'EXPIRED', reason: 'not-offered-within-24h', record: true };
    }
    return { action: 'offer', reason: 'first-offer', tracked: f.callerAuthenticated };
  }

  // From here the push WAS offered and the caller is still below the target.
  // An unauthenticated caller can neither prove that nor move the record: it
  // gets the old behaviour — the offer, untracked — inside the old 24-hour
  // window, and nothing after it (a screen whose credential broke must not be
  // handed a download every 6 hours forever).
  if (!f.callerAuthenticated) {
    return pushAgeMs < PUSH_EXPIRE_MS
      ? { action: 'offer', reason: 'untracked-unauthenticated', tracked: false }
      : { action: 'withhold', reason: 'unauthenticated-after-24h' };
  }

  const offerMs = p.lastOfferAt.getTime();
  // Only a report made AFTER the last offer says anything about it.
  const r = f.report.at && f.report.at.getTime() >= offerMs ? f.report : null;
  const st = r?.state ?? null;

  if (st && FAILED_STATE.test(st)) {
    return { action: 'hold', hold: 'FAILED', reason: `device-reported-${st.toLowerCase()}`, record: true };
  }
  if (st === 'ERROR' && isInstallPhaseError(r?.message)) {
    return { action: 'hold', hold: 'FAILED', reason: 'device-reported-install-error', record: true };
  }

  // The install was COMMITTED after the last offer. A replaced worker cannot
  // undo that, so give it time to land; then say what is most likely true.
  if (st === 'INSTALLING') {
    if (nowMs - offerMs < PUSH_SETTLE_MS) {
      return { action: 'in-flight', reason: `committed-${Math.round((nowMs - offerMs) / 1000)}s-after-offer` };
    }
    // Committed at least PUSH_SETTLE_MS ago, and the screen is still on the
    // old build with no failure report. On a screen whose Android cannot
    // install unattended that is the "Install?" dialog nobody tapped; on a
    // silent one the cause is unknown.
    if (f.readiness === 'silent') {
      return { action: 'hold', hold: 'STALLED', reason: 'silent-install-did-not-land', record: true };
    }
    return {
      action: 'hold',
      hold: 'NEEDS_TAP',
      reason: f.readiness === 'needs-tap' ? 'did-not-land-needs-tap-class' : 'did-not-land-unknown-class',
      record: true,
    };
  }
  // The install LANDED but Android would not let the app start again: the
  // new build reports itself once someone opens it. Never re-offer it.
  if (st === 'RELAUNCH_BLOCKED') {
    return { action: 'in-flight', reason: 'installed-relaunch-blocked' };
  }

  // Not committed: a download/verify error, an attempt still downloading
  // whose worker this check just replaced, or no word at all. Offer again —
  // a bounded number of times.
  if (p.offerCount < PUSH_MAX_OFFERS) {
    return {
      action: 'offer',
      reason: st === 'ERROR' ? 'retry-after-download-error' : 'reoffer-not-installed',
      tracked: true,
    };
  }
  return { action: 'hold', hold: 'STALLED', reason: 'offer-limit-reached', record: true };
}

/**
 * The human sentence stored beside a hold (Screen.forceApkUpdateHoldReason,
 * the OTA status line of a server-inferred NEEDS_TAP, the audit row). States
 * what the evidence proves, nothing more (player-reliability rule 10). The
 * dashboard words each hold from its own catalogue; this is the English record.
 */
export function holdSentence(
  hold: PushHold,
  reason: string,
  facts: { targetVersion: string | null; callerVersion: string | null; offeredAt: Date | null; offerCount?: number },
): string {
  const target = facts.targetVersion ? `v${facts.targetVersion}` : 'the update';
  const running = facts.callerVersion ? `v${facts.callerVersion}` : 'its current build';
  const offered = facts.offeredAt ? ` (offered ${facts.offeredAt.toISOString()})` : '';
  switch (hold) {
    case 'NEEDS_TAP':
      return reason === 'device-reported-needs-tap'
        ? `Android on this screen is waiting for someone to tap Install for ${target}.`
        : `${target}${offered} did not install; the screen is still on ${running}. ` +
          (reason === 'did-not-land-needs-tap-class'
            ? 'Android on this screen needs someone to tap Install.'
            : 'Most often Android is waiting for someone to tap Install on the screen.');
    case 'STALLED':
      return reason === 'offer-limit-reached'
        ? `${target} was offered ${facts.offerCount ?? PUSH_MAX_OFFERS} times and did not install; the screen is still on ${running}.`
        : `${target}${offered} did not install; the screen is still on ${running} and reported no reason.`;
    case 'FAILED':
      return `Installing ${target} failed on the screen (${reason.replace(/^device-reported-/, '')}).`;
    case 'EXPIRED':
      return 'The update was not handed to this screen within 24 hours of the push (it may have been offline, ' +
        'outside its update window, or held by a staged rollout), so the push was stopped and nothing will ' +
        'install later. Send the update again if it is still needed.';
  }
}

/**
 * Does this DEVICE-AUTHENTICATED version report satisfy the pending push?
 *
 * The long-standing rule is "the versionCode went up". Since pushes are
 * tracked rather than expired it also counts when the device runs at least
 * the build it was offered: the Manager's anonymous update-check reports the
 * installed Player's version too, and can move the stored version before the
 * Player's own authenticated report arrives — the increase is then invisible,
 * and only the target still proves the install. Callers must only use this
 * for authenticated reports (OTA-01).
 */
export function pushSatisfiedByReport(input: {
  pendingAt: unknown;
  priorVersionCode: unknown;
  reportedVersionCode: number;
  targetVersionCode: unknown;
}): boolean {
  if (!input.pendingAt) return false;
  const reported = input.reportedVersionCode;
  if (!Number.isFinite(reported) || reported <= 0) return false;
  if (reported > Number(input.priorVersionCode || 0)) return true;
  return typeof input.targetVersionCode === 'number' && reported >= input.targetVersionCode;
}

/**
 * Is the pending push still an install IN FLIGHT — i.e. something the wedge
 * detector must not race and the heartbeat should still announce? Not when it
 * is held (no install will be offered), and not past the 24 h window.
 */
export function pushIsActive(input: { pendingAt: unknown; hold: unknown }, nowMs: number): boolean {
  if (!input.pendingAt || isPushHold(input.hold)) return false;
  const t = new Date(input.pendingAt as string | Date).getTime();
  return Number.isFinite(t) && nowMs - t < PUSH_EXPIRE_MS;
}
