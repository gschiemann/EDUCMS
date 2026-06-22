'use client';

/**
 * useConsoleFit — make the desktop sports Run scoreboard auto-fit one pane.
 *
 * THE BUG (2026-06-21, operator on a real PC): the centre clock tile and the
 * two team tiles had hard `min-h-[280px]` / `min-h-[220px]` floors and a
 * text-8xl clock. On a laptop the pinned-bottom stack (ribbon + roster + cues
 * + tray) plus the page chrome leaves the `flex-1` scoreboard region shorter
 * than that fixed content, so it scrolled and the clock CONTROL row
 * (Start/reset/±1s/Set) clipped below the fold — the operator had to scroll to
 * run the clock mid-game.
 *
 * THE FIX: measure the scoreboard region and step the scoreboard's DENSITY down
 * one tier at a time until it fits — shrinking only NON-interactive height
 * (clock/score font, logo, paddings). The control buttons NEVER shrink (they
 * stay ≥44px in every tier), so this is the opposite of a transform:scale (which
 * the repo's FitOneLine docstring + CLAUDE.md warn breaks button hit-targets).
 * Self-correcting: it downshifts while the content overflows, so it's immune to
 * threshold mis-tuning — whatever the viewport, it lands on the loosest tier
 * that fits. Below the tightest tier (a pathologically short window) the region
 * keeps its existing overflow-y-auto as a documented last resort.
 *
 * Mechanics: the region is `flex-1`, so its size is set by the available space,
 * NOT its content — shrinking the scoreboard never changes the region size, so
 * the ResizeObserver can't feed back into a loop. The observer only fires on a
 * genuine layout change (window resize / pinned-stack collapse), where it resets
 * to the loosest tier and re-converges.
 */
import { RefObject, useEffect, useLayoutEffect, useState } from 'react';

export type FitTier = 'normal' | 'compact' | 'tight';

const ORDER: FitTier[] = ['normal', 'compact', 'tight'];

// Use layout effect in the browser (avoids a one-frame flash of the overflowing
// state) but fall back to useEffect on the server to dodge React's SSR warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useConsoleFit(
  regionRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): FitTier {
  const [tier, setTier] = useState<FitTier>('normal');

  // After each paint: if the scoreboard overflows its region, step DOWN a tier.
  // Converges in ≤2 passes and is stable once it fits (or reaches 'tight').
  useIsoLayoutEffect(() => {
    if (!enabled) return;
    const el = regionRef.current;
    if (!el) return;
    if (el.scrollHeight > el.clientHeight + 2) {
      setTier((t) => {
        const i = ORDER.indexOf(t);
        return i < ORDER.length - 1 ? ORDER[i + 1] : t;
      });
    }
  });

  // On a real region-size change (resize / pinned-stack collapse) or a late
  // webfont swap (which changes content height), reset to the loosest tier and
  // let the layout effect re-converge to the biggest type that still fits.
  useEffect(() => {
    if (!enabled) {
      setTier('normal');
      return;
    }
    const el = regionRef.current;
    if (!el) return;
    const reset = () => setTier('normal');
    const ro = new ResizeObserver(reset);
    ro.observe(el);
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => !cancelled && reset()).catch(() => {});
    }
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [enabled, regionRef]);

  return enabled ? tier : 'normal';
}

/**
 * Tier → Tailwind class fragments for each height-contributing element of the
 * desktop scoreboard. The control BUTTONS are deliberately absent — they keep
 * their full ≥44px size in every tier. Pure literal strings so Tailwind's JIT
 * scanner picks them up; downscale-only, so modern engines compute identical
 * layout at `normal`.
 */
export const FIT: Record<string, Record<FitTier, string>> = {
  clockTile: { normal: 'min-h-[280px] pt-5 pb-3', compact: 'min-h-[200px] pt-3 pb-2', tight: 'pt-2 pb-1' },
  clockText: { normal: 'text-7xl sm:text-8xl my-3', compact: 'text-6xl sm:text-7xl my-2', tight: 'text-5xl sm:text-6xl my-1' },
  ctrlRow: { normal: 'gap-1.5 mt-1', compact: 'gap-1.5 mt-1', tight: 'gap-1 mt-0.5' },
  teamTile: { normal: 'min-h-[220px] pt-3 pb-2', compact: 'min-h-[160px] pt-2 pb-1', tight: 'pt-1 pb-1' },
  teamLogo: { normal: 'h-20 w-20', compact: 'h-14 w-14', tight: 'h-10 w-10' },
  teamLogoImg: { normal: 'max-h-20 max-w-20', compact: 'max-h-14 max-w-14', tight: 'max-h-10 max-w-10' },
  teamName: { normal: 'mt-3', compact: 'mt-1.5', tight: 'mt-1' },
  scoreText: { normal: 'text-6xl sm:text-7xl my-2', compact: 'text-5xl sm:text-6xl my-1', tight: 'text-4xl sm:text-5xl my-0.5' },
  statRows: { normal: 'mt-3 pt-3', compact: 'mt-2 pt-2', tight: 'mt-1 pt-1' },
};
