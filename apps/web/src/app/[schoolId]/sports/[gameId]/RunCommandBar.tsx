'use client';

/**
 * RunCommandBar — the single console command bar (2026-06-22 elegance redesign).
 *
 * Operator: "it seems so fucking messy" — the Run console had FOUR stacked
 * full-width toolbars (view/action rail · game-state strip · screens-health
 * strip · show-control strip) competing above the scoreboard with no hierarchy.
 * This collapses the first three into ONE slim bar: game identity + a status
 * chip (left) · a role segmented control (centre) · status-transition buttons +
 * Spotlight + Penalty + Screens-health nub + Send-to-device (right).
 *
 * Pure presentational shell — every interactive piece is passed in (the status
 * buttons and the screens nub come in as elements so there's no circular import
 * with page.tsx, and the mutation/role logic stays exactly where it was). Solid
 * white bg (no backdrop-blur) so the always-mounted chrome can't trip the
 * mobile-perf GPU guard.
 */
import { ReactNode } from 'react';
import { Star, ExternalLink } from 'lucide-react';

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
  pills,
  view,
  onView,
  showSpotlight,
  onSpotlight,
  penaltyLabel,
  penaltyCount,
  onPenalty,
  onShare,
  statusButtons,
  screensNub,
}: {
  gameName: string;
  status: string;
  pills: ViewPill[];
  view: string;
  onView: (key: string) => void;
  showSpotlight: boolean;
  onSpotlight: () => void;
  penaltyLabel: string | null;
  penaltyCount: number;
  onPenalty: () => void;
  onShare: () => void;
  statusButtons: ReactNode;
  screensNub: ReactNode;
}) {
  const chip = STATUS_CHIP[status] || STATUS_CHIP.SCHEDULED;
  return (
    <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-slate-200 bg-white shrink-0 overflow-x-auto">
      {/* Identity + live status chip — one chip, glanceable game state. */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <span className="text-[13px] font-bold text-slate-900 truncate max-w-[160px] sm:max-w-[220px]" title={gameName}>
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

      {/* Role segmented control — one control, not four loose pills. */}
      <div className="flex items-center bg-slate-100 rounded-xl p-0.5 shrink-0">
        {pills.map((p) => (
          <button
            key={p.key}
            type="button"
            title={p.title}
            onClick={() => onView(p.key)}
            aria-pressed={view === p.key}
            className={`min-h-[40px] px-3 py-1 rounded-lg text-[13px] font-bold transition-colors ${
              view === p.key ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Right cluster: live state transitions + ambient actions. */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {statusButtons}

        {showSpotlight && (
          <button
            type="button"
            onClick={onSpotlight}
            title="Spotlight a player or sponsor on the scoreboard AND the ribbon"
            aria-label="Spotlight"
            className="flex items-center justify-center min-h-[40px] min-w-[40px] rounded-lg text-slate-500 hover:bg-amber-50 hover:text-amber-700 transition-colors"
          >
            <Star className="h-[18px] w-[18px]" />
          </button>
        )}

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

        {screensNub}

        <button
          type="button"
          onClick={onShare}
          title="Send a role view (Scorekeeper / Show Caller / PA) to another phone or tablet"
          aria-label="Send to device"
          className="flex items-center justify-center min-h-[40px] min-w-[40px] rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
        >
          <ExternalLink className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}
