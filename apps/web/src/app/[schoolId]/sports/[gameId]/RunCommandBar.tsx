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
 *   [matchup · LIVE chip]  ········  [status transitions] [More]
 *
 * The role switcher, spotlight, screens health, send-to-device, the surface
 * launchers, AND the penalty/exclusion box manager all moved into the single
 * `moreMenu` (RunMoreMenu) — passed in as an element so there's no circular
 * import and the mutation/role logic is unchanged. (2026-06-26: the exclusions
 * nub left too — adding exclusions is the celebrate deck's "Exclusion" tile and
 * counts are the inline per-player stepper, so the bar nub only duplicated that
 * plus the rarely-used release-early manager, now one tap away under More.)
 * Solid white bg (no backdrop-blur) so the always-mounted chrome can't trip the
 * mobile-perf GPU guard.
 */
import { ReactNode } from 'react';
import { GameStatusPill } from './GameStatusPill';

export type ViewPill = { key: string; label: string; title: string };

export function RunCommandBar({
  gameName,
  status,
  statusButtons,
  moreMenu,
  leading,
  trailing,
  landscape = false,
}: {
  gameName: string;
  status: string;
  statusButtons: ReactNode;
  moreMenu: ReactNode;
  /** K12-F15 landscape phone: the console's back button rides here… */
  leading?: ReactNode;
  /** …and its emergency door, so the bar is the only chrome row. */
  trailing?: ReactNode;
  /** The matchup name is on the pinned score pane in landscape — here it is
   *  kept for screen readers only, so the actions fit one row. */
  landscape?: boolean;
}) {
  return (
    // K12-F15 — below md the bar WRAPS instead of scrolling sideways: at
    // 390 px "End game" was cut in half and More sat off-screen inside a
    // horizontal scroller nobody knows to swipe. The actions drop to a
    // second line when they do not fit; md+ keeps the single-row scroller.
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 sm:px-4 py-2 border-b border-slate-200 bg-white shrink-0 md:flex-nowrap md:overflow-x-auto">
      {leading}
      {/* Identity + live status chip — one chip, glanceable game state. */}
      <div className="flex items-center gap-2 min-w-0 max-md:max-w-full md:shrink-0">
        <span
          className={
            landscape
              ? 'sr-only'
              : 'text-[13px] font-bold text-slate-900 truncate min-w-0 max-w-[160px] sm:max-w-[260px]'
          }
          title={gameName}
        >
          {gameName}
        </span>
        <GameStatusPill status={status} />
      </div>

      {/* Right cluster: the only live-essential actions — game-state
          transitions for the current status, and the single More affordance
          for everything else. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 md:shrink-0 md:flex-nowrap">
        {statusButtons}
        {moreMenu}
        {trailing}
      </div>
    </div>
  );
}
