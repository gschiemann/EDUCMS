'use client';

/**
 * ShowControlPanel — T3-3 Show Control scene launcher (2026-06-22).
 *
 * Operator question that drove this: "I see a halftime template but how would
 * I even trigger that during halftime?" Before this, the gameday scenes
 * (Halftime Board, Starting Lineup, Sponsors, This Week, Countdown) were
 * stranded in the template library with no way to push them to the board mid-
 * game. This strip — modelled on Daktronics Show Control / ScoreVision scene
 * recall — lets the operator TAKE a scene to the board with one tap; it
 * auto-reverts to the live scoreboard after a hold, and a big red BACK TO LIVE
 * is always one tap away (panic-to-live).
 *
 * Mechanics: each tile fires ctl.scene.mutate({templateId, holdMs}); the board
 * polls /sports/board/:id (750ms) and renders the recalled scene until it
 * expires SERVER-SIDE (so a closed laptop can't strand the board). The recall
 * response carries expiresAt, which drives the on-air countdown chip; the
 * countdown also fires a client-side clear at 0 as a courtesy safety net.
 */
import { useEffect, useRef, useState } from 'react';
import { Tv, Radio, Pause, Plus } from 'lucide-react';
import { useTemplates, useGameControl } from '@/hooks/use-api';

type SceneTpl = { id: string; name?: string };

export function ShowControlPanel({
  g,
  ctl,
}: {
  g: { id: string };
  ctl: ReturnType<typeof useGameControl>;
}) {
  const { data: templates } = useTemplates('GAMEDAY');
  const scenes: SceneTpl[] = Array.isArray(templates) ? (templates as SceneTpl[]) : [];

  // Locally-tracked on-air scene (what THIS console recalled). The board is the
  // display source of truth; this just drives the tile highlight + countdown.
  const [active, setActive] = useState<{ templateId: string; expiresAt: number } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const clearedRef = useRef(false);

  const HOLD_MS = 20_000; // default on-air hold before auto-revert

  const take = (templateId: string) => {
    clearedRef.current = false;
    ctl.scene.mutate(
      { templateId, holdMs: HOLD_MS },
      {
        onSuccess: (res: unknown) => {
          const exp = (res as { expiresAt?: number })?.expiresAt;
          setActive({ templateId, expiresAt: typeof exp === 'number' ? exp : Date.now() + HOLD_MS });
        },
      },
    );
  };

  const backToLive = () => {
    setActive(null);
    ctl.sceneClear.mutate();
  };

  const hold = () => {
    // Freeze the scene on-air (extend to the server's max ~1h) until the
    // operator taps Back to Live.
    ctl.sceneExtend.mutate(
      { holdMs: 3_600_000 },
      {
        onSuccess: (res: unknown) => {
          const exp = (res as { expiresAt?: number })?.expiresAt;
          if (active) setActive({ ...active, expiresAt: typeof exp === 'number' ? exp : active.expiresAt });
        },
      },
    );
  };

  const extend = () => {
    ctl.sceneExtend.mutate(
      { holdMs: HOLD_MS },
      {
        onSuccess: (res: unknown) => {
          const exp = (res as { expiresAt?: number })?.expiresAt;
          if (active) setActive({ ...active, expiresAt: typeof exp === 'number' ? exp : active.expiresAt + HOLD_MS });
        },
      },
    );
  };

  // Countdown + client safety-net auto-clear (server already reverts on expiry;
  // this keeps the panel honest and clears once at 0). Visible-only timer.
  useEffect(() => {
    if (!active) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const ms = active.expiresAt - Date.now();
      setRemaining(Math.max(0, ms));
      if (ms <= 0 && !clearedRef.current) {
        clearedRef.current = true;
        setActive(null);
        ctl.sceneClear.mutate();
      }
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const held = active && active.expiresAt - Date.now() > 600_000; // >10min ≈ "held"
  const secs = Math.ceil(remaining / 1000);
  const countdown = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  if (scenes.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-slate-200 bg-slate-50 overflow-x-auto">
      <span
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1 shrink-0"
        title="Push a full-screen scene (Halftime, Lineup, Sponsors…) to the board — it auto-reverts to the scoreboard"
      >
        <Tv className="h-4 w-4 text-slate-400" />
        <span className="hidden sm:inline">Show on board</span>
      </span>

      {/* Back to live — the always-available panic-to-scoreboard button. Loud
          (red) while a scene is on-air; quiet when the board is already live. */}
      <button
        type="button"
        onClick={backToLive}
        disabled={!active}
        title="Return the board to the live scoreboard"
        className={`min-h-[40px] px-3 rounded-full text-[13px] font-bold transition-colors shrink-0 flex items-center gap-1.5 ${
          active
            ? 'bg-red-600 text-white hover:bg-red-500'
            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
        }`}
      >
        <Radio className="h-4 w-4" />
        {active ? 'Back to live' : 'Live'}
      </button>

      {scenes.map((s) => {
        const on = active?.templateId === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => take(s.id)}
            title={`Show "${s.name || 'scene'}" on the board`}
            className={`min-h-[40px] px-3.5 py-1.5 rounded-full text-[13px] font-bold transition-colors shrink-0 ${
              on
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-indigo-400 hover:text-indigo-700'
            }`}
          >
            {s.name || 'Scene'}
            {on && <span className="ml-1.5 text-[10px] font-black tracking-widest text-indigo-100">ON AIR</span>}
          </button>
        );
      })}

      {/* On-air status: countdown + Hold + Extend. */}
      {active && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <span
            className="text-[12px] font-bold text-slate-600 tabular-nums"
            aria-live="polite"
          >
            {held ? 'Held on air' : `Back to live in ${countdown}`}
          </span>
          {!held && (
            <button
              type="button"
              onClick={hold}
              title="Keep this scene on the board until you tap Back to live"
              className="min-h-[36px] px-2.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[12px] font-bold hover:border-slate-400 flex items-center gap-1"
            >
              <Pause className="h-3.5 w-3.5" /> Hold
            </button>
          )}
          {!held && (
            <button
              type="button"
              onClick={extend}
              title="Add 20 seconds to the on-air time"
              className="min-h-[36px] px-2.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[12px] font-bold hover:border-slate-400 flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" /> 20s
            </button>
          )}
        </div>
      )}
    </div>
  );
}
