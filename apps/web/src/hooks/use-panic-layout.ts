'use client';

/**
 * usePanicLayout — which of four shapes /panic's idle panel takes (2026-11-23).
 *
 * The panel is a header / title / LIVE | DRILL / alert line / "Send to" stack
 * (about 330 px tall at 390 wide) above the six trigger buttons, which are
 * sized by their grid rows. On a phone held sideways (844 × 390) that stack
 * left nothing for the rows and the buttons measured about 2 px tall; at
 * 390 × 480 they were 28 px, and below about 634 px tall with an alert line
 * they were not circles. So:
 *
 *   'tall'    — 800 px or taller, any orientation. Exactly what it was.
 *   'compact' — under 800 px tall and not phone landscape: every short
 *               portrait phone, and laptop windows and tablets in landscape
 *               541–799 px tall. A compacted stack and three buttons across.
 *   'land2x3' — phone landscape that is narrow (under 700 px wide and an
 *               aspect ratio under 9/4: 568 × 320, 640 × 360, 667 × 375).
 *               The stack becomes a status column on the left; the buttons
 *               get their own fixed area on the right, two across.
 *   'land3x2' — every other phone landscape: the same, three across.
 *
 * One string from one store, so a media change is one commit and the page can
 * change classes in place without remounting a button under a finger.
 *
 * All three queries are classic media syntax: Tailwind v4's `min-[..]` /
 * `max-[..]` variants compile to range syntax, which Safari matches only from
 * 16.4. Event-driven ('change' listeners, no polling), with the old
 * addListener pair for Safari before 14. 'tall' on the server (and wherever
 * there is no matchMedia, as in jsdom), so SSR and the first client paint
 * agree, as with use-short-landscape.ts.
 */
import { useSyncExternalStore } from 'react';
import { SHORT_LANDSCAPE_QUERY } from './use-short-landscape';
import { SHORT_PANIC_SCREEN_QUERY } from './use-short-panic-screen';

export type PanicLayout = 'tall' | 'compact' | 'land2x3' | 'land3x2';

/** In phone landscape: wide enough for three buttons across beside the status column. */
export const PANIC_WIDE_LANDSCAPE_QUERY = '(min-width: 700px), (min-aspect-ratio: 9/4)';

const QUERIES = [SHORT_LANDSCAPE_QUERY, PANIC_WIDE_LANDSCAPE_QUERY, SHORT_PANIC_SCREEN_QUERY];

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const offs = QUERIES.map((query) => {
    const mql = window.matchMedia(query);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Safari < 14 only knows the old listener pair.
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  });
  return () => {
    for (const off of offs) off();
  };
}

function read(): PanicLayout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'tall';
  const m = (query: string) => window.matchMedia(query).matches;
  if (m(SHORT_LANDSCAPE_QUERY)) return m(PANIC_WIDE_LANDSCAPE_QUERY) ? 'land3x2' : 'land2x3';
  return m(SHORT_PANIC_SCREEN_QUERY) ? 'compact' : 'tall';
}

const serverLayout = (): PanicLayout => 'tall';

export function usePanicLayout(): PanicLayout {
  return useSyncExternalStore(subscribe, read, serverLayout);
}
