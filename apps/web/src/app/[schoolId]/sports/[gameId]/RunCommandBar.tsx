'use client';

/**
 * RunCommandBar — the single console command bar (2026-06-22 elegance redesign;
 * 2026-06-24 absorbed the old page-header so Run mode shows ONE bar, not two).
 *
 * Operator: "look at all those fucking buttons and tabs at the top, we have like
 * 3 levels of shit and they are all not even user friendly." This is now the
 * ONLY top bar in Run mode. Left → right it carries: Back + game identity + a
 * live status chip · a role segmented control · an ambient action cluster
 * (Spotlight · Penalty · Screens-health nub · Send) · the live-surface launchers
 * (Ribbon · Scoreboard · Stream · Keys) folded into a compact icon group · a
 * Set-up jump.
 *
 * The game-state transition buttons (Go Live / Halftime / Final) render on the
 * scoreboard's top-right corner on desktop (see page.tsx); on mobile they stay
 * here in the bar (passed in as `statusButtons`, shown `md:hidden`) so a phone
 * operator never loses them off a narrow board.
 *
 * Pure presentational shell — every interactive piece is a passed-in callback or
 * element (no circular import with page.tsx; mutation/role logic stays put).
 * Solid white bg (no backdrop-blur) so the always-mounted chrome can't trip the
 * mobile-perf GPU guard.
 */
import { ReactNode } from 'react';
import {
  Star,
  Share2,
  ArrowLeft,
  RectangleHorizontal,
  Monitor,
  Copy,
  Check,
  Keyboard,
  Settings,
} from 'lucide-react';

const STATUS_CHIP: Record<string, { label: string; cls: string; dot: string }> = {
  SCHEDULED: { label: 'Scheduled', cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  PRE_GAME: { label: 'Pre-game', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  LIVE: { label: 'Live', cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500 animate-pulse' },
  HALFTIME: { label: 'Halftime', cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  FINAL: { label: 'Final', cls: 'bg-slate-800 text-white border-slate-700', dot: 'bg-slate-400' },
};

export type ViewPill = { key: string; label: string; title: string };

const iconBtn =
  'flex items-center justify-center min-h-[40px] min-w-[40px] rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors shrink-0';

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
  statusOnBoard,
  screensNub,
  onBack,
  onSetup,
  onRibbon,
  onScoreboard,
  onStream,
  streamCopied,
  onShortcuts,
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
  /** Game-state transition buttons. When `statusOnBoard` is true the desktop copy
   *  lives on the scoreboard's corner so these are mobile-only (md:hidden) here;
   *  when false (Show Caller / PA views have no board) they show on ALL
   *  breakpoints so a desktop operator never loses the transitions. */
  statusButtons: ReactNode;
  statusOnBoard: boolean;
  screensNub: ReactNode;
  onBack: () => void;
  onSetup: () => void;
  onRibbon: () => void;
  onScoreboard: () => void;
  onStream: () => void;
  streamCopied: boolean;
  onShortcuts: () => void;
}) {
  const chip = STATUS_CHIP[status] || STATUS_CHIP.SCHEDULED;
  return (
    <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-slate-200 bg-white shrink-0 overflow-x-auto">
      {/* Back + identity + live status chip — one glanceable cluster. */}
      <button
        type="button"
        onClick={onBack}
        title="Back to Game Day"
        aria-label="Back to Game Day"
        className={iconBtn}
      >
        <ArrowLeft className="h-[18px] w-[18px]" />
      </button>
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <span
          className="text-[13px] font-bold text-slate-900 truncate max-w-[130px] sm:max-w-[200px]"
          title={gameName}
        >
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

      {/* Right cluster: ambient actions · live-surface launchers · Set up. */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {/* Status transitions. When a board is on-screen the desktop copy lives on
            its corner, so here they're mobile-only; in Show Caller / PA views
            (no board) they show on every breakpoint so desktop keeps them. */}
        <span className={`${statusOnBoard ? 'md:hidden ' : ''}flex items-center gap-1.5`}>
          {statusButtons}
        </span>

        {showSpotlight && (
          <button
            type="button"
            onClick={onSpotlight}
            title="Spotlight a player or sponsor on the scoreboard AND the ribbon"
            aria-label="Spotlight"
            className="flex items-center justify-center min-h-[40px] min-w-[40px] rounded-lg text-slate-500 hover:bg-amber-50 hover:text-amber-700 transition-colors shrink-0"
          >
            <Star className="h-[18px] w-[18px]" />
          </button>
        )}

        {penaltyLabel && (
          <button
            type="button"
            onClick={onPenalty}
            aria-label={`${penaltyLabel} — add, release early, or clear`}
            title={`${penaltyLabel} — add / release early / clear exclusions`}
            className={`flex items-center gap-1 min-h-[40px] px-2.5 rounded-lg text-[13px] font-bold transition-colors shrink-0 ${
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
          className="flex items-center justify-center min-h-[40px] min-w-[40px] rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 transition-colors shrink-0"
        >
          <Share2 className="h-[18px] w-[18px]" />
        </button>

        <span className="w-px h-6 bg-slate-200 mx-0.5 shrink-0" aria-hidden />

        {/* Live-surface launchers — were a whole second toolbar row; now a
            compact icon group. (2026-06-24 — folded the page-header in here.) */}
        <button
          type="button"
          onClick={onRibbon}
          title="Open the stadium ribbon / fascia board in a new tab"
          aria-label="Open ribbon board"
          className={iconBtn}
        >
          <RectangleHorizontal className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onScoreboard}
          title="Open the scoreboard in a new tab"
          aria-label="Open scoreboard"
          className={iconBtn}
        >
          <Monitor className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onStream}
          title="Copy the transparent stream-overlay URL — add it as a Browser Source in OBS / vMix / Hudl (1920×1080)"
          aria-label="Copy stream overlay URL"
          className={iconBtn}
        >
          {streamCopied ? <Check className="h-[18px] w-[18px] text-green-600" /> : <Copy className="h-[18px] w-[18px]" />}
        </button>
        <button
          type="button"
          onClick={onShortcuts}
          title="Keyboard shortcuts (?)"
          aria-label="Show keyboard shortcuts"
          className={iconBtn}
        >
          <Keyboard className="h-[18px] w-[18px]" />
        </button>

        <span className="w-px h-6 bg-slate-200 mx-0.5 shrink-0" aria-hidden />

        <button
          type="button"
          onClick={onSetup}
          title="Switch to Set up"
          className="flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg text-[13px] font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors shrink-0"
        >
          <Settings className="h-[16px] w-[16px]" />
          <span className="hidden sm:inline">Set up</span>
        </button>
      </div>
    </div>
  );
}
