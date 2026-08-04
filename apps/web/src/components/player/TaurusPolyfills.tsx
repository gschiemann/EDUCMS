'use client';

/**
 * TaurusPolyfills — the two runtime Chromium-83/95/101 fixes, mountable on any
 * surface that ships to a NovaStar Taurus LED controller.
 *
 * ─── Why this file exists (2026-08-03) ───────────────────────────────────────
 * Both polyfills used to be installed by a `useEffect` inside
 * `apps/web/src/app/player/page.tsx` and NOWHERE else. But `/board`,
 * `/ribbon` and `/scorebug` render the SAME widget tree as the player — the
 * repo's own Taurus gate says so out loud (`apps/web/tools/
 * check-taurus-safety.cjs` → "Lane-6 P0: sports surfaces also render on
 * Taurus", which is why those three route dirs are in `SCAN_DIRS`). A
 * scoreboard reached by its standalone URL on a Taurus wall therefore lost
 * every flex `gap` and every container-query unit, while the identical widget
 * inside the player was fixed. This component is that `useEffect`, hoisted, so
 * one mount per surface keeps them in step.
 *
 * ─── What it does ────────────────────────────────────────────────────────────
 * Two independent legacy-Chromium fixes with DIFFERENT cutoffs:
 *   • flex `gap`                       — Chrome 84  → only the 83 box needs it
 *   • container-query units (cqmin/cqh)— Chrome 105 → the 83/95/101 boxes do
 *     (a Chrome 95 box supports gap but NOT cq units, so these must gate
 *     separately or the 95/101 boxes get missed).
 *
 * Each polyfill self-detects and no-ops where supported, so on every modern
 * browser this component installs NOTHING: `isFlexGapSupported()` and
 * `isCqUnitSupported()` both return true, the effect returns early, and not a
 * single timer or DOM pass is scheduled. Zero cost, zero regression, zero risk
 * to a demo on a laptop.
 *
 * On a Taurus it converts flex-container gaps to child margins after the first
 * paint and re-applies on a gentle 2.5s interval so freshly-swapped content (a
 * new playlist item, a new scene, a scoreboard template change) is fixed too.
 * The polyfills mark processed elements, so each pass only touches new DOM.
 * Every call is wrapped in try/catch — a polyfill must never be able to break
 * playback on a live board.
 *
 * Renders nothing.
 */

import { useEffect } from 'react';
import { isFlexGapSupported, applyFlexGapPolyfill } from '@/lib/flex-gap-polyfill';
import { isCqUnitSupported, applyCqUnitPolyfill } from '@/lib/cq-unit-polyfill';

/**
 * The hook form. `player/page.tsx` already had this exact effect inline and
 * calls the hook instead, so there is ONE implementation and the player + the
 * sports surfaces can no longer drift apart again.
 */
export function useTaurusPolyfills() {
  useEffect(() => {
    const needsGap = !isFlexGapSupported();
    const needsCq = !isCqUnitSupported();
    if (!needsGap && !needsCq) return; // fully modern engine → nothing to do
    const run = () => {
      if (needsGap) { try { applyFlexGapPolyfill(); } catch { /* never break playback */ } }
      if (needsCq) { try { applyCqUnitPolyfill(); } catch { /* never break playback */ } }
    };
    const raf = requestAnimationFrame(run); // initial, after first paint
    const id = setInterval(run, 2500);      // re-apply after content/scene swaps
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, []);
}

/** The component form — mountable from a server-component route layout. */
export function TaurusPolyfills() {
  useTaurusPolyfills();
  return null;
}

export default TaurusPolyfills;
