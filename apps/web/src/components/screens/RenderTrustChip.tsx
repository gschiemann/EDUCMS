"use client";

/**
 * RenderTrustChip — operator-facing render-proof trust line (2026-08-24).
 *
 * Surfaces the render-proof signal (Screen.lastRenderedAt / renderHealth,
 * apps/api/src/screens/render-proof.ts) directly on the Screens list, so
 * the industry's #1 signage complaint — "is my screen actually showing the
 * right thing?" — has a real, positive-proof answer instead of just a
 * ping-derived ONLINE badge (which a frozen kiosk still passes for free).
 * Classification is delegated to the pure `deriveRenderTrustGrade` in
 * `./renderTrust` (unit-tested there); this file is presentation only.
 *
 * Six variants (see renderTrust.ts grading — 2026-08-25 calm-down):
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
import { deriveRenderTrustGrade, type RenderHealth } from './renderTrust';

export function RenderTrustChip({
  status,
  renderHealth,
  renderStale,
  verifiedAgo,
  verifiedFull,
  lastRenderedAtMs,
  lastRenderedHash,
  authState,
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
  /** Server clock (ms) of the last render-proof POST — grades a stale
   *  signal into checking / alarm / chronic (2026-08-25 calm-down). */
  lastRenderedAtMs?: number | null;
  /** `Screen.lastRenderedHash` — separates a liveness-only (idle) proof
   *  from proof that operator content is on the glass (2026-08-25 v1.1.6). */
  lastRenderedHash?: string | null;
  /** `Screen.authState` — server-stamped credential verdict (2026-08-30);
   *  'REPAIR_REQUIRED' outranks the green states. */
  authState?: string | null;
}) {
  const variant = deriveRenderTrustGrade({
    status,
    renderHealth,
    renderStale,
    lastRenderedAtMs,
    lastRenderedHash,
    authState,
  });

  if (variant === 'offline') return null;

  // ── CREDENTIAL TRUST GONE (2026-08-30 reliability program) ──────────
  // The server downgraded this device to temporary 1-hour tokens
  // (`requiresRePair` at register). It may well be painting — which is
  // exactly why an unqualified green would be a lie. Amber, actionable,
  // and specific: the fix is a re-pair from the gear menu, nothing else.
  if (variant === 'repair-required') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-amber-500 text-amber-950 shadow-sm"
        title="This screen's trusted credential expired or was superseded — it is running on renewed temporary keys. Content continues, but re-pair it (gear menu → Re-pair) to restore full trust and instant realtime delivery."
      >
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
        Re-pair required{verifiedAgo ? ` · showing content ${verifiedAgo}` : ''}
      </span>
    );
  }

  // ── ALERT ON GLASS, SERVER UNREACHABLE (2026-08-30 deep audit A-F10) ──
  // The screen is correctly HOLDING an emergency it cannot re-confirm
  // (network/credential failure mid-alert). That posture is right — never
  // drop an alert on a failure — but an ALL-CLEAR cannot reach this screen
  // until it reconnects, and pretending otherwise is the lie this chip
  // ends. Red: this is the one to walk to.
  if (variant === 'alert-unconfirmed') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-red-600 text-white shadow-sm"
        title="This screen is showing an emergency alert it has NOT been able to re-confirm with the server for 2+ minutes (network or credential failure mid-alert). Holding the alert is correct — but an all-clear cannot reach it until it reconnects. If the emergency is over, clear this screen in person or restore its connection."
      >
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
        Showing alert — lost server contact{verifiedAgo ? ` · ${verifiedAgo}` : ''}
      </span>
    );
  }

  // ── VIDEO FROZEN ON GLASS (2026-08-30 deep audit D-2) ───────────────
  // The compositor paints (heartbeats green everywhere else) but the
  // active video hasn't advanced a frame — the player's stall watchdog is
  // mid-recovery. If recovery fails it fails the item and the rotation
  // moves on, so this chip is usually transient; chronic appearances mean
  // a broken file or a decoder problem on that hardware.
  if (variant === 'media-stalled') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-orange-500 text-orange-950 shadow-sm"
        title="The screen is alive, but its current video has not advanced a frame for 12+ seconds. The player is auto-recovering (reload, then skip the item). If this keeps appearing, the file or this device's decoder is the problem."
      >
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
        Video stuck — fixing itself{verifiedAgo ? ` · ${verifiedAgo}` : ''}
      </span>
    );
  }

  if (variant === 'painting') {
    return (
      <span
        className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600"
        title={
          verifiedFull
            ? `This screen confirmed its content is on the glass — last check ${verifiedFull}`
            : 'This screen is confirming its content is on the glass'
        }
      >
        Showing content ✓{verifiedAgo ? ` · checked ${verifiedAgo}` : ''}
      </span>
    );
  }

  // ── ALIVE, NOTHING SCHEDULED (2026-08-25, v1.1.6) ──────────────────
  // A brand-new panel used to show NOTHING here, and on the night of the
  // field install "nothing" read as "broken". It is now a positive, calm
  // statement of the actual situation — the panel is painting, there is
  // just no content on it yet. Deliberately not green: green is reserved
  // for proof that the operator's OWN content is on the glass.
  if (variant === 'idle') {
    return (
      <span
        className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700"
        title="This screen is on and working — there is just no content scheduled for it yet. Schedule a playlist and this turns green."
      >
        Screen on · nothing scheduled yet{verifiedAgo ? ` · ${verifiedAgo}` : ''}
      </span>
    );
  }

  // ── PAUSED ON THE SCREEN (2026-09-01, TC22 field find) ─────────────
  // An operator stopped playback from the remote with content still
  // scheduled. This used to read "nothing scheduled" — false. Say what the
  // player proves: alive, content assigned, waiting for Resume on the glass.
  if (variant === 'paused') {
    return (
      <span
        className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700"
        title="Someone paused playback on the screen itself (remote: Back, then Stop). The scheduled content is still assigned and plays again as soon as Resume is pressed on the screen."
      >
        Paused on the screen{verifiedAgo ? ` · ${verifiedAgo}` : ''}
      </span>
    );
  }

  // Stale under 5 minutes — the reload/OTA self-healing window. A soft
  // "checking" instead of the siren: red chips that fire during every
  // refresh push train the operator to ignore the one red that matters
  // (operator, launch night: "why do i get these bright ass red alerts all
  // the time now").
  if (variant === 'checking') {
    return (
      <span
        className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700"
        title="The screen paused its picture check-ins a moment ago — usually a reload or an update in progress. This turns into a red alert only if it stays quiet past 5 minutes."
      >
        Confirming picture{verifiedAgo ? `… · last seen ${verifiedAgo}` : '…'}
      </span>
    );
  }

  // Stale beyond 48 hours — chronic condition, documented calmly. The red
  // alarm is reserved for "WAS painting recently and stopped".
  if (variant === 'stale-chronic') {
    return (
      <span
        className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500"
        title="This screen has not confirmed a picture in over 48 hours. Long-idle screens and older player versions both land here — worth a look when convenient, but it is not an emergency."
      >
        No picture confirmed{verifiedAgo ? ` since ${verifiedFull ?? verifiedAgo}` : ' in 48h+'}
      </span>
    );
  }

  if (variant === 'not-painting') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-red-600 text-white shadow-sm"
        title="This screen is connected and answering, but it has not shown us proof of a picture — it may be stuck or dark. Try Refresh web (or Restart) from the gear menu; if that does not fix it, someone should look at the physical screen."
      >
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
        No picture confirmed{verifiedAgo ? ` · last picture ${verifiedAgo}` : ''} — still responds
      </span>
    );
  }

  // 'unknown' — quiet neutral, never an alarm.
  return (
    <span
      className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400"
      title="This screen's player app is too old to confirm its picture (or it just paired). Not a failure — update the player app to get picture confirmations."
    >
      Can&rsquo;t confirm picture yet · older player
    </span>
  );
}
