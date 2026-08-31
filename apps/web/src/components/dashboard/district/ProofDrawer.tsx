"use client";

/**
 * ProofDrawer — "show me the screens" for one deployment (Fleet Command
 * Phase 2, 2026-08-31).
 *
 * The convergence card answers "how far has my push got"; this drawer answers
 * the only question that follows — WHICH screens, and what happened to them.
 * A right-side slide-over so the operator never loses the fleet context behind
 * it (full-width on a phone, where a 420px panel would just be a bad modal).
 *
 * ── WHAT THIS SURFACE CAN AND CANNOT PROVE ──────────────────────────
 * The deployments payload carries a COUNT of targets, not their ids: a screen
 * clears its pending-refresh marker the moment it confirms, so the fleet rows
 * can only identify the screens STILL WAITING. Everything else is reported as
 * one honest aggregate ("Confirmed or superseded") rather than guessed at by
 * name. Under-claiming beats naming the wrong screen.
 *
 * Two independent truths per row, never merged: the render-proof chip says
 * whether a picture is confirmed on the glass; the ack chip says whether THIS
 * push landed. A screen can be happily showing yesterday's content.
 *
 * Dashboard surface (not player/widget) → CSS gap/inset are fine here. No
 * backdrop-blur anywhere: the mobile standard is explicit that blur on an
 * overlay is paid on every repaint of the animation (a solid scrim reads the
 * same and costs nothing).
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { RenderTrustChip } from '@/components/screens/RenderTrustChip';
import { useScreenEvents, type DeploymentRow, type ScreenEventKind } from '@/hooks/use-api';
import { useOverlayLock } from '@/hooks/use-overlay-lock';

/** The fleet-row subset the drawer renders (the caller maps fleet.screens). */
export interface ProofDrawerScreen {
  id: string;
  name: string;
  status: string;
  renderHealth?: 'OK' | 'STALE' | 'UNKNOWN' | null;
  renderStale?: boolean | null;
  /** Outstanding refresh value — compared by IDENTITY to the deployment's. */
  pendingRefreshAtMs?: number | null;
  /** Location this screen belongs to (fleet row's sourceTenant name). */
  locationName: string;
}

/**
 * Compact "time ago" — same wording as the Screens list so one product speaks
 * one language. Exported because the convergence card dates the same records.
 */
