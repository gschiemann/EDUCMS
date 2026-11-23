'use client';

/**
 * useShortPanicScreen — is /panic on a screen too short for the six trigger
 * buttons AND the panic-phone row above them? (2026-11-23)
 *
 * The 2026-11-16 release train put the "Keep this phone ready" card (and, on
 * a phone that is set up, the "This phone is ready" line) directly above the
 * `flex-1 min-h-0` trigger grid, whose buttons are sized by their row. Every
 * pixel the card took came off the buttons: in Safari with its toolbars
 * showing (390 × 664) they shrank from 89 px to 65 px, below the 88 px floor
 * `emergency-targeting.spec.ts` holds them to. On a short screen the buttons
 * own the space, so /panic moves the phone row below them, out of their way.
 *
 * Why 799 px: on a 390 × 844 iPhone it matches in Safari whichever viewport
 * WebKit measures (about 664 with toolbars, about 750 without), and it leaves
 * the installed app at 844 and every screen 800 px or taller exactly as it
 * was. It also matches a short laptop browser window (about 657 px on a
 * 1366 × 768 screen), which gets the same layout.
 *
 * Same shape as `use-short-landscape.ts`: event-driven (a matchMedia 'change'
 * listener, no polling) and false on the server and in jsdom, so SSR and the
 * first client paint agree.
 */
import { useSyncExternalStore } from 'react';

export const SHORT_PANIC_SCREEN_QUERY = '(max-height: 799px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(SHORT_PANIC_SCREEN_QUERY);
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
    window.matchMedia(SHORT_PANIC_SCREEN_QUERY).matches
  );
}

export function useShortPanicScreen(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
