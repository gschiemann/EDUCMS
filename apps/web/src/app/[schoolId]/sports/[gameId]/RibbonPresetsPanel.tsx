'use client';

/**
 * VenueOS Sports — ribbon content settings.
 *
 * A compact switchboard for the stadium ribbon: which content tiles
 * ride the reel (score, period, clock, the sport-specific game
 * situation, crowd messages, roster, sponsors, image slides) and how
 * fast it scrolls.
 *
 * Every switch AUTO-SAVES — there is no Save button. A flip persists
 * immediately through the ribbon-presets / ribbon-speed endpoints and
 * the ribbon picks it up within ~1s (it polls the board feed every
 * 750ms). The catalog is sport-aware (`ribbonPresetCatalog`).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useGame, useGameControl } from '@/hooks/use-api';
import { findSport, ribbonPresetCatalog, RIBBON_SPEEDS } from '@cms/api-types';
import type { RibbonSpeed } from '@cms/api-types';

/** A small pill switch — on = indigo, off = slate. */
function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${
        on ? 'bg-indigo-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </span>
  );
}

export function RibbonPresetsPanel({ gameId }: { gameId: string }) {
  const { data: game } = useGame(gameId);
  const ctl = useGameControl(gameId);

  const def = useMemo(
    () => findSport((game as { sport?: string } | undefined)?.sport),
    [game],
  );
  const catalog = useMemo(() => (def ? ribbonPresetCatalog(def) : []), [def]);

  // Local state, seeded once from the game — don't re-seed on later
  // polls or an in-progress edit gets yanked.
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [speed, setSpeed] = useState<RibbonSpeed>('normal');
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && game) {
      seeded.current = true;
      const g = game as { ribbonPresets?: string[]; ribbonSpeed?: string };
      setEnabled(new Set(g.ribbonPresets || []));
      if (g.ribbonSpeed) setSpeed(g.ribbonSpeed as RibbonSpeed);
    }
  }, [game]);

  if (!game || !def) {
    return <p className="text-xs text-slate-400">Loading ribbon settings…</p>;
  }

  // Every change auto-saves immediately — no Save button.
  const toggle = (key: string) => {
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setEnabled(next);
    ctl.ribbonPresets.mutate({
      presets: catalog.map((p) => p.key).filter((k) => next.has(k)),
    });
  };
  const pickSpeed = (s: RibbonSpeed) => {
    setSpeed(s);
    ctl.ribbonSpeed.mutate({ speed: s });
  };

  const saving = ctl.ribbonPresets.isPending || ctl.ribbonSpeed.isPending;

  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5">
        {catalog.map((p) => {
          const on = enabled.has(p.key);
          return (
            <button
              key={p.key}
              type="button"
              role="switch"
              aria-checked={on}
              title={p.hint}
              onClick={() => toggle(p.key)}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-left transition-colors hover:border-indigo-300"
            >
              <span className="truncate text-sm font-medium text-slate-800">{p.label}</span>
              <Toggle on={on} />
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Speed
        </span>
        {RIBBON_SPEEDS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => pickSpeed(s.key)}
            className={`flex-1 rounded-md border px-1.5 py-1 text-xs font-semibold transition-colors ${
              speed === s.key
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-200 text-slate-600 hover:border-indigo-300'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
        {saving ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </>
        ) : (
          <>
            <Check className="h-3 w-3 text-green-500" /> Changes save automatically
          </>
        )}
      </p>
    </div>
  );
}
