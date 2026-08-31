"use client";

/**
 * BundleSkewChip — "this panel is still on an older page bundle"
 * (2026-08-25, "the dashboard lied to me")
 *
 * Player fixes ship in the WEB bundle and each panel reloads onto a new one
 * on its own schedule, so for up to ~20 minutes after a deploy a
 * freshly-fixed button and a genuinely dead button look identical from the
 * dashboard. This chip is the missing sentence. Classification is delegated
 * to the pure `deriveBundleSkew` in `./bundleSkew` (unit-tested there); this
 * file is presentation only — the same split `RenderTrustChip` uses.
 *
 * ── Deliberately quiet ───────────────────────────────────────────────
 * NEVER red. A stale bundle is a normal, self-healing state that every panel
 * passes through after every deploy, and the render-proof chip next door was
 * graded down for crying wolf on the very same night (operator: "why do i get
 * these bright ass red alerts all the time now"). So: slate, no icon fill, no
 * uppercase siren styling — a note, not an alert. Only the actionable case
 * renders at all; 'current', 'unknown' and 'offline' render nothing.
 *
 * ACTIONABLE, not just informative: the trailing "· Refresh" is a real button
 * wired to the row's EXISTING Refresh-web action (the same handler the gear
 * menu uses), so the operator can close the gap from the row instead of
 * reading a status and being left to guess what to do about it. Callers that
 * have no refresh handler get a plain label — the chip still tells the truth,
 * it just doesn't offer a control it can't honour.
 */

import { deriveBundleSkew } from './bundleSkew';

export function BundleSkewChip({
  status,
  reportedSha,
  deployedSha,
  onRefresh,
  refreshPending,
}: {
  /** Live-computed Screen.status (ONLINE / OFFLINE / PENDING / REVOKED). */
  status?: string | null;
  /** `Screen.lastBundleSha` — what the player reported it is running. */
  reportedSha?: string | null;
  /** What `/api/build-info` says is deployed right now. */
  deployedSha?: string | null;
  /** The row's existing Refresh-web handler. Omit to render a plain label. */
  onRefresh?: () => void;
  refreshPending?: boolean;
}) {
  const variant = deriveBundleSkew({ status, reportedSha, deployedSha });
  if (variant !== 'stale') return null;

  // Deliberately careful about Refresh: it SENDS a request (a REFRESH_WEB
  // push), it does not perform a reload. On a screen with no live push
  // channel — the "poll-only" chip on this same row — that request cannot
  // arrive, and the panel's own timer is what will close the gap. Saying
  // "Refresh to do it now" would be a small new overclaim inside the fix
  // for a big old one.
  const title =
    'This screen is running an older version of the player and will update ' +
    'itself soon: it checks every few minutes and reloads once nothing ' +
    'is mid-playback — usually within 5–20 minutes. Refresh asks it to ' +
    'reload now. Until then, very recent fixes may not have reached this ' +
    'screen yet.';

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500"
      title={title}
    >
      Player update waiting
      {onRefresh && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshPending}
            className="font-bold underline underline-offset-2 hover:text-slate-700 disabled:opacity-50 disabled:cursor-default"
          >
            {refreshPending ? 'Refreshing…' : 'Refresh'}
          </button>
        </>
      )}
    </span>
  );
}