export function timeAgo(ts: string | number | Date): string {
  const then = typeof ts === 'string' || typeof ts === 'number' ? new Date(ts) : ts;
  const ms = then.getTime();
  if (!Number.isFinite(ms)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 45) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Every event kind in STANDARD-USER language. Engineer-speak is banned on this
 * surface — an operator reading their own screen's history should never meet
 * the word "manifest", "ack" or "credential".
 */
const EVENT_COPY: Record<ScreenEventKind, string> = {
  'refresh-requested': 'Update push sent',
  'auto-refresh-requested': 'VenueOS asked this screen to reload itself',
  'refresh-acked': 'Screen confirmed the update',
  'repair-required': 'Screen needs re-pairing',
  'credential-restored': 'Screen’s trust restored',
};

/** Has THIS push landed on this screen? A screen clears the value on confirm. */
function isWaiting(s: ProofDrawerScreen, valueMs: number): boolean {
  return s.pendingRefreshAtMs != null && s.pendingRefreshAtMs === valueMs;
}

function ScreenRow({ screen, valueMs }: { screen: ProofDrawerScreen; valueMs: number }) {
  const [open, setOpen] = useState(false);
  // Dormant until the operator asks — a collapsed row costs no request, and
  // there is no polling on this surface at all.
  const events = useScreenEvents(open ? screen.id : null);
  const waiting = isWaiting(screen, valueMs);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li className="border-t border-slate-100 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-slate-50"
      >
        <Chevron className="w-3.5 h-3.5 text-slate-300 shrink-0" aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-bold text-slate-800 truncate">{screen.name}</span>
          <span className="mt-1 flex items-center gap-1.5 flex-wrap">
            <RenderTrustChip
              status={screen.status}
              renderHealth={screen.renderHealth ?? null}
              renderStale={screen.renderStale ?? null}
            />
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${
                waiting ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              {waiting ? 'Waiting…' : 'Update confirmed'}
            </span>
          </span>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3 pl-9">
          <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
            Recent activity
          </h4>
          {events.isLoading ? (
            <Loader2 className="w-4 h-4 text-slate-300 animate-spin" aria-label="Loading recent activity" />
          ) : events.data?.events?.length ? (
            <ul className="space-y-1">
              {events.data.events.map((ev) => (
                <li key={ev.id} className="flex items-baseline gap-2 text-[11.5px]">
                  <span className="font-semibold text-slate-700">
                    {EVENT_COPY[ev.kind] ?? 'Something changed on this screen'}
                  </span>
                  <span className="text-slate-400 shrink-0">{timeAgo(ev.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] font-semibold text-slate-400">No recent activity recorded.</p>
          )}
        </div>
      )}
    </li>
  );
}

export function ProofDrawer({
  deployment,
  screens,
  locationNoun,
  onClose,
}: {
  deployment: DeploymentRow;
  /** The screens this drawer can name — today, the ones still waiting. */
  screens: ProofDrawerScreen[];
  /** Vertical-aware location nouns, e.g. { one: 'gym', many: 'gyms' }. */
  locationNoun: { one: string; many: string };
  onClose: () => void;
}) {
  useOverlayLock(); // mounts only while open — hides the mobile tab bar
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Group the named screens by location — an operator fixing a push walks a
  // building, not an id list.
  const groups = new Map<string, ProofDrawerScreen[]>();
  for (const s of screens) {
    const key = s.locationName || 'Unassigned';
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  // Targets this payload cannot attribute to a name. Equals the spec's
  // targetCount − waitingCount today (the caller passes waiting screens only);
  // a future API rev adding targetIds names them and drives this to zero.
  const unnamed = Math.max(0, deployment.targetCount - screens.length);
  const noun = groups.size === 1 ? locationNoun.one : locationNoun.many;

  return (
    <div className="fixed top-0 right-0 bottom-0 left-0 z-[9999]" role="dialog" aria-modal="true" aria-label={`Screens for ${deployment.label}`}>
      <div className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className="absolute top-0 right-0 bottom-0 w-full md:w-[420px] bg-white shadow-[0_0_40px_rgba(15,23,42,0.18)] flex flex-col animate-in slide-in-from-right duration-200 will-change-transform"
      >
        {/* ─── Header ────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-black text-slate-800 truncate">{deployment.label}</h2>
            <p className="text-[12px] font-bold text-slate-500 mt-0.5">
              {deployment.convergence.converged}/{deployment.targetCount} confirmed
              <span className="text-slate-300"> · </span>
              <span className="font-semibold text-slate-400">pushed {timeAgo(deployment.createdAt)}</span>
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-indigo-300 outline-none shrink-0"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        {/* ─── Body ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {screens.length === 0 ? (
            <p className="text-[12.5px] font-semibold text-slate-500">
              No screen is still waiting on this push.
            </p>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Still waiting · {screens.length} screen{screens.length === 1 ? '' : 's'} across {groups.size} {noun}
              </p>
              {Array.from(groups.entries()).map(([location, rows]) => (
                <div key={location} className="rounded-2xl border border-slate-200 mb-3">
                  <div className="px-4 py-2 border-b border-slate-100 text-[11px] font-black uppercase tracking-wider text-slate-500 truncate">
                    {location}
                  </div>
                  <ul>
                    {rows.map((s) => (
                      <ScreenRow key={s.id} screen={s} valueMs={deployment.valueMs} />
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}

          {unnamed > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                Confirmed or superseded ({unnamed})
              </h3>
              <p className="text-[11.5px] font-semibold text-slate-500 mt-1">
                These screens are no longer waiting on this push. We can&rsquo;t list them by name —
                a screen drops its marker for this push the moment it confirms, so all we can prove
                is the count.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
