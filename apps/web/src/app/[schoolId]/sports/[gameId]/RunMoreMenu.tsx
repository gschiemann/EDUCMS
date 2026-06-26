'use client';

/**
 * RunMoreMenu + OnAirBar — the de-cluttered Run console's two new pieces
 * (2026-06-26).
 *
 * Operator: "remove all these fucking tabs and buttons that make it impossible
 * to know what i am suppose to do and what the app can do, the UX is the worst
 * thing ive seen in my life." The prior redesigns were SPATIAL (4 strips -> 1
 * bar) and never STRUCTURAL — the live view still showed FIVE competing nav
 * vocabularies at once (mode tabs / role pills / surface launchers / ambient
 * cluster / scene strip). This pulls the structural lever:
 *
 *   RunMoreMenu  — ONE kebab "More" button -> a single grouped, labelled sheet
 *                  holding everything secondary (show-on-board scenes, switch
 *                  this device's role, spotlight, screens health, open a
 *                  surface, send to another device). Nothing deleted; nothing
 *                  shouting. This is the only discoverability affordance in the
 *                  live bar.
 *   OnAirBar     — the ONE secondary capability that earns a near-permanent
 *                  home: a slim red promote row (Back to live + countdown +
 *                  Hold/+20s) that auto-surfaces UNDER the command bar only
 *                  while a scene is actually on-air, and vanishes the instant
 *                  the board is back to the scoreboard.
 *
 * Solid backgrounds (no backdrop-blur) per the mobile-perf guard. The sheet is
 * a transient overlay (not always-mounted chrome), opened on demand.
 */
import { ReactNode, useState } from 'react';
import {
  MoreHorizontal,
  Radio,
  Tv,
  Star,
  RectangleHorizontal,
  ExternalLink,
  Keyboard,
  Send,
  Check,
  Copy,
  Pause,
  Plus,
  X,
  Settings,
} from 'lucide-react';
import type { ViewPill } from './RunCommandBar';
import type { useShowControl } from './useShowControl';

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
      {children}
    </div>
  );
}

function MenuRow({
  icon,
  label,
  hint,
  trailing,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  trailing?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left rounded-lg transition-colors min-h-[44px] ${
        active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      <span className={`shrink-0 ${active ? 'text-indigo-600' : 'text-slate-400'}`}>{icon}</span>
      <span className="flex-1 min-w-0 text-[14px] font-semibold truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11px] text-slate-400">{hint}</span>}
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  );
}

