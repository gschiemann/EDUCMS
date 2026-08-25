"use client";

/**
 * BlastRadiusSummary — the one truthful line every publish surface shows
 * before it commits: "Publishes to N screens across M groups", plus the
 * actual screen names behind a disclosure, plus honest amber warnings when
 * the selection reaches nothing.
 *
 * Shared by all three publish paths so the answer can't drift between them:
 *   1. PlaylistCreateWizard — Step 5 Review
 *   2. /[schoolId]/playlists — the "Publish to Screens" bottom sheet
 *   3. PublishToLocationsModal — HQ fleet publish (groupNoun="location")
 *
 * Deliberately NOT a confirmation gate. No typed-confirm, no hold-to-trigger,
 * nothing modal-blocking on size. This is information the operator reads in
 * one glance; the only thing it ever disables is a schedule that provably
 * runs zero days (see `reachWarnings` → `no-days`, which the surfaces wire to
 * their commit button).
 *
 * All maths lives in `@/lib/blast-radius` (pure, unit-tested). This file is
 * presentation only.
 *
 * Layout notes: no flex `gap-*` / no `inset-*` (matches the
 * PlaylistCreateWizard house style it renders inside). Every name list wraps
 * and breaks rather than pushing the bottom sheet off-viewport, and the
 * disclosure is a full-width ≥44px touch target.
 */

import { useId, useState } from 'react';
import { Monitor, Layers, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import {
  blastRadiusLine,
  type BlastRadius,
  type ReachWarning,
} from '@/lib/blast-radius';

/** Above this many screens the name list starts collapsed. */
export const BLAST_COLLAPSE_ABOVE = 8;

export function BlastRadiusSummary({
  radius,
  warnings = [],
  groupNoun = 'group',
  verb = 'Publishes to',
  className = '',
}: {
  radius: BlastRadius;
  warnings?: ReachWarning[];
  /** "group" for a tenant's screen groups, "location" for the HQ fleet. */
  groupNoun?: string;
  verb?: string;
  className?: string;
}) {
  // The operator's manual toggle wins; until they touch it, small selections
  // show their names inline and big ones stay tidy.
  const [override, setOverride] = useState<boolean | null>(null);
  // useId (not a module counter) so the server and client agree on the
  // aria-controls target — a mismatch there is a React 19 hydration error.
  const panelId = `blast-radius-panel-${useId()}`;
  const expandable = radius.screenCount > 0 || radius.groups.length > 0;
  // Small selections show their names inline; big ones stay tidy. A picked
  // group that resolves to zero screens counts as "small" on purpose — the
  // breakdown IS the diagnostic ("Annex — no screens"), so never hide it.
  const autoOpen = expandable && radius.screenCount <= BLAST_COLLAPSE_ABOVE;
  const open = override ?? autoOpen;
  const zero = radius.screenCount === 0;

  return (
    <div className={className}>
      <div
        className={`rounded-xl border px-3 py-2.5 ${
          zero ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-slate-50/70'
        }`}
      >
        <div className="flex items-start">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mr-2.5 ${
              zero ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            }`}
            aria-hidden
          >
            <Monitor className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm font-bold leading-snug break-words ${
                zero ? 'text-amber-800' : 'text-slate-800'
              }`}
              aria-live="polite"
            >
              {blastRadiusLine(radius, { verb, groupNoun })}
            </p>
            {expandable && (
              <button
                type="button"
                onClick={() => setOverride(!open)}
                aria-expanded={open}
                aria-controls={panelId}
                className="mt-1 -ml-1 inline-flex items-center min-h-[44px] px-1 text-xs font-semibold text-slate-500 hover:text-slate-800 rounded-lg"
              >
                {open ? (
                  <ChevronDown className="w-3.5 h-3.5 mr-1" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 mr-1" />
                )}
                {open ? 'Hide the list' : `Show which screen${radius.screenCount === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>

        {expandable && open && (
          <div id={panelId} className="mt-1 pt-2 border-t border-slate-200/80">
            {radius.groups.map((g) => (
              <div key={g.id} className="mb-2 last:mb-0">
                <div className="flex items-center">
                  <Layers
                    className={`w-3.5 h-3.5 shrink-0 mr-1.5 ${g.empty ? 'text-amber-500' : 'text-emerald-600'}`}
                    aria-hidden
                  />
                  <span className="text-xs font-bold text-slate-700 truncate">{g.name}</span>
                  <span
                    className={`ml-2 shrink-0 text-[10px] font-bold uppercase tracking-wider ${
                      g.empty ? 'text-amber-600' : 'text-slate-400'
                    }`}
                  >
                    {g.empty ? 'no screens' : `${g.screenCount} screen${g.screenCount === 1 ? '' : 's'}`}
                  </span>
                </div>
                {g.screenNames.length > 0 && (
                  <p className="ml-5 text-[11px] text-slate-500 leading-relaxed break-words">
                    {g.screenNames.join(' · ')}
                  </p>
                )}
              </div>
            ))}
            {radius.ungroupedScreenNames.length > 0 && (
              <div>
                {radius.groups.length > 0 && (
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                    Individually picked
                  </p>
                )}
                <p className="text-[11px] text-slate-500 leading-relaxed break-words">
                  {radius.ungroupedScreenNames.join(' · ')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {warnings.map((w) => (
        <div
          key={w.kind}
          role={w.blocking ? 'alert' : undefined}
          className="mt-2 flex items-start rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mr-2 mt-0.5" aria-hidden />
          <p className="text-xs text-amber-800 leading-snug min-w-0 break-words">{w.message}</p>
        </div>
      ))}
    </div>
  );
}

export default BlastRadiusSummary;
