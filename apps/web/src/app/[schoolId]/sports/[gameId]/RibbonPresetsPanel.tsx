'use client';

/**
 * VenueOS Sports — ribbon content presets.
 *
 * The stadium ribbon scrolls a reel of content tiles. This panel is
 * the operator's on/off switchboard for what rides that reel — the
 * score, the game clock, the period, the sport-specific game
 * situation, plus the engagement tiles (crowd messages, player
 * spotlights, sponsors).
 *
 * The catalog is SPORT-AWARE (`ribbonPresetCatalog`): a clockless
 * sport has no "Time remaining" toggle, and every label adapts —
 * baseball shows "Inning", football "Quarter"; baseball's situation
 * is "Count & bases", football's is "Down & distance". Saved through
 * the ribbon-presets endpoint; the ribbon picks it up within ~1s (it
 * polls the same board feed every 750ms).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGame, useGameControl } from '@/hooks/use-api';
import { findSport, ribbonPresetCatalog } from '@cms/api-types';
import type { RibbonPreset } from '@cms/api-types';

/** A pill switch — on = indigo, off = slate. */
function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? 'bg-indigo-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </span>
  );
}

/** One preset toggle row — the whole row is the switch. */
function PresetRow({
  preset,
  on,
  onToggle,
}: {
  preset: RibbonPreset;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{preset.label}</span>
        <span className="block text-xs text-slate-400">{preset.hint}</span>
      </span>
      <Toggle on={on} />
    </button>
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

  // Local enabled set, seeded once from the game's resolved presets —
  // don't re-seed on later polls or an in-progress edit gets yanked.
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && game) {
      seeded.current = true;
      const saved = (game as { ribbonPresets?: string[] }).ribbonPresets || [];
      setEnabled(new Set(saved));
    }
  }, [game]);

  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  if (!game || !def) {
    return <p className="text-xs text-slate-400">Loading ribbon presets…</p>;
  }

  const toggle = (key: string) => {
    setSaved(false);
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    // Persist in catalog order for a stable, predictable reel.
    const presets = catalog.map((p) => p.key).filter((k) => enabled.has(k));
    await ctl.ribbonPresets.mutateAsync({ presets });
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2400);
  };

  const onCount = catalog.filter((p) => enabled.has(p.key)).length;
  const core = catalog.filter((p) => p.group === 'core');
  const engagement = catalog.filter((p) => p.group === 'engagement');

  return (
    <div>
      <p className="mb-3 text-xs text-slate-400">
        Pick what scrolls on the stadium ribbon for this {def.name.toLowerCase()} game.
        Toggle a tile off to drop it from the reel.
      </p>

      <div className="space-y-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Game</p>
        {core.map((p) => (
          <PresetRow
            key={p.key}
            preset={p}
            on={enabled.has(p.key)}
            onToggle={() => toggle(p.key)}
          />
        ))}
      </div>

      <div className="mt-3 space-y-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Engagement
        </p>
        {engagement.map((p) => (
          <PresetRow
            key={p.key}
            preset={p}
            on={enabled.has(p.key)}
            onToggle={() => toggle(p.key)}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={ctl.ribbonPresets.isPending} className="gap-1.5">
          {ctl.ribbonPresets.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : null}
          {saved ? 'Saved' : 'Save ribbon presets'}
        </Button>
        <span className="text-xs text-slate-400">
          {onCount} of {catalog.length} tile{catalog.length === 1 ? '' : 's'} on
        </span>
      </div>
    </div>
  );
}
