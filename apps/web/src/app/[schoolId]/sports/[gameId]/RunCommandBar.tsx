'use client';

/**
 * RunCommandBar — the single live-console command bar.
 *
 * 2026-06-26 de-clutter: the prior "elegance" pass merged four strips into one
 * bar but LEFT the bar itself carrying five competing nav vocabularies (role
 * pills + spotlight + screens nub + send + status). Operator: "remove all these
 * fucking tabs and buttons… impossible to know what I'm supposed to do." So the
 * bar is now stripped to ONLY the live-essential glance + actions:
 *
 *   [matchup · LIVE chip]  ········  [status transitions] [exclusions ②] [More]
 *
 * The role switcher, spotlight, screens health, send-to-device, and the surface
 * launchers all moved into the single `moreMenu` (RunMoreMenu) — passed in as an
 * element so there's no circular import and the mutation/role logic is unchanged.
 * Solid white bg (no backdrop-blur) so the always-mounted chrome can't trip the
 * mobile-perf GPU guard.
 */
import { ReactNode } from 'react';

const STATUS_CHIP: Record<string, { label: string; cls: string; dot: string }> = {
  SCHEDULED: { label: 'Scheduled', cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  PRE_GAME: { label: 'Pre-game', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  LIVE: { label: 'Live', cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500 animate-pulse' },
  HALFTIME: { label: 'Halftime', cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  FINAL: { label: 'Final', cls: 'bg-slate-800 text-white border-slate-700', dot: 'bg-slate-400' },
};

export type ViewPill = { key: string; label: string; title: string };

export function RunCommandBar({
  gameName,
  status,
  penaltyLabel,
  penaltyCount,
  onPenalty,
  statusButtons,
  moreMenu,
}: {
  gameName: string;
  status: string;
  penaltyLabel: string | null;
  penaltyCount: number;
  onPenalty: () => void;
  statusButtons: ReactNode;
  moreMenu: ReactNode;
}) {
  const chip = STATUS_CHIP[status] || STATUS_CHIP.SCHEDULED;
  return (
    <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-slate-200 bg-white shrink-0 overflow-x-auto">
      {/* Identity + live status chip — one chip, glanceable game state. */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <span className="text-[13px] font-bold text-slate-900 truncate max-w-[160px] sm:max-w-[260px]" title={gameName}>
          {gameName}
        </span>
        <span
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest border shrink-0 ${chip.cls}`}
        >
          <span className={`w-2 h-2 rounded-full ${chip.dot}`} />
          {chip.label}
        </span>
      </div>

      {/* Right cluster: the only live-essential actions — game-state
          transitions for the current status, the live exclusions count, and
          the single More affordance for everything else. */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {statusButtons}

        {penaltyLabel && (
          <button
            type="button"
            onClick={onPenalty}
            title={`${penaltyLabel} — add / release early / clear exclusions`}
            className={`flex items-center gap-1 min-h-[40px] px-2.5 rounded-lg text-[13px] font-bold transition-colors ${
              penaltyCount > 0
                ? 'bg-amber-500 text-amber-950 hover:bg-amber-400'
                : 'text-slate-500 hover:bg-amber-50 hover:text-amber-700'
            }`}
          >
            <span aria-hidden>⏱</span>
            {penaltyCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-5 px-1 rounded-full bg-amber-950 text-amber-50 text-[11px] tabular-nums">
                {penaltyCount}
              </span>
            )}
          </button>
        )}

        {moreMenu}
      </div>
    </div>
  );
}
