"use client";

/**
 * LedPosterStandardCard — the tenant's standard LED poster size (2026-09-01).
 *
 * A NovaStar TB poster cannot report its own LED module size: the controller
 * knows the raster it drives, never the pitch bolted in front of it. The
 * operator runs 1.86 mm posters (320×1080) and 1.56 mm posters (~360×1200) in
 * the same fleet, so the size is STATED here once and every new poster
 * inherits it — until a screen sets its own canvas, which always wins.
 *
 * "Reset to 320×1080" writes NULL/NULL, which is a real value meaning "use the
 * built-in default", not "unset and broken".
 *
 * Feedback is honest and quiet: one inline "Saved" / "Could not save" line next
 * to the button — no toast, so re-saving twice cannot storm the screen. The
 * card carries no `backdrop-blur` (settings mounts under the always-mounted
 * mobile chrome; see CLAUDE.md mobile-perf standard).
 */

import { useEffect, useState } from 'react';
import { LayoutPanelTop, Loader2 } from 'lucide-react';
import {
  DEFAULT_POSTER_STANDARD, useSetTenantPosterStandard, useTenantPosterStandard,
} from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';

/** The two pitches in the fleet today. Anything else is typed in the fields. */
const PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: '1.86 mm · 320×1080', w: 320, h: 1080 },
  { label: '1.56 mm · 360×1200', w: 360, h: 1200 },
];

const MIN = 32;
const MAX = 8192;

/** Roles that may only look. Mirrors the server's RequireRoles on the PUT. */
const READ_ONLY_ROLES = ['CONTRIBUTOR', 'RESTRICTED_VIEWER'];

export function LedPosterStandardCard() {
  const standard = useTenantPosterStandard();
  const save = useSetTenantPosterStandard();
  const role = useUIStore((s) => s.user?.role);
  const readOnly = !!role && READ_ONLY_ROLES.includes(role);

  const [w, setW] = useState<string>('');
  const [h, setH] = useState<string>('');
  const [saved, setSaved] = useState(false);

  // Seed the fields from the server value, and re-seed whenever it changes
  // underneath (another admin, another tab). Keyed on the values themselves so
  // a load that arrives after first paint still fills the inputs.
  useEffect(() => {
    setW(String(standard.w));
    setH(String(standard.h));
  }, [standard.w, standard.h]);

  const nw = Number(w);
  const nh = Number(h);
  const valid =
    Number.isInteger(nw) && Number.isInteger(nh) &&
    nw >= MIN && nw <= MAX && nh >= MIN && nh <= MAX;
  const dirty = nw !== standard.w || nh !== standard.h;

  function commit(next: { w: number | null; h: number | null }) {
    setSaved(false);
    save.mutate(next, { onSuccess: () => setSaved(true) });
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4">
      <div className="px-6 py-4 border-b border-slate-100 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
          <LayoutPanelTop className="w-4 h-4 text-amber-600" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-700">LED posters</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Standard poster size — the module size of one panel. New posters use this
            until you set a size on the screen.
          </p>
        </div>
      </div>

      <div className="px-6 py-4">
        {/* Presets — one tap for the two pitches in the fleet. They fill the
            fields rather than saving behind the operator's back, so the value
            about to be written is always the one on screen. */}
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => {
            const active = nw === p.w && nh === p.h;
            return (
              <button
                key={p.label}
                type="button"
                disabled={readOnly}
                onClick={() => { setW(String(p.w)); setH(String(p.h)); setSaved(false); }}
                aria-pressed={active}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  active
                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:bg-amber-50/60'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-3 mt-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Width</span>
            <input
              type="number" inputMode="numeric" min={MIN} max={MAX}
              value={w}
              disabled={readOnly}
              onChange={(e) => { setW(e.target.value); setSaved(false); }}
              className="w-24 px-2 py-1.5 text-sm font-mono text-slate-700 bg-white border border-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </label>
          <span className="text-slate-300 pb-2">×</span>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Height</span>
            <input
              type="number" inputMode="numeric" min={MIN} max={MAX}
              value={h}
              disabled={readOnly}
              onChange={(e) => { setH(e.target.value); setSaved(false); }}
              className="w-24 px-2 py-1.5 text-sm font-mono text-slate-700 bg-white border border-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </label>

          <button
            type="button"
            disabled={readOnly || !valid || !dirty || save.isPending}
            onClick={() => commit({ w: nw, h: nh })}
            className="px-3 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>

          <button
            type="button"
            disabled={readOnly || save.isPending || standard.isDefault}
            onClick={() => commit({ w: null, h: null })}
            className="px-3 py-2 rounded-lg text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:border-slate-400 disabled:opacity-50 disabled:cursor-not-allowed"
            title={`Clear the org standard. Posters fall back to the built-in ${DEFAULT_POSTER_STANDARD.w}×${DEFAULT_POSTER_STANDARD.h}.`}
          >
            Reset to {DEFAULT_POSTER_STANDARD.w}×{DEFAULT_POSTER_STANDARD.h}
          </button>
        </div>

        {/* One quiet status line. It states what is actually stored — a
            default is named as a default, never dressed up as a saved choice. */}
        <div className="text-[11px] text-slate-500 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Current:{' '}
            <span className="font-mono text-slate-700">{standard.w}×{standard.h}</span>
            {standard.isDefault && <span className="text-slate-400"> (built-in default)</span>}
          </span>
          {standard.isError && <span className="text-amber-600">· Could not load the current value.</span>}
          {!valid && !readOnly && (
            <span className="text-amber-600">· Width and height must be whole numbers between {MIN} and {MAX}.</span>
          )}
          {save.isError && <span className="text-rose-600">· Could not save — try again.</span>}
          {saved && !save.isPending && !save.isError && <span className="text-emerald-600">· Saved.</span>}
          {readOnly && <span className="text-slate-400">· Read-only for your role.</span>}
        </div>
      </div>
    </div>
  );
}
