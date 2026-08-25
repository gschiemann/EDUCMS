"use client";

/**
 * RenderTrustChip — operator-facing render-proof trust line (2026-08-24).
 *
 * Surfaces the render-proof signal (Screen.lastRenderedAt / renderHealth,
 * apps/api/src/screens/render-proof.ts) directly on the Screens list, so
 * the industry's #1 signage complaint — "is my screen actually showing the
 * right thing?" — has a real, positive-proof answer instead of just a
 * ping-derived ONLINE badge (which a frozen kiosk still passes for free).
 * Classification is delegated to the pure `deriveRenderTrust` in
 * `./renderTrust` (unit-tested there); this file is presentation only.
 *
 * Four variants, three of them visible:
 *   painting     — green, quiet: "Rendering ✓ · verified {time} ago"
 *   not-painting — THE money state: reachable but no proof of a paint
 *                  within the render-proof window. Styled to break from
 *                  every other soft pastel chip on the row on purpose —
 *                  this is the one verdict an operator must not miss.
 *   unknown      — quiet neutral: no player build has reported yet. Never
 *                  styled as an alarm — an older player build or a screen
 *                  that JUST paired hasn't had a chance to prove anything.
 *   offline      — renders NOTHING. The screen's existing OFFLINE/PENDING/
 *                  REVOKED badge already owns that message; a second
 *                  neutral-or-alarming line next to it would double-alarm.
 *
 * No live ticker: `verifiedAgo` is a pre-formatted string the caller
 * computes once at render (page.tsx's own `timeAgo(screen.lastRenderedAt)`
 * — the same helper already used for the row's `lastPingAt` chip), so the
 * wording matches the rest of the row exactly and this component stays
 * free of date math. The Screens page already refetches on its normal
 * cadence, which is what advances the displayed age.
 */

import { AlertTriangle } from 'lucide-react';
import { deriveRenderTrust, type RenderHealth } from './renderTrust';

export function RenderTrustChip({
  status,
  renderHealth,
  renderStale,
  verifiedAgo,
  verifiedFull,
}: {
  /** Live-computed Screen.status (ONLINE / OFFLINE / PENDING / REVOKED). */
  status?: string | null;
  renderHealth?: RenderHealth | null;
  renderStale?: boolean | null;
  /** Pre-formatted relative time since the last render-proof POST, e.g.
   *  "18s ago" (page.tsx's `timeAgo(screen.lastRenderedAt)`). Null/undefined
   *  when there's no render-proof timestamp to show yet. */
  verifiedAgo?: string | null;
  /** Full datetime for the tooltip (page.tsx's `fullDateTime`), same
   *  chip-plus-tooltip pairing convention as the row's lastPingAt chip. */
  verifiedFull?: string | null;
}) {
  const variant = deriveRenderTrust({ status, renderHealth, renderStale });

  if (variant === 'offline') return null;

  if (variant === 'painting') {
    return (
      <span
        className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600"
        title={
          verifiedFull
            ? `Render-proof: last confirmed painted frame ${verifiedFull}`
            : 'Render-proof: painting normally'
        }
      >
        Rendering ✓{verifiedAgo ? ` · verified ${verifiedAgo}` : ''}
      </span>
    );
  }

  if (variant === 'not-painting') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-red-600 text-white shadow-sm"
        title="This screen answers its heartbeat (reachable) but has NOT proven a painted frame recently — the usual cause is a wedged or crashed renderer showing a stuck or black frame. Try Refresh web (or Restart) from the gear menu."
      >
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
        Reachable — but not painting{verifiedAgo ? ` (last verified ${verifiedAgo})` : ''}
      </span>
    );
  }

  // 'unknown' — quiet neutral, never an alarm.
  return (
    <span
      className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400"
      title="This player build hasn't reported render-proof yet — could be an older APK or a screen that just paired. Not a failure, just no evidence yet."
    >
      Render-proof: awaiting player update
    </span>
  );
}