export function RunMoreMenu({
  gameId,
  onSetup,
  pills,
  view,
  onView,
  show,
  onSpotlight,
  onShare,
  onCopyStream,
  streamCopied,
  onShortcuts,
  screensNub,
}: {
  gameId: string;
  onSetup: () => void;
  pills: ViewPill[];
  view: string;
  onView: (key: string) => void;
  show: ReturnType<typeof useShowControl>;
  onSpotlight: () => void;
  onShare: () => void;
  onCopyStream: () => void;
  streamCopied: boolean;
  onShortcuts: () => void;
  screensNub: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Everything else — scenes, roles, surfaces, sharing"
        className="flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-slate-200 bg-slate-50 text-[13px] font-bold text-slate-700 hover:bg-slate-100 hover:border-slate-300 transition-colors shrink-0"
      >
        <MoreHorizontal className="h-[18px] w-[18px]" />
        <span className="hidden sm:inline">More</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end bg-slate-900/60 p-0 sm:items-start sm:p-4"
          onClick={close}
        >
          <div
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-2 shadow-2xl sm:mt-12 sm:mr-1 sm:max-w-sm sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="menu"
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[13px] font-bold text-slate-900">More</span>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <SectionLabel>Game</SectionLabel>
            <MenuRow
              icon={<Settings className="h-[18px] w-[18px]" />}
              label="Set up game"
              hint="teams · roster · displays"
              onClick={run(onSetup)}
            />

            {show.scenes.length > 0 && (
              <>
                <SectionLabel>Show on board</SectionLabel>
                {show.active && (
                  <MenuRow
                    icon={<Radio className="h-[18px] w-[18px]" />}
                    label="Back to live"
                    hint="scoreboard"
                    onClick={run(show.backToLive)}
                  />
                )}
                {show.scenes.map((s) => (
                  <MenuRow
                    key={s.id}
                    icon={<Tv className="h-[18px] w-[18px]" />}
                    label={s.name || 'Scene'}
                    active={show.active?.templateId === s.id}
                    hint={show.active?.templateId === s.id ? 'on air' : undefined}
                    onClick={run(() => show.take(s.id))}
                  />
                ))}
              </>
            )}

            <SectionLabel>Switch this device’s role</SectionLabel>
            {pills.map((p) => (
              <MenuRow
                key={p.key || 'full'}
                icon={<Tv className="h-[18px] w-[18px]" />}
                label={p.label}
                active={view === p.key}
                onClick={run(() => onView(p.key))}
              />
            ))}

            <SectionLabel>On this game</SectionLabel>
            <MenuRow
              icon={<Star className="h-[18px] w-[18px]" />}
              label="Spotlight a player or sponsor"
              onClick={run(onSpotlight)}
            />
            <MenuRow
              icon={<Tv className="h-[18px] w-[18px]" />}
              label="Screens"
              trailing={<span onClick={(e) => e.stopPropagation()}>{screensNub}</span>}
            />

            <SectionLabel>Open a surface</SectionLabel>
            <MenuRow
              icon={<RectangleHorizontal className="h-[18px] w-[18px]" />}
              label="Ribbon"
              trailing={<ExternalLink className="h-3.5 w-3.5 text-slate-400" />}
              onClick={run(() => window.open(`/ribbon/${gameId}`, '_blank'))}
            />
            <MenuRow
              icon={<Tv className="h-[18px] w-[18px]" />}
              label="Scoreboard"
              trailing={<ExternalLink className="h-3.5 w-3.5 text-slate-400" />}
              onClick={run(() => window.open(`/board/${gameId}`, '_blank'))}
            />
            <MenuRow
              icon={streamCopied ? <Check className="h-[18px] w-[18px] text-emerald-600" /> : <Copy className="h-[18px] w-[18px]" />}
              label={streamCopied ? 'Stream overlay URL copied' : 'Copy stream overlay URL'}
              onClick={onCopyStream}
            />
            <MenuRow
              icon={<Keyboard className="h-[18px] w-[18px]" />}
              label="Keyboard shortcuts"
              onClick={run(onShortcuts)}
            />

            <SectionLabel>Send to another device</SectionLabel>
            <MenuRow
              icon={<Send className="h-[18px] w-[18px]" />}
              label="Send a view to another device"
              onClick={run(onShare)}
            />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * OnAirBar — slim red promote row that appears UNDER the command bar only while
 * a gameday scene is on the board. Back to live (panic-to-scoreboard) +
 * countdown + Hold/+20s. Renders nothing when the board shows the scoreboard.
 */
export function OnAirBar({ show }: { show: ReturnType<typeof useShowControl> }) {
  if (!show.active) return null;
  return (
    <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-red-200 bg-red-50 shrink-0">
      <button
        type="button"
        onClick={show.backToLive}
        title="Return the board to the live scoreboard"
        className="min-h-[40px] px-3 rounded-full text-[13px] font-bold bg-red-600 text-white hover:bg-red-500 transition-colors shrink-0 flex items-center gap-1.5"
      >
        <Radio className="h-4 w-4" />
        Back to live
      </button>
      <span className="text-[12px] font-bold text-red-800 tabular-nums" aria-live="polite">
        {show.held ? 'Held on air' : `Back to live in ${show.countdown}`}
      </span>
      {!show.held && (
        <button
          type="button"
          onClick={show.hold}
          title="Keep this scene on the board until you tap Back to live"
          className="ml-auto min-h-[36px] px-2.5 rounded-lg bg-white border border-red-200 text-red-700 text-[12px] font-bold hover:border-red-400 flex items-center gap-1 shrink-0"
        >
          <Pause className="h-3.5 w-3.5" /> Hold
        </button>
      )}
      {!show.held && (
        <button
          type="button"
          onClick={show.extend}
          title="Add 20 seconds to the on-air time"
          className="min-h-[36px] px-2.5 rounded-lg bg-white border border-red-200 text-red-700 text-[12px] font-bold hover:border-red-400 flex items-center gap-1 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" /> 20s
        </button>
      )}
    </div>
  );
}
