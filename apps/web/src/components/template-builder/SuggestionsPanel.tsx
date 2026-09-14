'use client';

// "Review" panel — surfaces the deterministic suggestion engine as one-tap-fix
// cards (flagship Slice 1a, 2026-06-16). Every fix funnels through the store's
// updateZone(id, patch, commit:true) so it lands as a normal, undoable edit —
// this also proves the external-mutation→commit→undo contract that the
// chat-to-edit agent (Slice 2) rides on. Zero network / zero AI cost.
import { useMemo } from 'react';
import { AlertTriangle, Lightbulb, Check, Wand2 } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { computeSuggestions } from './suggestions';

export function SuggestionsPanel() {
  const zones = useBuilderStore((s) => s.zones);
  const meta = useBuilderStore((s) => s.meta);
  const isTouchEnabled = useBuilderStore((s) => s.isTouchEnabled);
  const updateZone = useBuilderStore((s) => s.updateZone);
  const select = useBuilderStore((s) => s.select);

  const suggestions = useMemo(
    () =>
      computeSuggestions({
        zones,
        screenWidth: meta.screenWidth,
        screenHeight: meta.screenHeight,
        isTouchEnabled,
      }),
    [zones, meta.screenWidth, meta.screenHeight, isTouchEnabled],
  );

  const warnCount = suggestions.filter((s) => s.severity === 'warn').length;

  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-center gap-2 px-1 pb-1">
        <Wand2 className="w-4 h-4 text-indigo-500" aria-hidden />
        <h2 className="text-sm font-bold text-slate-800">Review</h2>
        {suggestions.length > 0 && (
          <span
            className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold ${
              warnCount > 0 ? 'bg-amber-500 text-amber-950' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {suggestions.length}
          </span>
        )}
      </div>

      <p className="text-[11px] text-slate-400 px-1 leading-relaxed">
        Automatic checks against what plays well on real screens — off-screen elements, finger-friendly
        tap targets, and accidental tiny pieces. Every fix is one tap and fully undoable.
      </p>

      {suggestions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <div className="w-11 h-11 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center">
            <Check className="w-5 h-5 text-emerald-500" aria-hidden />
          </div>
          <p className="text-sm font-semibold text-slate-700">No layout issues detected by these checks</p>
          <p className="text-[11px] text-slate-400 max-w-[240px]">
            Checked, per scene: off-screen elements, hairline sizes, tap-target size, overlapping text.
            Not checked: contrast, font size, brand palette, what the words say.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s) => {
            const isWarn = s.severity === 'warn';
            const Icon = isWarn ? AlertTriangle : Lightbulb;
            return (
              <li
                key={s.id}
                className={`rounded-xl border p-2.5 ${
                  isWarn ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'
                }`}
              >
                <button
                  type="button"
                  onClick={() => s.zoneId && select(s.zoneId, false, { source: 'panel' })}
                  className="w-full text-left flex items-start gap-2 focus:outline-none"
                  title={s.zoneId ? 'Select this element' : undefined}
                >
                  <Icon
                    className={`w-4 h-4 mt-0.5 shrink-0 ${isWarn ? 'text-amber-500' : 'text-slate-400'}`}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] font-bold text-slate-800 truncate">{s.title}</span>
                    <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{s.detail}</span>
                  </span>
                </button>
                {s.fix && s.zoneId && (
                  <div className="flex items-center gap-2 mt-2 pl-6">
                    <button
                      type="button"
                      onClick={() => {
                        updateZone(s.zoneId as string, s.fix!.patch, true);
                        select(s.zoneId as string, false, { source: 'panel' });
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <Wand2 className="w-3 h-3" aria-hidden />
                      {s.fix.label}
                    </button>
                    <span className="text-[10px] text-slate-400">one tap · undoable</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
