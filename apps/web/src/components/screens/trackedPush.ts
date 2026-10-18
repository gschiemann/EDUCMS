/**
 * trackedPush — what the SERVER knows about an operator's "Send update" for one
 * screen (2026-10-18, unattended-updates piece 3). Pure: no React, no clock.
 *
 * A push used to be fire-and-forget: the API offered the APK on every check
 * for 24 hours, then dropped the push without a word, and this dashboard said
 * "Updating…" the whole time. The API now keeps the push (`Screen.forceApk
 * Update*`, apps/api/src/player-ota/push-tracking.ts) until the screen runs
 * the offered build or someone cancels it, and records why it stopped
 * offering it:
 *
 *   waiting    sent, not handed to the screen yet (it has not checked in)
 *   sent       handed to the screen; the install has not been confirmed
 *   needs-tap  Android on the screen is waiting for a person to tap Install
 *   stalled    offered and it did not install, with no reason from the screen
 *   failed     the screen reported that the install failed
 *   expired    not handed to the screen within 24 h of the push — it will not
 *              install by surprise later
 *
 * Read off the server's row, so it survives a page reload (unlike the
 * page's own `pushState`). An API that predates the tracked columns sends
 * none of them: the push then reads `waiting` / `sent` exactly as before.
 */

export type TrackedPushKind = 'waiting' | 'sent' | 'needs-tap' | 'stalled' | 'failed' | 'expired';

export interface TrackedPushRow {
  forceApkUpdatePendingAt?: string | null;
  forceApkUpdateHold?: string | null;
  forceApkUpdateHoldAt?: string | null;
  forceApkUpdateHoldReason?: string | null;
  forceApkUpdateOfferCount?: number | null;
  forceApkUpdateLastOfferAt?: string | null;
  forceApkUpdateTargetVersion?: string | null;
}

export interface TrackedPush {
  kind: TrackedPushKind;
  /** When the operator sent it (server clock). */
  pushedAtMs: number;
  /** How many times the server handed the APK to the screen for this push. */
  offers: number;
  lastOfferAtMs: number | null;
  /** When the server stopped offering it; null while it is still offering. */
  heldAtMs: number | null;
  /** The build the push offered, once it was offered. */
  targetVersion: string | null;
  /**
   * The server's stable reason code (the part of the hold reason before ':'),
   * e.g. `offer-limit-reached`, `did-not-land-unknown-class`. Never shown raw.
   */
  reason: string | null;
  /** The PackageInstaller code a FAILED hold names (`INCOMPATIBLE`), if any. */
  failedCode: string | null;
}

const HOLD_KIND: Record<string, TrackedPushKind> = {
  NEEDS_TAP: 'needs-tap',
  STALLED: 'stalled',
  FAILED: 'failed',
  EXPIRED: 'expired',
};

const msOf = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** The screen's pending push, or null when there is none. */
export function deriveTrackedPush(row: TrackedPushRow | null | undefined): TrackedPush | null {
  const pushedAtMs = msOf(row?.forceApkUpdatePendingAt);
  if (pushedAtMs === null || !row) return null;
  const offers = typeof row.forceApkUpdateOfferCount === 'number' && row.forceApkUpdateOfferCount > 0
    ? Math.floor(row.forceApkUpdateOfferCount)
    : 0;
  const heldKind = row.forceApkUpdateHold ? HOLD_KIND[row.forceApkUpdateHold] : undefined;
  const rawReason = (row.forceApkUpdateHoldReason ?? '').split(':')[0].trim();
  const reason = heldKind && /^[a-z0-9_-]{1,64}$/.test(rawReason) ? rawReason : null;
  const failed = reason?.match(/^device-reported-failed_([a-z0-9_]{1,40})$/);
  return {
    kind: heldKind ?? (offers > 0 ? 'sent' : 'waiting'),
    pushedAtMs,
    offers,
    lastOfferAtMs: msOf(row.forceApkUpdateLastOfferAt),
    heldAtMs: heldKind ? msOf(row.forceApkUpdateHoldAt) : null,
    targetVersion: (row.forceApkUpdateTargetVersion ?? '').trim() || null,
    reason,
    failedCode: failed ? failed[1].toUpperCase() : null,
  };
}

/** States the dashboard reports while a held push is being worked on at the glass. */
const ACTIVE_PROGRESS = new Set(['DOWNLOADING', 'VERIFYING', 'INSTALLING']);

/**
 * Does the hold still describe the screen? Not once the screen reported real
 * progress AFTER the hold — that is someone pressing Install now on the
 * panel, and its live progress is the truer line until it lands or the screen
 * says why it did not.
 */
export function holdIsCurrent(
  push: TrackedPush,
  report: { state?: string | null; at?: string | null },
): boolean {
  if (push.kind === 'waiting' || push.kind === 'sent') return false;
  const at = msOf(report.at);
  const progressSinceHold = at !== null && push.heldAtMs !== null && at > push.heldAtMs &&
    ACTIVE_PROGRESS.has(String(report.state ?? ''));
  return !progressSinceHold;
}
