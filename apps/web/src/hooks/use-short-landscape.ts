'use client';

/**
 * useShortLandscape — is this a phone held sideways (or any other short, wide
 * window)? K-12 launch program, K12-F15 / F16 (2026-09-27).
 *
 * At 844 × 390 (an iPhone on its side) the operator's Run view used the
 * DESKTOP layout — width is past the `md` breakpoint — so the desktop sidebar
 * took a third of the width and the pinned control rows took all the height:
 * the scoreboard collapsed to nothing and the game could not be scored. At
 * 740 × 360 the phone layout's scrolling deck had ~70 px to show anything in.
 * A short landscape screen is its own shape, not a small desktop and not a
 * wide phone, so the Run view and the volunteer pad give it a two-pane
 * layout: the score and clock pinned on one side, the controls scrolling on
 * the other.
 *
 * Same query as the `short-land:` Tailwind variant (globals.css), which the
 * surfaces use for sizing; this hook is for the structural branch. It is
 * event-driven (a matchMedia 'change' listener, no polling) and reads false
 * on the server, so SSR and the first client paint agree.
 */
import { useSyncExternalStore } from 'react';

export const SHORT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 540px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(SHORT_LANDSCAPE_QUERY);
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  // Safari < 14 only knows the old listener pair.
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

function read(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(SHORT_LANDSCAPE_QUERY).matches
  );
}

export function useShortLandscape(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
